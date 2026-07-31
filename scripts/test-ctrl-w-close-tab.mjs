/**
 * Structural: Ctrl+W must close the shell DocumentTabBar tab, not only clear currentFile.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shell = fs.readFileSync(
  path.join(root, 'src/lightweight-office/LightweightDocumentEditor.tsx'),
  'utf8',
)
const text = fs.readFileSync(
  path.join(root, 'src/lightweight-office/editors/TextEditor.tsx'),
  'utf8',
)
const catalog = fs.readFileSync(
  path.join(root, 'src/lib/office-shortcuts/catalog.ts'),
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

test('catalog maps Ctrl+W to close action', () => {
  assert.match(catalog, /actionId:\s*'close'/)
  assert.match(catalog, /defaultChord:\s*'Ctrl\+W'/)
})

test('Word/Excel close handler uses closeActiveTab (not bare setCurrentFile null)', () => {
  assert.match(shell, /closeActiveTab/)
  assert.match(shell, /close:\s*\(\)\s*=>\s*\{\s*tabNav\?\.closeActiveTab\(\)/)
  // The old bug: close only cleared the store file and left the tab strip
  assert.doesNotMatch(
    shell,
    /close:\s*\(\)\s*=>\s*\{\s*setCurrentFile\(null\)\s*\}/,
  )
})

test('closeTab removes tab and selects a neighbor', () => {
  assert.match(shell, /remaining\[Math\.min\(index,\s*remaining\.length - 1\)\]/)
  assert.match(shell, /const closeActiveTab = useCallback/)
})

test('embedded TextEditor Ctrl+W closes shell tab when provided', () => {
  assert.match(text, /onShellCloseTab/)
  assert.match(text, /if \(onShellCloseTab\) onShellCloseTab\(\)/)
  assert.match(shell, /onShellCloseTab=\{closeActiveTab\}/)
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
