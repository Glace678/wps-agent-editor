/**
 * Drive the shipped notepad-table helpers. Markdown body and table edits must
 * stay independent while the document remains in formatted editing mode.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const mod = await import(
  pathToFileURL(path.join(root, 'src/lightweight-office/editors/notepad-tables.ts')).href
)
const {
  buildHtmlTable,
  findMarkdownBodyRegions,
  findTableRegions,
  removeAllTablesFromSource,
  removeTableFromSource,
  replaceMarkdownBodyRegion,
  replaceTablesInSource,
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

const table =
  '<table class="notepad-md-table"><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>'

test('delete all tables removes every region and keeps body newlines', () => {
  const source = `first line\nsecond line\n\n${table}\n\nbody after table\nlast line\n`
  const after = removeAllTablesFromSource(source)

  assert.equal(findTableRegions(after).length, 0)
  assert.ok(after.includes('first line\nsecond line'))
  assert.ok(after.includes('body after table\nlast line'))
  assert.ok(!after.includes('<table'))
  assert.ok(!after.includes('</table>'))
})

test('insert then delete a table keeps editable body text', () => {
  const body = 'editable body line one\neditable body line two\n'
  const inserted = body + buildHtmlTable(2, 2) + body
  assert.ok(findTableRegions(inserted).length >= 1)

  const deleted = removeAllTablesFromSource(inserted)
  assert.equal(findTableRegions(deleted).length, 0)
  assert.ok(deleted.includes('editable body line one'))
  assert.ok(deleted.includes('editable body line two'))
  assert.ok((deleted + 'continued input\n').includes('continued input'))
})

test('cell edit still updates when a table remains', () => {
  const source = `above\n\n${table}\n\nbelow line\n`
  const updated = table.replace('<td>C</td>', '<td>NEW</td>')
  const next = replaceTablesInSource(source, [updated])

  assert.match(next, /<td>NEW<\/td>/)
  assert.ok(next.includes('below line'))
  assert.equal(findTableRegions(next).length, 1)
})

test('two tables can be removed without losing body text between and after them', () => {
  const source = `intro\n${table}\nmiddle L1\nmiddle L2\n${table}\ntail L1\ntail L2\n`
  const after = removeAllTablesFromSource(source)

  assert.equal(findTableRegions(after).length, 0)
  assert.ok(after.includes('intro'))
  assert.ok(after.includes('middle L1\nmiddle L2'))
  assert.ok(after.includes('tail L1\ntail L2'))
})

test('remove one selected table preserves the other table and surrounding body', () => {
  const secondTable = table.replaceAll('H', 'H2').replaceAll('C', 'C2')
  const source = `before\n${table}\nmiddle\n${secondTable}\nafter\n`
  const next = removeTableFromSource(source, 1)

  assert.equal(findTableRegions(next).length, 1)
  assert.ok(next.includes('<th>H</th>'))
  assert.ok(!next.includes('<th>H2</th>'))
  assert.ok(next.includes('before'))
  assert.ok(next.includes('middle'))
  assert.ok(next.includes('after'))
})

test('findMarkdownBodyRegions returns spans before, between, and after tables', () => {
  const secondTable = table.replaceAll('H', 'H2').replaceAll('C', 'C2')
  const before = '# Heading\n\nBefore **bold** body.\n\n'
  const between = '\n\nBetween body.\n\n'
  const after = '\n\nAfter body.\n'
  const source = before + table + between + secondTable + after
  const regions = findMarkdownBodyRegions(source)

  assert.equal(regions.length, 3)
  assert.deepEqual(
    regions.map((region) => source.slice(region.start, region.end)),
    [before, between, after],
  )
})

test('replaceMarkdownBodyRegion edits one span and preserves table bytes', () => {
  const source = `# Heading\n\nbefore body\n\n${table}\n\nafter body\n`
  const next = replaceMarkdownBodyRegion(source, 1, 'After body edited twice.')

  assert.equal(
    next,
    `# Heading\n\nbefore body\n\n${table}\n\nAfter body edited twice.\n`,
  )
  const tableRegion = findTableRegions(next)[0]
  assert.equal(next.slice(tableRegion.start, tableRegion.end), table)
})

test('replaceMarkdownBodyRegion normalizes editor text without changing boundaries', () => {
  const source = `before\n\n${table}\n\nafter\n`
  const next = replaceMarkdownBodyRegion(source, 1, '\r\nChanged\u00a0body\r\n')

  assert.equal(next, `before\n\n${table}\n\nChanged body\n`)
  assert.equal(replaceMarkdownBodyRegion(source, 99, 'ignored'), source)
})

test('empty Markdown body spans can be edited on either side of a table', () => {
  assert.deepEqual(findMarkdownBodyRegions(table), [
    { start: 0, end: 0 },
    { start: table.length, end: table.length },
  ])
  assert.equal(replaceMarkdownBodyRegion(table, 0, 'Before'), `Before\n\n${table}`)
  assert.equal(replaceMarkdownBodyRegion(table, 1, 'After'), `${table}\n\nAfter`)
})

test('table and Markdown body replacements compose without losing either edit', () => {
  const editedTable = table.replace('<td>C</td>', '<td>EDITED</td>')
  const source = `before\n\n${table}\n\noutside body\n`
  const withCellEdit = replaceTablesInSource(source, [editedTable])
  const next = replaceMarkdownBodyRegion(withCellEdit, 1, 'Outside edit A-B: outside body')

  assert.ok(next.includes('<td>EDITED</td>'))
  assert.ok(next.includes('\n\nOutside edit A-B: outside body\n'))
  assert.ok(!next.includes('<td>C</td>'))
})

test('strip and delete helpers leave body-only sources free of table markers', () => {
  const body = 'a\nb\nc\n'
  assert.equal(stripTableRegions(body), body)

  const cleaned = removeAllTablesFromSource(`x\n${buildHtmlTable(1, 1)}\ny\n`)
  assert.equal(findTableRegions(cleaned).length, 0)
  assert.ok(cleaned.includes('x'))
  assert.ok(cleaned.includes('y'))
  assert.ok(!cleaned.includes('<table'))
})

console.log(`\n${passed} notepad table-delete-edit tests passed`)
if (process.exitCode) process.exit(1)
