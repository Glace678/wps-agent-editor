import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const themeCssPath = path.join(root, 'src/lightweight-office/fortune-sheet-theme.css')
const themeCss = fs.readFileSync(themeCssPath, 'utf8')

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

test('fortune-sheet-theme.css contains dark mode override for selected toolbar buttons', () => {
  assert.match(themeCss, /\.dark \.excel-editor-shell \.fortune-toolbar-button\[style\*=['"]background['"]\]/)
  assert.match(themeCss, /\.dark \.excel-editor-shell \.fortune-toolbar-button\[style\*=['"]background-color['"]\]/)
  assert.match(themeCss, /\.dark \.excel-editor-shell \.fortune-toolbar-button\[data-selected=['"]true['"]\]/)
})

test('dark mode selected button background color is dark (#343438 / var(--fortune-dark-text))', () => {
  const match = themeCss.match(
    /\.dark \.excel-editor-shell \.fortune-toolbar-button\[style\*=['"]background['"]\][\s\S]*?\{([\s\S]*?)\}/,
  )
  assert.ok(match, 'Selected button rule block found')
  const body = match[1]
  assert.match(body, /background-color:\s*#343438\s*!important/)
  assert.match(body, /color:\s*var\(--fortune-dark-text\)\s*!important/)
})

test('dark mode selected button hover and active states provide distinct feedback', () => {
  assert.match(
    themeCss,
    /\.dark \.excel-editor-shell \.fortune-toolbar-button\[style\*=['"]background['"]\]:hover[\s\S]*?background-color:\s*#42424a\s*!important/,
  )
  assert.match(
    themeCss,
    /\.dark \.excel-editor-shell \.fortune-toolbar-button\[style\*=['"]background['"]\]:active[\s\S]*?background-color:\s*#242428\s*!important/,
  )
})

test('dark mode selected button SVG icon is styled bright white for high contrast', () => {
  assert.match(
    themeCss,
    /\.dark \.excel-editor-shell \.fortune-toolbar-button\[style\*=['"]background['"]\] svg[\s\S]*?color:\s*#ffffff\s*!important/,
  )
})

test('light mode selected button hover and active states provide proper feedback', () => {
  assert.match(
    themeCss,
    /\.excel-editor-shell \.fortune-toolbar-button\[style\*=['"]background['"]\]:hover[\s\S]*?background-color:\s*#d8d4dc\s*!important/,
  )
  assert.match(
    themeCss,
    /\.excel-editor-shell \.fortune-toolbar-button\[style\*=['"]background['"]\]:active[\s\S]*?background-color:\s*#cbcfd8\s*!important/,
  )
})

console.log(`\n${passed} test(s) passed successfully.`)
