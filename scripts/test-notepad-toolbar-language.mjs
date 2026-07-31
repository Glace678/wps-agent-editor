/**
 * Unit + structural: language switch must not wipe notepad toolbar icons.
 *
 * Run: npx tsx scripts/test-notepad-toolbar-language.mjs
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

test('formattingTierFromWidth: 0 / negative keep previous (return null)', () => {
  assert.equal(formattingTierFromWidth(0), null)
  assert.equal(formattingTierFromWidth(-1), null)
  assert.equal(formattingTierFromWidth(Number.NaN), null)
})

test('formattingTierFromWidth: full-width bar keeps tier 6 (all icons)', () => {
  assert.equal(formattingTierFromWidth(800), 6)
  assert.equal(formattingTierFromWidth(708), 6)
})

test('formattingTierFromWidth: narrow bar reduces tier without going null', () => {
  assert.equal(formattingTierFromWidth(500), 2)
  assert.equal(formattingTierFromWidth(400), 0)
})

test('TooltipProvider is not remounted on every language change', () => {
  // key={language} remounts the bar DOM, detaches ResizeObserver target → tier collapse
  assert.doesNotMatch(src, /TooltipProvider\s+key=\{language\}/)
  assert.match(src, /<TooltipProvider delayDuration=\{450\}>/)
})

test('formatting tier re-measures on language and ignores zero width', () => {
  assert.match(src, /useFormattingTier\(barRef,\s*language\)/)
  assert.match(src, /formattingTierFromWidth/)
  assert.match(src, /if \(next === null\) return/)
})

test('command bar forces LTR chrome and protects toolbar from shrink/clip', () => {
  assert.match(src, /dir="ltr"/)
  assert.match(src, /data-language=\{language\}/)
  // Center + right columns must not use min-w-0 shrink that eats icons
  assert.match(src, /shrink-0 items-center justify-self-center[^"]*"\s+role="toolbar"/)
  assert.match(src, /shrink-0 items-center justify-end justify-self-end/)
  assert.match(src, /notepad-settings-button/)
  // Core format icons still wired
  assert.match(src, /notepad-heading-menu/)
  assert.match(src, /notepad-list-menu/)
  assert.match(src, /notepad-table-menu/)
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
