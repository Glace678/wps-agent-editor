/**
 * Drives the shipped office-shortcuts catalog + match helpers.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const modPath = path.join(root, 'src/lib/office-shortcuts/index.ts')

const mod = await import(pathToFileURL(modPath).href)
const {
  OFFICE_SHORTCUT_CATALOG,
  OFFICE_SHORTCUT_CATALOG_COUNT,
  getOfficeShortcutCatalog,
  getDefaultActionChordMap,
  matchKeyEvent,
  resolveActionFromEvent,
  parseChord,
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

test('catalog exports full Office-common set', () => {
  const catalog = getOfficeShortcutCatalog()
  assert.ok(catalog.length >= 40, `expected ≥40 bindings, got ${catalog.length}`)
  assert.equal(catalog.length, OFFICE_SHORTCUT_CATALOG_COUNT)
  assert.equal(catalog.length, OFFICE_SHORTCUT_CATALOG.length)
  console.log(`  catalog count = ${catalog.length}`)
})

test('required Office default chords map to expected action ids', () => {
  const map = getDefaultActionChordMap()
  const required = {
    save: 'Ctrl+S',
    open: 'Ctrl+O',
    new: 'Ctrl+N',
    print: 'Ctrl+P',
    undo: 'Ctrl+Z',
    redo: 'Ctrl+Y',
    cut: 'Ctrl+X',
    copy: 'Ctrl+C',
    paste: 'Ctrl+V',
    selectAll: 'Ctrl+A',
    bold: 'Ctrl+B',
    italic: 'Ctrl+I',
    underline: 'Ctrl+U',
    hyperlink: 'Ctrl+K',
    find: 'Ctrl+F',
    replace: 'Ctrl+H',
    close: 'Ctrl+W',
  }
  for (const [action, chord] of Object.entries(required)) {
    assert.equal(map[action], chord, `${action} should default to ${chord}, got ${map[action]}`)
  }
  // F12 → saveAs registered as alternate binding
  const f12 = OFFICE_SHORTCUT_CATALOG.find((b) => b.defaultChord === 'F12')
  assert.ok(f12)
  assert.equal(f12.actionId, 'saveAs')
})

test('matchKeyEvent is case-insensitive on letters and treats Meta as Ctrl', () => {
  assert.equal(
    matchKeyEvent(keyEvent({ key: 'S', ctrlKey: true }), 'Ctrl+S'),
    true,
  )
  assert.equal(
    matchKeyEvent(keyEvent({ key: 's', metaKey: true }), 'Ctrl+S'),
    true,
  )
  assert.equal(
    matchKeyEvent(keyEvent({ key: 's', ctrlKey: true, shiftKey: true }), 'Ctrl+S'),
    false,
  )
  assert.equal(
    matchKeyEvent(keyEvent({ key: 's', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+S'),
    true,
  )
})

test('resolveActionFromEvent maps chords via shared catalog (context filter only)', () => {
  const save = resolveActionFromEvent(keyEvent({ key: 's', ctrlKey: true }), {
    context: 'word',
  })
  assert.equal(save?.actionId, 'save')

  const saveExcel = resolveActionFromEvent(keyEvent({ key: 's', ctrlKey: true }), {
    context: 'excel',
  })
  assert.equal(saveExcel?.actionId, 'save')

  const saveText = resolveActionFromEvent(keyEvent({ key: 's', ctrlKey: true }), {
    context: 'text',
  })
  assert.equal(saveText?.actionId, 'save')

  // bold is word/text only
  const boldExcel = resolveActionFromEvent(keyEvent({ key: 'b', ctrlKey: true }), {
    context: 'excel',
  })
  assert.equal(boldExcel, null)

  const boldWord = resolveActionFromEvent(keyEvent({ key: 'b', ctrlKey: true }), {
    context: 'word',
  })
  assert.equal(boldWord?.actionId, 'bold')
})

test('parseChord understands Office chord strings', () => {
  assert.deepEqual(parseChord('Ctrl+Shift+S'), {
    ctrl: true,
    alt: false,
    shift: true,
    key: 's',
  })
  assert.deepEqual(parseChord('Alt+F4'), {
    ctrl: false,
    alt: true,
    shift: false,
    key: 'f4',
  })
  assert.equal(parseChord('Ctrl+Space').key, ' ')
})

test('parseChord handles Ctrl++ (trailing Plus) and Ctrl+=', () => {
  // Naive split('+') would yield key:'' — must peel modifiers
  assert.deepEqual(parseChord('Ctrl++'), {
    ctrl: true,
    alt: false,
    shift: false,
    key: '+',
  })
  assert.deepEqual(parseChord('Ctrl+='), {
    ctrl: true,
    alt: false,
    shift: false,
    key: '=',
  })
  assert.equal(
    matchKeyEvent(keyEvent({ key: '+', ctrlKey: true, code: 'NumpadAdd' }), 'Ctrl++'),
    true,
  )
  assert.equal(
    matchKeyEvent(
      keyEvent({ key: '+', ctrlKey: true, shiftKey: true, code: 'Equal' }),
      'Ctrl++',
    ),
    true,
  )
  assert.equal(
    matchKeyEvent(keyEvent({ key: '=', ctrlKey: true, code: 'Equal' }), 'Ctrl+='),
    true,
  )
  // Catalog zoomIn.plus must resolve
  const zoomPlus = resolveActionFromEvent(
    keyEvent({ key: '+', ctrlKey: true, shiftKey: true, code: 'Equal' }),
    { context: 'word' },
  )
  assert.equal(zoomPlus?.actionId, 'zoomIn')
})

test('every catalog binding has unique id and valid defaultChord', () => {
  const ids = new Set()
  for (const b of OFFICE_SHORTCUT_CATALOG) {
    assert.ok(b.id, 'id required')
    assert.ok(!ids.has(b.id), `duplicate id ${b.id}`)
    ids.add(b.id)
    assert.ok(b.defaultChord.length > 0)
    assert.ok(b.actionId)
    assert.ok(b.label)
    assert.ok(b.contexts.length > 0)
  }
})

console.log(`\n${passed} catalog tests passed (catalog size ${OFFICE_SHORTCUT_CATALOG_COUNT})`)
if (process.exitCode) process.exit(1)
