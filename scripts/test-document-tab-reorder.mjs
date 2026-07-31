/**
 * Unit + structural: document tab reorder + tab navigation shortcuts.
 * Run: npx tsx scripts/test-document-tab-reorder.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  reorderTabsById,
  tabIndexByOffset,
} from '../src/lightweight-office/document-tabs.ts'
import { getCatalogBindingsForContext } from '../src/lib/office-shortcuts/catalog.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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

test('reorderTabsById moves dragged tab to target index', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  assert.deepEqual(
    reorderTabsById(tabs, 'a', 'c').map((t) => t.id),
    ['b', 'c', 'a', 'd'],
  )
  assert.deepEqual(
    reorderTabsById(tabs, 'd', 'a').map((t) => t.id),
    ['d', 'a', 'b', 'c'],
  )
  assert.deepEqual(
    reorderTabsById(tabs, 'b', 'b').map((t) => t.id),
    ['a', 'b', 'c', 'd'],
  )
})

test('tabIndexByOffset wraps circularly for Ctrl+Tab', () => {
  assert.equal(tabIndexByOffset(3, 0, 1), 1)
  assert.equal(tabIndexByOffset(3, 2, 1), 0)
  assert.equal(tabIndexByOffset(3, 0, -1), 2)
  assert.equal(tabIndexByOffset(1, 0, 1), 0)
  assert.equal(tabIndexByOffset(0, 0, 1), -1)
})

test('nextTab/previousTab available for text, word, excel', () => {
  for (const ctx of ['text', 'word', 'excel']) {
    const ids = getCatalogBindingsForContext(ctx).map((b) => b.actionId)
    assert.ok(ids.includes('nextTab'), `${ctx} nextTab`)
    assert.ok(ids.includes('previousTab'), `${ctx} previousTab`)
  }
})

test('DocumentTabBar is used by shell and notepad', () => {
  const shell = read('src/lightweight-office/LightweightDocumentEditor.tsx')
  const text = read('src/lightweight-office/editors/TextEditor.tsx')
  const bar = read('src/lightweight-office/components/DocumentTabBar.tsx')
  assert.match(shell, /DocumentTabBar/)
  assert.match(shell, /onReorder=\{reorderTabs\}/)
  assert.match(shell, /switchTabByOffset/)
  assert.match(shell, /onShellNextTab/)
  assert.match(text, /DocumentTabBar/)
  assert.match(text, /onShellNextTab/)
  assert.match(bar, /draggable/)
  assert.match(bar, /onDragStart/)
  assert.match(bar, /ArrowLeft|ArrowRight/)
  assert.match(bar, /Ctrl\+Shift\+Arrow|ctrlKey && event\.shiftKey/)
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
