import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const rendering = fs.readFileSync(
  path.join(root, 'src/lightweight-office/utils/fortune-rendering.ts'),
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

assert.match(
  theme,
  /--fortune-dark-sheet-bg:\s*#fff;/,
  'dark theme should expose a dedicated worksheet surface token',
)
assert.match(
  theme,
  /\.dark\s+\.excel-editor-shell\s+\.fortune-sheet-canvas\s*\{[^}]*background:\s*var\(--fortune-dark-sheet-bg\);/s,
  'worksheet canvas should use the authored sheet surface instead of hard black',
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

console.log('Excel dark color preservation checks passed')
