import assert from 'node:assert/strict'
import { getTabTransformX, reorderTabsById } from '../src/lightweight-office/document-tabs'

const tabs = [
  { id: 'tab-0' },
  { id: 'tab-1' },
  { id: 'tab-2' },
  { id: 'tab-3' },
]

const widths: Record<string, number> = {
  'tab-0': 120,
  'tab-1': 140,
  'tab-2': 110,
  'tab-3': 130,
}

// 1. Drag forward: tab-0 (width 120 + gap 4 = 124) dragged over tab-2
// Expected: tab-0 -> 0 (held by user)
// tab-1 -> -124 (moves left)
// tab-2 -> -124 (moves left)
// tab-3 -> 0 (untouched)
assert.equal(getTabTransformX('tab-0', 0, 'tab-0', 'tab-2', tabs, widths, 4), 0)
assert.equal(getTabTransformX('tab-1', 1, 'tab-0', 'tab-2', tabs, widths, 4), -124)
assert.equal(getTabTransformX('tab-2', 2, 'tab-0', 'tab-2', tabs, widths, 4), -124)
assert.equal(getTabTransformX('tab-3', 3, 'tab-0', 'tab-2', tabs, widths, 4), 0)

// 2. Drag backward: tab-3 (width 130 + gap 4 = 134) dragged over tab-1
// Expected: tab-0 -> 0 (untouched)
// tab-1 -> +134 (moves right)
// tab-2 -> +134 (moves right)
// tab-3 -> 0 (held by user)
assert.equal(getTabTransformX('tab-0', 0, 'tab-3', 'tab-1', tabs, widths, 4), 0)
assert.equal(getTabTransformX('tab-1', 1, 'tab-3', 'tab-1', tabs, widths, 4), 134)
assert.equal(getTabTransformX('tab-2', 2, 'tab-3', 'tab-1', tabs, widths, 4), 134)
assert.equal(getTabTransformX('tab-3', 3, 'tab-3', 'tab-1', tabs, widths, 4), 0)

// 3. Drag over self: all zero
for (let i = 0; i < tabs.length; i++) {
  assert.equal(getTabTransformX(tabs[i].id, i, 'tab-1', 'tab-1', tabs, widths, 4), 0)
}

// 4. No dragging active: all zero
for (let i = 0; i < tabs.length; i++) {
  assert.equal(getTabTransformX(tabs[i].id, i, null, null, tabs, widths, 4), 0)
}

// 5. Reorder result matches visual placement
const reorderedForward = reorderTabsById(tabs, 'tab-0', 'tab-2').map((t) => t.id)
assert.deepEqual(reorderedForward, ['tab-1', 'tab-2', 'tab-0', 'tab-3'])

const reorderedBackward = reorderTabsById(tabs, 'tab-3', 'tab-1').map((t) => t.id)
assert.deepEqual(reorderedBackward, ['tab-0', 'tab-3', 'tab-1', 'tab-2'])

console.log('PASS  document tab displacement animation calculations and reordering')
