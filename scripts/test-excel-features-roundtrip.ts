import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import type { Sheet } from '@fortune-sheet/core'
import {
  sheetsToXlsxBuffer,
  xlsxBufferToSheets,
} from '../src/lightweight-office/utils/xlsx-convert'

// 1x1 transparent PNG, enough to exercise image media round-tripping.
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function buildSourceWorkbook(): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Features')

  worksheet.getCell('A1').value = 'BORDER'
  worksheet.getCell('A1').border = {
    top: { style: 'thin', color: { argb: 'FFFF0000' } },
    left: { style: 'medium', color: { argb: 'FF00FF00' } },
    bottom: { style: 'double', color: { argb: 'FF0000FF' } },
    right: { style: 'thick', color: { argb: 'FF000000' } },
  }

  worksheet.getCell('A2').value = 'NOTE'
  worksheet.getCell('A2').note = 'a plain comment'

  const imageId = workbook.addImage({
    extension: 'png',
    base64: PNG_1X1_BASE64,
  })
  worksheet.addImage(imageId, {
    tl: { col: 1.5, row: 2.5 },
    br: { col: 4, row: 6 },
  } as unknown as { tl: ExcelJS.Anchor; br: ExcelJS.Anchor })

  ;(worksheet as unknown as {
    dataValidations: { add(address: string, validation: unknown): void }
  }).dataValidations.add('A3:A5', {
    type: 'list',
    allowBlank: true,
    formulae: ['"x,y,z"'],
  })
  ;(worksheet as unknown as {
    dataValidations: { add(address: string, validation: unknown): void }
  }).dataValidations.add('B3:B5', {
    type: 'whole',
    operator: 'between',
    allowBlank: true,
    formulae: [1, 10],
  })

  worksheet.addConditionalFormatting({
    ref: 'C3:C10',
    rules: [{
      type: 'cellIs',
      operator: 'greaterThan',
      priority: 1,
      formulae: [5],
      style: {
        font: { color: { argb: 'FFAA0000' } },
        fill: {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFC7CE' },
        },
      },
    }],
  })
  worksheet.addConditionalFormatting({
    ref: 'D3:D10',
    rules: [{
      type: 'colorScale',
      priority: 2,
      cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }],
      color: [{ argb: 'FFF8696B' }, { argb: 'FFFFEB84' }, { argb: 'FF63BE7B' }],
    }],
  })
  worksheet.addConditionalFormatting({
    ref: 'E3:E10',
    rules: [{
      type: 'containsText',
      operator: 'containsText',
      priority: 3,
      text: 'hello',
      formulae: ['"hello"'],
      style: { font: { color: { argb: 'FF006100' } } },
    } as unknown as ExcelJS.ConditionalFormattingRule],
  })

  return workbook.xlsx.writeBuffer()
}

async function assertImported(buffer: ArrayBuffer): Promise<Sheet[]> {
  const sheets = await xlsxBufferToSheets(buffer)
  assert.equal(sheets.length, 1)
  const sheet = sheets[0]

  // Borders: one per-cell entry for A1 carrying all four sides.
  const borderInfo = sheet.config?.borderInfo
  assert.ok(borderInfo && borderInfo.length === 1)
  const entry = borderInfo[0] as {
    rangeType: string
    value: {
      row_index: number
      col_index: number
      t: { style: number; color: string }
      l: { style: number; color: string }
      b: { style: number; color: string }
      r: { style: number; color: string }
    }
  }
  assert.equal(entry.rangeType, 'cell')
  assert.deepEqual([entry.value.row_index, entry.value.col_index], [0, 0])
  assert.equal(entry.value.t.style, 1)
  assert.equal(entry.value.t.color, '#FF0000')
  assert.equal(entry.value.l.style, 8)
  assert.equal(entry.value.l.color, '#00FF00')
  assert.equal(entry.value.b.style, 7)
  assert.equal(entry.value.b.color, '#0000FF')
  assert.equal(entry.value.r.style, 13)
  assert.equal(entry.value.r.color, '#000000')

  // Comment: ps descriptor on A2.
  const a2 = sheet.celldata?.find((cell) => cell.r === 1 && cell.c === 0)
  assert.equal(a2?.v?.ps?.value, 'a plain comment')
  assert.equal(a2?.v?.ps?.isShow, false)

  // Image: present with a data URL and positive size.
  assert.equal(sheet.images?.length, 1)
  const image = sheet.images[0]
  assert.match(image.src, /^data:image\/png;base64,/)
  assert.ok(image.width > 0 && image.height > 0)

  // Data validation.
  assert.equal(sheet.dataVerification?.['2_0']?.type, 'dropdown')
  assert.equal(sheet.dataVerification?.['2_0']?.value1, 'x,y,z')
  assert.equal(sheet.dataVerification?.['2_1']?.type, 'number_integer')
  assert.equal(sheet.dataVerification?.['2_1']?.type2, 'between')
  assert.equal(sheet.dataVerification?.['2_1']?.value1, '1')
  assert.equal(sheet.dataVerification?.['2_1']?.value2, '10')

  // Conditional formatting.
  const rules = sheet.luckysheet_conditionformat_save
  assert.ok(rules && rules.length >= 3)
  const generic = rules.find(
    (rule) => (rule as { conditionName?: string }).conditionName === 'greaterThan',
  ) as {
    conditionValue: string[]
    format: {
      textColor: { check: boolean; color: string }
      cellColor: { check: boolean; color: string }
    }
  } | undefined
  assert.ok(generic)
  assert.deepEqual(generic.conditionValue, ['5'])
  assert.equal(generic.format.textColor.check, true)
  assert.equal(generic.format.textColor.color, '#AA0000')
  assert.equal(generic.format.cellColor.color, '#FFC7CE')

  const gradation = rules.find(
    (rule) => (rule as { type?: string }).type === 'colorGradation',
  ) as { format: string[] } | undefined
  assert.ok(gradation)
  assert.equal(gradation.format.length, 3)

  const textRule = rules.find(
    (rule) => (rule as { conditionName?: string }).conditionName === 'textContains',
  )
  assert.ok(textRule)

  return sheets
}

