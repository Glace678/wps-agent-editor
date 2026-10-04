import { gzipSync } from 'node:zlib'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const outputRoot = path.join(projectRoot, 'out', 'renderer')

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative))
    else files.push(relative)
  }
  return files
}

function fail(message) {
  throw new Error(`[web-bundle] ${message}`)
}

const [manifest, contract, baseline] = await Promise.all([
  readJson(path.join(outputRoot, '.vite', 'manifest.json')),
  readJson(path.join(outputRoot, '.vite', 'bundle-contract.json')),
  readJson(path.join(projectRoot, 'scripts', 'web-bundle-baseline.json')),
])

if (contract.schemaVersion !== 1 || baseline.schemaVersion !== 1) {
  fail('Unsupported bundle contract or baseline schema')
}
if (!Number.isInteger(baseline.initialGzipBytes) || baseline.initialGzipBytes <= 0) {
  fail('The initial gzip baseline must be a positive integer')
}
// maxRegressionPercent must be a finite number in a sane range; otherwise the
// comparison `initialGzipBytes > maximum` silently becomes false when maximum is
// NaN. Re-validate after computing the limit as well.
if (!Number.isFinite(baseline.maxRegressionPercent)
  || baseline.maxRegressionPercent < 0
  || baseline.maxRegressionPercent > 100) {
  fail(`baseline.maxRegressionPercent must be a finite number in [0,100] (got ${JSON.stringify(baseline.maxRegressionPercent)})`)
}

// Runtime type validation of the contract before we traverse it, so malformed
// input produces a diagnostic fail() rather than a native TypeError.
if (typeof contract.entry !== 'string' || !contract.entry) fail('contract.entry must be a non-empty string')
if (typeof contract.chunks !== 'object' || contract.chunks === null || Array.isArray(contract.chunks)) {
  fail('contract.chunks must be an object')
}
for (const [name, chunk] of Object.entries(contract.chunks)) {
  if (typeof chunk !== 'object' || chunk === null) fail(`contract.chunks["${name}"] must be an object`)
  if (!Array.isArray(chunk.imports) || !chunk.imports.every((i) => typeof i === 'string')) {
    fail(`contract.chunks["${name}"].imports must be a string array`)
  }
  if (!Array.isArray(chunk.engines) || !chunk.engines.every((i) => typeof i === 'string')) {
    fail(`contract.chunks["${name}"].engines must be a string array`)
  }
}

const outputFiles = await listFiles(outputRoot)
const outputFileSet = new Set(outputFiles)

// Resolve a manifest/contract-relative path and confirm it stays inside outputRoot
// and is one of the emitted files. This rejects ../ traversal, backslash escapes,
// and absolute paths that would read a file outside the bundle.
function resolveBundlePath(relative, label) {
  if (typeof relative !== 'string' || !relative) fail(`${label} must be a non-empty string path`)
  const resolved = path.resolve(outputRoot, relative)
  const rel = path.relative(outputRoot, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    fail(`${label} escapes the output root: ${relative}`)
  }
  const posix = rel.split(path.sep).join('/')
  if (!outputFileSet.has(posix)) {
    fail(`${label} does not correspond to an emitted file: ${relative}`)
  }
  return posix
}

const initialChunks = new Set()
const pending = [contract.entry]
while (pending.length > 0) {
  const fileName = pending.pop()
  if (initialChunks.has(fileName)) continue
  const chunk = contract.chunks[fileName]
  if (!chunk) fail(`Missing chunk metadata for ${fileName}`)
  initialChunks.add(fileName)
  pending.push(...chunk.imports)
}

const initialEngines = new Map()
for (const fileName of initialChunks) {
  for (const engine of contract.chunks[fileName].engines) {
    const files = initialEngines.get(engine) ?? []
    files.push(fileName)
    initialEngines.set(engine, files)
  }
}
if (initialEngines.size > 0) {
  fail(`Heavy engines entered the initial graph: ${[...initialEngines.entries()]
    .map(([engine, files]) => `${engine} (${files.join(', ')})`).join('; ')}`)
}

const requiredLazyEngines = ['xterm', 'superdoc', 'fortune-sheet', 'pptx-renderer']
for (const engine of requiredLazyEngines) {
  const files = Object.entries(contract.chunks)
    .filter(([, chunk]) => chunk.engines.includes(engine))
    .map(([fileName]) => fileName)
  if (files.length === 0) fail(`Expected a lazy ${engine} chunk`)
  if (files.some((fileName) => initialChunks.has(fileName))) {
    fail(`${engine} is reachable from the initial graph`)
  }
  // The engine must correspond to at least one real emitted file on disk; an
  // engine declared only in metadata (no output file) is an isolated declaration
  // that the runtime would fail to load. (A contract may list several chunks per
  // engine; at least one must exist and be excluded from the initial graph.)
  const emittedFiles = files.filter((fileName) => outputFileSet.has(fileName))
  if (emittedFiles.length === 0) {
    fail(`Lazy ${engine} has no emitted output file (declared: ${files.join(', ')})`)
  }
}

if (!outputFiles.some((file) => /^assets\/mupdf[.-]worker-[^/]+\.js$/.test(file))) {
  fail('Expected a separately emitted MuPDF worker')
}
if (!outputFiles.some((file) => /^assets\/mupdf-wasm-[^/]+\.wasm$/.test(file))) {
  fail('Expected a separately emitted MuPDF WASM asset')
}

const initialFiles = new Set(['index.html'])
for (const fileName of initialChunks) initialFiles.add(fileName)
for (const descriptor of Object.values(manifest)) {
  if (typeof descriptor !== 'object' || descriptor === null) fail('manifest entries must be objects')
  if (!initialChunks.has(descriptor.file)) continue
  resolveBundlePath(descriptor.file, 'manifest entry file')
  for (const file of descriptor.css ?? []) initialFiles.add(resolveBundlePath(file, 'manifest css'))
  for (const file of descriptor.assets ?? []) initialFiles.add(resolveBundlePath(file, 'manifest asset'))
}

const gzipSizes = []
for (const fileName of [...initialFiles].sort()) {
  const safeName = resolveBundlePath(fileName, 'initial file')
  const bytes = await readFile(path.join(outputRoot, ...safeName.split('/')))
  gzipSizes.push({ fileName: safeName, gzipBytes: gzipSync(bytes, { level: 9 }).byteLength })
}
const initialGzipBytes = gzipSizes.reduce((sum, item) => sum + item.gzipBytes, 0)
const maximum = Math.floor(
  baseline.initialGzipBytes * (1 + baseline.maxRegressionPercent / 100),
)
if (!Number.isFinite(maximum)) {
  fail(`Computed regression limit is not finite (${maximum}); check the baseline`)
}
if (initialGzipBytes > maximum) {
  fail(`Initial gzip payload ${initialGzipBytes} exceeds ${maximum} bytes `
    + `(${baseline.maxRegressionPercent}% above the ${baseline.recordedAt} baseline)`)
}

console.log(`Web bundle contract passed: ${initialGzipBytes} gzip bytes `
  + `(baseline ${baseline.initialGzipBytes}, limit ${maximum})`)
for (const item of gzipSizes) {
  console.log(`  ${item.fileName}: ${item.gzipBytes}`)
}
