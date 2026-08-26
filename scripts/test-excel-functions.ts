import assert from 'node:assert/strict'
import { Parser } from '@fortune-sheet/formula-parser'
import '../src/lightweight-office/utils/formula-compatibility'
import {
  EXCEL_FUNCTION_CATALOG,
  EXCEL_FUNCTION_CATALOG_VERSION,
  searchExcelFunctions,
  validateCuratedExcelFormula,
} from '../src/lib/excel-functions/catalog'
import {
  parseExcelA1Range,
  parseExcelCellAddress,
} from '../src/lib/excel-functions/address'
import type { LanguageCode } from '../src/lib/i18n/types'

const EXPECTED_FUNCTIONS = `
SUM SUMIF SUMIFS SUMPRODUCT SUBTOTAL AVERAGE AVERAGEIF AVERAGEIFS MIN MAX MEDIAN COUNT COUNTA COUNTBLANK COUNTIF COUNTIFS LARGE SMALL STDEV VAR
ABS ROUND ROUNDUP ROUNDDOWN INT MOD CEILING FLOOR MROUND PRODUCT POWER SQRT
IF IFERROR IFNA AND OR NOT TRUE FALSE SWITCH
VLOOKUP HLOOKUP INDEX MATCH LOOKUP CHOOSE ROW ROWS COLUMN COLUMNS TRANSPOSE UNIQUE
CONCAT CONCATENATE LEFT RIGHT MID LEN TRIM CLEAN UPPER LOWER PROPER FIND SEARCH SUBSTITUTE REPLACE TEXT VALUE
DATE DATEVALUE TODAY NOW YEAR MONTH DAY DAYS DATEDIF EDATE EOMONTH WEEKDAY WEEKNUM NETWORKDAYS WORKDAY HOUR MINUTE
ISBLANK ISNUMBER ISTEXT ISLOGICAL ISERROR ISNA
PMT PV FV NPV IRR XIRR RATE
`.trim().split(/\s+/)

const LANGUAGES: LanguageCode[] = ['zh-CN', 'en', 'ja', 'es', 'pt', 'de', 'fr', 'ru', 'ar']

function rangeFixture(functionName: string, start: { column: { index: number } }): unknown[][] {
  if (functionName === 'VLOOKUP' || functionName === 'INDEX') return [[1, 10], [2, 20], [3, 30]]
  if (functionName === 'HLOOKUP') return [[1, 2, 3], [10, 20, 30]]
  if (functionName === 'IRR') return [[-100], [60], [60]]
  if (functionName === 'XIRR') {
    return start.column.index === 1
      ? [[new Date(Date.UTC(2025, 0, 1))], [new Date(Date.UTC(2026, 0, 1))]]
      : [[-100], [110]]
  }
  if (functionName === 'LOOKUP') return start.column.index === 1 ? [[10], [20], [30]] : [[1], [2], [3]]
  return [[1], [2], [3]]
}

function calculateExample(functionName: string, formula: string): { error: string | null; result: unknown } {
  const parser = new Parser()
  parser.on('callCellValue', (
    _cell: unknown,
    _options: unknown,
    done: (value: unknown) => void,
  ) => done(functionName === 'ISBLANK' ? undefined : 1))
  parser.on('callRangeValue', (
    start: { column: { index: number } },
    _end: unknown,
    _options: unknown,
    done: (value: unknown[][]) => void,
  ) => done(rangeFixture(functionName, start)))
  return parser.parse(formula.slice(1), { sheetId: 'catalog-test' })
}

function main(): void {
  assert.equal(EXCEL_FUNCTION_CATALOG_VERSION, 'excel-curated-v1')
  assert.equal(EXCEL_FUNCTION_CATALOG.length, 100)
  assert.equal(new Set(EXCEL_FUNCTION_CATALOG.map((item) => item.name)).size, 100)
  assert.deepEqual(EXCEL_FUNCTION_CATALOG.map((item) => item.name), EXPECTED_FUNCTIONS)

  for (const definition of EXCEL_FUNCTION_CATALOG) {
    assert.match(definition.name, /^[A-Z][A-Z0-9.]*$/)
    assert.ok(definition.syntax.startsWith(`${definition.name}(`), `${definition.name} syntax`)
    assert.ok(definition.example.startsWith(`=${definition.name}(`), `${definition.name} example`)
    assert.ok(Array.isArray(definition.parameters), `${definition.name} parameters`)
    for (const language of LANGUAGES) {
      assert.ok(definition.summaries[language]?.trim(), `${definition.name} ${language} summary`)
    }
    const calculated = calculateExample(definition.name, definition.example)
    assert.equal(calculated.error, null, `${definition.name} example returned ${calculated.error}`)
  }

  assert.equal(validateCuratedExcelFormula('=SUM(A1:A3)+IF(B1>0,1,0)').valid, true)
  assert.equal(validateCuratedExcelFormula("='Other Sheet'!$A$1*2").valid, true)
  assert.deepEqual(validateCuratedExcelFormula('=XLOOKUP(A1,B:B,C:C)'), {
    valid: false,
    functions: ['XLOOKUP'],
    unsupported: ['XLOOKUP'],
    error: 'UNSUPPORTED_FUNCTION',
  })
  assert.equal(validateCuratedExcelFormula('SUM(A1:A3)').error, 'FORMULA_MUST_START_WITH_EQUALS')
  assert.equal(searchExcelFunctions({ query: '条件求和', language: 'zh-CN' })[0]?.name, 'SUMIF')
  assert.ok(searchExcelFunctions({ query: 'Financial', language: 'en' }).every((item) => item.category === 'financial'))

  assert.deepEqual(parseExcelCellAddress('$XFD$1048576'), {
    row: 1_048_575,
    column: 16_383,
    rowAbsolute: true,
    columnAbsolute: true,
  })
  assert.equal(parseExcelCellAddress('XFE1'), null)
  assert.equal(parseExcelA1Range('D2:D100')?.cellCount, 99)
  assert.equal(parseExcelA1Range('F4:D2')?.normalized, 'D2:F4')

  console.log('PASS 100 unique Excel functions with nine-language metadata')
  console.log('PASS parser calculation samples, hard allowlist, localized search, and A1 validation')
}

main()
