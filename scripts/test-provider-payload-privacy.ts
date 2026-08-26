import assert from 'node:assert/strict'
import { sanitizeProviderPayload } from '../electron/services/provider-payload-sanitizer'

const windowsPath = ['C:', 'Users', 'ExampleUser', 'Documents', 'report.docx'].join('\\')
const unixPath = ['', 'home', 'example-user', 'projects', 'report.docx'].join('/')
const spacedHomePath = ['D:', 'Users', 'Example User', 'Private Project', 'draft.docx'].join('\\')
const uncPath = ['\\\\private-server', 'finance-share', 'forecast.xlsx'].join('\\')
const sanitized = sanitizeProviderPayload({
  documentId: windowsPath,
  nested: {
    sourcePath: unixPath,
    error: `Could not open ${windowsPath}`,
    outputPath: spacedHomePath,
    paths: [uncPath, '/opt/internal/customer-a/notes.txt'],
    diagnostic: `Failed at ${spacedHomePath}`,
  },
  content: 'ordinary document content remains available',
})
const serialized = JSON.stringify(sanitized)

assert.doesNotMatch(serialized, /ExampleUser|example-user|Example User|Private Project|private-server|finance-share|customer-a/)
assert.doesNotMatch(serialized, /[CD]:\\\\Users|\/home\/|\/opt\/|file:\/\/|\\\\\\\\private-server/)
assert.match(serialized, /report\.docx/)
assert.match(serialized, /ordinary document content remains available/)
assert.deepEqual(sanitizeProviderPayload(new Uint8Array([1, 2, 3])), '<binary-data>')

console.log('PASS provider payloads do not expose local filesystem identity')
