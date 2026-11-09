/**
 * Structural: Excel column/row resize drags must live-preview content reflow
 * without corrupting Fortune's own commit, undo history, or collab ops, and the
 * blue drag guide line (.fortune-change-size-line) must strictly coincide with
 * the rendered table grid line on <canvas> at all times.
 *
 * Mechanism invariants:
 *  - preview flows through applyOp (the history-free op channel), NEVER
 *    setColumnWidth/setRowHeight (each call would push an undo entry);
 *  - each preview frame atomically advances Fortune's drag-start marker
 *    (luckysheet_*_change_size_start) by the applied delta, so Fortune's own
 *    mouseup commit finalizes original + total delta with NO dispatch from us
 *    at mouseup — the native queue conditions that keep fortune-sheet's
 *    impure undo push single (React rebase re-executes updaters that share a
 *    queue with a skipped one);
 *  - the preview lags PREVIEW_LAG px behind the cursor so the commit's
 *    residual delta clears Fortune's 3px no-op threshold;
 *  - preview applies are dispatched per animation frame (op merged with the
 *    browser frame, no flushSync) and mousemove is exclusively captured during a
 *    session (no pending low-priority updates at commit time);
 *  - a canceled drag (window blur) restores the original size map;
 *  - unsupported frozen sheets fall back to native behavior;
 *  - guide line (.fortune-change-size-line) is always locked to the rendered
 *    track edge (domEdge - 3) with content-box sizing and synchronous canvas
 *    draw synchronization, never floating at raw unclamped mouse coordinates.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const util = fs.readFileSync(
  path.join(root, 'src/lightweight-office/utils/excel-live-resize.ts'),
  'utf8',
)
const rendering = fs.readFileSync(
  path.join(root, 'src/lightweight-office/utils/fortune-rendering.ts'),
  'utf8',
)
const themeCss = fs.readFileSync(
  path.join(root, 'src/lightweight-office/fortune-sheet-theme.css'),
  'utf8',
)
const editor = fs.readFileSync(
  path.join(root, 'src/lightweight-office/editors/ExcelEditor.tsx'),
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

test('preview uses the history-free applyOp channel only', () => {
  assert.match(util, /api\.applyOp\(\[/)
  assert.doesNotMatch(util, /setColumnWidth|setRowHeight/, 'these record one undo entry per call')
})

test('each frame advances Fortune drag-start marker with the size patch', () => {
  assert.match(util, /luckysheet_cols_change_size_start/)
  assert.match(util, /luckysheet_rows_change_size_start/)
  assert.match(util, /session\.startNative \+ \(len - session\.originalLen\) \* session\.zoom/)
})

test('normal mouseup dispatches nothing; blur cancel restores the snapshot', () => {
  assert.match(util, /const onUp = \(\) => endSession\(false\)/)
  assert.match(util, /const onBlur = \(\) => endSession\(true\)/)
  assert.match(util, /restoreForCancel && session\.lastApplied !== null/)
  assert.match(util, /value: originalMap,/)
})

test('preview lags the cursor to clear the 3px commit threshold', () => {
  assert.match(util, /PREVIEW_LAG = 5/)
  assert.match(util, /- PREVIEW_LAG,?\s*\n?\s*\)\)/)
})

test('preview frames are dispatched per animation frame; mousemove is exclusively captured', () => {
  assert.match(util, /frame = requestAnimationFrame\(\(\) =>/)
  assert.match(util, /event\.stopPropagation\(\)/)
  assert.match(util, /moveGuideLine\(event\)/)
})

test('track lookup mirrors Fortune sortedIndex + calcRowColSize math and resolves nearest edge index', () => {
  assert.match(util, /function lowerBound/)
  assert.match(util, /Math\.round\(\(\(lens\[i\] \?\? 0\) \+ 1\) \* zoom\)/)
  assert.match(util, /if \(prevEdgeDist < currentEdgeDist\) \{\s*index -= 1\s*\}/)
})

test('frozen sheets fall back to native behavior when unsupported', () => {
  assert.match(util, /sheet\.frozen\) return/)
})

test('guide line is locked to rendered track edge and synced on every canvas draw with content-box sizing', () => {
  assert.match(util, /\$\{domEdge - 3\}px/)
  assert.match(util, /\$\{domEdge - 4\}px/)
  assert.match(util, /path: \[session\.axis === 'col' \? 'visibledatacolumn' : 'visibledatarow'\]/)
  assert.match(rendering, /syncResizeGuideLineWithCanvas\(\s*canvas,\s*this\.sheetCtx/)
  assert.match(themeCss, /\.excel-editor-shell \.fortune-change-size-line[\s\S]*?box-sizing:\s*content-box/)
})

test('ExcelEditor wires the live resize attach with the workbook ref', () => {
  assert.match(editor, /attachExcelLiveResize\(/)
  assert.match(editor, /\(\) => workbookRef\.current as FortuneWorkbookApiLike \| null/)
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
