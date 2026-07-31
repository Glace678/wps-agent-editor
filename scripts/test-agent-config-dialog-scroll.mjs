/**
 * Structural: the agent config dialog (opened from the assistant panel's plus
 * button) must keep its form scrollable. The body is a flex-1 child of a
 * max-h flex column, so it needs min-h-0 (min-height:auto would keep it at
 * content height) and native overflow-y-auto (a Radix ScrollArea viewport's
 * h-full percentage cannot resolve inside a max-h-only flex column, so it
 * silently never scrolls).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dialog = fs.readFileSync(
  path.join(root, 'src/components/agent/AgentConfigDialog.tsx'),
  'utf8',
)

let passed = 0
function test(name, fn) {
  try {
    fn()
    console.log(`PASS  ${name}`)
    passed += 1
  } catch (err) {
    console.error(`FAIL  ${name}`)
    console.error(err)
    process.exitCode = 1
  }
}

test('dialog body scrolls natively and can shrink below content height', () => {
  assert.match(
    dialog,
    /className="min-h-0 flex-1 overflow-y-auto px-6" data-testid="agent-config-dialog-body"/,
    'body must be a min-h-0 flex-1 overflow-y-auto container',
  )
})

test('dialog body does not use Radix ScrollArea (broken under max-h flex column)', () => {
  assert.doesNotMatch(dialog, /<ScrollArea/)
  assert.doesNotMatch(dialog, /from '@\/components\/ui\/scroll-area'/)
})

test('dialog root caps height and lays out as a column', () => {
  assert.match(dialog, /max-h-\[90vh\][^"]*flex-col|flex[^"]*max-h-\[90vh\][^"]*flex-col/)
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
