import { lstat, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const directory = resolve(process.argv[2] || 'artifacts')
const hardMaxBytes = 100 * 1024 * 1024
const configuredMaxBytes = Number(process.env.MAX_PRIMARY_ARTIFACT_BYTES)
// Allow stricter local limits, but never permit CI configuration to weaken the
// contractual 100 MiB release budget (or turn it into NaN).
const maxBytes = Number.isFinite(configuredMaxBytes) && configuredMaxBytes > 0
  ? Math.min(configuredMaxBytes, hardMaxBytes)
  : hardMaxBytes
const requireMatrix = process.env.REQUIRE_RELEASE_MATRIX === '1'
const primaryPattern = /^(windows-(?:x86|x86_64|aarch64)-setup\.exe|macos-(?:x86_64|aarch64)\.dmg|linux-(?:x86_64|aarch64)\.AppImage)$/
const updaterPattern = /^(macos-(?:x86_64|aarch64)\.app\.tar\.gz)$/
const forbiddenPattern = /(^|[\\/])(?:electron|chromium|node_modules|onlyoffice|documentserver|document-server|app\.asar|node(?:\.exe)?|libnode(?:\.so|\.dylib|\.dll)|[^\\/]+\.dSYM)(?=[\\/]|$|[-_.])|(^|[\\/])(?:icudtl\.dat|v8_context_snapshot\.bin|snapshot_blob\.bin|resources\.pak|chrome_[^\\/]*\.pak)$|\.(?:map|pdb|ilk|debug)$/i

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) files.push(...await walk(child))
    else files.push(child)
  }
  return files
}

const files = await walk(directory)
const symlinks = []
for (const path of files) {
  if ((await lstat(path)).isSymbolicLink()) symlinks.push(path)
}
if (symlinks.length) {
  throw new Error(`Symbolic links are not allowed in release artifacts:\n${symlinks.join('\n')}`)
}
const forbidden = files.filter((path) => forbiddenPattern.test(path.slice(directory.length + 1)))
if (forbidden.length) throw new Error(`Forbidden packaged content:\n${forbidden.join('\n')}`)

const primary = files.filter((path) => primaryPattern.test(path.slice(directory.length + 1)))
if (requireMatrix && primary.length !== 7) {
  throw new Error(`Expected seven primary release artifacts, found ${primary.length}`)
}
if (!primary.length) throw new Error(`No primary release artifacts found in ${directory}`)
for (const path of primary) {
  const size = (await stat(path)).size
  if (size > maxBytes) {
    throw new Error(`${path} is ${(size / 1024 / 1024).toFixed(2)} MiB; limit is ${(maxBytes / 1024 / 1024).toFixed(2)} MiB`)
  }
  console.log(`${path.slice(directory.length + 1)} ${(size / 1024 / 1024).toFixed(2)} MiB`)
}

// The macOS updater payload is a separate archive from the DMG and must obey
// the same download budget. Windows and Linux reuse their primary payload.
for (const path of files.filter((candidate) => updaterPattern.test(candidate.slice(directory.length + 1)))) {
  const size = (await stat(path)).size
  if (size > maxBytes) {
    throw new Error(`${path} is ${(size / 1024 / 1024).toFixed(2)} MiB; updater packages must not exceed ${(maxBytes / 1024 / 1024).toFixed(2)} MiB`)
  }
  console.log(`${path.slice(directory.length + 1)} ${(size / 1024 / 1024).toFixed(2)} MiB (updater)`)
}
