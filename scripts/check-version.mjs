import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const tauriConfig = JSON.parse(await readFile(new URL('src-tauri/tauri.conf.json', root), 'utf8'))
const cargoToml = await readFile(new URL('src-tauri/Cargo.toml', root), 'utf8')

let cargoVersion
let cargoLicense
let inPackageSection = false
for (const line of cargoToml.split(/\r?\n/)) {
  const section = line.match(/^\[([^\]]+)\]\s*$/)?.[1]
  if (section) {
    inPackageSection = section === 'package'
    continue
  }
  if (inPackageSection) {
    cargoVersion ||= line.match(/^version\s*=\s*"([^"]+)"\s*$/)?.[1]
    cargoLicense ||= line.match(/^license\s*=\s*"([^"]+)"\s*$/)?.[1]
  }
}
const versions = {
  'package.json': packageJson.version,
  'src-tauri/Cargo.toml': cargoVersion,
  'src-tauri/tauri.conf.json': tauriConfig.version,
}

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
for (const [source, version] of Object.entries(versions)) {
  if (typeof version !== 'string' || !semver.test(version)) {
    throw new Error(`${source} does not contain a valid SemVer version`)
  }
}

const distinct = new Set(Object.values(versions))
if (distinct.size !== 1) {
  throw new Error(`Version mismatch: ${Object.entries(versions).map(([source, version]) => `${source}=${version}`).join(', ')}`)
}

const licenses = {
  'package.json': packageJson.license,
  'src-tauri/Cargo.toml': cargoLicense,
  'src-tauri/tauri.conf.json': tauriConfig.bundle?.license,
}
if (Object.values(licenses).some((license) => license !== 'AGPL-3.0-only')) {
  throw new Error(`License mismatch: ${Object.entries(licenses).map(([source, license]) => `${source}=${license}`).join(', ')}`)
}

const tagFlagIndex = process.argv.indexOf('--tag')
const suppliedTag = tagFlagIndex >= 0 ? process.argv[tagFlagIndex + 1] : undefined
const environmentTag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined
const tag = suppliedTag || environmentTag
const [version] = distinct
if (tag && tag !== `v${version}`) {
  throw new Error(`Release tag ${tag} does not match v${version}`)
}

console.log(`Version ${version} and license AGPL-3.0-only are consistent across package, Cargo, and Tauri configuration`)
