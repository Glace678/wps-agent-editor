import { createHash, createPublicKey, verify as verifyEd25519 } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { parseArguments, releaseArtifactSpec } from './release-smoke-lib.mjs'

const MAX_PRIMARY_BYTES = 100 * 1024 * 1024
const args = parseArguments(process.argv.slice(2))
const repository = args.repository || process.env.GITHUB_REPOSITORY
if (!repository || !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
  throw new Error('GITHUB_REPOSITORY or --repository owner/name is required')
}

const spec = releaseArtifactSpec(args.tag, args.platform, args.arch, args.directory || 'smoke-artifacts')
const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim()
if (!publicKey) throw new Error('TAURI_UPDATER_PUBLIC_KEY is required for cryptographic updater verification')

// Release fixtures (tamper/invalid-install metadata and invalid bins) no longer
// ship on the public release. `--fixtures-directory` points at the internal
// fixture package for full verification; `--public-only` re-verifies just the
// public assets (used by the promotion job). Exactly one mode must be chosen.
const fixturesDirectory = args['fixtures-directory'] ? resolve(args['fixtures-directory']) : null
const publicOnly = args['public-only'] === true
if (!fixturesDirectory && !publicOnly) {
  throw new Error('Provide --fixtures-directory <path> for full verification or --public-only to skip fixture checks')
}
if (fixturesDirectory && publicOnly) {
  throw new Error('--fixtures-directory and --public-only are mutually exclusive')
}
function fixturePath(name) {
  return join(fixturesDirectory, name)
}

function decodeBase64Strict(value, label) {
  const compact = value.replace(/\s/g, '')
  if (!compact || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new Error(`${label} is not canonical base64`)
  }
  const decoded = Buffer.from(compact, 'base64')
  if (decoded.toString('base64') !== compact) throw new Error(`${label} has invalid base64 padding or data`)
  return decoded
}

async function hashFile(path, algorithm = 'sha256') {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest()
}

function parsePublicKey(encoded) {
  const decoded = decodeBase64Strict(encoded, 'Tauri updater public key').toString('utf8').replace(/\r/g, '')
  const lines = decoded.trim().split('\n')
  if (lines.length !== 2 || !lines[0].startsWith('untrusted comment: minisign public key ')) {
    throw new Error('Tauri updater public key does not contain a two-line Minisign public key')
  }
  const packet = decodeBase64Strict(lines[1], 'Minisign public key packet')
  if (packet.length !== 42 || packet[0] !== 0x45 || ![0x44, 0x64].includes(packet[1])) {
    throw new Error('Minisign public key packet uses an unsupported format')
  }
  return { keyId: packet.subarray(2, 10), key: packet.subarray(10, 42) }
}

function parseSignature(encoded) {
  const decoded = decodeBase64Strict(encoded, 'Tauri updater signature').toString('utf8').replace(/\r/g, '')
  const lines = decoded.trim().split('\n')
  if (lines.length !== 4 || !lines[0].startsWith('untrusted comment:') || !lines[2].startsWith('trusted comment: ')) {
    throw new Error('Updater signature does not contain a four-line Minisign signature box')
  }
  const packet = decodeBase64Strict(lines[1], 'Minisign signature packet')
  const globalSignature = decodeBase64Strict(lines[3], 'Minisign global signature')
  if (packet.length !== 74 || globalSignature.length !== 64) throw new Error('Minisign signature packet has an invalid length')
  if (packet[0] !== 0x45 || packet[1] !== 0x44) {
    throw new Error('Updater signature is not pre-hashed Ed25519 (legacy Minisign signatures are rejected)')
  }
  return {
    keyId: packet.subarray(2, 10),
    signature: packet.subarray(10, 74),
    trustedComment: Buffer.from(lines[2].slice('trusted comment: '.length), 'utf8'),
    globalSignature,
  }
}

