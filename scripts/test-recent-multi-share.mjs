import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const recentFilesSource = fs.readFileSync(path.join(root, 'src/components/file-manager/RecentFiles.tsx'), 'utf8')
const dialogSource = fs.readFileSync(path.join(root, 'src/components/file-manager/RecentFileDialogs.tsx'), 'utf8')
const fileOpsSource = fs.readFileSync(path.join(root, 'electron/services/file-ops.service.ts'), 'utf8')
const fileHandlersSource = fs.readFileSync(path.join(root, 'electron/ipc/file.handlers.ts'), 'utf8')

let passed = 0

function test(name, check) {
  try {
    check()
    passed += 1
    console.log(`PASS  ${name}`)
  } catch (error) {
    console.error(`FAIL  ${name}`)
    throw error
  }
}

test('RecentFiles sends the selected set into the share dialog', () => {
  assert.match(recentFilesSource, /type DialogState =[\s\S]*\| \{ kind: 'share'; files: RecentFile\[] \}/)
  assert.match(recentFilesSource, /const candidates = files\.filter\(\(candidate\) => selectedPaths\.has\(candidate\.path\)\)/)
  assert.match(recentFilesSource, /const filesToShare = candidates\.length > 0 \? candidates : \[file\]/)
  assert.match(recentFilesSource, /setDialog\(\{ kind: 'share', files: existingFiles \}\)/)
  assert.match(recentFilesSource, /<ShareDialog files=\{dialog\.files\} onClose=\{\(\) => setDialog\(null\)\} \/>/)
})

test('ShareDialog copies and lists every selected file', () => {
  assert.match(dialogSource, /export function ShareDialog\(\{ files, onClose \}: \{ files: RecentFile\[]; onClose: \(\) => void \}\)/)
  assert.match(dialogSource, /const filePaths = files\.map\(\(file\) => file\.path\)/)
  assert.match(dialogSource, /window\.api\.file\.copyToClipboard\(filePaths\)/)
  assert.match(dialogSource, /navigator\.clipboard\.writeText\(filePaths\.join\('\\n'\)\)/)
  assert.match(dialogSource, /files\.map\(\(file\) => \(/)
})

test('Electron share pipeline accepts multiple files at once', () => {
  assert.match(fileOpsSource, /export async function copyFilesToClipboard\(filePaths: string \| readonly string\[]\)/)
  assert.match(fileOpsSource, /Set-Clipboard -LiteralPath \$paths/)
  assert.match(fileOpsSource, /set the clipboard to fileList/)
  assert.match(fileHandlersSource, /ipcMain\.handle\(IPC\.FILE_COPY_TO_CLIPBOARD, async \(_e, filePaths: string \| string\[]\) =>/)
  assert.match(fileHandlersSource, /return copyFilesToClipboard\(normalizedPaths\)/)
})

console.log(`\n${passed} tests passed`)