async function assertExported(): Promise<void> {
  const sheets: Sheet[] = [{
    name: 'Back',
    id: 'back-sheet',
    order: 0,
    status: 1,
    row: 30,
    column: 12,
    config: {
      borderInfo: [
        {
          rangeType: 'cell',
          value: {
            row_index: 0,
            col_index: 0,
            l: { style: 1, color: '#FF0000' },
            r: { style: 8, color: '#00FF00' },
            t: { style: 13, color: '#000000' },
            b: { style: 7, color: '#0000FF' },
          },
        },
        {
          rangeType: 'range',
          borderType: 'border-all',
          color: '#808080',
          style: 1,
          range: [{ row: [2, 3], column: [2, 3] }],
        },
      ],
    },
    celldata: [
      { r: 0, c: 0, v: { v: 'BORDER', m: 'BORDER' } },
      {
        r: 1,
        c: 0,
        v: { v: 'NOTE', m: 'NOTE', ps: {
          left: null,
          top: null,
          width: null,
          height: null,
          value: 'fortune comment',
          isShow: false,
        } },
      },
    ],
    images: [{
      id: 'pic_1',
      left: 80,
      top: 30,
      width: 40,
      height: 20,
      src: `data:image/png;base64,${PNG_1X1_BASE64}`,
    }],
    dataVerification: {
      // Key MUST be quoted: the bare token 2_0 is a numeric-separator
      // literal equal to 20.
      '2_0': {
        type: 'dropdown',
        type2: 0,
        value1: 'a,b,c',
        value2: '',
        prohibitInput: true,
        hintShow: false,
      },
    },
    luckysheet_conditionformat_save: [
      {
        conditionName: 'greaterThan',
        conditionValue: ['9'],
        cellrange: [{ row: [1, 4], column: [1, 2] }],
        format: {
          textColor: { check: true, color: '#AA0000' },
          cellColor: { check: true, color: '#FFC7CE' },
        },
      },
      {
        type: 'dataBar',
        cellrange: [{ row: [5, 8], column: [3, 3] }],
        format: ['rgb(99,142,198)'],
      },
    ],
  }]

  const buffer = await sheetsToXlsxBuffer(sheets)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as never)
  const worksheet = workbook.getWorksheet('Back')
  assert.ok(worksheet)

  const a1 = worksheet.getCell('A1')
  assert.equal(a1.border?.top?.style, 'thick')
  assert.equal(a1.border?.left?.style, 'thin')
  assert.equal(a1.border?.bottom?.style, 'double')
  assert.equal(a1.border?.right?.style, 'medium')

  // Range entry materialized per cell with the gray thin line.
  const c3 = worksheet.getCell('C3')
  assert.equal(c3.border?.top?.style, 'thin')
  assert.equal(c3.border?.top?.color?.argb, 'FF808080')
  const d4 = worksheet.getCell('D4')
  assert.equal(d4.border?.right?.style, 'thin')

  // Comment, image and data validation.
  const a2 = worksheet.getCell('A2')
  assert.equal(typeof a2.note === 'string' ? a2.note : '', 'fortune comment')
  assert.equal(worksheet.getImages().length, 1)

  const dvModel = (worksheet as unknown as {
    dataValidations: { model: Record<string, { type: string; formulae: string[] }> }
  }).dataValidations.model
  const dv = dvModel.A3
  assert.equal(dv?.type, 'list')
  assert.deepEqual(dv.formulae, ['"a,b,c"'])

  // Conditional formatting.
  const cfEntries = (worksheet as unknown as {
    conditionalFormattings: Array<{ ref: string; rules: Array<{ type: string }> }>
  }).conditionalFormattings
  const types = cfEntries.flatMap((cf) => cf.rules.map((rule) => rule.type))
  assert.ok(types.includes('cellIs'))
  assert.ok(types.includes('dataBar'))
}

async function main() {
  const sourceBuffer = (await buildSourceWorkbook()) as unknown as ArrayBuffer
  await assertImported(sourceBuffer)
  await assertExported()
  console.log('Excel features round-trip passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
