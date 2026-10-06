// Shared helpers for scripts/check-web-bundle-contract.mjs and
// scripts/update-web-bundle-baseline.mjs (wps_07 B1).
import { gzipSync } from 'node:zlib'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

export async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative))
    else files.push(relative)
  }
  return files
}

// Walk the chunk-import graph from the entry to find every initial chunk.
// Structural validation of the contract is expected to have run first.
export function collectInitialChunks(contract, fail) {
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
  return initialChunks
}

export function makePathResolver({ outputRoot, outputFileSet }, fail) {
  // Resolve a manifest/contract-relative path and confirm it stays inside
  // outputRoot and is one of the emitted files. Rejects ../ traversal,
  // backslash escapes, and absolute paths reading a file outside the bundle.
  return function resolveBundlePath(relative, label) {
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
}

// Build the initial-file set (entry + manifest css/assets of initial chunks).
export function collectInitialFiles({ manifest, contract, outputFileSet, resolveBundlePath }, fail) {
  const initialChunks = collectInitialChunks(contract, fail)
  const initialFiles = new Set(['index.html'])
  for (const fileName of initialChunks) initialFiles.add(fileName)
  for (const descriptor of Object.values(manifest)) {
    if (typeof descriptor !== 'object' || descriptor === null) fail('manifest entries must be objects')
    if (!initialChunks.has(descriptor.file)) continue
    resolveBundlePath(descriptor.file, 'manifest entry file')
    for (const file of descriptor.css ?? []) initialFiles.add(resolveBundlePath(file, 'manifest css'))
    for (const file of descriptor.assets ?? []) initialFiles.add(resolveBundlePath(file, 'manifest asset'))
  }
  return initialFiles
}

export async function measureGzip({ outputRoot, initialFiles, resolveBundlePath }) {
  const files = []
  for (const fileName of [...initialFiles].sort()) {
    const safeName = resolveBundlePath(fileName, 'initial file')
    const bytes = await readFile(path.join(outputRoot, ...safeName.split('/')))
    files.push({ fileName: safeName, gzipBytes: gzipSync(bytes, { level: 9 }).byteLength })
  }
  const total = files.reduce((sum, item) => sum + item.gzipBytes, 0)
  return { total, files }
}
