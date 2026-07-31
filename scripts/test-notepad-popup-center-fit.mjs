/**
 * Structural check: heading / list popups size for multi-language labels;
 * table shell still fits grid; File/Edit/View stay wide.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(
  path.join(root, 'src/lightweight-office/editors/NotepadCommandBar.tsx'),
  'utf8',
)
const indexCss = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8')

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

function extractClassConst(name) {
  const match = src.match(new RegExp(`const ${name}\\s*=\\s*\\n?\\s*['\`]([^'\`]+)['\`]`))
  assert.ok(match, `${name} must exist`)
  return match[1]
}

test('heading / list / table triggers still present', () => {
  assert.match(src, /notepad-heading-menu/)
  assert.match(src, /notepad-list-menu/)
  assert.match(src, /notepad-table-menu/)
})

test('compactFormatContentClass is content-fit and wide enough for locales', () => {
  const cls = extractClassConst('compactFormatContentClass')
  assert.match(cls, /\bw-max\b/)
  assert.match(cls, /text-\[13px\]/, 'font size unchanged')
  assert.doesNotMatch(cls, /min-w-\[232px\]/)
  const max = cls.match(/max-w-\[(\d+)px\]/)
  assert.ok(max, 'max-w required')
  assert.ok(Number(max[1]) >= 220, 'max-w must fit long RU/DE/PT labels')
  assert.doesNotMatch(cls, /max-w-\[88px\]/, 'must not use the old 88px clamp')
})

test('heading/list items use nowrap so labels are not clipped mid-word', () => {
  const heading = src.match(
    /label=\{t\('notepad\.headingStyles'\)\}[\s\S]*?<\/FormattingDropdown>/,
  )
  const list = src.match(
    /label=\{t\('notepad\.listStyles'\)\}[\s\S]*?<\/FormattingDropdown>/,
  )
  assert.ok(heading && list)
  assert.match(heading[0], /whitespace-nowrap/)
  assert.match(list[0], /whitespace-nowrap/)
  for (const cmd of ['paragraph', 'heading-1', 'heading-2', 'heading-3']) {
    assert.match(heading[0], new RegExp(`onFormat\\('${cmd}'\\)`))
  }
  for (const cmd of ['bullet-list', 'number-list', 'check-list']) {
    assert.match(list[0], new RegExp(`onFormat\\('${cmd}'\\)`))
  }
})

test('compactTableContentClass still fits 5×5 grid', () => {
  const cls = extractClassConst('compactTableContentClass')
  assert.match(cls, /\bw-max\b/)
  assert.match(cls, /text-\[13px\]/)
  const max = cls.match(/max-w-\[(\d+)px\]/)
  assert.ok(max)
  const maxPx = Number(max[1])
  assert.ok(maxPx >= 128, `max-w ${maxPx} must fit grid+padding`)
  assert.ok(maxPx < 144, `max-w ${maxPx} still tighter than prior 144`)
})

test('table grid CSS remains centered', () => {
  assert.match(indexCss, /\.notepad-table-size-grid\s*\{[\s\S]*?margin:\s*0 auto/)
})

test('File/Edit/View still use wide menubar shell, not compact format shells', () => {
  const tops = [...src.matchAll(/sideOffset=\{2\}\s+align="start"\s+className=\{(\w+)\}/g)]
  assert.ok(tops.length >= 3)
  for (const m of tops) {
    assert.ok(m[1] === 'menubarContentClass' || m[1] === 'contentClass')
    assert.notEqual(m[1], 'compactFormatContentClass')
    assert.notEqual(m[1], 'compactTableContentClass')
  }
  assert.match(extractClassConst('contentClass'), /min-w-\[232px\]/)
})

test('toolbar + overflow table paths still use compactTableContentClass', () => {
  const parents = [...src.matchAll(/className=\{(\w+)\}[\s\S]{0,120}TableInsertPicker/g)]
  assert.ok(parents.length >= 2)
  for (const m of parents) {
    assert.equal(m[1], 'compactTableContentClass')
  }
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
