import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const rendering = fs.readFileSync(
  path.join(root, 'src/lightweight-office/utils/fortune-rendering.ts'),
  'utf8',
)
const xlsxConvert = fs.readFileSync(
  path.join(root, 'src/lightweight-office/utils/xlsx-convert.ts'),
  'utf8',
)
const theme = fs.readFileSync(
  path.join(root, 'src/lightweight-office/fortune-sheet-theme.css'),
  'utf8',
)

assert.doesNotMatch(
  rendering,
  /globalCompositeOperation\s*=\s*['"]difference['"]/,
  'dark-mode worksheet should not invert the entire canvas anymore',
)
assert.doesNotMatch(
  rendering,
  /invertBackingPixels|scheduleNativeDarkPixels|restoreNativeLightPixels/,
  'legacy whole-canvas dark inversion helpers should stay removed',
)
assert.doesNotMatch(
  rendering,
  /(?:filter|webkitFilter)\s*=\s*[^;\n]*invert\s*\(/i,
  'worksheet rendering must not use a whole-canvas invert filter',
)
assert.doesNotMatch(
  rendering,
  /\b(?:getImageData|putImageData)\s*\(/,
  'worksheet rendering must not rewrite the whole canvas pixel buffer',
)

assert.match(
  theme,
  /--fortune-dark-sheet-bg:\s*#000;/,
  'dark theme should use black as the default worksheet surface',
)
assert.match(
  theme,
  /--fortune-dark-sheet-text:\s*#f5f5f5;/,
  'dark theme should use light text for cells without an authored font color',
)
assert.match(
  theme,
  /\.dark\s+\.excel-editor-shell\s+\.fortune-sheet-canvas\s*\{[^}]*background:\s*var\(--fortune-dark-sheet-bg\);/s,
  'worksheet canvas should use the dark worksheet surface token',
)
assert.doesNotMatch(
  theme,
  /\.luckysheet-input-box-inner,[^}]*background:\s*#000\s*!important;/s,
  'live cell editor should no longer force a black background in dark mode',
)
assert.doesNotMatch(
  theme,
  /\.luckysheet-cell-input[^}]*color:\s*#f5f5f5\s*!important;/s,
  'live cell editor text should no longer force light text over authored styles',
)

assert.match(
  rendering,
  /const\s+DARK_WORKSHEET_BACKGROUND\s*=\s*['"]#000000['"]/,
  'canvas rendering should paint implicit worksheet backgrounds black',
)
assert.match(
  rendering,
  /const\s+DARK_WORKSHEET_TEXT\s*=\s*['"]#f5f5f5['"]/,
  'canvas rendering should paint implicit worksheet text light',
)

const cellDrawMethods = rendering.match(
  /const\s+CELL_DRAW_METHODS\s*=\s*\[([\s\S]*?)\]\s*as const/,
)
assert.ok(cellDrawMethods, 'cell-level dark rendering methods should be declared together')
for (const methodName of ['cellRender', 'nullCellRender', 'cellOverflowRender']) {
  assert.match(
    cellDrawMethods[1],
    new RegExp(`name:\\s*['"]${methodName}['"]`),
    `${methodName} should participate in cell-level dark rendering`,
  )
}
assert.match(
  rendering,
  /for\s*\(\s*const\s*\{[^}]*\bname\b[^}]*\}\s+of\s+CELL_DRAW_METHODS\s*\)[\s\S]*?prototype\s*\[\s*name\s*\]\s*=\s*function/,
  'every cell draw method should be wrapped instead of post-processing the whole canvas',
)

const paintState = rendering.match(
  /function\s+getCellPaintState\s*\([\s\S]*?\n\}/,
)
assert.ok(paintState, 'cell paint state should be derived before drawing')
assert.match(
  paintState[0],
  /cell\?\.bg/,
  'authored cell backgrounds should be detected independently',
)
assert.match(
  paintState[0],
  /cell\?\.fc/,
  'authored cell font colors should be detected independently',
)
assert.match(
  paintState[0],
  /!hasAuthoredBackground\s*&&\s*!hasConditionalBackground/,
  'dark background substitution should only apply when no explicit background exists',
)
assert.match(
  paintState[0],
  /!hasAuthoredText\s*&&\s*!hasConditionalText/,
  'dark text substitution should only apply when no explicit text color exists',
)

const darkCellPaint = rendering.match(
  /function\s+withDarkCellPaint\s*\([\s\S]*?\n\}/,
)
assert.ok(darkCellPaint, 'cell drawing should have a scoped dark-default wrapper')
assert.match(
  darkCellPaint[0],
  /if\s*\(\s*!state\.useDarkDefaultBackground\s*\)/,
  'explicit cell backgrounds should pass through unchanged',
)
assert.match(
  darkCellPaint[0],
  /state\.useDarkDefaultText\s*&&\s*isDefaultCanvasTextColor/,
  'explicit font colors should not be replaced by the dark default',
)

assert.match(
  xlsxConvert,
  /if\s*\(\s*fontColor\s*\)\s*(?:\{\s*)?style\.fc\s*=\s*fontColor/,
  'xlsx import should preserve a source font color when one exists',
)
assert.doesNotMatch(
  xlsxConvert,
  /style\.fc\s*=\s*fontColor\s*\|\|\s*DEFAULT_SPREADSHEET_FONT_COLOR/,
  'xlsx import must not turn an automatic font color into an explicit black color',
)
assert.doesNotMatch(
  xlsxConvert,
  /\bfc\s*:\s*DEFAULT_SPREADSHEET_FONT_COLOR/,
  'unstyled xlsx fallback cells must leave font color implicit',
)
assert.match(
  xlsxConvert,
  /if\s*\(\s*fillColor\s*\)\s*(?:\{\s*)?style\.bg\s*=\s*fillColor/,
  'xlsx import should preserve an explicit source fill color',
)

console.log('Excel dark color preservation checks passed')
