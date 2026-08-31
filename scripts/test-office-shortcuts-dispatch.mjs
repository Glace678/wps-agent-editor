/**
 * Shared dispatch: same registry for Word/Excel/text; unsupported → no-handler.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const modPath = path.join(root, 'src/lib/office-shortcuts/index.ts')

const mod = await import(pathToFileURL(modPath).href)
const {
  dispatchOfficeShortcut,
  resolveOfficeShortcut,
  invokeOfficeAction,
  __setActiveForTests,
  getOfficeShortcutCatalog,
  getDefaultActionChordMap,
  getShortcutSettingsRows,
  captureShortcutChord,
  findShortcutConflicts,
  shortcutChordsConflict,
  shortcutContextsOverlap,
} = mod

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

function keyEvent(partial) {
  return {
    key: 'a',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  }
}

test('resolve does not branch default map by editor kind', () => {
  for (const ctx of ['word', 'excel', 'text']) {
    const r = resolveOfficeShortcut(keyEvent({ key: 's', ctrlKey: true }), ctx)
    assert.equal(r?.actionId, 'save', `context ${ctx}`)
  }
  const map = getDefaultActionChordMap()
  assert.equal(map.save, 'Ctrl+S')
})

test('dispatch with handler: handled=true for Word and Excel same chord', () => {
  const calls = []
  __setActiveForTests('word', {
    save: () => {
      calls.push('word-save')
    },
  })
  let r = dispatchOfficeShortcut(keyEvent({ key: 's', ctrlKey: true }))
  assert.equal(r.matched, true)
  assert.equal(r.handled, true)
  assert.equal(r.actionId, 'save')
  assert.equal(r.reason, 'ok')

  __setActiveForTests('excel', {
    save: () => {
      calls.push('excel-save')
    },
  })
  r = dispatchOfficeShortcut(keyEvent({ key: 's', ctrlKey: true }))
  assert.equal(r.handled, true)
  assert.deepEqual(calls, ['word-save', 'excel-save'])
})

test('dispatch without handler returns clear no-handler (not alternate chord)', () => {
  __setActiveForTests('excel', {
    // no bold handler — and bold not in excel context filter either
  })
  // open is in all contexts
  const r = dispatchOfficeShortcut(keyEvent({ key: 'o', ctrlKey: true }))
  assert.equal(r.matched, true)
  assert.equal(r.actionId, 'open')
  assert.equal(r.handled, false)
  assert.equal(r.reason, 'no-handler')
})

test('dispatch no-match when chord unknown', () => {
  __setActiveForTests('text', { save: () => {} })
  const r = dispatchOfficeShortcut(keyEvent({ key: 'F13' }))
  assert.equal(r.matched, false)
  assert.equal(r.reason, 'no-match')
})

test('text context can handle find/replace via same resolve path', () => {
  const seen = []
  __setActiveForTests('text', {
    find: () => {
      seen.push('find')
    },
    replace: () => {
      seen.push('replace')
    },
  })
  assert.equal(dispatchOfficeShortcut(keyEvent({ key: 'f', ctrlKey: true })).handled, true)
  assert.equal(dispatchOfficeShortcut(keyEvent({ key: 'h', ctrlKey: true })).handled, true)
  assert.deepEqual(seen, ['find', 'replace'])
})

test('settings rows driven by same catalog (action ids + default chords)', () => {
  const rows = getShortcutSettingsRows()
  const catalog = getOfficeShortcutCatalog()
  assert.equal(rows.length, catalog.length)
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const b of catalog) {
    const row = byId.get(b.id)
    assert.ok(row, `missing settings row for ${b.id}`)
    assert.equal(row.actionId, b.actionId)
    assert.equal(row.defaultChord, b.defaultChord)
  }
})

test('shortcut recorder shows a modifier before completing the chord', () => {
  const modifier = captureShortcutChord(keyEvent({ key: 'Control', ctrlKey: true }))
  assert.deepEqual(modifier, {
    chord: 'Ctrl',
    complete: false,
    modifiers: ['Ctrl'],
  })

  // A released modifier stays latched for the next key in the recorder.
  const complete = captureShortcutChord(keyEvent({ key: 'n' }), modifier.modifiers)
  assert.deepEqual(complete, {
    chord: 'Ctrl+N',
    complete: true,
    modifiers: ['Ctrl'],
  })
})

test('custom chord resolves through the same runtime path', () => {
  const overrides = { 'file.new': 'Ctrl+M' }
  const custom = resolveOfficeShortcut(keyEvent({ key: 'm', ctrlKey: true }), 'text', overrides)
  assert.equal(custom?.bindingId, 'file.new')
  assert.equal(custom?.actionId, 'new')
  assert.equal(resolveOfficeShortcut(keyEvent({ key: 'n', ctrlKey: true }), 'text', overrides), null)
})

test('conflict detection uses effective chords and overlapping scopes', () => {
  const conflicts = findShortcutConflicts('file.new', 'Ctrl+S')
  assert.ok(conflicts.some((binding) => binding.id === 'file.save'))

  const movedSave = findShortcutConflicts('file.new', 'Ctrl+S', {
    'file.save': 'Ctrl+Q',
  })
  assert.ok(!movedSave.some((binding) => binding.id === 'file.save'))
  assert.equal(shortcutContextsOverlap(['word'], ['excel']), false)
  assert.equal(shortcutContextsOverlap(['word', 'text'], ['text']), true)
  assert.equal(shortcutContextsOverlap(['all'], ['excel']), true)
})

test('conflict detection recognizes overlapping plus-key events', () => {
  assert.equal(shortcutChordsConflict('Ctrl++', 'Ctrl+='), true)
  assert.equal(shortcutChordsConflict('Ctrl+=', 'Ctrl+Shift++'), false)
  const conflicts = findShortcutConflicts('file.new', 'Ctrl++')
  assert.ok(conflicts.some((binding) => binding.actionId === 'zoomIn'))
})

test('alternate bindings for the same action are not functional conflicts', () => {
  const conflicts = findShortcutConflicts('view.zoomIn.plus', 'Ctrl+=')
  assert.ok(!conflicts.some((binding) => binding.actionId === 'zoomIn'))
})

test('handler returning false yields handled=false (native clipboard path)', () => {
  __setActiveForTests('word', {
    copy: () => false,
  })
  const r = dispatchOfficeShortcut(keyEvent({ key: 'c', ctrlKey: true }))
  assert.equal(r.matched, true)
  assert.equal(r.actionId, 'copy')
  assert.equal(r.handled, false)
})

test('invokeOfficeAction runs same registered handlers as keyboard (menu bridge)', () => {
  const seen = []
  __setActiveForTests('excel', {
    save: () => {
      seen.push('save')
    },
    print: () => {
      seen.push('print')
    },
  })
  assert.equal(invokeOfficeAction('save'), true)
  assert.equal(invokeOfficeAction('print'), true)
  assert.equal(invokeOfficeAction('bold'), false, 'no handler → false')
  assert.deepEqual(seen, ['save', 'print'])
})

test('zoom chord without handler is matched but not handled (DocumentZoom owns zoom)', () => {
  __setActiveForTests('word', {
    save: () => {},
    // intentionally no zoomIn — Word/Excel zoom is DocumentZoom-only
  })
  const r = dispatchOfficeShortcut(keyEvent({ key: '=', ctrlKey: true, code: 'Equal' }))
  assert.equal(r.matched, true)
  assert.equal(r.actionId, 'zoomIn')
  assert.equal(r.handled, false)
  assert.equal(r.reason, 'no-handler')
})

__setActiveForTests(null)

console.log(`\n${passed} dispatch tests passed`)
if (process.exitCode) process.exit(1)
