import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(
  new URL('../src/components/layout/resize/ResizableThreeColumnLayout.tsx', import.meta.url),
  'utf8',
)
test('panel edge tracks the pointer 1:1 with collapse/expand only at the sidebar half position', () => {
  assert.match(source, /const halfWidth = minWidth \/ 2/)
  assert.match(source, /const startWidth = startCollapsed \? COLLAPSED_PANEL_WIDTH : startSizes\[side\]/)
  assert.match(source, /const panelLeft = side === 'left' \? startX - startWidth : startX/)
  assert.match(source, /const panelRight = panelLeft \+ startWidth/)
  assert.match(source, /const rawWidth = side === 'left'\s*\?\s*clientX - panelLeft\s*:\s*panelRight - clientX/)
  assert.match(source, /const nextCollapsed = rawWidth <= halfWidth/)
  assert.match(source, /latestWidth = clamp\(rawWidth, COLLAPSED_PANEL_WIDTH, maxWidth\)/)
  assert.doesNotMatch(source, /collapseDragDistance/)
  assert.doesNotMatch(source, /triggerCollapse/)
  assert.doesNotMatch(source, /lastClientX/)
})

test('fast flicks cannot miss the half-position flip at release', () => {
  assert.match(source, /const processMove = \(clientX: number\) => \{/)
  assert.match(source, /processMove\(event\.clientX\)\s*finishResize\(collapsedDuringDrag \? 'collapse' : 'commit'\)/)
})

test('collapsed sidebars open through the same pointer-tracked drag', () => {
  assert.match(source, /startResize\('left', e\.clientX\)/)
  assert.match(source, /startResize\('right', e\.clientX\)/)
  assert.doesNotMatch(source, /startRestoreSidebarResize/)
  assert.doesNotMatch(source, /restoreOnRelease/)
  assert.doesNotMatch(source, /restoreMidpointWidth/)
})

test('release settles on the rail or the minimum usable width without leaving the divider behind', () => {
  assert.match(source, /const nextWidth = clamp\(latestWidth, minWidth, maxWidth\)/)
  assert.match(source, /panel\.style\.setProperty\('--panel-drag-width', `\$\{nextWidth\}px`\)/)
  assert.match(source, /panel\.style\.setProperty\('--panel-drag-width', `\$\{COLLAPSED_PANEL_WIDTH\}px`\)/)
  assert.match(source, /requestAnimationFrame\(\(\) => \{\s*panel\.style\.removeProperty\('--panel-drag-width'\)\s*clearPanelVisualOverrides\(visualElements\)\s*\}\)/)
})

test('drag-only visual overrides cannot keep an expanded sidebar invisible', () => {
  assert.match(source, /function clearPanelVisualOverrides\(/)
  assert.match(source, /element\.style\.removeProperty\('opacity'\)/)
  assert.match(source, /element\.style\.removeProperty\('transform'\)/)
  assert.match(source, /element\.style\.removeProperty\('transition-duration'\)/)
})

test('sidebar content and collapsed rail cross-fade progressively in both directions', () => {
  assert.match(source, /function setPanelRevealProgress\(/)
  assert.match(source, /const contentProgress = smoothstep/)
  assert.match(source, /const railProgress = smoothstep/)
  assert.match(source, /elements\.content\.style\.opacity = contentProgress\.toFixed\(3\)/)
  assert.match(source, /elements\.rail\.style\.opacity = railProgress\.toFixed\(3\)/)
  assert.match(source, /getPanelRevealProgress\(latestWidth, minWidth\)/)
  assert.match(source, /data-panel-content/g)
  assert.match(source, /data-panel-collapsed-rail/g)
  assert.doesNotMatch(source, /pointer-events-none invisible opacity-0/)
})

test('sidebar drag remains captured across embedded editor content', () => {
  assert.match(source, /function mountResizeDragShield\(\)/)
  assert.match(source, /data-panel-resize-shield/)
  assert.match(source, /document\.addEventListener\('mousemove', onMove, true\)/)
  assert.match(source, /document\.addEventListener\('mouseup', onUp, true\)/)
  assert.match(source, /document\.removeEventListener\('mouseup', onUp, true\)/)
  assert.match(source, /removeDragShield\(\)/)
})

test('only the primary mouse button starts or commits a sidebar drag', () => {
  assert.equal(source.match(/if \(e\.button !== 0\) return/g)?.length, 2)
  assert.match(source, /if \(event\.button !== 0\) return/)
})
