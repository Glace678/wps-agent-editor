/**
 * Structural: Word toolbar collapses overflow into SuperDoc 「⋯」 menu
 * (Excel-like), instead of forcing all buttons visible via horizontal scroll.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const toolbar = fs.readFileSync(path.join(root, 'src/lightweight-office/word-toolbar.ts'), 'utf8')
const overflowPolicy = fs.readFileSync(
  path.join(root, 'src/lightweight-office/word-toolbar-overflow.ts'),
  'utf8',
)
const css = fs.readFileSync(path.join(root, 'src/lightweight-office/word-editor.css'), 'utf8')
const wordEditor = fs.readFileSync(
  path.join(root, 'src/lightweight-office/editors/WordEditor.tsx'),
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

test('SuperDoc overflow mode enabled (hideButtons + responsiveToContainer)', () => {
  assert.match(toolbar, /hideButtons:\s*true/)
  assert.match(toolbar, /responsiveToContainer:\s*true/)
  assert.doesNotMatch(toolbar, /hideButtons:\s*false/)
  assert.doesNotMatch(toolbar, /responsiveToContainer:\s*false/)
})

test('custom groups include SuperDoc overflow (three-dots) control', () => {
  // Without 'overflow' in groups, SuperDoc filters out the ⋯ button entirely.
  assert.match(toolbar, /'overflow'/)
  assert.match(toolbar, /SuperDoc overflow/)
})

test('full toolbar groups still declared (not emptied)', () => {
  for (const id of ['bold', 'fontFamily', 'table', 'zoom', 'undo', 'overflow']) {
    assert.match(toolbar, new RegExp(`'${id}'`))
  }
  assert.match(toolbar, /createFullWordEditorModules/)
})

test('WordEditor forces toolbar resize on container size changes', () => {
  assert.match(wordEditor, /onToolbarResize/)
  assert.match(wordEditor, /ResizeObserver/)
})

test('CSS no longer forces max-content / horizontal scroll for all buttons', () => {
  // Old pattern that prevented overflow measurement
  assert.doesNotMatch(
    css,
    /\.superdoc-toolbar\s*\{[^}]*width:\s*max-content\s*!important/,
  )
  assert.match(css, /\.superdoc-toolbar\s*\{[\s\S]*?width:\s*100%/)
  // Container is width-bounded; overflow visible so ⋯ dropdown can paint below
  assert.match(
    css,
    /\.superdoc-toolbar-container[\s\S]{0,400}(?:overflow:\s*visible|max-width:\s*100%)/,
  )
  assert.match(css, /\.superdoc-toolbar\s*\{[\s\S]*?min-width:\s*0/)
})

test('overflow / three-dots chrome is styled and not zero-width', () => {
  assert.match(css, /superdoc-toolbar-overflow/)
  assert.match(css, /overflow-menu/)
  assert.match(css, /padding-right:\s*37px/)
  assert.match(css, /\.sd-toolbar-button\s*\{[\s\S]*?min-width:\s*28px/)
  assert.match(css, /position:\s*absolute/)
})

test('overflow policy measures rendered controls and avoids the old fixed 96px reserve', () => {
  assert.match(overflowPolicy, /getBoundingClientRect\(\)\.width/)
  assert.match(overflowPolicy, /data-item\^='btn-'/)
  assert.match(overflowPolicy, /measuredItemWidths/)
  assert.doesNotMatch(overflowPolicy, /RESERVED_WIDTH\s*=\s*96/)
})

test('resize reuses the complete item set and explicitly refreshes the Vue toolbar', () => {
  assert.match(overflowPolicy, /orderedItems\.length === 0/)
  assert.match(overflowPolicy, /toolbar\.emit\('toolbar-items-changed'\)/)
  assert.match(overflowPolicy, /documentMode\.group\.value = 'center'/)
})

test('WordEditor still mounts full modules from createFullWordEditorModules', () => {
  assert.match(wordEditor, /createFullWordEditorModules/)
  assert.match(wordEditor, /modules=\{wordEditorModules\}/)
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
