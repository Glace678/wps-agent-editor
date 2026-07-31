/**
 * Structural check: shared office-shortcuts module is consumed by
 * text editor + common document parent (Word/Excel path).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

test('shared module files exist', () => {
  for (const rel of [
    'src/lib/office-shortcuts/catalog.ts',
    'src/lib/office-shortcuts/match.ts',
    'src/lib/office-shortcuts/registry.ts',
    'src/lib/office-shortcuts/index.ts',
    'src/components/shortcuts/ShortcutSettingsPanel.tsx',
  ]) {
    assert.ok(fs.existsSync(path.join(root, rel)), rel)
  }
})

test('TextEditor imports shared office-shortcuts', () => {
  const src = read('src/lightweight-office/editors/TextEditor.tsx')
  assert.match(src, /from '@\/lib\/office-shortcuts'/)
  assert.match(src, /useOfficeShortcuts\('text'/)
  // Must not hardcode Ctrl+S save path as sole owner
  assert.match(src, /officeHandlers/)
})

test('LightweightDocumentEditor wires global dispatcher for Word/Excel/text', () => {
  const src = read('src/lightweight-office/LightweightDocumentEditor.tsx')
  assert.match(src, /useGlobalOfficeShortcutListener/)
  assert.match(src, /useOfficeShortcuts/)
  assert.match(src, /from '@\/lib\/office-shortcuts'/)
  // Word + Excel handlers via binary kind
  assert.match(src, /useBinaryDocShortcuts/)
  assert.match(src, /'word'/)
  assert.match(src, /'excel'/)
})

test('settings panel uses catalog not a hard-coded chord list', () => {
  const src = read('src/components/shortcuts/ShortcutSettingsPanel.tsx')
  assert.match(src, /getOfficeShortcutCatalog/)
  assert.doesNotMatch(src, /Ctrl\+S.*Ctrl\+O.*Ctrl\+N/)
})

test('Electron menu aligns core accelerators with Office defaults', () => {
  const src = read('electron/menu/menu.ts')
  assert.match(src, /CmdOrCtrl\+O/)
  assert.match(src, /CmdOrCtrl\+S/)
  assert.match(src, /CmdOrCtrl\+P/)
  assert.match(src, /CmdOrCtrl\+Z/)
  // F12 no longer sole DevTools (Save As in-app)
  assert.doesNotMatch(src, /accelerator:\s*'F12'/)
})

test('preload allows menu:save and menu:print channels', () => {
  const src = read('electron/preload.ts')
  assert.match(src, /menu:save/)
  assert.match(src, /menu:print/)
})

test('App listens for menu:save/print and invokes office actions', () => {
  const src = read('src/App.tsx')
  assert.match(src, /menu:save/)
  assert.match(src, /menu:print/)
  assert.match(src, /invokeOfficeAction\('save'\)/)
  assert.match(src, /invokeOfficeAction\('print'\)/)
})

test('Word/Excel binary handlers do not register zoom (avoid double step)', () => {
  const src = read('src/lightweight-office/LightweightDocumentEditor.tsx')
  // useBinaryDocShortcuts body must not call zoomIn/zoomOut handlers
  assert.doesNotMatch(src, /zoomIn:\s*\(\)\s*=>\s*zoomIn/)
  assert.doesNotMatch(src, /zoomOut:\s*\(\)\s*=>\s*zoomOut/)
  assert.doesNotMatch(src, /zoomReset:\s*\(\)\s*=>\s*zoomReset/)
})

console.log(`\n${passed} structural tests passed`)
if (process.exitCode) process.exit(1)
