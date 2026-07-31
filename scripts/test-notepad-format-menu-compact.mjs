/**
 * Structural check: heading / list / insert-table popups use compact shells
 * tighter than prior baselines (144px neighborhood), font size unchanged,
 * while File/Edit/View menubar keeps the wide shell.
 *
 * Drives the shipped NotepadCommandBar source (not a re-implementation).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const commandBarPath = path.join(root, 'src/lightweight-office/editors/NotepadCommandBar.tsx')

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

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

function extractClassConst(src, name) {
  const match = src.match(new RegExp(`const ${name}\\s*=\\s*\\n?\\s*['\`]([^'\`]+)['\`]`))
  assert.ok(match, `${name} constant must exist`)
  return match[1]
}

function extractMinMaxWidths(cls) {
  const min = cls.match(/min-w-\[(\d+)px\]/)
  const max = cls.match(/max-w-\[(\d+)px\]/)
  const fixed = cls.match(/(?:^|\s)w-\[(\d+)px\]/)
  return {
    minPx: min ? Number(min[1]) : null,
    maxPx: max ? Number(max[1]) : null,
    fixedPx: fixed ? Number(fixed[1]) : null,
    cls,
  }
}

const src = read('src/lightweight-office/editors/NotepadCommandBar.tsx')

// Prior baselines this change must beat
const PRIOR_FORMAT_MIN = 144
const PRIOR_FORMAT_MAX = 180
const PRIOR_TABLE_FIXED = 144

test('shipped command bar source exists', () => {
  assert.ok(fs.existsSync(commandBarPath), commandBarPath)
})

test('shared menubar contentClass keeps wide min-w-[232px]', () => {
  const cls = extractClassConst(src, 'contentClass')
  assert.match(cls, /min-w-\[232px\]/)
  assert.doesNotMatch(cls, /min-w-\[1(0|2)\dpx\]/)
})

test('compactFormatContentClass fits multi-language labels; font size unchanged', () => {
  const cls = extractClassConst(src, 'compactFormatContentClass')
  assert.match(cls, /text-\[13px\]/, 'must keep text-[13px] (no font shrink)')
  assert.match(cls, /\bw-max\b/, 'content-fit width')
  assert.doesNotMatch(cls, /min-w-\[232px\]/)
  const { minPx, maxPx } = extractMinMaxWidths(cls)
  // Room for long locales (RU/DE/PT list labels) while staying under menubar shell
  if (minPx != null) {
    assert.ok(minPx < 232, `min-w ${minPx} must be < menubar 232`)
  }
  assert.ok(maxPx != null, 'max-w required so shell can grow for long labels')
  assert.ok(maxPx >= 220, `max-w ${maxPx} must fit long localized labels (≥220)`)
  assert.ok(maxPx < 360, `max-w ${maxPx} must stay under menubar max 360`)
  assert.ok(maxPx <= 300, `max-w ${maxPx} should stay moderate`)
})

test('compactTableContentClass is tighter than prior fixed 144px; font size unchanged', () => {
  const cls = extractClassConst(src, 'compactTableContentClass')
  assert.match(cls, /text-\[13px\]/, 'must keep text-[13px]')
  const { maxPx, fixedPx } = extractMinMaxWidths(cls)
  assert.doesNotMatch(cls, /(?:^|\s)w-\[144px\]/, 'must not keep prior fixed w-[144px]')
  if (fixedPx != null) {
    assert.ok(fixedPx < PRIOR_TABLE_FIXED, `fixed w ${fixedPx} must be < ${PRIOR_TABLE_FIXED}`)
  }
  if (maxPx != null) {
    assert.ok(maxPx < PRIOR_TABLE_FIXED, `max-w ${maxPx} must be < prior table ${PRIOR_TABLE_FIXED}`)
  }
  assert.ok(
    cls.includes('w-max') || (fixedPx != null && fixedPx < PRIOR_TABLE_FIXED) || (maxPx != null && maxPx < PRIOR_TABLE_FIXED),
    'table shell must be content-fit or fixed/max below prior 144',
  )
})

test('insert-table shell max width fits 5×5 grid + horizontal padding (no overflow)', () => {
  const cls = extractClassConst(src, 'compactTableContentClass')
  const { maxPx, fixedPx } = extractMinMaxWidths(cls)
  // Grid from index.css: 5×20px cells + 4×4px gaps = 116px
  const GRID_PX = 5 * 20 + 4 * 4
  // Tailwind p-1.5 = 6px each side → 12px horizontal padding
  const padMatch = cls.match(/(?:^|\s)p-(\d+(?:\.\d+)?)\b/) || cls.match(/(?:^|\s)px-(\d+(?:\.\d+)?)\b/)
  const padToken = padMatch ? padMatch[1] : null
  const padScale = { 0: 0, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 2.5: 10, 3: 12 }
  const padEach = padToken != null && padScale[padToken] != null ? padScale[padToken] : 6
  const padTotal = padEach * 2
  const needed = GRID_PX + padTotal
  const shellMax = maxPx ?? fixedPx
  assert.ok(shellMax != null, 'table shell must declare max-w or fixed w')
  assert.ok(
    shellMax >= needed,
    `table shell ${shellMax}px must be ≥ grid+pad ${needed}px (grid ${GRID_PX} + pad ${padTotal}); got overflow otherwise`,
  )
  assert.ok(shellMax < PRIOR_TABLE_FIXED, `still tighter than prior ${PRIOR_TABLE_FIXED}px`)
})

test('heading-styles FormattingDropdown wires compact contentClassName', () => {
  const headingBlock = src.match(
    /label=\{t\('notepad\.headingStyles'\)\}[\s\S]*?data-testid="notepad-heading-menu"[\s\S]*?<\/FormattingDropdown>/,
  )
  assert.ok(headingBlock, 'heading-styles FormattingDropdown block must exist')
  assert.match(headingBlock[0], /contentClassName=\{compactFormatContentClass\}/)
})

test('list-styles FormattingDropdown wires compact contentClassName', () => {
  const listBlock = src.match(
    /label=\{t\('notepad\.listStyles'\)\}[\s\S]*?data-testid="notepad-list-menu"[\s\S]*?<\/FormattingDropdown>/,
  )
  assert.ok(listBlock, 'list-styles FormattingDropdown block must exist')
  assert.match(listBlock[0], /contentClassName=\{compactFormatContentClass\}/)
})

test('insert-table toolbar + overflow paths use compactTableContentClass', () => {
  assert.match(src, /data-testid="notepad-table-menu"/)
  // TableInsertMenu content shell
  const tableMenu = src.match(
    /data-testid="notepad-table-menu"[\s\S]*?<\/DropdownMenu\.Root>/,
  )
  assert.ok(tableMenu, 'table menu root block')
  assert.match(tableMenu[0], /className=\{compactTableContentClass\}/)
  // Overflow SubContent that hosts TableInsertPicker
  const overflowTable = src.match(
    /TableInsertPicker onInsertTable=\{onInsertTable\}[\s\S]{0,80}/g,
  )
  assert.ok(overflowTable && overflowTable.length >= 1)
  // Every SubContent/Content wrapping TableInsertPicker near compactTable
  const pickerParents = [...src.matchAll(/className=\{(\w+)\}[\s\S]{0,120}TableInsertPicker/g)]
  assert.ok(pickerParents.length >= 2, 'toolbar + overflow should both wrap TableInsertPicker')
  for (const m of pickerParents) {
    assert.equal(m[1], 'compactTableContentClass', `table picker shell must be compactTableContentClass, got ${m[1]}`)
  }
})

test('File/Edit/View menus still use wide menubar shell (not compact format/table)', () => {
  for (const testId of ['notepad-menu-file', 'notepad-menu-edit', 'notepad-menu-view']) {
    assert.match(src, new RegExp(`testId="${testId}"`))
  }
  // Top-level menubar Content (sideOffset={2}) uses menubarContentClass built on contentClass
  const menubarContents = [...src.matchAll(/sideOffset=\{2\}\s+align="start"\s+className=\{(\w+)\}/g)]
  assert.ok(menubarContents.length >= 3, 'expected ≥3 File/Edit/View Content shells')
  for (const m of menubarContents) {
    assert.ok(
      m[1] === 'contentClass' || m[1] === 'menubarContentClass',
      `menubar Content must use wide shell, got ${m[1]}`,
    )
    assert.notEqual(m[1], 'compactFormatContentClass')
    assert.notEqual(m[1], 'compactTableContentClass')
  }
  assert.match(src, /const menubarContentClass = `\$\{contentClass\}/)
})

test('heading and list menus still expose all expected format commands', () => {
  const headingMatch = src.match(
    /label=\{t\('notepad\.headingStyles'\)\}[\s\S]*?<\/FormattingDropdown>/,
  )
  assert.ok(headingMatch, 'heading-styles block')
  for (const cmd of ['paragraph', 'heading-1', 'heading-2', 'heading-3']) {
    assert.match(headingMatch[0], new RegExp(`onFormat\\('${cmd}'\\)`))
  }
  const listMatch = src.match(
    /label=\{t\('notepad\.listStyles'\)\}[\s\S]*?<\/FormattingDropdown>/,
  )
  assert.ok(listMatch, 'list-styles block')
  for (const cmd of ['bullet-list', 'number-list', 'check-list']) {
    assert.match(listMatch[0], new RegExp(`onFormat\\('${cmd}'\\)`))
  }
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
