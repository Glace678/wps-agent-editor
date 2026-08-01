/**
 * Unit tests for Excel dirty fingerprint (tab dirty-dot logic).
 * Run: npx tsx scripts/test-excel-dirty-fingerprint.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import excelDirty from '../src/lightweight-office/utils/excel-dirty.ts'

const {
  excelSheetsContentEqual,
  excelSheetsShareContentReferences,
  fingerprintExcelSheets,
} = excelDirty

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const excelSrc = fs.readFileSync(
  path.join(root, 'src/lightweight-office/editors/ExcelEditor.tsx'),
  'utf8',
)

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

const baseSheet = {
  name: 'Sheet1',
  id: 's1',
  order: 0,
  status: 1,
  celldata: [{ r: 0, c: 0, v: { v: 'A', m: 'A' } }],
  luckysheet_select_save: [{ row: [0, 0], column: [0, 0] }],
  scrollLeft: 0,
  scrollTop: 0,
}

test('selection / scroll / active status do not change fingerprint', () => {
  const a = [baseSheet]
  const b = [{
    ...baseSheet,
    status: 0,
    luckysheet_select_save: [{ row: [2, 2], column: [3, 3] }],
    scrollLeft: 120,
    scrollTop: 40,
    jfgird_select_save: [{ row: [1, 1], column: [1, 1] }],
  }]
  assert.equal(fingerprintExcelSheets(a), fingerprintExcelSheets(b))
  assert.equal(excelSheetsContentEqual(a, b), true)
})

test('cell value edits change fingerprint', () => {
  const clean = [baseSheet]
  const edited = [{
    ...baseSheet,
    celldata: [{ r: 0, c: 0, v: { v: 'B', m: 'B' } }],
  }]
  assert.notEqual(fingerprintExcelSheets(clean), fingerprintExcelSheets(edited))
  assert.equal(excelSheetsContentEqual(clean, edited), false)
})

test('celldata and equivalent data matrix fingerprint the same', () => {
  const viaCelldata = [{
    name: 'S',
    id: '1',
    order: 0,
    celldata: [{ r: 1, c: 1, v: { v: 42, m: '42' } }],
  }]
  const data = []
  data[1] = []
  data[1][1] = { v: 42, m: '42' }
  const viaMatrix = [{
    name: 'S',
    id: '1',
    order: 0,
    data,
  }]
  assert.equal(fingerprintExcelSheets(viaCelldata), fingerprintExcelSheets(viaMatrix))
})

test('UI-only sheet updates share content references and take the fast path', () => {
  const data = [[{ v: 'A', m: 'A' }]]
  const config = { columnlen: { 0: 120 } }
  const before = [{ ...baseSheet, data, config }]
  const afterScroll = [{
    ...before[0],
    scrollLeft: 800,
    scrollTop: 120,
    luckysheet_select_save: [{ row: [4, 4], column: [7, 7] }],
  }]
  assert.equal(excelSheetsShareContentReferences(before, afterScroll), true)
})

test('cell and track-size changes leave the reference fast path', () => {
  const data = [[{ v: 'A', m: 'A' }]]
  const config = { columnlen: { 0: 120 } }
  const before = [{ ...baseSheet, data, config }]
  assert.equal(
    excelSheetsShareContentReferences(before, [{ ...before[0], data: [[{ v: 'B', m: 'B' }]] }]),
    false,
  )
  assert.equal(
    excelSheetsShareContentReferences(before, [{ ...before[0], config: { columnlen: { 0: 180 } } }]),
    false,
  )
})

test('ExcelEditor wires content fingerprint for dirty (not bare onDirty)', () => {
  assert.match(excelSrc, /fingerprintExcelSheets/)
  assert.match(excelSrc, /baselineFingerprintRef/)
  assert.match(excelSrc, /nextFingerprint === baselineFingerprintRef\.current/)
  // Still keeps a settle window after mount
  assert.match(excelSrc, /suppressDirtyRef/)
  assert.match(excelSrc, /setTimeout/)
  assert.match(excelSrc, /excelSheetsShareContentReferences/)
  assert.match(excelSrc, /scheduleDirtyCheck/)
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
