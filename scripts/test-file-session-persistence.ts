import assert from 'node:assert/strict'
import {
  selectFileSession,
  useFileSessionStore,
} from '../src/stores/file-session.store'

useFileSessionStore.getState().hydrate({
  mainDirectory: 'C:\\workspace',
  currentDirectory: 'C:\\workspace\\docs',
  recentDirectories: [
    'C:\\workspace\\docs',
    'c:/workspace/docs',
    'C:\\workspace',
  ],
  openFiles: [
    'C:\\workspace\\one.txt',
    'c:/workspace/one.txt',
    'C:\\workspace\\two.docx',
  ],
  activeFile: 'C:\\workspace\\two.docx',
})

let session = selectFileSession(useFileSessionStore.getState())
assert.deepEqual(session.recentDirectories, [
  'C:\\workspace\\docs',
  'C:\\workspace',
])
assert.deepEqual(session.openFiles, [
  'C:\\workspace\\one.txt',
  'C:\\workspace\\two.docx',
])
assert.equal(session.activeFile, 'C:\\workspace\\two.docx')

useFileSessionStore.getState().visitDirectory('C:\\workspace\\src')
session = selectFileSession(useFileSessionStore.getState())
assert.equal(session.currentDirectory, 'C:\\workspace\\src')
assert.deepEqual(session.recentDirectories.slice(0, 3), [
  'C:\\workspace\\src',
  'C:\\workspace\\docs',
  'C:\\workspace',
])

useFileSessionStore.getState().setDocuments([
  'C:\\workspace\\two.docx',
  'C:\\workspace\\one.txt',
], 'C:\\workspace\\one.txt')
session = selectFileSession(useFileSessionStore.getState())
assert.deepEqual(session.openFiles, [
  'C:\\workspace\\two.docx',
  'C:\\workspace\\one.txt',
])
assert.equal(session.activeFile, 'C:\\workspace\\one.txt')

useFileSessionStore.getState().setDocuments(session.openFiles, 'C:\\missing.txt')
assert.equal(useFileSessionStore.getState().activeFile, null)

console.log('PASS  file session hydration, directory history, tab order, and active file')
