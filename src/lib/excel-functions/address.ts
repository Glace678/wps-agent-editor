export interface ExcelCellAddress {
  row: number
  column: number
  rowAbsolute: boolean
  columnAbsolute: boolean
}

export interface ExcelA1Range {
  start: ExcelCellAddress
  end: ExcelCellAddress
  normalized: string
  cellCount: number
}

const MAX_EXCEL_ROW = 1_048_576
const MAX_EXCEL_COLUMN = 16_384
const CELL_RE = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)$/

export function excelColumnToIndex(column: string): number {
  let value = 0
  for (const character of column.toUpperCase()) {
    value = value * 26 + character.charCodeAt(0) - 64
  }
  return value - 1
}

export function excelColumnFromIndex(column: number): string {
  if (!Number.isInteger(column) || column < 0 || column >= MAX_EXCEL_COLUMN) {
    throw new Error('INVALID_EXCEL_COLUMN')
  }
  let value = column + 1
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

export function parseExcelCellAddress(value: string): ExcelCellAddress | null {
  const match = CELL_RE.exec(value.trim())
  if (!match) return null
  const column = excelColumnToIndex(match[2])
  const row = Number(match[4]) - 1
  if (column < 0 || column >= MAX_EXCEL_COLUMN || row < 0 || row >= MAX_EXCEL_ROW) return null
  return {
    row,
    column,
    columnAbsolute: match[1] === '$',
    rowAbsolute: match[3] === '$',
  }
}

export function formatExcelCellAddress(
  row: number,
  column: number,
  options: { rowAbsolute?: boolean; columnAbsolute?: boolean } = {},
): string {
  if (!Number.isInteger(row) || row < 0 || row >= MAX_EXCEL_ROW) {
    throw new Error('INVALID_EXCEL_ROW')
  }
  return `${options.columnAbsolute ? '$' : ''}${excelColumnFromIndex(column)}${options.rowAbsolute ? '$' : ''}${row + 1}`
}

export function parseExcelA1Range(value: string): ExcelA1Range | null {
  const parts = value.trim().split(':')
  if (parts.length < 1 || parts.length > 2) return null
  const first = parseExcelCellAddress(parts[0])
  const second = parseExcelCellAddress(parts[1] ?? parts[0])
  if (!first || !second) return null

  const startRow = Math.min(first.row, second.row)
  const endRow = Math.max(first.row, second.row)
  const startColumn = Math.min(first.column, second.column)
  const endColumn = Math.max(first.column, second.column)
  const start: ExcelCellAddress = {
    row: startRow,
    column: startColumn,
    rowAbsolute: first.rowAbsolute,
    columnAbsolute: first.columnAbsolute,
  }
  const end: ExcelCellAddress = {
    row: endRow,
    column: endColumn,
    rowAbsolute: second.rowAbsolute,
    columnAbsolute: second.columnAbsolute,
  }
  const startText = formatExcelCellAddress(startRow, startColumn)
  const endText = formatExcelCellAddress(endRow, endColumn)
  return {
    start,
    end,
    normalized: startText === endText ? startText : `${startText}:${endText}`,
    cellCount: (endRow - startRow + 1) * (endColumn - startColumn + 1),
  }
}

export function formatExcelA1Range(
  startRow: number,
  startColumn: number,
  endRow: number,
  endColumn: number,
): string {
  const start = formatExcelCellAddress(startRow, startColumn)
  const end = formatExcelCellAddress(endRow, endColumn)
  return start === end ? start : `${start}:${end}`
}
