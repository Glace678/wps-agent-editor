import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import type { Cell, Sheet } from '@fortune-sheet/core'
import {
  sheetsToXlsxBuffer,
  xlsxBufferToSheets,
} from '../src/lightweight-office/utils/xlsx-convert'

function findCell(sheet: Sheet, row: number, column: number): Cell | undefined {
  return sheet.celldata?.find((cell) => cell.r === row && cell.c === column)?.v ?? undefined
}

async function main() {
  const sheets: Sheet[] = [{
    name: 'Styled',
    id: 'styled-sheet',
    order: 0,
    status: 1,
    row: 20,
    column: 10,
    celldata: [
      {
        r: 0,
        c: 0,
        v: {
          v: 'RED FONT',
          m: 'RED FONT',
          ff: 'Microsoft YaHei',
          fs: 18,
          fc: '#FF2020',
          bl: 1,
          it: 1,
          ht: 2,
          vt: 2,
        },
      },
      {
        r: 0,
        c: 1,
        v: {
          v: 'GREEN FILL',
          m: 'GREEN FILL',
          ff: 'Segoe UI',
          fs: 14,
          fc: '#FFFFFF',
          bg: '#16A05D',
          ht: 0,
          vt: 0,
        },
      },
      {
        r: 1,
        c: 0,
        v: {
          v: 'RED BLUE',
          m: 'RED BLUE',
          ff: 'Segoe UI',
          fs: 13,
          ct: {
            fa: 'General',
            t: 'inlineStr',
            s: [
              { v: 'RED', ff: 'Segoe UI', fs: 13, fc: '#F00F00', bl: 1 },
              { v: ' BLUE', ff: 'Segoe UI', fs: 13, fc: '#0F00F0', it: 1 },
            ],
          },
        },
      },
      {
        r: 1,
        c: 1,
        v: {
          v: 3,
          m: '3',
          f: 'SUM(1,2)',
          ff: 'Segoe UI',
          fs: 11,
          fc: '#000000',
          bg: '#FFF4F4',
          ct: { fa: '0.00', t: 'n' },
        },
      },
    ],
  }] satisfies Sheet[]

  const buffer = await sheetsToXlsxBuffer(sheets)
  assert.ok(buffer.byteLength > 0, 'xlsx buffer should not be empty')

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as never)
  const worksheet = workbook.getWorksheet('Styled')
  assert.ok(worksheet, 'worksheet should exist after export')

  const a1 = worksheet.getCell('A1')
  assert.equal(a1.value, 'RED FONT')
  assert.equal(a1.font?.name, 'Microsoft YaHei')
  assert.equal(a1.font?.size, 18)
  assert.equal(a1.font?.bold, true)
  assert.equal(a1.font?.italic, true)
  assert.equal(a1.font?.color?.argb, 'FFFF2020')
  assert.equal(a1.alignment?.horizontal, 'right')
  assert.equal(a1.alignment?.vertical, 'bottom')

  const b1 = worksheet.getCell('B1')
  assert.equal(b1.value, 'GREEN FILL')
  assert.equal(b1.font?.color?.argb, 'FFFFFFFF')
  assert.equal((b1.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb, 'FF16A05D')
  assert.equal(b1.alignment?.horizontal, 'center')
  assert.equal(b1.alignment?.vertical, 'middle')

  const a2 = worksheet.getCell('A2')
  assert.ok(a2.value && typeof a2.value === 'object' && 'richText' in a2.value)
  const exportedRuns = (a2.value as ExcelJS.CellRichTextValue).richText
  assert.deepEqual(exportedRuns.map((run) => run.text), ['RED', ' BLUE'])
  assert.equal(exportedRuns[0].font?.color?.argb, 'FFF00F00')
  assert.equal(exportedRuns[0].font?.bold, true)
  assert.equal(exportedRuns[1].font?.color?.argb, 'FF0F00F0')
  assert.equal(exportedRuns[1].font?.italic, true)

  const b2 = worksheet.getCell('B2')
  assert.deepEqual(b2.value, { formula: 'SUM(1,2)', result: 3 })
  assert.equal(b2.numFmt, '0.00')
  assert.equal((b2.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb, 'FFFFF4F4')

  const importedSheets = await xlsxBufferToSheets(buffer)
  assert.equal(importedSheets.length, 1)

  const importedA1 = findCell(importedSheets[0], 0, 0)
  assert.equal(importedA1?.ff, 'Microsoft YaHei')
  assert.equal(importedA1?.fs, 18)
  assert.equal(importedA1?.fc, '#FF2020')
  assert.equal(importedA1?.bl, 1)
  assert.equal(importedA1?.it, 1)
  assert.equal(importedA1?.ht, 2)
  assert.equal(importedA1?.vt, 2)

  const importedB1 = findCell(importedSheets[0], 0, 1)
  assert.equal(importedB1?.fc, '#FFFFFF')
  assert.equal(importedB1?.bg, '#16A05D')
  assert.equal(importedB1?.ht, 0)
  assert.equal(importedB1?.vt, 0)

  const importedA2 = findCell(importedSheets[0], 1, 0)
  assert.equal(importedA2?.v, 'RED BLUE')
  assert.equal(importedA2?.ct?.t, 'inlineStr')
  assert.deepEqual(
    importedA2?.ct?.s?.map((run: { v?: string }) => run.v),
    ['RED', ' BLUE'],
  )
  assert.equal(importedA2?.ct?.s?.[0]?.fc, '#F00F00')
  assert.equal(importedA2?.ct?.s?.[0]?.bl, 1)
  assert.equal(importedA2?.ct?.s?.[1]?.fc, '#0F00F0')
  assert.equal(importedA2?.ct?.s?.[1]?.it, 1)

  const importedB2 = findCell(importedSheets[0], 1, 1)
  assert.equal(importedB2?.f, 'SUM(1,2)')
  assert.equal(importedB2?.ct?.fa, '0.00')
  assert.equal(importedB2?.bg, '#FFF4F4')

  console.log('Excel style round-trip passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
