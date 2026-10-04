// Fails when a scripts/test-* file is not reachable from package.json, CI, or the structural runner,
// so new regression scripts cannot silently rot.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STRUCTURAL_TESTS } from './run-structural-tests.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scriptsDir = path.join(root, 'scripts')
const workflowsDir = path.join(root, '.github', 'workflows')

// Known standalone/manual regression scripts. These currently have no
// package.json, CI, structural-runner, or driver-script reference and are retained
// as manually-invoked scripts (they previously passed only because they mentioned
// their own filename in a header comment, which is no longer accepted as evidence).
// They must be wired into a runner or removed in a follow-up. Any NEW test script
// not referenced by package.json/CI/structural/driver and not listed here will
// fail this check.
const KNOWN_STANDALONE = new Set([
  'test-code-file-tab-visuals.ts',
  'test-document-tab-reorder.mjs',
  'test-excel-dirty-fingerprint.mjs',
  'test-file-hover-card-border.mjs',
  'test-file-list-row-hover-border.mjs',
  'test-notepad-menubar.mjs',
  'test-notepad-table-newlines.mjs',
  'test-notepad-toolbar-language.mjs',
])

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
function stripJsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}
const driverCommands = fs.readdirSync(scriptsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(mjs|cjs|js|ts)$/.test(entry.name) && !TEST_FILE.test(entry.name))
  .map((entry) => stripJsComments(fs.readFileSync(path.join(scriptsDir, entry.name), 'utf8')))
  .join('\n')

const referenceText = [packageCommands, collectWorkflowCommands(), driverCommands].join('\n')

// Token-boundary match: the filename must appear as a standalone argument/path,
// never as a substring of another identifier. `test-foo.ts` must not match
// `test-foo.ts.bak` or `not-test-foo.tsx`.
function isReferenced(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|[^\\w.-])${escaped}(?:[^\\w.-]|$)`)
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
  && !isReferenced(name)
))

if (unwired.length) {
  console.error('These test scripts are not wired into package.json, CI, run-structural-tests.mjs, or a known standalone entry:')
  for (const name of unwired) console.error(`  scripts/${name}`)
  console.error('If a script is intentionally driven dynamically or is an approved standalone, add it to KNOWN_STANDALONE after review.')
  process.exit(1)
}
console.log('All scripts/test-* files are wired into a runner')
