// Fails when a scripts/test-* file is not reachable from package.json, CI, or the structural runner,
// so new regression scripts cannot silently rot.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STRUCTURAL_TESTS } from './run-structural-tests.mjs'
import { stripComments as stripJsComments } from './lib/comment-utils.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scriptsDir = path.join(root, 'scripts')
const workflowsDir = path.join(root, '.github', 'workflows')

// Known standalone/manual regression scripts. Every test-* script is wired into
// run-structural-tests.mjs, package.json, CI, or a driver script; this list is
// an empty allowlist kept so that a genuinely manual script requires explicit
// review before being admitted.
const KNOWN_STANDALONE = new Set()

// 项16: a test script may end in .mjs, .ts, OR .js.
const TEST_FILE = /^test-.*\.(mjs|ts|js)$/

// Authoritative wiring evidence #1: package.json script commands.
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const packageCommands = Object.values(packageJson.scripts ?? []).join('\n')

// Authoritative wiring evidence #2: workflow run commands. Read only regular
// files (项19) and drop comment lines so a mention inside a YAML comment cannot
// count as wiring evidence.
function collectWorkflowCommands() {
  if (!fs.existsSync(workflowsDir)) return ''
  return fs.readdirSync(workflowsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => fs.readFileSync(path.join(workflowsDir, entry.name), 'utf8'))
    .join('\n')
}

// Evidence #3: non-test driver scripts may spawn a helper. Strip JS comments so
// a mention in a comment is not mistaken for an invocation. The checked test
// files themselves are excluded, so a script cannot wire itself by referencing
// its own filename (项17).
const driverCommands = fs.readdirSync(scriptsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(mjs|cjs|js|ts)$/.test(entry.name) && !TEST_FILE.test(entry.name))
  .map((entry) => stripJsComments(fs.readFileSync(path.join(scriptsDir, entry.name), 'utf8')))
  .join('\n')

const referenceText = [packageCommands, collectWorkflowCommands(), driverCommands].join('\n')

// B6: a bare mention of the filename (documentation text, a string literal, a
// commented-out reference) must NOT count as wiring evidence. Require an
// executable invocation verb within the text immediately preceding the
// filename: `node scripts/test-x.mjs`, `tsx scripts/test-x.ts`, spawn/exec
// calls that pass the script as an argument.
const INVOCATION_GAP = String.raw`[^\n]{0,160}?`
const INVOCATION_VERBS = [
  'node',
  'npx',
  'tsx',
  'spawnSync',
  'spawn',
  'execFileSync',
  'execSync',
  'execFile',
  'exec',
].join('|')
function isInvoked(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `\\b(?:${INVOCATION_VERBS})\\b${INVOCATION_GAP}${escaped}(?![\\w.-])`,
  )
  return pattern.test(referenceText)
}

const structural = new Set(STRUCTURAL_TESTS)
const testFiles = fs.readdirSync(scriptsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => TEST_FILE.test(name))

const unwired = testFiles.filter((name) => (
  !structural.has(name)
  && !KNOWN_STANDALONE.has(name)
  && !isInvoked(name)
))

if (unwired.length) {
  console.error('These test scripts are not wired into package.json, CI, run-structural-tests.mjs, or a known standalone entry:')
  for (const name of unwired) console.error(`  scripts/${name}`)
  console.error('If a script is intentionally driven dynamically or is an approved standalone, add it to KNOWN_STANDALONE after review.')
  process.exit(1)
}
console.log('All scripts/test-* files are wired into a runner')
