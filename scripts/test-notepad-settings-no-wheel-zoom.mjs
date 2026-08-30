/**
 * Structural: while the notepad settings dialog is open, Ctrl/Cmd + wheel must
 * NOT change the notepad zoom (font size). The handler still calls
 * preventDefault so the gesture cannot fall through to page-level zoom.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const textEditor = fs.readFileSync(
  path.join(root, 'src/lightweight-office/editors/TextEditor.tsx'),
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

test('wheel handler bails out while settings dialog is open', () => {
  assert.match(
    textEditor,
    /event\.preventDefault\(\)\s*\r?\n\s*if \(settingsOpenRef\.current\) return/,
    'handler must preventDefault first, then skip zoom through the live settings ref',
  )
})

test('settings state is mirrored into the stable wheel-listener ref', () => {
  assert.match(
    textEditor,
    /settingsOpenRef\.current = settingsOpen/,
    'the wheel listener must observe the latest settings state without re-subscribing',
  )
})

test('normal wheel zoom is normalized and coalesced before live text reflow', () => {
  assert.match(
    textEditor,
    /normalizeWheelZoomDelta\(event\.deltaY, event\.deltaMode\)/,
  )
  assert.match(textEditor, /requestAnimationFrame\(flushWheelZoom\)/)
  assert.match(textEditor, /applyLiveZoom\(/)
  assert.match(
    textEditor,
    /setProperty\('--notepad-editor-font-size'/,
    'each rendered zoom step must update the real font metrics',
  )
  assert.match(
    textEditor,
    /setTimeout\(commitWheelZoom, NOTEPAD_WHEEL_ZOOM_IDLE_MS\)/,
    'only the React/localStorage state commit should wait for wheel idle',
  )
})

test('text zoom never transforms or CSS-zooms the editor surface', () => {
  assert.doesNotMatch(textEditor, /applyNotepadZoomPreview|applyNotepadZoomStyle/)
  assert.doesNotMatch(textEditor, /surface\.style\.(?:zoom|transform)/)
})

test('cancelled zoom gestures restore the committed indicator and live ref', () => {
  assert.match(
    textEditor,
    /liveZoomPercentRef\.current = appliedZoomPercentRef\.current\s*\r?\n\s*updateZoomIndicator\(appliedZoomPercentRef\.current\)/,
  )
})

test('switching tabs, views, or settings settles a pending zoom gesture', () => {
  assert.match(
    textEditor,
    /commitWheelZoom\(\)\s*\r?\n\s*\}, \[activeTabId, commitWheelZoom, markdownView, settingsOpen\]\)/,
  )
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
