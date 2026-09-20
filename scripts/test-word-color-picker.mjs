import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const picker = fs.readFileSync(path.join(root, 'src/lightweight-office/word-color-picker.tsx'), 'utf8')
const css = fs.readFileSync(path.join(root, 'src/lightweight-office/word-color-picker.css'), 'utf8')
const editor = fs.readFileSync(path.join(root, 'src/lightweight-office/editors/WordEditor.tsx'), 'utf8')

const paletteSource = picker.match(/EXCEL_COLOR_PALETTE[^=]*= \[([\s\S]*?)\] as const/)
assert.ok(paletteSource, 'Word picker must declare the Excel palette')
const paletteColors = paletteSource[1].match(/'#[0-9a-f]{6}'/gi) ?? []
assert.equal(paletteColors.length, 64, 'Word picker must carry all 64 Excel palette colors')
assert.match(picker, /EXCEL_COLOR_PALETTE\.flatMap/, 'Word picker must render the shared palette')
assert.match(picker, /ExcelCircularColorPicker/, 'Word picker must expose the circular custom picker')
assert.match(picker, /toolbar\.emitCommand\(\{ item, argument: color \}\)/, 'color writes must use SuperDoc toolbar commands')
assert.match(picker, /argument: null/, 'reset must clear the text color through the toolbar command path')
assert.match(picker, /MutationObserver/, 'teleported SuperDoc menus must be observed')
assert.match(css, /data-word-font-color-menu/, 'Word color menu needs a teleported-menu style boundary')
assert.match(css, /grid-template-columns: repeat\(8, 22px\)/, 'Word palette must remain an 8-column grid')
assert.match(editor, /installWordFontColorPicker/, 'WordEditor must install the color picker')
assert.match(editor, /__wordFontColorPickerCleanup/, 'WordEditor must clean up the picker on document changes')

console.log('Word color picker structural checks passed')
