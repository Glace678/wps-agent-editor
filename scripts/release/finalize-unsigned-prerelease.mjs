import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, open, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  releaseArtifactSpec,
  requireSemverTag,
  supportedReleaseTargets,
} from './release-smoke-lib.mjs'

const directory = resolve(process.argv[2] || 'artifacts')
const tag = process.env.GITHUB_REF_NAME?.trim()
const parsedTag = requireSemverTag(tag, 'unsigned prerelease tag')
if (!/^rc\.(0|[1-9]\d*)$/.test(parsedTag.prerelease)) {
  throw new Error(`Unsigned prerelease tags must end in -rc.N; received ${tag}`)
}

const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
if (packageJson.version !== parsedTag.version) {
  throw new Error(`Tag ${tag} does not match package version ${packageJson.version}`)
}

const primaryNames = supportedReleaseTargets.map((target) => {
  const separator = target.indexOf('-')
  const platform = target.slice(0, separator)
  const arch = target.slice(separator + 1)
  return releaseArtifactSpec(tag, platform, arch, directory).primaryName
})
const sourceName = `WPS-Agent-Editor-${tag}-source.zip`
const metadataNames = ['sbom-npm.cdx.json', 'sbom-rust.cdx.json', sourceName]
const expectedNames = [...primaryNames, ...metadataNames].sort()
const expected = new Set(expectedNames)
const actualNames = (await readdir(directory)).sort()
const missing = expectedNames.filter((name) => !actualNames.includes(name))
const unexpected = actualNames.filter((name) => !expected.has(name))
if (missing.length || unexpected.length) {
  throw new Error([
    missing.length ? `Missing unsigned prerelease assets: ${missing.join(', ')}` : '',
    unexpected.length ? `Unexpected unsigned prerelease assets: ${unexpected.join(', ')}` : '',
  ].filter(Boolean).join('\n'))
}

for (const name of expectedNames) {
  const metadata = await lstat(join(directory, name))
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
    throw new Error(`Unsigned prerelease asset must be a non-empty regular file: ${name}`)
  }
}

for (const name of ['sbom-npm.cdx.json', 'sbom-rust.cdx.json']) {
  const document = JSON.parse(await readFile(join(directory, name), 'utf8'))
  if (document.bomFormat !== 'CycloneDX') {
    throw new Error(`${name} is not a CycloneDX SBOM`)
  }
}

const source = await open(join(directory, sourceName), 'r')
try {
  const signature = Buffer.alloc(4)
  const { bytesRead } = await source.read(signature, 0, signature.length, 0)
  if (bytesRead !== 4 || !signature.equals(Buffer.from('504b0304', 'hex'))) {
    throw new Error(`${sourceName} is not a ZIP archive`)
  }
} finally {
  await source.close()
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

const checksumLines = []
for (const name of expectedNames) {
  checksumLines.push(`${await sha256(join(directory, name))}  ${name}`)
}
await writeFile(join(directory, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`)
console.log(`Finalized ${primaryNames.length}-target unsigned prerelease ${tag} without updater metadata`)
