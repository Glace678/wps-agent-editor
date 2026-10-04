/**
 * Structural: the Excel number-format picker must size itself from VISIBLE row
 * labels, per language.
 *
 * Regressions guarded:
 *  - "Custom formats" hosts a hidden flyout submenu; textContent concatenation
 *    measured all nested labels as one line and inflated the popup (~347-520px).
 *  - JS \b is ASCII-only, so \bформат\b / \bшрифт\b never matched and the
 *    Russian format popup was misdetected as a font picker (520px + wrong
 *    search placeholder).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8')
const src = read('src/lightweight-office/editors/ExcelEditor.tsx')
const labelSource = read('src/lightweight-office/utils/excel-picker-labels.ts')
const widthSource = read('src/lightweight-office/utils/excel-picker-width.ts')
const allSources = `${src}\n${labelSource}\n${widthSource}`

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

test('no ASCII-\\b around Cyrillic tokens (they can never match)', () => {
  assert.doesNotMatch(allSources, /\\bформат\\b/)
  assert.doesNotMatch(allSources, /\\bшрифт\\b/)
  assert.match(allSources, /формат/, 'format label regex must still cover Russian')
  assert.match(allSources, /шрифт/, 'font label regex must still cover Russian')
})

test('width fit skips options inside a collapsed flyout submenu', () => {
  assert.match(widthSource, /option\.closest\('\.toolbar-item-sub-menu'\)/)
})

test('submenu host rows measure their own menu-line label + arrow allowance', () => {
  assert.match(widthSource, /\.fortune-toolbar-menu-line/)
  assert.match(widthSource, /EXCEL_PICKER_SUBMENU_ARROW_X = 22/)
  assert.match(widthSource, /considerName\(menuLine\.textContent\?\.trim\(\) \|\| '', EXCEL_PICKER_SUBMENU_ARROW_X\)/)
})

test('format popup caps at 320 (content peaks ~260)', () => {
  assert.match(widthSource, /format:\s*\{\s*min:\s*120,\s*max:\s*320\s*\}/)
})

test('format option heuristic covers ru and es workbook locales', () => {
  const hasRu = /автомат/.test(labelSource) || labelSource.includes('\\u0430\\u0432\\u0442\\u043e\\u043c\\u0430\\u0442')
  assert.ok(hasRu, 'hint regex must include a Russian token (автомат…)')
  assert.match(labelSource, /personalizado/, 'hint regex must include Spanish tokens')
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
