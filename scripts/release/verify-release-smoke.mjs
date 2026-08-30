import { createHash, createPublicKey, verify as verifyEd25519 } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
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
  spec.invalidInstallPath,
  spec.invalidInstallSignaturePath,
  spec.checksumsPath,
  spec.latestPath,
  spec.tamperedLatestPath,
  spec.invalidInstallLatestPath,
]
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
for (const path of new Set([
  spec.primaryPath,
  spec.updaterPath,
  spec.signaturePath,
  spec.invalidInstallPath,
  spec.invalidInstallSignaturePath,
  spec.latestPath,
  spec.tamperedLatestPath,
  spec.invalidInstallLatestPath,
])) {
  const name = basename(path)
  const expected = checksums.get(name)
  if (!expected) throw new Error(`SHA256SUMS does not cover ${name}`)
  const actual = (await hashFile(path)).toString('hex')
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${name}: expected ${expected}, received ${actual}`)
}

const signatureText = (await readFile(spec.signaturePath, 'utf8')).trim()
const invalidInstallSignatureText = (await readFile(spec.invalidInstallSignaturePath, 'utf8')).trim()
const latest = JSON.parse(await readFile(spec.latestPath, 'utf8'))
const tamperedLatest = JSON.parse(await readFile(spec.tamperedLatestPath, 'utf8'))
const invalidInstallLatest = JSON.parse(await readFile(spec.invalidInstallLatestPath, 'utf8'))
for (const [name, metadata] of [
  ['latest.json', latest],
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

const platformEntry = latest.platforms[spec.platformKey]
const tamperedEntry = tamperedLatest.platforms[spec.platformKey]
const invalidInstallEntry = invalidInstallLatest.platforms[spec.platformKey]
if (platformEntry.signature !== signatureText) throw new Error(`latest.json signature differs from ${spec.signatureName}`)
if (invalidInstallEntry.signature !== invalidInstallSignatureText) {
  throw new Error(`latest-invalid-install.json signature differs from ${spec.invalidInstallSignatureName}`)
}
if (tamperedEntry.signature === signatureText) {
  throw new Error('latest-tampered.json did not alter the updater signature')
}

const expectedPrefix = `/releases/download/${spec.tag}/`
for (const [name, entry, artifactName] of [
  ['latest.json', platformEntry, spec.updaterName],
  ['latest-tampered.json', tamperedEntry, spec.updaterName],
  ['latest-invalid-install.json', invalidInstallEntry, spec.invalidInstallName],
]) {
  let updateUrl
  try {
    updateUrl = new URL(entry.url)
  } catch {
    throw new Error(`${name} contains an invalid URL for ${spec.platformKey}`)
  }
  if (updateUrl.protocol !== 'https:' || updateUrl.hostname !== 'github.com' ||
      updateUrl.username || updateUrl.password || updateUrl.port || updateUrl.search || updateUrl.hash ||
      updateUrl.pathname !== `/${repository}${expectedPrefix}${encodeURIComponent(artifactName)}`) {
    throw new Error(`Unexpected updater URL in ${name} for ${spec.platformKey}: ${entry.url}`)
  }
}

await verifyTauriUpdaterSignature(spec.updaterPath, signatureText, publicKey)
await verifyTauriUpdaterSignature(spec.invalidInstallPath, invalidInstallSignatureText, publicKey)
let tamperRejected = false
try {
  await verifyTauriUpdaterSignature(spec.updaterPath, tamperedEntry.signature, publicKey)
} catch {
  tamperRejected = true
}
if (!tamperRejected) throw new Error('Tampered updater signature was unexpectedly accepted')
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
  tamperRejected: true,
  invalidInstallFixtureSignatureVerified: true,
}, null, 2))
