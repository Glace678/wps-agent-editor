/**
 * Structural check: notepad “Recent updates” module UI + wiring are gone,
 * while settings and recent-files remain on the shipped sources.
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

const commandBar = read('src/lightweight-office/editors/NotepadCommandBar.tsx')
const textEditor = read('src/lightweight-office/editors/TextEditor.tsx')
const en = read('src/lib/i18n/locales/en.ts')
const zh = read('src/lib/i18n/locales/zh-CN.ts')

test('command bar has no recent-updates control or prop', () => {
  assert.doesNotMatch(commandBar, /onRecentUpdates/)
  assert.doesNotMatch(commandBar, /recentUpdates/)
  assert.doesNotMatch(commandBar, /Megaphone/)
  assert.doesNotMatch(commandBar, /notepad\.recentUpdates/)
})

test('command bar still exposes settings', () => {
  assert.match(commandBar, /onSettings/)
  assert.match(commandBar, /notepad-settings-button/)
  assert.match(commandBar, /notepad\.settings/)
})

test('command bar still exposes recent files (not recent updates)', () => {
  assert.match(commandBar, /recentFiles/)
  assert.match(commandBar, /onOpenRecent/)
  assert.match(commandBar, /notepad\.recentFiles|recentFiles\.noRecentFiles/)
})

test('text editor has no recent-updates state, modal, or wiring', () => {
  assert.doesNotMatch(textEditor, /recentUpdatesOpen/)
  assert.doesNotMatch(textEditor, /setRecentUpdatesOpen/)
  assert.doesNotMatch(textEditor, /onRecentUpdates/)
  assert.doesNotMatch(textEditor, /notepad\.recentUpdates/)
  assert.doesNotMatch(textEditor, /notepad\.recentUpdatesDescription/)
  assert.doesNotMatch(textEditor, /notepad\.moduleVersion/)
})

test('text editor still wires settings and recent files path', () => {
  assert.match(textEditor, /settingsOpen/)
  assert.match(
    textEditor,
    /onSettings=\{\(\) => \{[\s\S]*?setSettingsOpen\(true\)[\s\S]*?\}\}/,
  )
  assert.match(textEditor, /recentFiles/)
})

test('locale keys for recent-updates module are removed (en + zh-CN)', () => {
  for (const [name, src] of [
    ['en', en],
    ['zh-CN', zh],
  ]) {
    assert.doesNotMatch(src, /recentUpdates:/, `${name} recentUpdates`)
    assert.doesNotMatch(src, /recentUpdatesDescription:/, `${name} recentUpdatesDescription`)
    assert.doesNotMatch(src, /moduleVersion:/, `${name} moduleVersion`)
    // recent files keys must remain
    assert.match(src, /recentFiles:/, `${name} recentFiles`)
    assert.match(src, /settings:/, `${name} settings`)
  }
})

test('all locale files drop the three dead keys', () => {
  const dir = path.join(root, 'src/lib/i18n/locales')
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8')
    assert.doesNotMatch(src, /recentUpdates:/, file)
    assert.doesNotMatch(src, /recentUpdatesDescription:/, file)
    assert.doesNotMatch(src, /moduleVersion:/, file)
  }
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
