import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { join, relative, resolve } from 'node:path'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else files.push(path)
  }
  return files
}

const root = resolve(import.meta.dirname, '../..')
const renderer = resolve(root, 'out/renderer')
const hardRawLimit = 60 * 1024 * 1024
const hardGzipLimit = 15 * 1024 * 1024
const configuredRawLimit = Number(process.env.MAX_RENDERER_BYTES)
const configuredGzipLimit = Number(process.env.MAX_RENDERER_GZIP_BYTES)
// Local checks may be stricter, but environment overrides must not weaken the
// release acceptance budgets or disable them with a non-numeric value.
const rawLimit = Number.isFinite(configuredRawLimit) && configuredRawLimit > 0
  ? Math.min(configuredRawLimit, hardRawLimit)
  : hardRawLimit
const gzipLimit = Number.isFinite(configuredGzipLimit) && configuredGzipLimit > 0
  ? Math.min(configuredGzipLimit, hardGzipLimit)
  : hardGzipLimit
const forbiddenPath = /(^|[\\/])(?:electron|chromium|node_modules|onlyoffice|documentserver|document-server|app\.asar|node(?:\.exe)?|libnode(?:\.so|\.dylib|\.dll)|[^\\/]+\.dSYM)(?=[\\/]|$|[-_.])|(^|[\\/])(?:icudtl\.dat|v8_context_snapshot\.bin|snapshot_blob\.bin|resources\.pak|chrome_[^\\/]*\.pak)$|\.(?:map|pdb|ilk|debug)$/i
const trailingSourceMapDirective = /(?:\/\/[#@]\s*sourceMappingURL\s*=\s*[^\r\n]*|\/\*[#@]\s*sourceMappingURL\s*=\s*[\s\S]*?\*\/)\s*$/

const files = await walk(renderer)
for (const path of files) {
  if ((await lstat(path)).isSymbolicLink()) {
    throw new Error(`Symbolic links are not allowed in renderer artifacts: ${relative(renderer, path).replaceAll('\\', '/')}`)
  }
}
let rawBytes = 0
let gzipBytes = 0
const digests = []
for (const path of files) {
  const name = relative(renderer, path).replaceAll('\\', '/')
  if (forbiddenPath.test(name)) throw new Error(`Forbidden renderer artifact: ${name}`)
  const data = await readFile(path)
  rawBytes += data.byteLength
  gzipBytes += gzipSync(data, { level: 9 }).byteLength
  if (/\.(?:css|js|mjs|cjs)$/i.test(name) && trailingSourceMapDirective.test(data.toString('utf8'))) {
    throw new Error(`Source map directive found in renderer artifact: ${name}`)
  }
  digests.push(`${createHash('sha256').update(data).digest('hex')}  ${name}`)
}

if (rawBytes > rawLimit) throw new Error(`Renderer is ${rawBytes} bytes; limit is ${rawLimit}`)
if (gzipBytes > gzipLimit) throw new Error(`Renderer gzip sum is ${gzipBytes} bytes; limit is ${gzipLimit}`)

const tauriConfig = JSON.parse(await readFile(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'))
const externalBin = tauriConfig.bundle?.externalBin
if (JSON.stringify(externalBin) !== JSON.stringify(['binaries/esbuild'])) {
  throw new Error('Tauri externalBin must contain only the versioned esbuild sidecar')
}
if (tauriConfig.bundle?.resources && Object.keys(tauriConfig.bundle.resources).length > 0) {
  throw new Error('Tauri bundle resources must remain empty; document runtimes are system dependencies')
}
const updater = tauriConfig.plugins?.updater
if (!updater || !Array.isArray(updater.endpoints) || updater.endpoints.length !== 0) {
  throw new Error('Base updater configuration must remain offline; release config supplies the HTTPS endpoint')
}
let updaterPublicText = ''
try {
  updaterPublicText = Buffer.from(updater.pubkey, 'base64').toString('utf8')
} catch {
  throw new Error('Base updater configuration must contain a valid test public key')
}
if (!/^untrusted comment: minisign public key [0-9A-F]+\r?\nRWQ[^\r\n]+\r?\n?$/i.test(updaterPublicText)) {
  throw new Error('Base updater public key is malformed; the application would fail during updater initialization')
}

const target = argument('--target') || process.env.WAE_BUILD_TARGET
if (target) {
  const extension = target.includes('windows') ? '.exe' : ''
  const sidecar = resolve(root, 'src-tauri/binaries', `esbuild-${target}${extension}`)
  const sidecarMetadata = await lstat(sidecar)
  if (sidecarMetadata.isSymbolicLink() || !sidecarMetadata.isFile()) {
    throw new Error(`Esbuild sidecar must be a regular file for ${target}`)
  }
  const sidecarSize = sidecarMetadata.size
  if (sidecarSize <= 0 || sidecarSize > 20 * 1024 * 1024) {
    throw new Error(`Unexpected esbuild sidecar size for ${target}: ${sidecarSize} bytes`)
  }
}

console.log(`Renderer raw=${rawBytes} gzip-sum=${gzipBytes} files=${files.length}`)
console.log(`Renderer digest entries=${digests.length}${target ? ` sidecar=${target}` : ''}`)
