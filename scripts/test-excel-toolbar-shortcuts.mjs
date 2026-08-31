/**
 * Structural + pure-logic checks for Excel toolbar hover shortcut decoration.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcPath = path.join(root, 'src/lightweight-office/utils/excel-toolbar-shortcuts.ts')
const editorPath = path.join(root, 'src/lightweight-office/editors/ExcelEditor.tsx')
const src = fs.readFileSync(srcPath, 'utf8')
const editor = fs.readFileSync(editorPath, 'utf8')
const require = createRequire(import.meta.url)
const ts = require('typescript')
const compiled = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const toolbarShortcuts = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

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

const { appendExcelToolbarShortcut, syncExcelToolbarTooltipNode } = toolbarShortcuts

class FakeElement {
  constructor(className = '') {
    this.children = []
    this.parentElement = null
    this.textContent = ''
    this.className = className
  }

  set className(value) {
    this._className = value
    this._classes = new Set(value.split(/\s+/).filter(Boolean))
  }

  get className() {
    return this._className
  }

  matches(selector) {
    return selector.split(',').some((part) => {
      const className = part.trim().replace(/^\./, '')
      return this._classes.has(className)
    })
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  querySelectorAll(selector) {
    assert.equal(selector, ':scope > .fortune-tooltip')
    return this.children.filter((child) => child.matches('.fortune-tooltip'))
  }

  appendChild(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  remove() {
    if (!this.parentElement) return
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
    this.parentElement = null
  }
}

globalThis.document = {
  createElement: () => new FakeElement(),
}

test('module maps core Excel toolbar chords', () => {
  assert.match(src, /undo:\s*'Ctrl\+Z'/)
  assert.match(src, /redo:\s*'Ctrl\+Y'/)
  assert.match(src, /underline:\s*'Ctrl\+U'/)
  assert.match(src, /'currency-format':\s*'Ctrl\+Shift\+\$'/)
  assert.match(src, /'percentage-format':\s*'Ctrl\+Shift\+%'/)
  assert.match(src, /filter:\s*'Ctrl\+Shift\+L'/)
  assert.match(src, /comment:\s*'Shift\+F2'/)
  assert.match(src, /link:\s*'Ctrl\+K'/)
  assert.match(src, /search:\s*'Ctrl\+F'/)
  assert.match(src, /'formula-sum':\s*'Alt\+='/)
  assert.match(src, /border:\s*'Ctrl\+Shift\+&'/)
})

test('does not overwrite tips that already include a shortcut', () => {
  assert.equal(appendExcelToolbarShortcut('Bold (Ctrl+B)', 'Ctrl+B'), 'Bold (Ctrl+B)')
  assert.equal(appendExcelToolbarShortcut('粗体 (Ctrl+B)', 'Ctrl+B'), '粗体 (Ctrl+B)')
  assert.equal(appendExcelToolbarShortcut('粗體（Ctrl+B）', 'Ctrl+B'), '粗體（Ctrl+B）')
  assert.equal(appendExcelToolbarShortcut('Strikethrough (Alt+Shift+5)', 'Ctrl+5'), 'Strikethrough (Alt+Shift+5)')
})

test('appends chord when missing', () => {
  assert.equal(appendExcelToolbarShortcut('Underline', 'Ctrl+U'), 'Underline (Ctrl+U)')
  assert.equal(appendExcelToolbarShortcut('下划线', 'Ctrl+U'), '下划线 (Ctrl+U)')
  assert.equal(appendExcelToolbarShortcut('Undo', 'Ctrl+Z'), 'Undo (Ctrl+Z)')
  // Hover box under 撤销 must show: 撤销 (Ctrl+Z)
  assert.equal(appendExcelToolbarShortcut('撤销', 'Ctrl+Z'), '撤销 (Ctrl+Z)')
  assert.equal(appendExcelToolbarShortcut('Filter', 'Ctrl+Shift+L'), 'Filter (Ctrl+Shift+L)')
})

test('undo maps to Ctrl+Z for icon and Chinese tip', () => {
  assert.match(src, /undo:\s*'Ctrl\+Z'/)
  assert.match(src, /撤销/)
  assert.match(src, /syncExcelToolbarTooltipNode/)
  // Visible hover box must be synced to full tip text
  assert.match(src, /fortune-tooltip/)
})

test('normal toolbar button keeps one direct tooltip', () => {
  const button = new FakeElement('fortune-toolbar-button')

  syncExcelToolbarTooltipNode(button, '撤销 (Ctrl+Z)')

  assert.equal(button.querySelectorAll(':scope > .fortune-tooltip').length, 1)
  assert.equal(button.children[0].textContent, '撤销 (Ctrl+Z)')
})

test('combo button and arrow share one tooltip without duplicated label', () => {
  const combo = new FakeElement('fortune-toolbar-combo')
  const button = combo.appendChild(new FakeElement('fortune-toolbar-combo-button'))
  const arrow = combo.appendChild(new FakeElement('fortune-toolbar-combo-arrow'))
  const sharedTooltip = combo.appendChild(new FakeElement('fortune-tooltip'))
  sharedTooltip.textContent = '边框'

  // Reproduce stale nodes created by the old implementation.
  button.appendChild(new FakeElement('fortune-tooltip'))
  arrow.appendChild(new FakeElement('fortune-tooltip'))

  syncExcelToolbarTooltipNode(button, '边框 (Ctrl+Shift+&)')
  syncExcelToolbarTooltipNode(arrow, '边框 (Ctrl+Shift+&)')

  assert.equal(combo.querySelectorAll(':scope > .fortune-tooltip').length, 1)
  assert.equal(button.querySelectorAll(':scope > .fortune-tooltip').length, 0)
  assert.equal(arrow.querySelectorAll(':scope > .fortune-tooltip').length, 0)
  assert.equal(sharedTooltip.textContent, '边框 (Ctrl+Shift+&)')
})

test('ExcelEditor wires decoration + observer', () => {
  assert.match(editor, /decorateExcelToolbarShortcuts/)
  assert.match(editor, /from ['"].*excel-toolbar-shortcuts['"]/)
  assert.match(editor, /toolbarShortcutObserver/)
})

test('decorateExcelToolbarControl is exported and marks decorated nodes', () => {
  assert.match(src, /export function decorateExcelToolbarControl/)
  assert.match(src, /export function decorateExcelToolbarShortcuts/)
  assert.match(src, /dataset\.excelShortcutDecorated/)
  assert.match(src, /excelToolbarTipHasShortcut/)
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
