import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import {
  releaseArtifactSpec,
  requireSemverTag,
  supportedReleaseTargets,
} from './release-smoke-lib.mjs'

const directory = resolve(process.argv[2] || 'artifacts')
const repository = process.env.GITHUB_REPOSITORY
if (!repository) throw new Error('GITHUB_REPOSITORY is required to generate release URLs')

const names = await readdir(directory)
const manifestNames = names.filter((name) => /^release-part-.+\.json$/.test(name))
if (manifestNames.length !== supportedReleaseTargets.length) {
  throw new Error(`Expected ${supportedReleaseTargets.length} release manifests, found ${manifestNames.length}`)
}

async function requireRegularAsset(name, label = name) {
  if (basename(name) !== name) throw new Error(`${label} must be a root-level release asset name`)
  const path = join(directory, name)
  const metadata = await lstat(path).catch(() => null)
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
    throw new Error(`${label} is missing, empty, non-regular, or a symbolic link: ${path}`)
  }
  return path
}

const manifests = await Promise.all(manifestNames.map(async (name) => {
  const path = await requireRegularAsset(name, `Release manifest ${name}`)
  return [name, JSON.parse(await readFile(path, 'utf8'))]
}))
const manifestsByName = new Map(manifests)
const versions = new Set(manifests.map(([, manifest]) => manifest.version))
if (versions.size !== 1) throw new Error(`Release manifests disagree on version: ${[...versions].join(', ')}`)
const [version] = versions
const tag = `v${version}`
requireSemverTag(tag, 'release manifest version')
if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== tag) {
  throw new Error(`Tag ${process.env.GITHUB_REF_NAME} does not match package version ${version}`)
}

const expectedSpecs = supportedReleaseTargets.map((target) => {
  const separator = target.indexOf('-')
  const platform = target.slice(0, separator)
  const arch = target.slice(separator + 1)
  return releaseArtifactSpec(tag, platform, arch, directory)
})
const expectedKeys = expectedSpecs.map((spec) => spec.platformKey)

const platforms = {}
const invalidInstallPlatforms = {}
function tamperSignature(encoded) {
  const decoded = Buffer.from(encoded, 'base64').toString('utf8').replace(/\r/g, '')
  const lines = decoded.trimEnd().split('\n')
  if (lines.length !== 4) throw new Error('Cannot create tamper fixture from malformed updater signature')
  const packet = Buffer.from(lines[1], 'base64')
  if (packet.length !== 74) throw new Error('Cannot create tamper fixture from unsupported signature packet')
  packet[10] ^= 1
  lines[1] = packet.toString('base64')
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8').toString('base64')
}
for (const spec of expectedSpecs) {
  const manifestName = `release-part-${spec.platform}-${spec.arch}.json`
  const manifest = manifestsByName.get(manifestName)
  if (!manifest) throw new Error(`Missing release manifest ${manifestName}`)
  const expectedManifest = {
    version,
    platform: spec.platform,
    arch: spec.arch,
    updaterKey: spec.platformKey,
    primary: spec.primaryName,
    updater: spec.updaterName,
    signature: spec.signatureName,
    invalidInstall: spec.invalidInstallName,
    invalidInstallSignature: spec.invalidInstallSignatureName,
  }
  for (const [field, expected] of Object.entries(expectedManifest)) {
    if (manifest[field] !== expected) {
      throw new Error(`${manifestName} field ${field} must be ${JSON.stringify(expected)}, received ${JSON.stringify(manifest[field])}`)
    }
  }

  await requireRegularAsset(manifest.primary, `${spec.platformKey} primary package`)
  await requireRegularAsset(manifest.updater, `${spec.platformKey} updater package`)
  const signaturePath = await requireRegularAsset(manifest.signature, `${spec.platformKey} updater signature`)
  const invalidInstallPath = await requireRegularAsset(manifest.invalidInstall, `${spec.platformKey} invalid-install fixture`)
  const invalidInstallSignaturePath = await requireRegularAsset(
    manifest.invalidInstallSignature,
    `${spec.platformKey} invalid-install signature`,
  )
  const signature = (await readFile(signaturePath, 'utf8')).trim()
  if (!signature) throw new Error(`Empty updater signature: ${manifest.signature}`)
  platforms[spec.platformKey] = {
    signature,
    url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(manifest.updater)}`,
  }
  if ((await stat(invalidInstallPath)).size === 0) {
    throw new Error(`Empty invalid-install fixture: ${manifest.invalidInstall}`)
  }
  const invalidInstallSignature = (await readFile(invalidInstallSignaturePath, 'utf8')).trim()
  if (!invalidInstallSignature) {
    throw new Error(`Empty invalid-install fixture signature: ${manifest.invalidInstallSignature}`)
  }
  invalidInstallPlatforms[spec.platformKey] = {
    signature: invalidInstallSignature,
    url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(manifest.invalidInstall)}`,
  }
}

for (const name of ['sbom-npm.cdx.json', 'sbom-rust.cdx.json']) {
  const path = await requireRegularAsset(name, name)
  const sbom = JSON.parse(await readFile(path, 'utf8'))
  if (sbom.bomFormat !== 'CycloneDX') throw new Error(`${name} is not a CycloneDX SBOM`)
}
const sourceArchiveName = `WPS-Agent-Editor-${tag}-source.zip`
const sourceArchive = await requireRegularAsset(sourceArchiveName, 'Source archive')
const sourceHeader = (await readFile(sourceArchive)).subarray(0, 4)
if (sourceHeader.length < 4 || sourceHeader[0] !== 0x50 || sourceHeader[1] !== 0x4b) {
  throw new Error(`${sourceArchiveName} is not a ZIP archive`)
}

const releaseMetadata = {
  version,
  notes: `WPS Agent Editor ${version}`,
  pub_date: new Date().toISOString(),
  platforms,
}
await writeFile(join(directory, 'latest.json'), `${JSON.stringify(releaseMetadata, null, 2)}\n`)
await writeFile(join(directory, 'latest-tampered.json'), `${JSON.stringify({
  ...releaseMetadata,
  notes: `WPS Agent Editor ${version} signature rejection fixture`,
  platforms: Object.fromEntries(Object.entries(platforms).map(([key, value]) => [
    key,
    { ...value, signature: tamperSignature(value.signature) },
  ])),
}, null, 2)}\n`)
await writeFile(join(directory, 'latest-invalid-install.json'), `${JSON.stringify({
  ...releaseMetadata,
  notes: `WPS Agent Editor ${version} rejected-install preservation fixture`,
  platforms: invalidInstallPlatforms,
}, null, 2)}\n`)

const excluded = new Set([...manifestNames, 'SHA256SUMS'])
const releaseFiles = (await readdir(directory)).filter((name) => !excluded.has(name)).sort()
const checksumLines = []
for (const name of releaseFiles) {
  const path = join(directory, name)
  if (!(await stat(path)).isFile()) continue
  const hash = createHash('sha256').update(await readFile(path)).digest('hex')
  checksumLines.push(`${hash}  ${basename(path)}`)
}
await writeFile(join(directory, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`)
await Promise.all(manifestNames.map((name) => unlink(join(directory, name))))
console.log(`Finalized ${tag} with ${expectedKeys.length} updater targets`)
