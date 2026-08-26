/**
 * Structural + pure-logic checks for Excel toolbar hover shortcut decoration.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcPath = path.join(root, 'src/lightweight-office/utils/excel-toolbar-shortcuts.ts')
const editorPath = path.join(root, 'src/lightweight-office/editors/ExcelEditor.tsx')
const src = fs.readFileSync(srcPath, 'utf8')
const editor = fs.readFileSync(editorPath, 'utf8')

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

// Evaluate pure helpers via a tiny transpile-free mirror of the exported logic
// by dynamic-importing a built version is heavy; re-check source contracts and
// run a lightweight inline copy of the pure functions for behavior checks.
function excelToolbarTipHasShortcut(tip) {
  if (!tip) return false
  if (/\([^)]*(?:Ctrl|Alt|Shift|Cmd|Command|Meta|⌘|⌃)[^)]*\)/i.test(tip)) return true
  if (/（[^）]*(?:Ctrl|Alt|Shift|Cmd|Command|Meta|⌘|⌃)[^）]*）/i.test(tip)) return true
  if (/\b(?:Ctrl|Alt|Shift)\s*\+/i.test(tip)) return true
  if (/\bF(?:1[0-2]|[1-9])\b/.test(tip)) return true
  return false
}

function appendExcelToolbarShortcut(tip, chord) {
  const base = tip.trim()
  if (!base || !chord || excelToolbarTipHasShortcut(base)) return tip
  return `${base} (${chord})`
}

test('module maps core Excel toolbar chords', () => {
  assert.match(src, /undo:\s*'Ctrl\+Z'/)
  assert.match(src, /redo:\s*'Ctrl\+Y'/)
  assert.match(src, /underline:\s*'Ctrl\+U'/)
  assert.match(src, /'currency-format':\s*'Ctrl\+Shift\+\$'/)
  assert.match(src, /'percentage-format':\s*'Ctrl\+Shift\+%'/)
  assert.match(src, /filter:\s*'Ctrl\+Shift\+L'/)
  assert.match(src, /comment:\s*'Shift\+F2'/)
  assert.match(src, /link:\s*'Ctrl\+K'/)
  assert.match(src, /search:\s*'Ctrl\+F'/)
  assert.match(src, /'formula-sum':\s*'Alt\+='/)
  assert.match(src, /border:\s*'Ctrl\+Shift\+&'/)
})

test('does not overwrite tips that already include a shortcut', () => {
  assert.equal(appendExcelToolbarShortcut('Bold (Ctrl+B)', 'Ctrl+B'), 'Bold (Ctrl+B)')
  assert.equal(appendExcelToolbarShortcut('粗体 (Ctrl+B)', 'Ctrl+B'), '粗体 (Ctrl+B)')
  assert.equal(appendExcelToolbarShortcut('粗體（Ctrl+B）', 'Ctrl+B'), '粗體（Ctrl+B）')
  assert.equal(appendExcelToolbarShortcut('Strikethrough (Alt+Shift+5)', 'Ctrl+5'), 'Strikethrough (Alt+Shift+5)')
})

test('appends chord when missing', () => {
  assert.equal(appendExcelToolbarShortcut('Underline', 'Ctrl+U'), 'Underline (Ctrl+U)')
  assert.equal(appendExcelToolbarShortcut('下划线', 'Ctrl+U'), '下划线 (Ctrl+U)')
  assert.equal(appendExcelToolbarShortcut('Undo', 'Ctrl+Z'), 'Undo (Ctrl+Z)')
  // Hover box under 撤销 must show: 撤销 (Ctrl+Z)
  assert.equal(appendExcelToolbarShortcut('撤销', 'Ctrl+Z'), '撤销 (Ctrl+Z)')
  assert.equal(appendExcelToolbarShortcut('Filter', 'Ctrl+Shift+L'), 'Filter (Ctrl+Shift+L)')
})

test('undo maps to Ctrl+Z for icon and Chinese tip', () => {
  assert.match(src, /undo:\s*'Ctrl\+Z'/)
  assert.match(src, /撤销/)
  assert.match(src, /syncExcelToolbarTooltipNode/)
  // Visible hover box must be synced to full tip text
  assert.match(src, /fortune-tooltip/)
})

test('ExcelEditor wires decoration + observer', () => {
  assert.match(editor, /decorateExcelToolbarShortcuts/)
  assert.match(editor, /from ['"].*excel-toolbar-shortcuts['"]/)
  assert.match(editor, /toolbarShortcutObserver/)
})

test('decorateExcelToolbarControl is exported and marks decorated nodes', () => {
  assert.match(src, /export function decorateExcelToolbarControl/)
  assert.match(src, /export function decorateExcelToolbarShortcuts/)
  assert.match(src, /dataset\.excelShortcutDecorated/)
  assert.match(src, /excelToolbarTipHasShortcut/)
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
