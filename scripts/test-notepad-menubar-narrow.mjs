/**
 * Structural: at the narrowest center width (Agent sidebar dragged to max,
 * MIN_CENTER_WIDTH = 360) the notepad command bar must not cover the
 * File/Edit/View menubar or the settings button.
 *
 * Two cooperating guarantees:
 *  1. The grid's left column has a max-content minimum, so the menubar never
 *     shrinks below its labels.
 *  2. At tier 0 the center collapses to a single 32px overflow menu that
 *     absorbs the heading/list styles (no separate labeled "Formatting" menu).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formattingTierFromWidth } from '../src/lightweight-office/editors/notepad-commandbar-layout.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(
  path.join(root, 'src/lightweight-office/editors/NotepadCommandBar.tsx'),
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

test('menubar grid column cannot shrink below its labels', () => {
  assert.match(
    src,
    /grid-cols-\[minmax\(max-content,1fr\)_auto_minmax\(0,1fr\)\]/,
    'left column must be minmax(max-content,1fr) so File/Edit/View keep natural width',
  )
})

test('labeled formatting menus only render from tier 1 upward', () => {
  assert.match(src, /formattingTier >= 1 && <FormattingMenu/)
  assert.doesNotMatch(src, /CompactFormattingMenu/)
})

test('tier-0 renders only format-brush button and hides overflow menu', () => {
  assert.match(src, /formattingTier === 0 && \([\s\S]*notepad-format-brush-button/)
  assert.match(src, /formattingTier >= 1 && <OverflowFormattingMenu/)
})

test('exactly one notepad-format-overflow trigger remains (no duplicate testid)', () => {
  const matches = src.match(/data-testid="notepad-format-overflow"/g) || []
  assert.equal(matches.length, 1, `expected 1 overflow trigger, found ${matches.length}`)
})

test('MIN_CENTER_WIDTH lands in tier 0 (single-icon center)', () => {
  assert.equal(formattingTierFromWidth(360), 0)
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
