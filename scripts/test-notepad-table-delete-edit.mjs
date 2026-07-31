/**
 * Drive shipped notepad-tables helpers: delete all tables → recover syntax
 * edit mode; body text intact; cell replace still works when tables remain.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const mod = await import(
  pathToFileURL(path.join(root, 'src/lightweight-office/editors/notepad-tables.ts')).href
)
const {
  findTableRegions,
  removeAllTablesFromSource,
  replaceTablesInSource,
  shouldRecoverSyntaxEditMode,
  buildHtmlTable,
  stripTableRegions,
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

test('delete all tables removes every region and keeps body newlines', () => {
  const table = [
    '<table class="notepad-md-table">',
    '<thead><tr><th>列 1</th></tr></thead>',
    '<tbody><tr><td>内容</td></tr></tbody>',
    '</table>',
  ].join('\n')
  const source = [
    '第一行正文',
    '第二行正文',
    '',
    table,
    '',
    '删表后应能编辑',
    '最后一行',
  ].join('\n')

  assert.equal(findTableRegions(source).length, 1)
  const after = removeAllTablesFromSource(source)
  assert.equal(findTableRegions(after).length, 0)
  assert.ok(after.includes('第一行正文\n第二行正文'))
  assert.ok(after.includes('删表后应能编辑\n最后一行'))
  assert.ok(!after.includes('<table'))
  assert.ok(!after.includes('</table>'))
})

test('shouldRecoverSyntaxEditMode true when formatted + zero tables', () => {
  assert.equal(shouldRecoverSyntaxEditMode('hello\nworld\n', 'formatted'), true)
  assert.equal(shouldRecoverSyntaxEditMode('', 'formatted'), true)
})

test('shouldRecoverSyntaxEditMode false when syntax or tables remain', () => {
  const withTable =
    'pre\n' +
    '<table class="notepad-md-table"><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>\n' +
    'post\n'
  assert.equal(shouldRecoverSyntaxEditMode(withTable, 'formatted'), false)
  assert.equal(shouldRecoverSyntaxEditMode('hello', 'syntax'), false)
  assert.equal(shouldRecoverSyntaxEditMode(withTable, 'syntax'), false)
})

test('insert table then removeAllTables → recover decision true', () => {
  const body = '可编辑正文第一行\n可编辑正文第二行\n'
  const inserted = body + buildHtmlTable(2, 2) + body
  assert.ok(findTableRegions(inserted).length >= 1)
  assert.equal(shouldRecoverSyntaxEditMode(inserted, 'formatted'), false)

  const deleted = removeAllTablesFromSource(inserted)
  assert.equal(findTableRegions(deleted).length, 0)
  assert.equal(shouldRecoverSyntaxEditMode(deleted, 'formatted'), true)
  // Body still present (may have extra newlines from table fence)
  assert.ok(deleted.includes('可编辑正文第一行'))
  assert.ok(deleted.includes('可编辑正文第二行'))
  // applyText path: non-empty body can be extended
  const typed = deleted + '继续输入\n'
  assert.ok(typed.includes('继续输入'))
  assert.equal(shouldRecoverSyntaxEditMode(typed, 'formatted'), true)
})

test('cell edit still updates when table remains; recover stays false', () => {
  const source = [
    'above\n',
    '<table class="notepad-md-table"><thead><tr><th>H</th></tr></thead><tbody><tr><td>OLD</td></tr></tbody></table>',
    '\nbelow line\n',
  ].join('')
  const updated =
    '<table class="notepad-md-table"><thead><tr><th>H</th></tr></thead><tbody><tr><td>NEW</td></tr></tbody></table>'
  const next = replaceTablesInSource(source, [updated])
  assert.match(next, /NEW/)
  assert.ok(next.includes('below line'))
  assert.equal(findTableRegions(next).length, 1)
  assert.equal(shouldRecoverSyntaxEditMode(next, 'formatted'), false)
})

test('two tables: remove all leaves between-and-after text', () => {
  const t =
    '<table class="notepad-md-table"><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>'
  const source = `intro\n${t}\nmiddle L1\nmiddle L2\n${t}\ntail L1\ntail L2\n`
  const after = removeAllTablesFromSource(source)
  assert.equal(findTableRegions(after).length, 0)
  assert.ok(after.includes('intro'))
  assert.ok(after.includes('middle L1\nmiddle L2'))
  assert.ok(after.includes('tail L1\ntail L2'))
  assert.equal(shouldRecoverSyntaxEditMode(after, 'formatted'), true)
})

test('TextEditor wires shouldRecoverSyntaxEditMode (structural)', () => {
  const src = fs.readFileSync(
    path.join(root, 'src/lightweight-office/editors/TextEditor.tsx'),
    'utf8',
  )
  assert.match(src, /shouldRecoverSyntaxEditMode/)
  assert.match(src, /setMarkdownView\('syntax'\)/)
  // Must not remove insert table / cell editing wholesale
  assert.match(src, /insertTable/)
  assert.match(src, /enableEditableTableCells|contentEditable/)
  assert.match(src, /text-editor-input|textareaRef/)
})

test('stripTableRegions / removeAllTables leave no table markers', () => {
  const body = 'a\nb\nc\n'
  assert.equal(stripTableRegions(body), body)
  const cleaned = removeAllTablesFromSource(`x\n${buildHtmlTable(1, 1)}\ny\n`)
  assert.equal(findTableRegions(cleaned).length, 0)
  assert.ok(cleaned.includes('x'))
  assert.ok(cleaned.includes('y'))
  assert.ok(!cleaned.includes('<table'))
  // Body-only source: recover from formatted
  assert.equal(shouldRecoverSyntaxEditMode(cleaned, 'formatted'), true)
})

console.log(`\n${passed} notepad table-delete-edit tests passed`)
if (process.exitCode) process.exit(1)
