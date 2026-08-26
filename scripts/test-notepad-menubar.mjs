/**
 * Unit tests for shipped notepad menubar interaction logic
 * (src/lightweight-office/editors/notepad-menubar.ts) plus structural
 * checks on NotepadCommandBar wiring / immediate sibling switching.
 *
 * Run: npx tsx scripts/test-notepad-menubar.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createMenubarState,
  isMenubarTopOpen,
  menubarClickTop,
  menubarDismiss,
  menubarOpenChange,
  menubarPointerEnterTop,
  menubarResolveCloseAfterHoverSwitch,
  menubarSettleAfterClose,
} from '../src/lightweight-office/editors/notepad-menubar.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const menubarPath = path.join(root, 'src/lightweight-office/editors/notepad-menubar.ts')

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

// --- Unit tests drive the real shipped pure state module ---

test('idle: hover does not open any menu', () => {
  let s = createMenubarState()
  s = menubarPointerEnterTop(s, 'file')
  assert.equal(s.open, null)
  assert.equal(s.active, false)
  s = menubarPointerEnterTop(s, 'edit')
  assert.equal(s.open, null)
  s = menubarPointerEnterTop(s, 'view')
  assert.equal(s.open, null)
  assert.equal(isMenubarTopOpen(s, 'file'), false)
})

test('click File opens File and enters active mode', () => {
  let s = createMenubarState()
  s = menubarClickTop(s, 'file')
  assert.equal(s.open, 'file')
  assert.equal(s.active, true)
  assert.equal(isMenubarTopOpen(s, 'file'), true)
  assert.equal(isMenubarTopOpen(s, 'edit'), false)
})

test('openChange(true) on Edit opens Edit and activates', () => {
  let s = createMenubarState()
  s = menubarOpenChange(s, 'edit', true)
  assert.equal(s.open, 'edit')
  assert.equal(s.active, true)
})

test('active: hover Edit while File open switches to Edit', () => {
  let s = menubarClickTop(createMenubarState(), 'file')
  s = menubarPointerEnterTop(s, 'edit')
  assert.equal(s.open, 'edit')
  assert.equal(s.active, true)
  assert.equal(isMenubarTopOpen(s, 'file'), false)
  assert.equal(isMenubarTopOpen(s, 'edit'), true)
})

test('active: hover View while Edit open switches to View', () => {
  let s = menubarOpenChange(createMenubarState(), 'edit', true)
  s = menubarPointerEnterTop(s, 'view')
  assert.equal(s.open, 'view')
  assert.equal(isMenubarTopOpen(s, 'edit'), false)
})

test('stale close from previous top is ignored after hover switch', () => {
  let s = menubarClickTop(createMenubarState(), 'file')
  s = menubarPointerEnterTop(s, 'edit')
  s = menubarOpenChange(s, 'file', false)
  assert.equal(s.open, 'edit')
  assert.equal(s.active, true)
})

test('hover-switch still wins when modeled as enter-then-deferred-close (Radix race)', () => {
  let s = menubarClickTop(createMenubarState(), 'file')
  s = menubarResolveCloseAfterHoverSwitch(s, 'file', 'edit')
  assert.equal(s.open, 'edit')
  assert.equal(s.active, true)
  s = menubarResolveCloseAfterHoverSwitch(s, 'edit', 'view')
  assert.equal(s.open, 'view')
  assert.equal(isMenubarTopOpen(s, 'edit'), false)
})

test('command bar wires app-level-style immediate hot-track switching (structural)', () => {
  const commandBar = fs.readFileSync(
    path.join(root, 'src/lightweight-office/editors/NotepadCommandBar.tsx'),
    'utf8',
  )
  assert.match(commandBar, /openMenuRef/)
  assert.match(commandBar, /setMenubar/)
  assert.match(commandBar, /window\.setTimeout/)
  assert.match(commandBar, /}, 0\)/)
  assert.match(commandBar, /data-menubar-top/)
  assert.match(commandBar, /onPointerDownOutside/)
  assert.match(commandBar, /handleMenubarPointerEnter\('file'\)/)
  assert.match(commandBar, /handleMenubarPointerEnter\('edit'\)/)
  assert.match(commandBar, /handleMenubarPointerEnter\('view'\)/)
})

test('dismiss fully ends hot-track; hover no longer opens', () => {
  let s = menubarClickTop(createMenubarState(), 'file')
  s = menubarDismiss(s)
  assert.equal(s.open, null)
  assert.equal(s.active, false)
  s = menubarPointerEnterTop(s, 'edit')
  assert.equal(s.open, null)
})

test('Radix close keeps hot-track; settle opens top under pointer or idles', () => {
  let s = menubarOpenChange(createMenubarState(), 'view', true)
  s = menubarOpenChange(s, 'view', false)
  assert.equal(s.open, null)
  assert.equal(s.active, true, 'close keeps active for hot-track')
  s = menubarSettleAfterClose(s, 'edit')
  assert.equal(s.open, 'edit')
  assert.equal(s.active, true)
  s = menubarOpenChange(s, 'edit', false)
  s = menubarSettleAfterClose(s, null)
  assert.equal(s.open, null)
  assert.equal(s.active, false)
  s = menubarPointerEnterTop(s, 'file')
  assert.equal(s.open, null)
})

test('click same open top toggles closed to idle', () => {
  let s = menubarClickTop(createMenubarState(), 'file')
  s = menubarClickTop(s, 'file')
  assert.equal(s.open, null)
  assert.equal(s.active, false)
})

// --- Structural checks on shipped UI wiring ---

const commandBar = fs.readFileSync(
  path.join(root, 'src/lightweight-office/editors/NotepadCommandBar.tsx'),
  'utf8',
)
const menubarSrc = fs.readFileSync(menubarPath, 'utf8')
const indexCss = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8')

test('command bar still has File/Edit/View test ids', () => {
  assert.match(commandBar, /notepad-menu-file/)
  assert.match(commandBar, /notepad-menu-edit/)
  assert.match(commandBar, /notepad-menu-view/)
})

test('command bar wires shipped menubar state helpers', () => {
  assert.match(commandBar, /from ['"].*notepad-menubar['"]/)
  assert.match(commandBar, /createMenubarState/)
  assert.match(commandBar, /isMenubarTopOpen/)
})

test('top-level menus use controlled open from menubar state', () => {
  assert.match(commandBar, /open=\{isMenubarTopOpen\(menuState, 'file'\)\}/)
  assert.match(commandBar, /open=\{isMenubarTopOpen\(menuState, 'edit'\)\}/)
  assert.match(commandBar, /open=\{isMenubarTopOpen\(menuState, 'view'\)\}/)
})

test('top-level menu marker remains available without an open animation', () => {
  assert.match(commandBar, /notepad-menubar-content/)
  assert.match(commandBar, /menubarContentClass/)
  assert.doesNotMatch(indexCss, /notepad-menubar-open/)
  assert.doesNotMatch(indexCss, /\.notepad-menubar-content[^}]*animation:/s)
})

test('all three top-level contents use menubarContentClass; format pickers do not', () => {
  const tops = [...commandBar.matchAll(/className=\{menubarContentClass\}/g)]
  assert.ok(tops.length >= 3, `expected ≥3 menubarContentClass, got ${tops.length}`)
  // Heading/list use compactFormatContentClass, not menubar animation shell
  assert.match(commandBar, /contentClassName=\{compactFormatContentClass\}/)
  assert.doesNotMatch(
    commandBar,
    /notepad-heading-menu[\s\S]{0,200}menubarContentClass/,
  )
})

test('menu item trees still present (no empty File/Edit/View)', () => {
  assert.match(commandBar, /notepad\.newTab/)
  assert.match(commandBar, /menu\.undo/)
  assert.match(commandBar, /notepad\.wordWrap/)
})

test('pure module exports expected API', () => {
  assert.match(menubarSrc, /export function createMenubarState/)
  assert.match(menubarSrc, /export function menubarPointerEnterTop/)
  assert.match(menubarSrc, /export function menubarOpenChange/)
  assert.match(menubarSrc, /export function menubarDismiss/)
  assert.match(menubarSrc, /export function menubarClickTop/)
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
