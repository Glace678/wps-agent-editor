import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  collectInitialFiles,
  listFiles,
  makePathResolver,
  measureGzip,
  readJson,
} from './lib/web-bundle.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const outputRoot = path.join(projectRoot, 'out', 'renderer')

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

// B1: provenance — the baseline number must come from the dedicated update
// script (scripts/update-web-bundle-baseline.mjs), never a hand edit. The
// recorded commit must exist in this checkout, be an ancestor of HEAD, and its
// commit-date must match recordedAt.
if (!/^[0-9a-f]{7,40}$/.test(baseline.commitSha ?? '')) {
  fail('baseline.commitSha missing or malformed; regenerate with scripts/update-web-bundle-baseline.mjs')
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(baseline.recordedAt ?? '')) {
  fail('baseline.recordedAt must be a YYYY-MM-DD date; regenerate with scripts/update-web-bundle-baseline.mjs')
}
try {
  const commitDate = execFileSync(
    'git',
    ['show', '-s', '--format=%cI', baseline.commitSha],
    { cwd: projectRoot, encoding: 'utf8' },
  ).trim().slice(0, 10)
  if (commitDate !== baseline.recordedAt) {
    fail(`baseline.recordedAt (${baseline.recordedAt}) does not match the commit date of `
      + `${baseline.commitSha} (${commitDate}); regenerate with scripts/update-web-bundle-baseline.mjs`)
  }
  execFileSync(
    'git',
    ['merge-base', '--is-ancestor', baseline.commitSha, 'HEAD'],
    { cwd: projectRoot, stdio: 'ignore' },
  )
} catch (error) {
  fail(`baseline commit ${baseline.commitSha} is not an ancestor of HEAD; `
    + 'regenerate with scripts/update-web-bundle-baseline.mjs '
    + `(${error?.message?.split('\n')[0] ?? error})`)
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
const resolveBundlePath = makePathResolver({ outputRoot, outputFileSet }, fail)

// Assert no heavy engine entered the initial graph, and each known engine is
// emitted only via lazy chunks.
const initialChunks = (() => {
  const chunks = new Set()
  const pending = [contract.entry]
  while (pending.length > 0) {
    const fileName = pending.pop()
    if (chunks.has(fileName)) continue
    const chunk = contract.chunks[fileName]
    if (!chunk) fail(`Missing chunk metadata for ${fileName}`)
    chunks.add(fileName)
    pending.push(...chunk.imports)
  }
  return chunks
})()

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

const initialFiles = collectInitialFiles(
  { manifest, contract, outputFileSet, resolveBundlePath },
  fail,
)
const { total: initialGzipBytes, files: gzipSizes } = await measureGzip(
  { outputRoot, initialFiles, resolveBundlePath },
)
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
