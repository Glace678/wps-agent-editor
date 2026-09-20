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
}

const outputFiles = await listFiles(outputRoot)
if (!outputFiles.some((file) => /^assets\/mupdf[.-]worker-[^/]+\.js$/.test(file))) {
  fail('Expected a separately emitted MuPDF worker')
}
if (!outputFiles.some((file) => /^assets\/mupdf-wasm-[^/]+\.wasm$/.test(file))) {
  fail('Expected a separately emitted MuPDF WASM asset')
}

const initialFiles = new Set(['index.html', ...initialChunks])
for (const descriptor of Object.values(manifest)) {
  if (!initialChunks.has(descriptor.file)) continue
  for (const file of descriptor.css ?? []) initialFiles.add(file)
  for (const file of descriptor.assets ?? []) initialFiles.add(file)
}

const gzipSizes = []
for (const fileName of [...initialFiles].sort()) {
  const bytes = await readFile(path.join(outputRoot, ...fileName.split('/')))
  gzipSizes.push({ fileName, gzipBytes: gzipSync(bytes, { level: 9 }).byteLength })
}
const initialGzipBytes = gzipSizes.reduce((sum, item) => sum + item.gzipBytes, 0)
const maximum = Math.floor(
  baseline.initialGzipBytes * (1 + baseline.maxRegressionPercent / 100),
)
if (initialGzipBytes > maximum) {
  fail(`Initial gzip payload ${initialGzipBytes} exceeds ${maximum} bytes `
    + `(${baseline.maxRegressionPercent}% above the ${baseline.recordedAt} baseline)`)
}

console.log(`Web bundle contract passed: ${initialGzipBytes} gzip bytes `
  + `(baseline ${baseline.initialGzipBytes}, limit ${maximum})`)
for (const item of gzipSizes) {
  console.log(`  ${item.fileName}: ${item.gzipBytes}`)
}
