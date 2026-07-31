/**
 * Structural: while the notepad settings dialog is open, Ctrl/Cmd + wheel must
 * NOT change the notepad zoom (font size). The handler still calls
 * preventDefault so the gesture cannot fall through to page-level zoom.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const textEditor = fs.readFileSync(
  path.join(root, 'src/lightweight-office/editors/TextEditor.tsx'),
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

test('wheel handler bails out while settings dialog is open', () => {
  assert.match(
    textEditor,
    /event\.preventDefault\(\)\s*\n\s*if \(settingsOpen\) return/,
    'handler must preventDefault first, then skip zoom when settingsOpen',
  )
})

test('wheel effect re-subscribes when settingsOpen changes', () => {
  assert.match(
    textEditor,
    /\[loading, settingsOpen, zoomIn, zoomOut\]/,
    'settingsOpen must be in the wheel effect dependency array',
  )
})

test('zoom still wired for the normal (settings closed) path', () => {
  assert.match(
    textEditor,
    /if \(event\.deltaY < 0\) zoomIn\(\)\s*\n\s*else zoomOut\(\)/,
  )
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
