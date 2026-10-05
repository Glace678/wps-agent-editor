// Runs the package.json `test:web-canaries` chain as numbered steps.
//
// The chain used to be a ~1,300-char single line of `&&`-chained commands:
// when a canary failed, you had to count `&&` segments by hand to find out
// which step broke. This runner keeps the exact same commands in the exact
// same order (fail-fast, just like `&&`), but labels each step and exits with
// the failing step's own code, so the failure location is obvious.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Verbatim copy of the segments chained by `test:web-canaries` in package.json,
// in the original order. If package.json's chain changes, change this list.
export const WEB_CANARY_STEPS = [
  'node scripts/test-office-shortcuts-structural.mjs',
  'npm run check:test-scripts',
  'npm run test:structural',
  'npm run test:agent-document-bridge',
  'npm run test:agent-reasoning',
  'npm run test:agent-model-display',
  'npm run test:collaboration-transcript',
  'npm run test:document-zoom-wheel',
  'npm run test:word-zoom-seamless',
  'npm run test:word-image-resize',
  'npm run test:word-table-borders',
  'npm run test:file-session',
  'npm run test:desktop-channel',
  'npm run check:commands',
  'npm run test:provider-contract',
  'npm run test:word-toolbar-i18n',
  'npm run test:word-caret',
  'npm run test:terminal-contract',
  'npm run test:color-pickers-e2e',
  'npm run test:pdf-worker-e2e',
  'npm run test:terminal-e2e',
]

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [index, step] of WEB_CANARY_STEPS.entries()) {
    const n = index + 1
    console.log(`\n[${n}/${WEB_CANARY_STEPS.length}] ${step}`)
    const result = spawnSync(step, { cwd: root, shell: true, encoding: 'utf8' })
    if (result.status === 0) {
      console.log(`PASS [${n}/${WEB_CANARY_STEPS.length}]`)
    } else {
      console.error(`FAIL [${n}/${WEB_CANARY_STEPS.length}] ${step} (exit ${result.status})`)
      if (result.stdout) console.error(result.stdout)
      if (result.stderr) console.error(result.stderr)
      process.exit(result.status ?? 1)
    }
  }
  console.log(`\n${WEB_CANARY_STEPS.length}/${WEB_CANARY_STEPS.length} web canaries passed`)
}
