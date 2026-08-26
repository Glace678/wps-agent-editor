/**
 * Drives the shipped notepad-tables pure helpers (same module TextEditor imports).
 * Verifies table cell write-back never eats newlines below/between tables.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const require = createRequire(path.join(root, 'package.json'))

// Load compiled-free TS via dynamic import of the source through tsx, or transpile lightly.
// Prefer tsx register if available; else use a minimal approach: import via node --import tsx.
const modPath = path.join(root, 'src/lightweight-office/editors/notepad-tables.ts')

async function loadModule() {
  try {
    return await import(pathToFileURL(modPath).href)
  } catch {
    // Fallback: spawn note — tests run with `npx tsx scripts/test-notepad-table-newlines.mjs`
    throw new Error('Import failed; run with: npx tsx scripts/test-notepad-table-newlines.mjs')
  }
}

function extractPostTable(source, tableIndex = 0) {
  const { findTableRegions } = arguments.callee._mod
  const regions = findTableRegions(source)
  assert.ok(regions[tableIndex], `missing table region ${tableIndex}`)
  return source.slice(regions[tableIndex].end)
}

async function main() {
  const mod = await loadModule()
  const {
    findTableRegions,
    replaceTableInSource,
    replaceTablesInSource,
    serializeTableElement,
    serializeTableCellText,
    stripTableRegions,
    preserveBodyNewlinesInHtml,
    buildHtmlTable,
    insertHtmlTableAtSelection,
    shouldSkipPreviewTableRebuild,
    normalizeTableHtmlForCompare,
  } = mod

  extractPostTable._mod = mod

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

  // --- Case 1: multi-line text above + HTML table + multi-line text below ---
  test('post-table newlines preserved after cell replace (HTML multi-line table)', () => {
    const above = '标题行\n第二行上面\n\n'
    const table = [
      '<table class="notepad-md-table">',
      '<thead><tr><th>列 1</th><th>列 2</th></tr></thead>',
      '<tbody><tr><td>内容</td><td>内容</td></tr></tbody>',
      '</table>',
    ].join('\n')
    const below = '\n\nbelow line 1\nbelow line 2\nbelow line 3\n'
    const source = above + table + below
    const belowBefore = source.slice(findTableRegions(source)[0].end)

    const updated = '<table class="notepad-md-table"><thead><tr><th>列 1</th><th>改过</th></tr></thead><tbody><tr><td>内容</td><td>新值</td></tr></tbody></table>'
    const next = replaceTablesInSource(source, [updated])

    const region = findTableRegions(next)[0]
    const belowAfter = next.slice(region.end)
    assert.equal(belowAfter, belowBefore, 'post-table text must match byte-for-byte including \\n')
    assert.equal(next.slice(0, region.start), above, 'pre-table text unchanged')
    assert.match(next, /改过/)
    assert.match(next, /新值/)
    assert.ok(belowAfter.includes('\n'), 'newlines still present below table')
    assert.equal(belowAfter.split('\n').filter((l) => l.startsWith('below')).length, 3)
  })

  // --- Case 2: two tables, edit only first ---
  test('two tables: edit first keeps between-and-after newlines', () => {
    const t1 = '<table class="notepad-md-table"><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>'
    const t2 = '<table class="notepad-md-table"><thead><tr><th>B</th></tr></thead><tbody><tr><td>2</td></tr></tbody></table>'
    const source = [
      'intro line',
      '',
      t1,
      '',
      'between L1',
      'between L2',
      '',
      t2,
      '',
      'tail L1',
      'tail L2',
      'tail L3',
    ].join('\n')

    const regionsBefore = findTableRegions(source)
    assert.equal(regionsBefore.length, 2)
    const betweenBefore = source.slice(regionsBefore[0].end, regionsBefore[1].start)
    const afterBefore = source.slice(regionsBefore[1].end)

    const edited1 = '<table class="notepad-md-table"><thead><tr><th>A</th></tr></thead><tbody><tr><td>EDIT</td></tr></tbody></table>'
    // Only pass replacement for tables we "sync" — UI passes all tables; second unchanged serialize would equal t2
    const next = replaceTablesInSource(source, [edited1, t2])

    const regionsAfter = findTableRegions(next)
    assert.equal(regionsAfter.length, 2)
    const betweenAfter = next.slice(regionsAfter[0].end, regionsAfter[1].start)
    const afterAfter = next.slice(regionsAfter[1].end)

    assert.equal(betweenAfter, betweenBefore)
    assert.equal(afterAfter, afterBefore)
    assert.match(next, /EDIT/)
    assert.ok(betweenAfter.includes('between L1\nbetween L2'))
    assert.ok(afterAfter.includes('tail L1\ntail L2\ntail L3'))
  })

  // --- Case 3: multi-line table → compact one-liner must not glue next body line ---
  test('compact table replace keeps boundary newline before body', () => {
    const multi = [
      'head',
      '<table class="notepad-md-table">',
      '<thead><tr><th>H</th></tr></thead>',
      '<tbody><tr><td>C</td></tr></tbody>',
      '</table>',
      'body line should stay on its own line',
      'second body',
    ].join('\n')

    const regions = findTableRegions(multi)
    assert.equal(regions.length, 1)
    // Character after region should be newline (start of "body line...")
    assert.equal(multi[regions[0].end], '\n')

    const compact =
      '<table class="notepad-md-table"><thead><tr><th>H</th></tr></thead><tbody><tr><td>CHANGED</td></tr></tbody></table>'
    const next = replaceTablesInSource(multi, [compact])

    const r2 = findTableRegions(next)[0]
    assert.equal(next[r2.end], '\n', 'newline must remain immediately after table')
    assert.ok(next.includes('</table>\nbody line should stay on its own line'))
    assert.ok(!next.includes('</table>body line'), 'must not glue body onto </table>')
    assert.match(next, /CHANGED/)
    assert.ok(next.includes('second body'))
  })

  // --- Case 4: pipe markdown table below text ---
  test('pipe markdown table edit preserves trailing newlines', () => {
    const source = [
      'alpha',
      'beta',
      '',
      '| 列 1 | 列 2 |',
      '| --- | --- |',
      '| 内容 | 内容 |',
      '',
      'tail1',
      'tail2',
    ].join('\n')

    const regions = findTableRegions(source)
    assert.equal(regions.length, 1)
    const belowBefore = source.slice(regions[0].end)

    const html =
      '<table class="notepad-md-table"><thead><tr><th>列 1</th><th>列 2</th></tr></thead><tbody><tr><td>X</td><td>Y</td></tr></tbody></table>'
    const next = replaceTablesInSource(source, [html])
    const belowAfter = next.slice(findTableRegions(next)[0].end)
    assert.equal(belowAfter, belowBefore)
    assert.equal(belowAfter, '\n\ntail1\ntail2')
  })

  // --- Case 5: stripTableRegions stable when only cell text changes ---
  test('stripTableRegions shell stable across cell-only edit', () => {
    const a = 'pre\n\n<table class="notepad-md-table"><thead><tr><th>H</th></tr></thead><tbody><tr><td>A</td></tr></tbody></table>\n\npost1\npost2\n'
    const b = 'pre\n\n<table class="notepad-md-table"><thead><tr><th>H</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>\n\npost1\npost2\n'
    assert.equal(stripTableRegions(a), stripTableRegions(b))
  })

  // --- Case 6: preserveBodyNewlinesInHtml for loose text after table ---
  test('preserveBodyNewlinesInHtml wraps loose post-table lines', () => {
    const html = '<p>before</p>\n<table class="t"><tr><td>x</td></tr></table>\nline1\nline2\nline3'
    const fixed = preserveBodyNewlinesInHtml(html)
    assert.match(fixed, /<br>/)
    assert.match(fixed, /line1/)
    assert.match(fixed, /line2/)
    assert.ok(!/<\/table>\nline1\nline2/.test(fixed) || fixed.includes('<br>'))
  })

  // --- Case 7: buildHtmlTable shape ---
  test('buildHtmlTable produces an empty grid with the selected dimensions', () => {
    const t = buildHtmlTable(2, 3)
    assert.match(t, /<table class="notepad-md-table">/)
    assert.match(t, /<\/table>/)
    assert.equal((t.match(/<tr>/g) || []).length, 2)
    assert.equal((t.match(/<td><br><\/td>/g) || []).length, 6)
    assert.doesNotMatch(t, /<thead>|<th>|Column|Content/)
  })

  test('table insertion uses the requested middle source offset', () => {
    const source = 'before marker\nafter marker'
    const offset = source.indexOf('after marker')
    const inserted = insertHtmlTableAtSelection(source, offset, offset, 2, 3)
    const region = findTableRegions(inserted.source)[0]

    assert.equal(region.start, inserted.tableStart)
    assert.ok(inserted.source.indexOf('before marker') < region.start)
    assert.ok(inserted.source.indexOf('after marker') > region.end)
    assert.equal((inserted.source.match(/<td><br><\/td>/g) || []).length, 6)
  })

  test('table insertion replaces only the active selection and keeps block boundaries', () => {
    const source = 'alpha REMOVE omega'
    const start = source.indexOf('REMOVE')
    const inserted = insertHtmlTableAtSelection(source, start, start + 'REMOVE'.length, 1, 1)

    assert.equal(inserted.source.startsWith('alpha \n\n<table'), true)
    assert.equal(inserted.source.endsWith('</table>\n\n omega'), true)
    assert.equal(inserted.source.includes('REMOVE'), false)
  })

  // --- Case 8: live cell edit (source matches DOM) → skip rebuild ---
  test('shouldSkipPreviewTableRebuild true when source tables match DOM serializations', () => {
    const table =
      '<table class="notepad-md-table"><thead><tr><th>H</th></tr></thead><tbody><tr><td>EDITED</td></tr></tbody></table>'
    const source = `pre\n\n${table}\n\npost1\npost2\n`
    const shell = stripTableRegions(source)
    assert.equal(
      shouldSkipPreviewTableRebuild(source, [table], shell),
      true,
    )
  })

  // --- Case 9: undo-style mismatch (source cells differ from DOM) → must rebuild ---
  test('shouldSkipPreviewTableRebuild false when source cells differ from DOM (undo)', () => {
    const sourceTable =
      '<table class="notepad-md-table"><thead><tr><th>H</th></tr></thead><tbody><tr><td>OLD</td></tr></tbody></table>'
    const domTable =
      '<table class="notepad-md-table"><thead><tr><th>H</th></tr></thead><tbody><tr><td>NEW</td></tr></tbody></table>'
    const source = `pre\n\n${sourceTable}\n\npost1\npost2\n`
    const shell = stripTableRegions(source)
    // Shell still matches (only interior changed) but cells differ — like undo of a cell edit.
    assert.equal(stripTableRegions(source), stripTableRegions(`pre\n\n${domTable}\n\npost1\npost2\n`))
    assert.equal(
      shouldSkipPreviewTableRebuild(source, [domTable], shell),
      false,
      'must not skip rebuild when DOM is stale vs source',
    )
  })

  // --- Case 10: multi-line vs compact same cells still skip ---
  test('normalizeTableHtmlForCompare equates multi-line and compact same cells', () => {
    const multi = [
      '<table class="notepad-md-table">',
      '<thead><tr><th>H</th></tr></thead>',
      '<tbody><tr><td>C</td></tr></tbody>',
      '</table>',
    ].join('\n')
    const compact =
      '<table class="notepad-md-table"><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>'
    assert.equal(normalizeTableHtmlForCompare(multi), normalizeTableHtmlForCompare(compact))
    const source = `a\n${multi}\nb\n`
    assert.equal(
      shouldSkipPreviewTableRebuild(source, [compact], stripTableRegions(source)),
      true,
    )
  })

  // --- Case 11: null previous shell never skips ---
  test('shouldSkipPreviewTableRebuild false when previousShell is null', () => {
    const table =
      '<table class="notepad-md-table"><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>'
    assert.equal(shouldSkipPreviewTableRebuild(`x\n${table}\ny`, [table], null), false)
  })

  test('replaceTableInSource edits only the active table', () => {
    const first = '<table><tbody><tr><td>FIRST</td></tr></tbody></table>'
    const pipe = '| Pipe A | Pipe B |\n| --- | --- |\n| One | Two |'
    const rich = '<table data-keep="yes"><caption>Keep</caption><tbody><tr><td colspan="2"><a href="/x">RICH</a></td></tr></tbody></table>'
    const source = `${first}\n\n${pipe}\n\n${rich}\n`
    const edited = '<table><tbody><tr><td>EDITED</td></tr></tbody></table>'
    const next = replaceTableInSource(source, 0, edited)

    assert.ok(next.includes(edited))
    assert.ok(next.includes(pipe))
    assert.ok(next.includes(rich))
    assert.equal(findTableRegions(next).length, 3)
  })

  test('cell line breaks serialize as br elements and keep every numeric line', () => {
    assert.equal(serializeTableCellText('111\n1\n1'), '111<br>1<br>1')
    assert.equal(serializeTableCellText('111\n'), '111<br>')
    assert.equal(
      serializeTableCellText('1 < 2\n3 & 4'),
      '1 &lt; 2<br>3 &amp; 4',
    )
  })

  test('table examples inside fenced code stay ordinary Markdown body text', () => {
    const fencedHtml = '```html\n<table><tr><td>example</td></tr></table>\n```'
    const fencedPipe = '~~~md\n| A | B |\n| --- | --- |\n| 1 | 2 |\n~~~'
    const real = '<table><tbody><tr><td>real</td></tr></tbody></table>'
    const source = `${fencedHtml}\n\n${fencedPipe}\n\n${real}`
    const regions = findTableRegions(source)

    assert.equal(regions.length, 1)
    assert.equal(source.slice(regions[0].start, regions[0].end), real)
  })

  console.log(`\n${passed} tests passed`)
  if (process.exitCode) {
    console.error('Some tests failed')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
