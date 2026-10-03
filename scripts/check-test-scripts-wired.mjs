// Fails when a scripts/test-* file is not reachable from package.json, CI, or the structural runner,
// so new regression scripts cannot silently rot.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STRUCTURAL_TESTS } from './run-structural-tests.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scriptsDir = path.join(root, 'scripts')

const referenceText = [
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  ...fs.readdirSync(path.join(root, '.github/workflows'))
    .map((name) => fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8')),
  // Scripts may drive each other (e.g. a canary spawning a helper).
  ...fs.readdirSync(scriptsDir)
    .filter((name) => /\.(mjs|ts|js)$/.test(name))
    .map((name) => fs.readFileSync(path.join(scriptsDir, name), 'utf8')),
].join('\n')

const structural = new Set(STRUCTURAL_TESTS)
const unwired = fs.readdirSync(scriptsDir)
  .filter((name) => /^test-.*\.(mjs|ts)$/.test(name))
  .filter((name) => !structural.has(name))
  .filter((name) => !referenceText.includes(`scripts/${name}`))

if (unwired.length) {
  console.error('These test scripts are not wired into package.json, CI, or run-structural-tests.mjs:')
  for (const name of unwired) console.error(`  scripts/${name}`)
  process.exit(1)
}
console.log('All scripts/test-* files are wired into a runner')
