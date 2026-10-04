import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const tauriConfig = JSON.parse(await readFile(new URL('src-tauri/tauri.conf.json', root), 'utf8'))
const cargoToml = await readFile(new URL('src-tauri/Cargo.toml', root), 'utf8')

// Strip a TOML trailing comment while honoring basic ("...") and literal ('...')
// strings so a '#' inside a string is not mistaken for a comment start.
function stripTomlComment(line) {
  let inBasic = false
  let inLiteral = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inBasic) {
      if (ch === '\\') i++
      else if (ch === '"') inBasic = false
    } else if (inLiteral) {
      if (ch === "'") inLiteral = false
    } else if (ch === '"') {
      inBasic = true
    } else if (ch === "'") {
      inLiteral = true
    } else if (ch === '#') {
      return line.slice(0, i)
    }
  }
  return line
}

// Minimal but correct TOML reader for the [package] table: handles leading
// whitespace, trailing comments, basic and literal strings, and REJECTS
// `version.workspace = true` / `license.workspace = true` inheritance (which a
// line regex would silently misread).
function readPackageTable(toml) {
  let section = null
  const out = {}
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim()
    if (!line) continue
    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1].trim()
      continue
    }
    if (section !== 'package') continue
    // Explicitly reject Cargo workspace inheritance: `version.workspace = true`
    // (a dotted key) must not silently read as an empty/illegal version.
    const inherit = line.match(/^(version|license)\.workspace\s*=\s*(.+)$/)
    if (inherit) {
      throw new Error(`Cargo.toml [package].${inherit[1]}.workspace = ...: workspace inheritance is not accepted; pin a concrete ${inherit[1]}`)
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/)
    if (!kv) continue
    const key = kv[1]
    const rest = kv[2].trim()
    const basic = rest.match(/^"((?:[^"\\]|\\.)*)"$/)
    const literal = rest.match(/^'([^']*)'$/)
    if (basic) out[key] = basic[1]
    else if (literal) out[key] = literal[1]
  }
  return out
}

const cargo = readPackageTable(cargoToml)

const versions = {
  'package.json': packageJson.version,
  'src-tauri/Cargo.toml': cargo.version,
  'src-tauri/tauri.conf.json': tauriConfig.version,
}

// SemVer 2.0.0: numeric prerelease identifiers must not have leading zeros
// (`-0` is valid, `-01` / `-001` are not).
function isValidSemVer(version) {
  if (typeof version !== 'string') return false
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(version)
  if (!m) return false
  const prerelease = m[4]
  if (prerelease) {
    for (const ident of prerelease.split('.')) {
      if (/^\d+$/.test(ident) && ident.length > 1 && ident.startsWith('0')) return false
    }
  }
  return true
}

for (const [source, version] of Object.entries(versions)) {
  if (!isValidSemVer(version)) {
    throw new Error(`${source} does not contain a valid SemVer version (got ${JSON.stringify(version)})`)
  }
}

const distinct = new Set(Object.values(versions))
if (distinct.size !== 1) {
  throw new Error(`Version mismatch: ${Object.entries(versions).map(([source, version]) => `${source}=${version}`).join(', ')}`)
}

const licenses = {
  'package.json': packageJson.license,
  'src-tauri/Cargo.toml': cargo.license,
  'src-tauri/tauri.conf.json': tauriConfig.bundle?.license,
}
if (Object.values(licenses).some((license) => license !== 'AGPL-3.0-only')) {
  throw new Error(`License mismatch: ${Object.entries(licenses).map(([source, license]) => `${source}=${license}`).join(', ')}`)
}

// Strict argument parsing: --tag takes the next argument as its value. A missing
// value (end of args, empty string, or a value that looks like another flag) and
// duplicate/unknown arguments are immediate errors rather than silently skipped.
const argv = process.argv.slice(2)
let suppliedTag
let seenTag = false
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg === '--tag') {
    if (seenTag) throw new Error('--tag was specified more than once')
    seenTag = true
    const next = argv[i + 1]
    if (next === undefined || next === '' || next.startsWith('-')) {
      throw new Error(`--tag requires a value (got ${next === undefined ? 'end of arguments' : JSON.stringify(next)})`)
    }
    suppliedTag = next
    i++
  } else if (arg.startsWith('--')) {
    throw new Error(`Unknown argument: ${arg}`)
  } else {
    throw new Error(`Unexpected positional argument: ${arg}`)
  }
}

const environmentTag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined
const tag = suppliedTag ?? environmentTag
const [version] = distinct
if (tag && tag !== `v${version}`) {
  throw new Error(`Release tag ${tag} does not match v${version}`)
}

console.log(`Version ${version} and license AGPL-3.0-only are consistent across package, Cargo, and Tauri configuration`)
