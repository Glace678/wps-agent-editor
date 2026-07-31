/**
 * Structural: Excel font/size picker search is pinned above the scroll list
 * (not sticky inside it), so options cannot paint through the search chrome.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(path.join(root, 'src/lightweight-office/editors/ExcelEditor.tsx'), 'utf8')
const css = fs.readFileSync(path.join(root, 'src/lightweight-office/fortune-sheet-theme.css'), 'utf8')

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

test('decoratePicker pins search before the scrolling select', () => {
  assert.match(src, /popup\.insertBefore\(searchHeader,\s*select\)/)
  assert.doesNotMatch(src, /select\.prepend\(searchHeader\)/)
  assert.match(src, /excel-toolbar-picker-search/)
  assert.match(src, /excel-font-search/)
})

test('font/format/size picker kind detection covers Fortune locales + heuristics', () => {
  // Spanish / Russian labels that previously missed the search field.
  assert.match(src, /\\bfuente\\b/)
  // JS \b is ASCII-only: \bшрифт\b can never match, so the token must be bare.
  assert.match(src, /шрифт/)
  assert.doesNotMatch(src, /\\bшрифт\\b/)
  assert.doesNotMatch(src, /\\bформат\\b/)
  assert.match(src, /tama\[nñ\]o/)
  assert.match(src, /размер/)
  assert.match(src, /шрифта/)
  // Format (格式) picker
  assert.match(src, /'format'/)
  assert.match(src, /EXCEL_FORMAT_LABEL_RE/)
  assert.match(src, /looksLikeFormatList/)
  assert.match(src, /excel-format-search/)
  // Fallback when labels are missing or unexpected.
  assert.match(src, /looksLikeFontList/)
  // Per kind + language width strategies (not one global max algorithm).
  assert.match(src, /fitExcelToolbarPickerWidth/)
  assert.match(src, /resolveExcelPickerWidthStrategy/)
  assert.match(src, /isCjkUiLanguage/)
  assert.match(src, /isLongHintLanguage/)
  assert.match(src, /collectSystemFontDisplayNames/)
  assert.match(src, /measureExcelPickerTextWidth/)
  assert.match(src, /widthForPlaceholder/)
  assert.match(src, /widthForLongestLabel/)
  // Font-size stays compact; sizing uses text metrics only (no live scrollWidth).
  assert.match(src, /'font-size':\s*\{\s*min:\s*56/)
  assert.match(src, /Pure text metrics only/)
  assert.doesNotMatch(src, /considerName\(name,\s*Math\.ceil\(option\.scrollWidth/)
  // Avoid native search clear gutter (black trailing edge).
  assert.match(src, /input\.type = 'text'/)
})

test('font-size uses short localized placeholders', () => {
  const en = fs.readFileSync(path.join(root, 'src/lib/i18n/locales/en.ts'), 'utf8')
  const zh = fs.readFileSync(path.join(root, 'src/lib/i18n/locales/zh-CN.ts'), 'utf8')
  const pt = fs.readFileSync(path.join(root, 'src/lib/i18n/locales/pt.ts'), 'utf8')
  assert.match(en, /fontSizeSearchPlaceholder:\s*'Size'/)
  assert.match(zh, /fontSizeSearchPlaceholder:\s*'\\u5b57\\u53f7'/)
  // Must not use long phrases that force a wide size popup.
  assert.doesNotMatch(pt, /fontSizeSearchPlaceholder:\s*'Inserir/)
})

test('i18n exposes format and font-size search placeholders', () => {
  const en = fs.readFileSync(path.join(root, 'src/lib/i18n/locales/en.ts'), 'utf8')
  const zh = fs.readFileSync(path.join(root, 'src/lib/i18n/locales/zh-CN.ts'), 'utf8')
  assert.match(en, /fontSizeSearchPlaceholder/)
  assert.match(en, /formatSearchPlaceholder/)
  assert.match(zh, /fontSizeSearchPlaceholder/)
  assert.match(zh, /formatSearchPlaceholder/)
})

test('CSS: popup is a column shell; only the option list scrolls', () => {
  assert.match(
    css,
    /\.fortune-toolbar-combo-popup\[data-excel-picker-kind\]\s*\{[\s\S]*?flex-direction:\s*column[\s\S]*?overflow:\s*hidden/,
  )
  assert.match(
    css,
    /data-excel-picker-kind\] \.fortune-toolbar-select\s*\{[\s\S]*?overflow-y:\s*auto/,
  )
})

test('CSS: search chrome is fixed header (relative + opaque), not sticky in list', () => {
  const block = css.match(/\.excel-editor-shell \.excel-toolbar-picker-search \{[\s\S]*?\n\}/)
  assert.ok(block, 'search CSS block')
  assert.match(block[0], /position:\s*relative/)
  assert.doesNotMatch(block[0], /position:\s*sticky/)
  assert.match(block[0], /z-index:\s*5/)
  assert.match(block[0], /background:\s*#fff/)
  assert.match(block[0], /flex:\s*0\s+0\s+auto/)
})

test('CSS: placeholder field does not use a horizontal scrollbar gutter', () => {
  assert.match(
    css,
    /\.excel-toolbar-picker-search-input \{[\s\S]*?overflow-x:\s*hidden/,
  )
  assert.doesNotMatch(
    css,
    /\.excel-toolbar-picker-search-input\[type='search'\]\s*\{[\s\S]*?padding-inline-end:\s*28px/,
  )
})

test('CSS: dark search input is not pure black (no trailing black strip)', () => {
  assert.doesNotMatch(css, /\.excel-toolbar-picker-search-input \{\s*[\s\S]*?background:\s*#050505/)
  assert.match(
    css,
    /\.dark[\s\S]*?\.excel-toolbar-picker-search-input \{[\s\S]*?background:\s*var\(--fortune-dark-bg/,
  )
  // Font / size / format all use content-driven width (no forced wide min-width).
  assert.match(css, /data-excel-picker-kind='font'/)
  assert.match(css, /data-excel-picker-kind='font-size'/)
  assert.match(css, /data-excel-picker-kind='format'/)
  assert.match(
    css,
    /data-excel-picker-kind='font'[\s\S]*?data-excel-picker-kind='format'[\s\S]*?min-width:\s*0/,
  )
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