export async function verifyTauriUpdaterSignature(artifactPath, encodedSignature, encodedPublicKey) {
  const key = parsePublicKey(encodedPublicKey)
  const signature = parseSignature(encodedSignature)
  if (!key.keyId.equals(signature.keyId)) throw new Error('Updater signature key ID does not match the configured public key')

  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex')
  const cryptoKey = createPublicKey({
    key: Buffer.concat([spkiPrefix, key.key]),
    format: 'der',
    type: 'spki',
  })
  const digest = await hashFile(artifactPath, 'blake2b512')
  if (!verifyEd25519(null, digest, cryptoKey, signature.signature)) {
    throw new Error(`Updater payload signature is invalid for ${basename(artifactPath)}`)
  }
  const globalMessage = Buffer.concat([signature.signature, signature.trustedComment])
  if (!verifyEd25519(null, globalMessage, cryptoKey, signature.globalSignature)) {
    throw new Error('Minisign trusted-comment signature is invalid')
  }
}

const requiredPaths = [
  spec.primaryPath,
  spec.updaterPath,
  spec.signaturePath,
  spec.checksumsPath,
  spec.latestPath,
]
if (fixturesDirectory) {
  requiredPaths.push(
    fixturePath(spec.tamperedLatestPath.split(/[\\/]/).pop()),
    fixturePath(spec.invalidInstallLatestPath.split(/[\\/]/).pop()),
    fixturePath(spec.invalidInstallName),
    fixturePath(spec.invalidInstallSignatureName),
  )
}
for (const path of new Set(requiredPaths)) {
  const metadata = await stat(path).catch(() => null)
  if (!metadata?.isFile() || metadata.size === 0) throw new Error(`Missing or empty release asset: ${path}`)
}

const primaryStats = await stat(spec.primaryPath)
if (primaryStats.size > MAX_PRIMARY_BYTES) {
  throw new Error(`${spec.primaryName} is ${(primaryStats.size / 1024 / 1024).toFixed(2)} MiB; primary bundles must not exceed 100 MiB`)
}
const updaterStats = await stat(spec.updaterPath)
if (updaterStats.size > MAX_PRIMARY_BYTES) {
  throw new Error(`${spec.updaterName} is ${(updaterStats.size / 1024 / 1024).toFixed(2)} MiB; updater bundles must not exceed 100 MiB`)
}

