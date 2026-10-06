#!/usr/bin/env node
// Sole sanctioned way to update scripts/web-bundle-baseline.json (wps_07 B1).
// Records provenance (the exact git commit and its commit date) so the check
// script can reject hand-edits. Run after a fresh production web build:
//
//   node node_modules/vite/bin/vite.js build
//   node scripts/update-web-bundle-baseline.mjs
//
// Then commit the baseline file on its own so reviewers see the provenance.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  collectInitialFiles,
  listFiles,
  makePathResolver,
  measureGzip,
  readJson,
} from './lib/web-bundle.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = path.join(projectRoot, 'out', 'renderer')

function fail(message) {
  throw new Error(`[web-bundle] ${message}`)
}

const [manifest, contract, previous] = await Promise.all([
  readJson(path.join(outputRoot, '.vite', 'manifest.json')),
  readJson(path.join(outputRoot, '.vite', 'bundle-contract.json')),
  readJson(path.join(projectRoot, 'scripts', 'web-bundle-baseline.json')).catch(() => null),
])
if (contract.schemaVersion !== 1) fail('Unsupported bundle contract schema; build first')
if (typeof contract.entry !== 'string' || !contract.entry) fail('Malformed bundle contract; build first')

const outputFiles = await listFiles(outputRoot)
const outputFileSet = new Set(outputFiles)
const resolveBundlePath = makePathResolver({ outputRoot, outputFileSet }, fail)
const initialFiles = collectInitialFiles(
  { manifest, contract, outputFileSet, resolveBundlePath },
  fail,
)
const { total } = await measureGzip({ outputRoot, initialFiles, resolveBundlePath })

const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: projectRoot,
  encoding: 'utf8',
}).trim()
const recordedAt = execFileSync('git', ['show', '-s', '--format=%cI', commitSha], {
  cwd: projectRoot,
  encoding: 'utf8',
}).trim().slice(0, 10)

const next = {
  schemaVersion: 1,
  commitSha,
  recordedAt,
  initialGzipBytes: total,
  maxRegressionPercent: previous?.maxRegressionPercent ?? 10,
}
const baselinePath = path.join(projectRoot, 'scripts', 'web-bundle-baseline.json')
writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`)
console.log(`Baseline updated: ${total} gzip bytes at ${commitSha.slice(0, 12)} (${recordedAt})`)
