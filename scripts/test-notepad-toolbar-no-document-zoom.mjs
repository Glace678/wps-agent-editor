/**
 * Structural: shell chrome (document tab bar / notepad toolbar) must NOT sit
 * inside .document-zoom-target, so it stays full size at any document zoom.
 * Only the PDF page content keeps page-level CSS zoom, mounted below the tab bar.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(
  path.join(root, 'src/lightweight-office/LightweightDocumentEditor.tsx'),
  'utf8',
)
const textEditor = fs.readFileSync(
  path.join(root, 'src/lightweight-office/editors/TextEditor.tsx'),
  'utf8',
)
const pdfViewer = fs.readFileSync(
  path.join(root, 'src/lightweight-office/editors/PdfViewer.tsx'),
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

test('shell never CSS-zooms; PDF viewer manages its own zoom', () => {
  // EditorPanel（包含 DocumentTabBar）不得整体挂 document-zoom-target
  assert.doesNotMatch(
    src,
    /zoomable/,
    'EditorPanel must not toggle whole-panel zoom; tab bar would scale with Ctrl+wheel',
  )
  assert.doesNotMatch(
    src,
    /className="[^"]*document-zoom-target/,
    'shell must not apply CSS zoom anywhere (tab bar would scale)',
  )
  // PdfViewer 自管缩放：标记 + 全局缩放状态 + 显式像素宽度（CSS zoom 对
  // 百分比自适应布局无效，禁止回归）
  assert.match(pdfViewer, /data-manages-document-zoom/)
  assert.match(pdfViewer, /useDocumentZoom/)
  assert.doesNotMatch(pdfViewer, /document-zoom-target/)
})

test('text editor manages its own zoom (toolbar not via CSS zoom)', () => {
  assert.match(textEditor, /data-manages-document-zoom/)
  assert.match(textEditor, /NotepadCommandBar/)
  // The content uses direct hardware-accelerated CSS zoom scaling with constant base font size
  assert.match(
    textEditor,
    /fontSize: `\$\{fontSize \* \(96 \/ 72\)\}px`/,
  )
  assert.match(textEditor, /zoom,/)
  assert.match(textEditor, /data-zoom-settled=\{zoom\}/)
})

test('word/excel path comment documents fixed toolbar size', () => {
  assert.match(src, /工具栏/)
  assert.match(src, /document-zoom-target/)
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