const checksumText = await readFile(spec.checksumsPath, 'utf8')
const checksums = new Map()
for (const [index, line] of checksumText.trim().split(/\r?\n/).entries()) {
  const match = /^([0-9a-fA-F]{64})  ([^/\\]+)$/.exec(line)
  if (!match) throw new Error(`Malformed SHA256SUMS line ${index + 1}: ${JSON.stringify(line)}`)
  if (checksums.has(match[2])) throw new Error(`Duplicate SHA256SUMS entry: ${match[2]}`)
  checksums.set(match[2], match[1].toLowerCase())
}
// SHA256SUMS covers public assets only; fixtures are carried by the internal
// artifact and are intentionally absent.
for (const path of [
  spec.primaryPath,
  spec.updaterPath,
  spec.signaturePath,
  spec.latestPath,
]) {
  const name = basename(path)
  const expected = checksums.get(name)
  if (!expected) throw new Error(`SHA256SUMS does not cover ${name}`)
  const actual = (await hashFile(path)).toString('hex')
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${name}: expected ${expected}, received ${actual}`)
}

const signatureText = (await readFile(spec.signaturePath, 'utf8')).trim()
const latest = JSON.parse(await readFile(spec.latestPath, 'utf8'))
if (latest.version !== spec.version) {
  throw new Error(`latest.json version ${latest.version} does not match ${spec.version}`)
}
if (!latest.platforms?.[spec.platformKey]) {
  throw new Error(`latest.json is missing updater target ${spec.platformKey}`)
}

const platformEntry = latest.platforms[spec.platformKey]
if (platformEntry.signature !== signatureText) throw new Error(`latest.json signature differs from ${spec.signatureName}`)

const expectedPrefix = `/releases/download/${spec.tag}/`
let updateUrl
try {
  updateUrl = new URL(platformEntry.url)
} catch {
  throw new Error(`latest.json contains an invalid URL for ${spec.platformKey}`)
}
if (updateUrl.protocol !== 'https:' || updateUrl.hostname !== 'github.com' ||
    updateUrl.username || updateUrl.password || updateUrl.port || updateUrl.search || updateUrl.hash ||
    updateUrl.pathname !== `/${repository}${expectedPrefix}${encodeURIComponent(spec.updaterName)}`) {
  throw new Error(`Unexpected updater URL in latest.json for ${spec.platformKey}: ${platformEntry.url}`)
}

await verifyTauriUpdaterSignature(spec.updaterPath, signatureText, publicKey)
let tamperRejected = false
let invalidInstallSignatureVerified = false
if (fixturesDirectory) {
  const tamperedLatest = JSON.parse(await readFile(fixturePath('latest-tampered.json'), 'utf8'))
  const invalidInstallLatest = JSON.parse(await readFile(fixturePath('latest-invalid-install.json'), 'utf8'))
  for (const [name, metadata] of [
    ['latest-tampered.json', tamperedLatest],
    ['latest-invalid-install.json', invalidInstallLatest],
  ]) {
    if (metadata.version !== spec.version) {
      throw new Error(`${name} version ${metadata.version} does not match ${spec.version}`)
    }
    if (!metadata.platforms?.[spec.platformKey]) {
      throw new Error(`${name} is missing updater target ${spec.platformKey}`)
    }
  }

  const tamperedEntry = tamperedLatest.platforms[spec.platformKey]
  const invalidInstallEntry = invalidInstallLatest.platforms[spec.platformKey]
  const invalidInstallSignatureText = (await readFile(fixturePath(spec.invalidInstallSignatureName), 'utf8')).trim()
  if (invalidInstallEntry.signature !== invalidInstallSignatureText) {
    throw new Error('latest-invalid-install.json signature differs from the invalid-install fixture signature')
  }
  if (tamperedEntry.signature === signatureText) {
    throw new Error('latest-tampered.json did not alter the updater signature')
  }
  // Fixture metadata keeps release-shaped URLs; the staging hook rewrites them
  // to loopback just before serving. Only assert the deterministic shape here.
  for (const [name, entry, artifactName] of [
    ['latest-tampered.json', tamperedEntry, spec.updaterName],
    ['latest-invalid-install.json', invalidInstallEntry, spec.invalidInstallName],
  ]) {
    let fixtureUrl
    try {
      fixtureUrl = new URL(entry.url)
    } catch {
      throw new Error(`${name} contains an invalid URL for ${spec.platformKey}`)
    }
    if (fixtureUrl.protocol !== 'https:' || fixtureUrl.hostname !== 'github.com' ||
        fixtureUrl.pathname !== `/${repository}${expectedPrefix}${encodeURIComponent(artifactName)}`) {
      throw new Error(`Unexpected updater URL in ${name} for ${spec.platformKey}: ${entry.url}`)
    }
  }

  await verifyTauriUpdaterSignature(fixturePath(spec.invalidInstallName), invalidInstallSignatureText, publicKey)
  invalidInstallSignatureVerified = true
  try {
    await verifyTauriUpdaterSignature(spec.updaterPath, tamperedEntry.signature, publicKey)
  } catch {
    tamperRejected = true
  }
  if (!tamperRejected) throw new Error('Tampered updater signature was unexpectedly accepted')
}

console.log(JSON.stringify({
  ok: true,
  target: `${spec.platform}-${spec.arch}`,
  platformKey: spec.platformKey,
  version: spec.version,
  primary: spec.primaryName,
  primaryMiB: Number((primaryStats.size / 1024 / 1024).toFixed(2)),
  updater: spec.updaterName,
  sha256: checksums.get(spec.primaryName),
  signatureVerified: true,
  tamperRejected,
  invalidInstallFixtureSignatureVerified: invalidInstallSignatureVerified,
  mode: publicOnly ? 'public-only' : 'full',
}, null, 2))
