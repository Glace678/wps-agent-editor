import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const settingsPage = read('src/lightweight-office/editors/NotepadSettingsPage.tsx')
const textEditor = read('src/lightweight-office/editors/TextEditor.tsx')
const styles = read('src/index.css')

assert.match(textEditor, /\{settingsOpen && \(\s*<NotepadSettingsPage/)
assert.doesNotMatch(textEditor, /settingsOpen && createPortal/)
assert.match(settingsPage, /className="notepad-settings-overlay"/)
assert.match(settingsPage, /document\.addEventListener\('click', closeOnOutsideClick, true\)/)
assert.match(settingsPage, /event\.button !== 0/)
assert.match(settingsPage, /page\.contains\(target\)/)
assert.match(styles, /\.notepad-settings-overlay\s*\{[^}]*position: absolute;[^}]*inset: 0;/s)
assert.match(styles, /\.notepad-settings-page\s*\{[^}]*width:\s*min\(600px,\s*calc\(100%\s*-\s*32px\)\);[^}]*height:\s*min\(500px,\s*calc\(100%\s*-\s*32px\)\);/s)
assert.doesNotMatch(styles, /\.notepad-settings-page\s*\{[^}]*position: fixed;/s)

console.log('PASS  notepad settings stays centered in the editor and closes on outside left-click')
