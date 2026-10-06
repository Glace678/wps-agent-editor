import ExcelJS from 'exceljs'
import type {
  Alignment as ExcelAlignment,
  Cell as ExcelCell,
  CellIsOperators,
  Color as ExcelColor,
  DataValidation,
  Font as ExcelFont,
  RichText as ExcelRichText,
  WorksheetViewFrozen,
} from 'exceljs'
import { locale } from '@fortune-sheet/core'
import type { Cell, CellMatrix, Context, Sheet } from '@fortune-sheet/core'
import { DEFAULT_OFFICE_FONT_FAMILY } from './system-fonts'

type ExtendedExcelColor = Partial<ExcelColor> & {
  auto?: boolean
  indexed?: number
  tint?: number
}

const DEFAULT_THEME_COLORS = [
  'FFFFFF', '000000', 'EEECE1', '1F497D', '4F81BD', 'C0504D',
  '9BBB59', '8064A2', '4BACC6', 'F79646', '0000FF', '800080',
]

const INDEXED_COLORS = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
]

// Excel hard limits (rows/cols are 0-based here, inclusive max).
const EXCEL_MAX_ROW = 1_048_575
const EXCEL_MAX_COLUMN = 16_383

/** Drop illegal worksheet-name characters and guarantee uniqueness. */
function uniqueSheetName(name: string, index: number, used: Set<string>): string {
  const cleaned = (name || `Sheet${index + 1}`)
    .replace(/[\\/?*\[\]:]/g, ' ')
    .trim()
    .slice(0, 31) || `Sheet${index + 1}`
  let candidate = cleaned
  let suffix = 1
  while (used.has(candidate.toLowerCase())) {
    suffix += 1
    const suffixText = ` ${suffix}`
    candidate = cleaned.slice(0, Math.max(1, 31 - suffixText.length)) + suffixText
  }
  used.add(candidate.toLowerCase())
  return candidate
}

/** Reject non-integer / out-of-bounds / negative cell coordinates. */
function validCellCoord(r: unknown, c: unknown): boolean {
  return Number.isInteger(r) && Number.isInteger(c)
    && (r as number) >= 0 && (c as number) >= 0
    && (r as number) <= EXCEL_MAX_ROW && (c as number) <= EXCEL_MAX_COLUMN
}

/* Fortune Sheet falls back to 10pt Times New Roman when a workbook cell has
   no explicit font metadata. Segoe UI at 11pt has much stronger Windows
   hinting for small digits while explicit workbook fonts remain untouched. */
export const DEFAULT_SPREADSHEET_FONT = DEFAULT_OFFICE_FONT_FAMILY
export const DEFAULT_SPREADSHEET_FONT_SIZE = 11

function normalizeRgb(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()

  const shortHex = /^#?([0-9a-f]{3})$/i.exec(trimmed)
  if (shortHex) {
    return shortHex[1]
      .split('')
      .map((channel) => channel + channel)
      .join('')
      .toUpperCase()
  }

  const hex = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(trimmed)
  if (hex) return hex[1].slice(-6).toUpperCase()

  const rgb = /^rgba?\(\s*(\d{1,3})(?:\.\d+)?\s*,\s*(\d{1,3})(?:\.\d+)?\s*,\s*(\d{1,3})(?:\.\d+)?(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/i.exec(trimmed)
  if (!rgb) return undefined

  return rgb
    .slice(1, 4)
    .map((channel) => {
      const value = Math.max(0, Math.min(255, Number(channel)))
      return Math.round(value).toString(16).padStart(2, '0')
    })
    .join('')
    .toUpperCase()
}

function fortuneColorToArgb(value: string | undefined): string | undefined {
  const rgb = normalizeRgb(value)
  return rgb ? `FF${rgb}` : undefined
}

function applyTint(rgb: string, tint = 0): string {
  if (!Number.isFinite(tint) || tint === 0) return rgb
  const amount = Math.max(-1, Math.min(1, tint))
  const channels = [0, 2, 4].map((offset) => Number.parseInt(rgb.slice(offset, offset + 2), 16))
  return channels.map((channel) => {
    const adjusted = amount < 0
      ? channel * (1 + amount)
      : channel + (255 - channel) * amount
    return Math.round(adjusted).toString(16).padStart(2, '0')
  }).join('').toUpperCase()
}

function getThemeXml(themes: unknown): string | undefined {
  if (Array.isArray(themes)) return themes.find((value): value is string => typeof value === 'string')
  if (!themes || typeof themes !== 'object') return undefined
  return Object.values(themes).find((value): value is string => typeof value === 'string')
}

function parseThemeColors(themes: unknown): string[] {
  const xml = getThemeXml(themes)
  if (!xml || typeof DOMParser === 'undefined') return DEFAULT_THEME_COLORS

  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.querySelector('parsererror')) return DEFAULT_THEME_COLORS
  const themeKeys = [
    'lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2',
    'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink',
  ]

  return themeKeys.map((key, index) => {
    const container = document.getElementsByTagNameNS('*', key)[0]
    const color = container?.children[0]
    return normalizeRgb(color?.getAttribute('val') ?? color?.getAttribute('lastClr') ?? undefined)
      ?? DEFAULT_THEME_COLORS[index]
  })
}

function resolveExcelColor(
  color: ExtendedExcelColor | undefined,
  themeColors: string[],
): string | undefined {
  if (!color || color.auto) return undefined
  const direct = normalizeRgb(color.argb)
  const themed = color.theme !== undefined ? themeColors[color.theme] : undefined
  const indexed = color.indexed !== undefined ? INDEXED_COLORS[color.indexed] : undefined
  const rgb = direct ?? themed ?? indexed
  return rgb ? `#${applyTint(rgb, color.tint)}` : undefined
}

function toFortuneStyle(cell: ExcelCell, themeColors: string[]): Partial<Cell> {
  const style: Partial<Cell> = {}
  const font = cell.font
  const fill = cell.fill
  const alignment = cell.alignment

  style.ff = font?.name || DEFAULT_SPREADSHEET_FONT
  style.fs = font?.size || DEFAULT_SPREADSHEET_FONT_SIZE
  if (font?.bold) style.bl = 1
  if (font?.italic) style.it = 1
  if (font?.underline) style.un = 1
  if (font?.strike) style.cl = 1
  const fontColor = resolveExcelColor(font?.color as ExtendedExcelColor | undefined, themeColors)
  // Keep Excel's automatic font color implicit. The renderer can then use a
  // readable theme default without confusing it with a color the user chose.
  if (fontColor) style.fc = fontColor

  if (fill?.type === 'pattern' && fill.pattern && fill.pattern !== 'none') {
    const fillColor = resolveExcelColor(
      (fill.fgColor ?? fill.bgColor) as ExtendedExcelColor | undefined,
      themeColors,
    )
    if (fillColor) style.bg = fillColor
  }

  if (alignment?.horizontal === 'center') style.ht = 0
  else if (alignment?.horizontal === 'right') style.ht = 2
  else if (alignment?.horizontal === 'left') style.ht = 1

  if (alignment?.vertical === 'middle') style.vt = 0
  else if (alignment?.vertical === 'top') style.vt = 1
  else if (alignment?.vertical === 'bottom') style.vt = 2

  if (typeof alignment?.textRotation === 'number') style.rt = alignment.textRotation

  return style
}

type FortuneInlineStringRun = Partial<Cell> & {
  v?: string | number | boolean
}

function toFortuneInlineStringRuns(
  cell: ExcelCell,
  themeColors: string[],
): FortuneInlineStringRun[] | undefined {
  const value = cell.value
  if (!value || typeof value !== 'object' || !('richText' in value)
    || !Array.isArray(value.richText) || value.richText.length === 0) return undefined

  const cellStyle = toFortuneStyle(cell, themeColors)
  return value.richText.map((run) => {
    const font = run.font
    const fontColor = resolveExcelColor(
      font?.color as ExtendedExcelColor | undefined,
      themeColors,
    ) ?? cellStyle.fc
    return {
      v: run.text,
      ff: font?.name || cellStyle.ff || DEFAULT_SPREADSHEET_FONT,
      fs: font?.size || cellStyle.fs || DEFAULT_SPREADSHEET_FONT_SIZE,
      bl: font?.bold === undefined ? (cellStyle.bl ?? 0) : font.bold ? 1 : 0,
      it: font?.italic === undefined ? (cellStyle.it ?? 0) : font.italic ? 1 : 0,
      un: font?.underline === undefined
        ? (cellStyle.un ?? 0)
        : font.underline && font.underline !== 'none' ? 1 : 0,
      cl: font?.strike === undefined ? (cellStyle.cl ?? 0) : font.strike ? 1 : 0,
      ...(fontColor ? { fc: fontColor } : {}),
    }
  })
}

async function loadStyledWorkbook(buffer: ArrayBuffer): Promise<ExcelJS.Workbook | null> {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4))
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null
  try {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as never)
    return workbook
  } catch (error) {
    console.warn('[ExcelEditor] 鏃犳硶璇诲彇宸ヤ綔绨块鑹叉牱寮忥紝浣跨敤鍩虹鏍煎紡:', error)
    return null
  }
}

function ensureSheetId(order: number, existing?: string): string {
  return existing && existing.length > 0 ? existing : `sheet_${order}_${Math.random().toString(36).slice(2, 9)}`
}

/** 灏嗕簩缁?data 鐭╅樀杞洖 Fortune Sheet celldata */
function matrixToCelldata(data: CellMatrix | undefined): Sheet['celldata'] {
  if (!data?.length) return []
  const celldata: NonNullable<Sheet['celldata']> = []
  for (let r = 0; r < data.length; r++) {
    const row = data[r]
    if (!row) continue
    for (let c = 0; c < row.length; c++) {
      const cell = row[c]
      if (cell != null && (cell.v !== undefined || cell.m !== undefined || cell.f)) {
        celldata.push({ r, c, v: cell })
      }
    }
  }
  return celldata
}

function resolveFortuneFontFamily(value: Cell['ff']): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return undefined
  const localeData = locale({ lang: 'en' } as unknown as Context) as unknown as {
    fontarray?: unknown[]
  }
  const family = localeData.fontarray?.[value]
  return typeof family === 'string' && family.trim() ? family.trim() : undefined
}

function resolveExcelHorizontalAlignment(value: Cell['ht']): ExcelAlignment['horizontal'] | undefined {
  if (value === 0) return 'center'
  if (value === 1) return 'left'
  if (value === 2) return 'right'
  return undefined
}

function resolveExcelVerticalAlignment(value: Cell['vt']): ExcelAlignment['vertical'] | undefined {
  if (value === 0) return 'middle'
  if (value === 1) return 'top'
  if (value === 2) return 'bottom'
  return undefined
}

function fortuneStyleToExcelFont(
  style: Partial<Cell>,
  fallback?: Partial<Cell>,
): Partial<ExcelFont> {
  const fontName = resolveFortuneFontFamily(style.ff ?? fallback?.ff)
    || DEFAULT_SPREADSHEET_FONT
  const fontColor = fortuneColorToArgb(style.fc ?? fallback?.fc)
  const requestedSize = style.fs ?? fallback?.fs
  const fontSize = typeof requestedSize === 'number' && Number.isFinite(requestedSize)
    ? requestedSize
    : DEFAULT_SPREADSHEET_FONT_SIZE

  return {
    name: fontName,
    size: fontSize,
    color: fontColor ? { argb: fontColor } : undefined,
    bold: (style.bl ?? fallback?.bl) === 1,
    italic: (style.it ?? fallback?.it) === 1,
    underline: (style.un ?? fallback?.un) === 1 || undefined,
    strike: (style.cl ?? fallback?.cl) === 1,
  }
}

function applyFortuneCellStyle(excelCell: ExcelCell, cell: Cell | null | undefined): void {
  if (!cell) return

  excelCell.font = fortuneStyleToExcelFont(cell)

  const fillColor = fortuneColorToArgb(cell.bg)
  if (fillColor) {
    excelCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: fillColor },
      bgColor: { argb: fillColor },
    }
  }

  const horizontal = resolveExcelHorizontalAlignment(cell.ht)
  const vertical = resolveExcelVerticalAlignment(cell.vt)
  const textRotation = typeof cell.rt === 'number' && Number.isFinite(cell.rt)
    ? Math.max(-90, Math.min(90, Math.round(cell.rt)))
    : undefined

  if (horizontal || vertical || textRotation !== undefined) {
    excelCell.alignment = {
      horizontal,
      vertical,
      textRotation,
    }
  }

  const numberFormat = cell.ct?.fa?.trim()
  if (numberFormat && numberFormat !== 'General') {
    excelCell.numFmt = numberFormat
  }
}

function applyFortuneCellValue(excelCell: ExcelCell, cell: Cell | null | undefined): void {
  if (!cell) return

  if (typeof cell.f === 'string' && cell.f.length > 0) {
    excelCell.value = cell.v !== undefined
      ? { formula: cell.f, result: cell.v as string | number | boolean }
      : { formula: cell.f }
    return
  }

  const inlineRuns = cell.ct?.t === 'inlineStr' && Array.isArray(cell.ct.s)
    ? (cell.ct.s as FortuneInlineStringRun[]).filter(
        (run): run is FortuneInlineStringRun => Boolean(run && typeof run === 'object'),
      )
    : []
  if (inlineRuns.length > 0) {
    const richText: ExcelRichText[] = inlineRuns.map((run) => ({
      text: String(run.v ?? ''),
      font: fortuneStyleToExcelFont(run, cell),
    }))
    excelCell.value = { richText }
    return
  }

  // F3: imported date cells carry a local-time ISO string; restore a real
  // Date (new Date parses offset-less datetimes as local) so the workbook
  // stores a true date serial instead of text.
  if (cell.ct?.t === 'd' && typeof cell.v === 'string') {
    const parsed = new Date(cell.v)
    if (!Number.isNaN(parsed.getTime())) {
      excelCell.value = parsed
      return
    }
  }

  if (cell.v !== undefined) {
    excelCell.value = cell.v as string | number | boolean
    return
  }

  if (cell.m !== undefined) {
    excelCell.value = String(cell.m)
  }
}

interface MergeRect {
  startRow: number
  startCol: number
  endRow: number
  endCol: number
}

function overlapsExisting(rect: MergeRect, existing: MergeRect[]): boolean {
  return existing.some(
    (other) => rect.startRow <= other.endRow
      && rect.endRow >= other.startRow
      && rect.startCol <= other.endCol
      && rect.endCol >= other.startCol,
  )
}

function applyFortuneSheetMerges(worksheet: ExcelJS.Worksheet, sheet: Sheet): void {
  const merges = sheet.config?.merge
  if (!merges) return

  const applied: MergeRect[] = []
  for (const merge of Object.values(merges)) {
    if (!merge) continue
    const row = Number(merge.r)
    const column = Number(merge.c)
    const rowSpan = Number(merge.rs)
    const columnSpan = Number(merge.cs)
    // Validate endpoints and spans: reject non-finite / negative / oversized input
    // instead of letting exceljs throw or silently corrupt offsets.
    if (!Number.isInteger(row) || !Number.isInteger(column)) continue
    if (!Number.isFinite(rowSpan) || !Number.isFinite(columnSpan)) continue
    if (rowSpan < 1 || columnSpan < 1) continue
    if (row === 0 && column === 0 && rowSpan === 1 && columnSpan === 1) continue
    if (row < 0 || column < 0) continue

    const endRow = row + rowSpan - 1
    const endCol = column + columnSpan - 1
    if (row === endRow && column === endCol) continue
    if (endRow > EXCEL_MAX_ROW || endCol > EXCEL_MAX_COLUMN) continue

    const rect: MergeRect = {
      startRow: row,
      startCol: column,
      endRow,
      endCol,
    }
    if (overlapsExisting(rect, applied)) continue
    applied.push(rect)

    worksheet.mergeCells(
      row + 1,
      column + 1,
      endRow + 1,
      endCol + 1,
    )
  }
}

function asArrayBuffer(value: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value.slice(0)
  return Uint8Array.from(value).buffer
}

type SpreadsheetValue = string | number | boolean | Date

function normalizeExcelValue(value: unknown, depth = 0): SpreadsheetValue | undefined {
  if (depth > 2 || value === null || value === undefined) return undefined
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (value instanceof Date) return value
  if (typeof value !== 'object') return String(value)

  const record = value as Record<string, unknown>
  if (Array.isArray(record.richText)) {
    return record.richText
      .map((run) => {
        if (!run || typeof run !== 'object') return ''
        return String((run as Record<string, unknown>).text ?? '')
      })
      .join('')
  }
  if ('result' in record) return normalizeExcelValue(record.result, depth + 1)
  if (typeof record.text === 'string') return record.text
  if (typeof record.hyperlink === 'string') return record.hyperlink
  if (typeof record.error === 'string') return record.error
  return String(value)
}

function normalizeExcelCellValue(cell: ExcelCell): SpreadsheetValue | undefined {
  return normalizeExcelValue(cell.value)
}

function decodeCsvBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  if (
    bytes.length >= 8
    && bytes[0] === 0xd0
    && bytes[1] === 0xcf
    && bytes[2] === 0x11
    && bytes[3] === 0xe0
    && bytes[4] === 0xa1
    && bytes[5] === 0xb1
    && bytes[6] === 0x1a
    && bytes[7] === 0xe1
  ) {
    throw new Error('Legacy .xls files require WPS, LibreOffice, or Microsoft Excel conversion.')
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Uint8Array.from(bytes.subarray(2))
    for (let index = 0; index + 1 < swapped.length; index += 2) {
      const first = swapped[index]
      swapped[index] = swapped[index + 1]
      swapped[index + 1] = first
    }
    return new TextDecoder('utf-16le').decode(swapped)
  }
  const offset = bytes.length >= 3
    && bytes[0] === 0xef
    && bytes[1] === 0xbb
    && bytes[2] === 0xbf
    ? 3
    : 0
  return new TextDecoder('utf-8').decode(bytes.subarray(offset))
}

const CSV_DELIMITERS = [',', ';', '\t'] as const

/** Collect up to `maxLines` physical lines while respecting quoted newlines. */
function collectCsvSampleLines(text: string, maxLines: number): string[] {
  const lines: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < text.length && lines.length < maxLines; index++) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        current += character
        index++
        continue
      }
      quoted = !quoted
      current += character
      continue
    }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index++
      lines.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (lines.length < maxLines) lines.push(current)
  return lines
}

/**
 * Evaluate candidate delimiters across the first several lines (respecting
 * quotes) rather than only the first row, so a header that happens to lack the
 * delimiter (comment / single-field row) does not mis-classify the whole file.
 */
function detectCsvDelimiter(text: string): ',' | ';' | '\t' {
  const totals: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  const linesWith: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  for (const line of collectCsvSampleLines(text, 10)) {
    let quoted = false
    const perLine: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
    for (let index = 0; index < line.length; index++) {
      const character = line[index]
      if (character === '"') {
        if (quoted && line[index + 1] === '"') index++
        else quoted = !quoted
        continue
      }
      if ((CSV_DELIMITERS as readonly string[]).includes(character)) {
        perLine[character] += 1
      }
    }
    for (const delimiter of CSV_DELIMITERS) {
      totals[delimiter] += perLine[delimiter]
      if (perLine[delimiter] > 0) linesWith[delimiter] += 1
    }
  }
  const best = [...CSV_DELIMITERS]
    .sort((a, b) => linesWith[b] - linesWith[a] || totals[b] - totals[a])[0]
  return totals[best] > 0 ? best : ','
}

function parseCsv(text: string, delimiter: ',' | ';' | '\t'): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  const appendRow = () => {
    row.push(field)
    field = ''
    if (rows.length >= 100_000) throw new Error('CSV row limit exceeded (100000).')
    if (row.length > 16_384) throw new Error('CSV column limit exceeded (16384).')
    rows.push(row)
    row = []
  }

  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"'
        index++
      } else {
        quoted = !quoted
      }
    } else if (!quoted && character === delimiter) {
      row.push(field)
      field = ''
    } else if (!quoted && (character === '\r' || character === '\n')) {
      if (character === '\r' && text[index + 1] === '\n') index++
      appendRow()
    } else {
      field += character
    }
  }

  if (quoted) throw new Error('CSV contains an unterminated quoted field.')
  if (field.length > 0 || row.length > 0) appendRow()
  return rows
}

function normalizeCsvValue(value: string): string | number | boolean {
  const trimmed = value.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(trimmed)) {
    const significantDigits = trimmed.replace(/[^0-9]/g, '').replace(/^0+/, '').length
    const numeric = Number(trimmed)
    if (significantDigits <= 15 && Number.isFinite(numeric)) return numeric
  }
  return value
}

function csvBufferToSheets(buffer: ArrayBuffer): Sheet[] {
  const bytes = new Uint8Array(buffer)
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    throw new Error('Unsupported spreadsheet package. Convert ODS to XLSX with WPS or LibreOffice.')
  }

  const text = decodeCsvBuffer(buffer)
  const rows = parseCsv(text, detectCsvDelimiter(text))
  const celldata: NonNullable<Sheet['celldata']> = []
  let maxColumns = 0
  rows.forEach((row, rowIndex) => {
    maxColumns = Math.max(maxColumns, row.length)
    row.forEach((rawValue, columnIndex) => {
      if (rawValue === '') return
      const value = normalizeCsvValue(rawValue)
      celldata.push({
        r: rowIndex,
        c: columnIndex,
        v: {
          v: value,
          m: rawValue,
          ct: { fa: 'General', t: typeof value === 'number' ? 'n' : typeof value === 'boolean' ? 'b' : 'g' },
          ff: DEFAULT_SPREADSHEET_FONT,
          fs: DEFAULT_SPREADSHEET_FONT_SIZE,
        },
      })
    })
  })

  return [{
    name: 'Sheet1',
    id: ensureSheetId(0),
    celldata,
    order: 0,
    status: 1,
    row: Math.max(rows.length + 49, 84),
    column: Math.max(maxColumns + 9, 60),
  } satisfies Sheet]
}

/** F4: serialize the first sheet back to CSV (RFC 4180, comma delimiter,
 * CRLF). Only the first sheet is written, matching CSV's single-table model.
 * Display text (`m`) is preferred so formatted numbers/dates round-trip the
 * way the user sees them. */
export function sheetsToCsvBuffer(sheets: Sheet[]): ArrayBuffer {
  const sheet = sheets[0]
  if (!sheet) return new ArrayBuffer(0)
  const cells = (sheet.celldata && sheet.celldata.length > 0)
    ? sheet.celldata
    : matrixToCelldata(sheet.data)

  let maxRow = -1
  let maxColumn = -1
  const values = new Map<string, string>()
  for (const entry of cells || []) {
    if (!validCellCoord(entry.r, entry.c)) continue
    let text = ''
    if (entry.v) {
      text = typeof entry.v.m === 'string' && entry.v.m.length > 0
        ? entry.v.m
        : entry.v.v !== undefined && entry.v.v !== null
          ? String(entry.v.v)
          : ''
    }
    values.set(`${entry.r}_${entry.c}`, text)
    maxRow = Math.max(maxRow, entry.r)
    maxColumn = Math.max(maxColumn, entry.c)
  }

  const escapeCsvField = (value: string): string => {
    if (/[",\r\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`
    }
    return value
  }

  const lines: string[] = []
  for (let row = 0; row <= maxRow; row += 1) {
    const fields: string[] = []
    for (let column = 0; column <= maxColumn; column += 1) {
      fields.push(values.get(`${row}_${column}`) ?? '')
    }
    lines.push(fields.map(escapeCsvField).join(','))
  }
  return asArrayBuffer(new TextEncoder().encode(lines.join('\r\n')))
}

// Excel character-width → pixel conversion assumes Calibri 11 (max digit width
// 7px), the workbook default: pixels = TRUNC(width * 7 + 5).
const EXCEL_COLUMN_WIDTH_PX_FACTOR = 7
const EXCEL_COLUMN_WIDTH_PX_PADDING = 5
// Row heights are stored in points; 1 point = 96/72 pixels at 96 DPI.
const POINT_TO_PIXEL = 96 / 72

/** Runtime shape of an entry in worksheet.model.merges (the shipped .d.ts
 *  wrongly types these as strings; exceljs pushes Range model objects). */
type ExcelRangeModel = {
  top?: unknown
  left?: unknown
  bottom?: unknown
  right?: unknown
}

/** True when an empty cell carries formatting visible on its blank background. */
function hasVisibleExplicitStyle(style: Partial<Cell>): boolean {
  if (style.bl || style.it || style.un || style.cl || style.fc || style.bg) return true
  if (style.ht !== undefined || style.vt !== undefined || style.rt !== undefined) return true
  if (style.ff !== undefined && style.ff !== DEFAULT_SPREADSHEET_FONT) return true
  if (style.fs !== undefined && style.fs !== DEFAULT_SPREADSHEET_FONT_SIZE) return true
  return false
}

/** F3: format a Date as local-time ISO with no timezone suffix.
 *
 * ExcelJS hands back a `Date` in the host timezone; `toISOString()` shifts it
 * to UTC, so an early-morning value in UTC+8 crosses midnight and comes back
 * a day early. A datetime form without an offset ("2026-10-05T00:30:00") is
 * parsed by `new Date()` as *local* time on the same host, preserving the
 * calendar date. The export side converts it back to a real Date. */
function formatLocalDateTimeIso(date: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `.${pad(date.getMilliseconds(), 3)}`
  )
}

function excelColumnWidthToPixels(width: number): number {
  return Math.max(
    Math.round(width * EXCEL_COLUMN_WIDTH_PX_FACTOR + EXCEL_COLUMN_WIDTH_PX_PADDING),
    1,
  )
}

/** F1: translate ExcelJS merge ranges into Fortune Sheet config.merge. */
function collectFortuneMerges(
  worksheet: ExcelJS.Worksheet,
): NonNullable<Sheet['config']>['merge'] {
  const mergeRanges = worksheet.model.merges as unknown as ExcelRangeModel[] | undefined
  if (!Array.isArray(mergeRanges) || mergeRanges.length === 0) return undefined

  const merge: NonNullable<NonNullable<Sheet['config']>['merge']> = {}
  for (const range of mergeRanges) {
    const top = Number(range?.top)
    const left = Number(range?.left)
    const bottom = Number(range?.bottom)
    const right = Number(range?.right)
    if (!Number.isInteger(top) || !Number.isInteger(left)
      || !Number.isInteger(bottom) || !Number.isInteger(right)) continue
    if (top < 1 || left < 1 || bottom < top || right < left) continue

    const r = top - 1
    const c = left - 1
    const rs = bottom - top + 1
    const cs = right - left + 1
    if (rs === 1 && cs === 1) continue
    if (r + rs - 1 > EXCEL_MAX_ROW || c + cs - 1 > EXCEL_MAX_COLUMN) continue

    merge[`${r}_${c}`] = { r, c, rs, cs }
  }

  return Object.keys(merge).length > 0 ? merge : undefined
}

/** F2: import column widths and hidden columns (Fortune stores pixels). */
function collectFortuneColumnConfig(
  worksheet: ExcelJS.Worksheet,
): Pick<NonNullable<Sheet['config']>, 'columnlen' | 'colhidden'> {
  const columnlen: Record<string, number> = {}
  const colhidden: Record<string, number> = {}
  worksheet.columns.forEach((column, index) => {
    if (!column) return
    if (column.hidden) colhidden[String(index)] = 1
    const width = Number(column.width)
    if (Number.isFinite(width) && width > 0) {
      columnlen[String(index)] = excelColumnWidthToPixels(width)
    }
  })
  return {
    ...(Object.keys(columnlen).length > 0 ? { columnlen } : {}),
    ...(Object.keys(colhidden).length > 0 ? { colhidden } : {}),
  }
}

/** F2: map a frozen-pane view to Fortune's top-level frozen descriptor. */
function collectFortuneFrozen(worksheet: ExcelJS.Worksheet): Sheet['frozen'] {
  const frozenView = worksheet.views?.find(
    (view): view is WorksheetViewFrozen => view?.state === 'frozen',
  )
  if (!frozenView) return undefined

  const xSplit = Number(frozenView.xSplit) || 0
  const ySplit = Number(frozenView.ySplit) || 0
  if (xSplit <= 0 && ySplit <= 0) return undefined

  const type = xSplit > 0 && ySplit > 0
    ? 'both'
    : xSplit > 0
      ? 'column'
      : 'row'
  return {
    type,
    // Fortune wants the 0-based index of the LAST frozen row/column; Excel's
    // xSplit/ySplit are the COUNT of frozen columns/rows.
    range: {
      row_focus: Math.max(ySplit - 1, 0),
      column_focus: Math.max(xSplit - 1, 0),
    },
  }
}

/* ------------------------------------------------------------------ *
 * wps_04 F2: borders, images, comments, data validation and
 * conditional formatting. Fortune Sheet stores borders as per-cell
 * borderInfo entries whose `style` is one of the numeric line codes
 * used by its canvas renderer:
 * 1 Thin, 2 Hair, 3 Dotted, 4 Dashed, 5 DashDot, 6 DashDotDot,
 * 7 Double, 8 Medium, 9 MediumDashed, 10 MediumDashDot,
 * 11 MediumDashDotDot, 12 SlantedDashDot, 13 Thick.
 * ------------------------------------------------------------------ */

const EXCEL_BORDER_STYLE_TO_CODE: Record<string, number> = {
  thin: 1,
  hair: 2,
  dotted: 3,
  dashed: 4,
  dashDot: 5,
  dashDotDot: 6,
  double: 7,
  medium: 8,
  mediumDashed: 9,
  mediumDashDot: 10,
  mediumDashDotDot: 11,
  slantDashDot: 12,
  thick: 13,
}

const FORTUNE_BORDER_CODE_TO_EXCEL: Record<number, string> = {
  1: 'thin',
  2: 'hair',
  3: 'dotted',
  4: 'dashed',
  5: 'dashDot',
  6: 'dashDotDot',
  7: 'double',
  8: 'medium',
  9: 'mediumDashed',
  10: 'mediumDashDot',
  11: 'mediumDashDotDot',
  12: 'slantDashDot',
  13: 'thick',
}

type ExcelBorderSide = {
  style?: string
  color?: ExtendedExcelColor
}

type ExcelBordersShape = {
  top?: ExcelBorderSide
  left?: ExcelBorderSide
  bottom?: ExcelBorderSide
  right?: ExcelBorderSide
}

type FortuneBorderSide = {
  style: number
  color: string
}

/** Convert one ExcelJS border side (`{style, color}`) to a Fortune side. */
function toFortuneBorderSide(
  side: ExcelBorderSide | undefined,
  themeColors: string[],
): FortuneBorderSide | null {
  if (!side || !side.style) return null
  const code = EXCEL_BORDER_STYLE_TO_CODE[String(side.style)]
  if (!code) return null
  const color = resolveExcelColor(side.color, themeColors) ?? '#000000'
  return { style: code, color }
}

/** F2: per-cell borderInfo entries from cell borders. */
function collectFortuneBorderInfo(
  worksheet: ExcelJS.Worksheet,
  themeColors: string[],
): NonNullable<NonNullable<Sheet['config']>['borderInfo']> {
  const borderInfo: NonNullable<NonNullable<Sheet['config']>['borderInfo']> = []
  // Coordinates come from the callback numbers; Cell.row/col are strings.
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const borders = cell.border as ExcelBordersShape | undefined
      if (!borders) return
      const l = toFortuneBorderSide(borders.left, themeColors)
      const r = toFortuneBorderSide(borders.right, themeColors)
      const t = toFortuneBorderSide(borders.top, themeColors)
      const b = toFortuneBorderSide(borders.bottom, themeColors)
      if (!l && !r && !t && !b) return
      borderInfo.push({
        rangeType: 'cell',
        value: {
          row_index: rowNumber - 1,
          col_index: columnNumber - 1,
          l,
          r,
          t,
          b,
        },
      })
    })
  })
  return borderInfo
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function imageBufferToBase64(buffer: unknown): string | undefined {
  if (buffer instanceof Uint8Array) return bytesToBase64(buffer)
  if (buffer instanceof ArrayBuffer) return bytesToBase64(new Uint8Array(buffer))
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buffer)) {
    return bytesToBase64(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))
  }
  return undefined
}

// Column/row geometry used to place images. Fortune defaults:
// 73px columns, 19px rows (its own defaults).
const DEFAULT_COLUMN_PX = 73
const DEFAULT_ROW_PX = 19
const EMU_PER_PIXEL = 9525

/** Cumulative pixel edges for columns, honoring imported widths. */
function buildColumnEdges(worksheet: ExcelJS.Worksheet): number[] {
  const edges: number[] = []
  let cursor = 0
  worksheet.columns.forEach((column, index) => {
    edges.push(cursor)
    const width = Number(column?.width)
    const pixels = Number.isFinite(width) && width > 0
      ? excelColumnWidthToPixels(width)
      : DEFAULT_COLUMN_PX
    cursor += pixels
    void index
  })
  return edges
}

/** Cumulative pixel edges for rows, honoring imported heights. */
function buildRowEdges(worksheet: ExcelJS.Worksheet): number[] {
  const edges: number[] = []
  let cursor = 0
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    edges.push(cursor)
    const height = Number(row.height)
    const pixels = Number.isFinite(height) && height > 0
      ? Math.max(Math.round(height * POINT_TO_PIXEL), 1)
      : DEFAULT_ROW_PX
    cursor += pixels
    void rowNumber
  })
  return edges
}

/** EMU offset within a cell → pixels. */
function emuOffsetToPixels(emu: unknown): number {
  const value = Number(emu) || 0
  return value / EMU_PER_PIXEL
}

/** F2: imported images. ExcelJS anchors carry a cell plus EMU offsets. */
function collectFortuneImages(
  workbook: ExcelJS.Workbook,
  worksheet: ExcelJS.Worksheet,
): Sheet['images'] {
  const images = worksheet.getImages()
  if (!images || images.length === 0) return undefined
  const columnEdges = buildColumnEdges(worksheet)
  const rowEdges = buildRowEdges(worksheet)

  const resolveX = (col: number, offset: unknown): number =>
    (columnEdges[col] ?? col * DEFAULT_COLUMN_PX) + emuOffsetToPixels(offset)
  const resolveY = (row: number, offset: unknown): number =>
    (rowEdges[row] ?? row * DEFAULT_ROW_PX) + emuOffsetToPixels(offset)

  const result: NonNullable<NonNullable<Sheet['images']>> = []
  images.forEach((entry, index) => {
    const tl = entry.range?.tl as unknown as {
      col?: number
      row?: number
      nativeColOff?: number
      nativeRowOff?: number
    } | undefined
    const br = entry.range?.br as unknown as {
      col?: number
      row?: number
      nativeColOff?: number
      nativeRowOff?: number
    } | undefined
    if (!tl || !br) return
    const left = resolveX(Number(tl.col) || 0, tl.nativeColOff)
    const top = resolveY(Number(tl.row) || 0, tl.nativeRowOff)
    const right = resolveX(Number(br.col) || 0, br.nativeColOff)
    const bottom = resolveY(Number(br.row) || 0, br.nativeRowOff)
    if (right <= left || bottom <= top) return

    const image = workbook.getImage(Number(entry.imageId))
    let src: string | undefined = image?.base64
    if (!src) src = imageBufferToBase64(image?.buffer)
    if (!src) return
    const extension = image.extension === 'jpeg' ? 'jpeg' : image.extension
    result.push({
      id: `img_${index}_${entry.imageId}`,
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top),
      src: `data:image/${extension};base64,${src}`,
    })
  })
  return result.length > 0 ? result : undefined
}

/** Plain text of an ExcelJS note (string or rich-text comment). */
function noteText(note: unknown): string {
  if (typeof note === 'string') return note
  if (note && typeof note === 'object') {
    const texts = (note as { texts?: unknown }).texts
    if (Array.isArray(texts)) {
      return texts
        .map((run) => String((run as { text?: unknown })?.text ?? ''))
        .join('')
    }
  }
  return ''
}

type FortuneCommentEntry = { r: number; c: number; value: string }

/** F2: collect notes/threads comments as Fortune `ps` descriptors. */
function collectFortuneComments(
  worksheet: ExcelJS.Worksheet,
): FortuneCommentEntry[] {
  const comments: FortuneCommentEntry[] = []
  // The callback numeric params carry the coordinates; the typed Cell's
  // row/col fields are address strings (see exceljs Address).
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const value = noteText((cell as { note?: unknown }).note)
      if (value) comments.push({ r: rowNumber - 1, c: columnNumber - 1, value })
    })
  })
  return comments
}

/** Attach collected comments to celldata entries (or add blank entries). */
function applyCommentsToCelldata(
  celldata: NonNullable<Sheet['celldata']>,
  comments: FortuneCommentEntry[],
): void {
  for (const comment of comments) {
    const index = celldata.findIndex(
      (entry) => entry.r === comment.r && entry.c === comment.c,
    )
    // Geometry null: Fortune positions the comment box from the cell.
    const ps = {
      left: null,
      top: null,
      width: null,
      height: null,
      value: comment.value,
      isShow: false,
    }
    if (index >= 0 && celldata[index].v) {
      celldata[index] = { ...celldata[index], v: { ...celldata[index].v, ps } }
    } else if (index >= 0) {
      celldata[index] = { ...celldata[index], v: { ps } }
    } else {
      celldata.push({ r: comment.r, c: comment.c, v: { ps } })
    }
  }
}

/* ---- Data validation ------------------------------------------------ */

const DV_OPERATOR_TO_FORTUNE: Record<string, string> = {
  between: 'between',
  notBetween: 'notBetween',
  equal: 'equal',
  notEqual: 'notEqualTo',
  greaterThan: 'moreThanThe',
  lessThan: 'lessThan',
  greaterThanOrEqual: 'greaterOrEqualTo',
  lessThanOrEqual: 'lessThanOrEqualTo',
}

/** Strip the leading '=' and surrounding quotes from a DV formula. */
function dvFormulaText(value: unknown): string {
  let text = String(value ?? '')
  if (text.startsWith('=')) text = text.slice(1)
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1)
  }
  return text
}

/** Build one Fortune dataVerification entry from an ExcelJS validation. */
function toFortuneDataVerificationEntry(dv: unknown): Record<string, unknown> | null {
  const validation = dv as {
    type?: string
    operator?: string
    formulae?: unknown[]
    showErrorMessage?: boolean
    showInputMessage?: boolean
    prompt?: string
  }
  if (!validation || !validation.type || !Array.isArray(validation.formulae)) return null
  const operator = DV_OPERATOR_TO_FORTUNE[validation.operator ?? '']
  const value1 = dvFormulaText(validation.formulae[0])
  const value2 = validation.formulae[1] !== undefined
    ? dvFormulaText(validation.formulae[1])
    : ''

  let type: string
  let type2: string | number
  switch (validation.type) {
    case 'list':
      type = 'dropdown'
      type2 = 0
      break
    case 'whole':
      type = 'number_integer'
      type2 = operator ?? 'between'
      break
    case 'decimal':
      type = 'number'
      type2 = operator ?? 'between'
      break
    case 'textLength':
      type = 'text_length'
      type2 = operator ?? 'between'
      break
    case 'date':
      type = 'date'
      type2 = operator ?? 'between'
      break
    // custom expressions have no Fortune equivalent.
    default:
      return null
  }

  const entry: Record<string, unknown> = {
    type,
    type2,
    value1,
    value2,
    prohibitInput: validation.showErrorMessage !== false,
    hintShow: Boolean(validation.showInputMessage && validation.prompt),
  }
  if (entry.hintShow) entry.hintText = validation.prompt
  return entry
}

/** Column letters (`A`, `Z`, `AA`) → 0-based index. */
function columnLettersToIndex(text: string): number {
  let index = 0
  for (const character of text.toUpperCase()) {
    const digit = character.charCodeAt(0) - 64
    if (digit < 1 || digit > 26) return -1
    index = index * 26 + digit
  }
  return index - 1
}

/** 0-based index → column letters. */
function indexToColumnLetters(index: number): string {
  let remaining = index + 1
  let text = ''
  while (remaining > 0) {
    const digit = (remaining - 1) % 26
    text = String.fromCharCode(65 + digit) + text
    remaining = Math.floor((remaining - 1) / 26)
  }
  return text
}

type CellAddressRange = { r1: number; r2: number; c1: number; c2: number }

/** Parse a plain Excel address or range (`A1`, `$A$1:$B$2`, `A1:B2`). */
function parseCellAddress(address: string): CellAddressRange | null {
  const parts = address
    .replace(/^[^!]*!/, '')
    .replace(/\$/g, '')
    .split(':')
  if (parts.length < 1 || parts.length > 2) return null
  const parsePart = (part: string): { r: number; c: number } | null => {
    const match = /^([A-Za-z]+)(\d+)$/.exec(part.trim())
    if (!match) return null
    const c = columnLettersToIndex(match[1])
    const r = Number(match[2]) - 1
    if (c < 0 || r < 0) return null
    return { r, c }
  }
  const start = parsePart(parts[0])
  if (!start) return null
  const end = parts[1] ? parsePart(parts[1]) : start
  if (!end) return null
  return {
    r1: Math.min(start.r, end.r),
    r2: Math.max(start.r, end.r),
    c1: Math.min(start.c, end.c),
    c2: Math.max(start.c, end.c),
  }
}

/** F2: expand worksheet-level data validations into per-cell entries. */
function collectFortuneDataVerification(
  worksheet: ExcelJS.Worksheet,
): Sheet['dataVerification'] {
  const model = (worksheet as unknown as {
    dataValidations?: { model?: Record<string, unknown> }
  }).dataValidations?.model
  if (!model) return undefined

  const result: Record<string, Record<string, unknown>> = {}
  for (const [address, dv] of Object.entries(model)) {
    if (!dv) continue
    const range = parseCellAddress(address)
    const entry = toFortuneDataVerificationEntry(dv)
    if (!range || !entry) continue
    for (let r = range.r1; r <= range.r2; r += 1) {
      for (let c = range.c1; c <= range.c2; c += 1) {
        result[`${r}_${c}`] = entry
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/* ---- Conditional formatting ----------------------------------------- */

const CELLIS_OPERATOR_TO_CONDITION: Record<string, string> = {
  greaterThan: 'greaterThan',
  lessThan: 'lessThan',
  equal: 'equal',
  notEqual: 'equal',
  between: 'between',
  notBetween: 'between',
  containsText: 'textContains',
}

type DxfStyleShape = {
  font?: { color?: ExtendedExcelColor }
  fill?: { fgColor?: ExtendedExcelColor }
}

/** dxf style attached to a CF rule → Fortune format colors. */
function toFortuneCfFormat(
  style: DxfStyleShape | undefined,
  themeColors: string[],
): { textColor: { check: boolean; color: string }; cellColor: { check: boolean; color: string } } {
  const fontColor = resolveExcelColor(style?.font?.color, themeColors)
  const fillColor = resolveExcelColor(style?.fill?.fgColor, themeColors)
  return {
    textColor: { check: Boolean(fontColor), color: fontColor ?? '#FF0000' },
    cellColor: { check: Boolean(fillColor), color: fillColor ?? '#FFC7CE' },
  }
}

const addressToCellRange = (ref: string): { row: number[]; column: number[] }[] => {
  return ref
    .split(/\s+/)
    .map(parseCellAddress)
    .filter((range): range is CellAddressRange => range !== null)
    .map((range) => ({
      row: [range.r1, range.r2],
      column: [range.c1, range.c2],
    }))
}

/** F2: map common ExcelJS conditional formats to Fortune rules. */
function collectFortuneConditionalFormats(
  worksheet: ExcelJS.Worksheet,
  themeColors: string[],
): Sheet['luckysheet_conditionformat_save'] {
  const entries = (worksheet as unknown as {
    conditionalFormattings?: Array<{ ref?: string; rules?: unknown[] }>
  }).conditionalFormattings
  if (!entries || entries.length === 0) return undefined

  const result: NonNullable<NonNullable<Sheet['luckysheet_conditionformat_save']>> = []
  for (const entry of entries) {
    const cellrange = entry.ref ? addressToCellRange(entry.ref) : []
    if (cellrange.length === 0) continue
    for (const rule of entry.rules ?? []) {
      const r = rule as {
        type?: string
        operator?: string
        formulae?: unknown[]
        text?: string
        style?: DxfStyleShape
        color?: Array<{ argb?: string }>
        cfvo?: Array<{ type?: string; value?: number }>
      }
      if (r.type === 'cellIs' || r.type === 'containsText' || r.type === 'expression') {
        let conditionName: string
        let conditionValue: string[]
        if (r.type === 'containsText') {
          conditionName = 'textContains'
          conditionValue = [String(r.text ?? r.formulae?.[0] ?? '')]
        } else {
          conditionName = CELLIS_OPERATOR_TO_CONDITION[r.operator ?? ''] ?? 'greaterThan'
          conditionValue = (r.formulae ?? []).slice(0, 2).map((value) => String(value))
        }
        result.push({
          conditionName,
          conditionValue,
          cellrange,
          format: toFortuneCfFormat(r.style, themeColors),
        })
      } else if (r.type === 'colorScale') {
        const colors = (r.color ?? [])
          .map((color) => normalizeRgb(color.argb))
          .filter((color): color is string => Boolean(color))
          .map((color) => `rgb(${[0, 2, 4]
            .map((offset) => parseInt(color.slice(offset, offset + 2), 16))
            .join(',')})`)
        if (colors.length >= 2) {
          result.push({ type: 'colorGradation', cellrange, format: colors })
        }
      } else if (r.type === 'dataBar') {
        const barColor = normalizeRgb(r.color?.[0]?.argb) ?? '638EC6'
        result.push({
          type: 'dataBar',
          cellrange,
          format: [`rgb(${[0, 2, 4]
            .map((offset) => parseInt(barColor.slice(offset, offset + 2), 16))
            .join(',')})`],
        })
      }
      // top10, aboveAverage, iconSet, timePeriod are not mapped on import.
    }
  }
  return result.length > 0 ? result : undefined
}

export async function xlsxBufferToSheets(buffer: ArrayBuffer): Promise<Sheet[]> {
  const styledWorkbook = await loadStyledWorkbook(buffer)
  if (!styledWorkbook) return csvBufferToSheets(buffer)

  const themeColors = parseThemeColors(styledWorkbook?.model.themes)
  // F12: sanitize and de-duplicate sheet names on import too, matching the
  // export side; crafted workbooks can carry duplicate or illegal names.
  const usedSheetNames = new Set<string>()
  const sheetNames = styledWorkbook.worksheets.map((styledSheet, index) =>
    uniqueSheetName(styledSheet.name, index, usedSheetNames))
  return styledWorkbook.worksheets.map((styledSheet, order) => {
    const celldata: NonNullable<Sheet['celldata']> = []
    // F2: includeEmpty so cells carrying style only (fill, border-backed
    // formatting, alignment) are not dropped on import.
    const rowlen: Record<string, number> = {}
    const rowhidden: Record<string, number> = {}
    styledSheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (row.hidden) rowhidden[String(rowNumber - 1)] = 1
      const rowHeight = Number(row.height)
      if (Number.isFinite(rowHeight) && rowHeight > 0) {
        rowlen[String(rowNumber - 1)] = Math.max(
          Math.round(rowHeight * POINT_TO_PIXEL),
          1,
        )
      }
      row.eachCell({ includeEmpty: true }, (styledCell, columnNumber) => {
        const formula = styledCell.formula || undefined
        const value = normalizeExcelCellValue(styledCell)
        const style = toFortuneStyle(styledCell, themeColors)
        if (value === undefined && formula === undefined) {
          // Blank cell: keep it only when its own formatting is visible.
          if (hasVisibleExplicitStyle(style)) {
            celldata.push({
              r: rowNumber - 1,
              c: columnNumber - 1,
              v: style,
            })
          }
          return
        }

        const richTextRuns = toFortuneInlineStringRuns(styledCell, themeColors)
        const richTextValue = richTextRuns?.map((run) => String(run.v ?? '')).join('')
        const normalizedValue = richTextValue ?? value ?? ''
        const numberFormat = styledCell.numFmt?.trim() || 'General'
        const cellType = normalizedValue instanceof Date
          ? 'd'
          : typeof normalizedValue === 'number'
            ? 'n'
            : typeof normalizedValue === 'boolean'
              ? 'b'
              : 'g'

        celldata.push({
          r: rowNumber - 1,
          c: columnNumber - 1,
          v: {
            v: normalizedValue instanceof Date
              ? formatLocalDateTimeIso(normalizedValue)
              : normalizedValue,
            m: styledCell.text || String(normalizedValue),
            f: formula,
            ct: richTextRuns
              ? { fa: numberFormat, t: 'inlineStr', s: richTextRuns }
              : { fa: numberFormat, t: cellType },
            ...style,
          },
        })
      })
    })

    // wps_04 F2: comments attach to celldata entries (adding blank entries
    // for cells that only carry a note).
    const comments = collectFortuneComments(styledSheet)
    applyCommentsToCelldata(celldata, comments)

    const config: NonNullable<Sheet['config']> = {
      ...collectFortuneColumnConfig(styledSheet),
    }
    const merge = collectFortuneMerges(styledSheet)
    if (merge) config.merge = merge
    if (Object.keys(rowlen).length > 0) config.rowlen = rowlen
    if (Object.keys(rowhidden).length > 0) config.rowhidden = rowhidden
    // wps_04 F2: cell borders.
    const borderInfo = collectFortuneBorderInfo(styledSheet, themeColors)
    if (borderInfo.length > 0) config.borderInfo = borderInfo

    return {
      name: sheetNames[order],
      id: ensureSheetId(order),
      celldata,
      config: Object.keys(config).length > 0 ? config : undefined,
      frozen: collectFortuneFrozen(styledSheet),
      // wps_04 F2: images, data validation and conditional formatting.
      images: collectFortuneImages(styledWorkbook, styledSheet),
      dataVerification: collectFortuneDataVerification(styledSheet),
      luckysheet_conditionformat_save: collectFortuneConditionalFormats(styledSheet, themeColors),
      order,
      status: order === 0 ? 1 : 0,
      hide: styledSheet.state === 'hidden' || styledSheet.state === 'veryHidden' ? 1 : 0,
      row: Math.max(styledSheet.actualRowCount + 49, 84),
      column: Math.max(styledSheet.actualColumnCount + 9, 60),
    } satisfies Sheet
  })
}

/* ---- wps_04 F2 export --------------------------------------------- */

type MutableBorderSides = {
  l?: FortuneBorderSide
  r?: FortuneBorderSide
  t?: FortuneBorderSide
  b?: FortuneBorderSide
}

type FortuneBorderCellValue = {
  row_index: number
  col_index: number
  l?: FortuneBorderSide | null
  r?: FortuneBorderSide | null
  t?: FortuneBorderSide | null
  b?: FortuneBorderSide | null
}

type FortuneBorderRangeEntry = {
  rangeType: 'range'
  borderType?: string
  color?: string
  style?: number
  range?: FortuneRangeSelection[]
}

type FortuneRangeSelection = {
  row?: number[]
  column?: number[]
}

/** Convert a numeric Fortune border side back to an ExcelJS side. */
function fortuneSideToExcel(
  side: FortuneBorderSide | null | undefined,
): Partial<ExcelJS.Border> | undefined {
  if (!side) return undefined
  const styleName = FORTUNE_BORDER_CODE_TO_EXCEL[side.style] as ExcelJS.BorderStyle | undefined
  if (!styleName) return undefined
  return {
    style: styleName,
    color: { argb: fortuneColorToArgb(side.color) ?? 'FF000000' },
  }
}

const borderKey = (r: number, c: number): string => `${r}_${c}`

function borderSides(
  map: Map<string, MutableBorderSides>,
  r: number,
  c: number,
): MutableBorderSides {
  const key = borderKey(r, c)
  let sides = map.get(key)
  if (!sides) {
    sides = {}
    map.set(key, sides)
  }
  return sides
}

/** Expand a range-form borderInfo entry into per-cell sides in `map`. */
function materializeRangeBorder(
  entry: FortuneBorderRangeEntry,
  map: Map<string, MutableBorderSides>,
): void {
  const code = Number(entry.style)
  if (!FORTUNE_BORDER_CODE_TO_EXCEL[code]) return
  const color = normalizeRgb(entry.color) ?? '000000'
  const side = (): FortuneBorderSide => ({ style: code, color: `#${color}` })

  for (const selection of entry.range ?? []) {
    const rows = selection.row
    const columns = selection.column
    if (!Array.isArray(rows) || !Array.isArray(columns) || rows.length < 2 || columns.length < 2) {
      continue
    }
    const r1 = Math.min(rows[0], rows[1])
    const r2 = Math.max(rows[0], rows[1])
    const c1 = Math.min(columns[0], columns[1])
    const c2 = Math.max(columns[0], columns[1])

    const setTop = (r: number, c: number) => { borderSides(map, r, c).t = side() }
    const setBottom = (r: number, c: number) => { borderSides(map, r, c).b = side() }
    const setLeft = (r: number, c: number) => { borderSides(map, r, c).l = side() }
    const setRight = (r: number, c: number) => { borderSides(map, r, c).r = side() }

    for (let c = c1; c <= c2; c += 1) {
      setTop(r1, c)
      setBottom(r2, c)
      // Horizontal interior boundaries: b above, t below.
      for (let r = r1; r < r2; r += 1) {
        setBottom(r, c)
        setTop(r + 1, c)
      }
    }
    for (let r = r1; r <= r2; r += 1) {
      setLeft(r, c1)
      setRight(r, c2)
      for (let c = c1; c < c2; c += 1) {
        setRight(r, c)
        setLeft(r, c + 1)
      }
    }

    // Interior-only and none variants opt out of the outer sides applied
    // above. Everything else keeps the outer ring.
    if (entry.borderType === 'border-inside' || entry.borderType === 'border-none') {
      for (let c = c1; c <= c2; c += 1) {
        delete borderSides(map, r1, c).t
        delete borderSides(map, r2, c).b
      }
      for (let r = r1; r <= r2; r += 1) {
        delete borderSides(map, r, c1).l
        delete borderSides(map, r, c2).r
      }
    }
    if (entry.borderType === 'border-none') {
      // Remove interior boundaries too, leaving no trace of this entry.
      for (let r = r1; r <= r2; r += 1) {
        for (let c = c1; c <= c2; c += 1) {
          map.delete(borderKey(r, c))
        }
      }
    }
  }
}

/** F2 export: write borderInfo back as per-cell ExcelJS borders. */
function applyFortuneBorders(worksheet: ExcelJS.Worksheet, sheet: Sheet): void {
  const borderInfo = sheet.config?.borderInfo
  if (!borderInfo || borderInfo.length === 0) return

  const map = new Map<string, MutableBorderSides>()
  for (const entry of borderInfo) {
    if (!entry || typeof entry !== 'object') continue
    if ((entry as { rangeType?: string }).rangeType === 'cell') {
      const value = (entry as { value?: FortuneBorderCellValue }).value
      if (!value) continue
      const sides = borderSides(map, value.row_index, value.col_index)
      if (value.t) sides.t = value.t
      if (value.b) sides.b = value.b
      if (value.l) sides.l = value.l
      if (value.r) sides.r = value.r
    } else if ((entry as { rangeType?: string }).rangeType === 'range') {
      materializeRangeBorder(entry as FortuneBorderRangeEntry, map)
    }
  }

  for (const [key, sides] of map) {
    const [rText, cText] = key.split('_')
    const r = Number(rText)
    const c = Number(cText)
    if (!Number.isInteger(r) || !Number.isInteger(c)) continue
    const excelCell = worksheet.getCell(r + 1, c + 1)
    excelCell.border = {
      top: fortuneSideToExcel(sides.t),
      left: fortuneSideToExcel(sides.l),
      bottom: fortuneSideToExcel(sides.b),
      right: fortuneSideToExcel(sides.r),
    }
  }
}

/** F2 export: a Fortune `ps` descriptor becomes an ExcelJS cell note. */
function applyFortuneCellComment(excelCell: ExcelCell, cell: Cell | null | undefined): void {
  const value = cell?.ps?.value
  if (typeof value === 'string' && value.trim()) {
    excelCell.note = value
  }
}

/* Pixel geometry for exported images, sourced from the Fortune sheet's
 * own columnlen/rowlen so images land where the editor shows them. */

type EdgeIndex = { index: number; offset: number }

function locatePixelEdge(edges: number[], position: number): EdgeIndex {
  let index = 0
  while (index < edges.length - 2 && position >= edges[index + 1]) index += 1
  return { index, offset: Math.max(0, position - edges[index]) }
}

function buildLengthEdges(
  lengths: Record<string, number> | undefined,
  defaultPx: number,
  until: number,
): number[] {
  const edges = [0]
  let cursor = 0
  let index = 0
  while (cursor < until) {
    cursor += Number(lengths?.[String(index)]) || defaultPx
    edges.push(cursor)
    index += 1
  }
  return edges
}

/** F2 export: write sheet images back through workbook.addImage. */
function applyFortuneImages(
  workbook: ExcelJS.Workbook,
  worksheet: ExcelJS.Worksheet,
  sheet: Sheet,
): void {
  const images = sheet.images
  if (!images || images.length === 0) return

  for (const image of images) {
    const match = /^data:image\/(png|jpe?g|gif);base64,(.+)$/.exec(image.src || '')
    if (!match) continue
    const extension: 'png' | 'jpeg' | 'gif' = match[1] === 'jpg' ? 'jpeg' : (match[1] as 'png' | 'jpeg' | 'gif')
    const imageId = workbook.addImage({ extension, base64: match[2] })

    const right = image.left + image.width
    const bottom = image.top + image.height
    const columnEdges = buildLengthEdges(sheet.config?.columnlen, DEFAULT_COLUMN_PX, right)
    const rowEdges = buildLengthEdges(sheet.config?.rowlen, DEFAULT_ROW_PX, bottom)
    const tlx = locatePixelEdge(columnEdges, image.left)
    const tly = locatePixelEdge(rowEdges, image.top)
    const brx = locatePixelEdge(columnEdges, right)
    const bry = locatePixelEdge(rowEdges, bottom)

    const anchor = (located: EdgeIndex, column: boolean) => ({
      nativeCol: column ? located.index : 0,
      nativeRow: column ? 0 : located.index,
      nativeColOff: column ? Math.round(located.offset * EMU_PER_PIXEL) : 0,
      nativeRowOff: column ? 0 : Math.round(located.offset * EMU_PER_PIXEL),
    })
    const range = {
      tl: { ...anchor(tlx, true), ...anchor(tly, false) },
      br: { ...anchor(brx, true), ...anchor(bry, false) },
      editAs: 'oneCell',
    }
    worksheet.addImage(imageId, range as unknown as { tl: ExcelJS.Anchor; br: ExcelJS.Anchor })
  }
}

/** Reverse of DV_OPERATOR_TO_FORTUNE for export. */
const FORTUNE_DV_OPERATOR_TO_EXCEL: Record<string, DataValidation['operator']> = {
  between: 'between',
  notBetween: 'notBetween',
  equal: 'equal',
  notEqualTo: 'notEqual',
  moreThanThe: 'greaterThan',
  lessThan: 'lessThan',
  greaterOrEqualTo: 'greaterThanOrEqual',
  lessThanOrEqualTo: 'lessThanOrEqual',
}

function dropdownListFormula(value1: string): string {
  // A cell-range reference (`A1:A5`, `$A$1`) passes through; a literal
  // comma list needs quoting as an Excel list formula.
  if (/^[A-Za-z$][A-Za-z0-9$]*\d+(?::[A-Za-z$][A-Za-z0-9$]*\d+)?$/.test(value1.trim())) {
    return value1.trim()
  }
  return `"${value1.replace(/"/g, '""')}"`
}

/** One Fortune dataVerification entry → an ExcelJS DataValidation. */
function toExcelDataValidation(
  entry: Record<string, unknown> | undefined,
): DataValidation | null {
  if (!entry || typeof entry.type !== 'string') return null
  const value1 = String(entry.value1 ?? '')
  const value2 = String(entry.value2 ?? '')
  const base = {
    allowBlank: true,
    showErrorMessage: entry.prohibitInput !== false,
    showInputMessage: entry.hintShow === true,
    prompt: typeof entry.hintText === 'string' ? entry.hintText : undefined,
  }
  switch (entry.type) {
    case 'dropdown':
      if (!value1) return null
      return { ...base, type: 'list', formulae: [dropdownListFormula(value1)] }
    case 'number_integer':
      return {
        ...base,
        type: 'whole',
        operator: FORTUNE_DV_OPERATOR_TO_EXCEL[String(entry.type2)] ?? 'between',
        formulae: [value1, value2],
      }
    case 'number':
      return {
        ...base,
        type: 'decimal',
        operator: FORTUNE_DV_OPERATOR_TO_EXCEL[String(entry.type2)] ?? 'between',
        formulae: [value1, value2],
      }
    case 'text_length':
      return {
        ...base,
        type: 'textLength',
        operator: FORTUNE_DV_OPERATOR_TO_EXCEL[String(entry.type2)] ?? 'between',
        formulae: [value1, value2],
      }
    case 'date':
      return {
        ...base,
        type: 'date',
        operator: FORTUNE_DV_OPERATOR_TO_EXCEL[String(entry.type2)] ?? 'between',
        formulae: [value1, value2],
      }
    default:
      return null
  }
}

/** F2 export: per-cell data validations return to the worksheet. */
function applyFortuneDataValidations(
  worksheet: ExcelJS.Worksheet,
  sheet: Sheet,
): void {
  const dataVerification = sheet.dataVerification
  if (!dataVerification) return
  const validations = (worksheet as unknown as {
    dataValidations: { add(address: string, validation: DataValidation): void }
  }).dataValidations

  for (const [key, entry] of Object.entries(dataVerification)) {
    const [rText, cText] = key.split('_')
    const r = Number(rText)
    const c = Number(cText)
    if (!Number.isInteger(r) || !Number.isInteger(c)) continue
    const validation = toExcelDataValidation(
      entry as Record<string, unknown> | undefined,
    )
    if (!validation) continue
    validations.add(`${indexToColumnLetters(c)}${r + 1}`, validation)
  }
}

/* ---- Conditional formatting export --------------------------------- */

const CONDITION_NAME_TO_CELLIS: Record<string, CellIsOperators> = {
  greaterThan: 'greaterThan',
  lessThan: 'lessThan',
  equal: 'equal',
  notEqualTo: 'equal',
  between: 'between',
  notBetween: 'between',
}

/** One Fortune CF cellrange → an A1-style range string. */
function cfRangeToRef(range: unknown): string | undefined {
  const r = range as { row?: number[]; column?: number[] }
  if (!Array.isArray(r.row) || !Array.isArray(r.column) || r.row.length < 2 || r.column.length < 2) {
    return undefined
  }
  const r1 = r.row[0]
  const r2 = r.row[1]
  const c1 = r.column[0]
  const c2 = r.column[1]
  return `${indexToColumnLetters(c1)}${r1 + 1}:${indexToColumnLetters(c2)}${r2 + 1}`
}

/** Build the dxf style (font/fill colors) attached to a generic rule. */
function fortuneCfFormatToExcelStyle(format: unknown): Partial<ExcelJS.Style> {
  const f = format as {
    textColor?: { check?: boolean; color?: string }
    cellColor?: { check?: boolean; color?: string }
  }
  const textColor = f.textColor?.check ? normalizeRgb(f.textColor.color) : undefined
  const cellColor = f.cellColor?.check ? normalizeRgb(f.cellColor.color) : undefined
  return {
    font: textColor ? { color: { argb: `FF${textColor}` } } : undefined,
    fill: cellColor
      ? {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: `FF${cellColor}` },
          bgColor: { argb: `FF${cellColor}` },
        }
      : undefined,
  }
}

type ExportedCfEntry = {
  type?: string
  conditionName?: string
  conditionValue?: unknown[]
  cellrange?: unknown[]
  format?: unknown
}

/** F2 export: conditional formatting rules return to the worksheet. */
function applyFortuneConditionalFormats(
  worksheet: ExcelJS.Worksheet,
  sheet: Sheet,
): void {
  const rawEntries = sheet.luckysheet_conditionformat_save
  if (!rawEntries || rawEntries.length === 0) return
  const entries = rawEntries as unknown as ExportedCfEntry[]

  let priority = 1
  for (const entry of entries) {
    const ref = (entry.cellrange ?? [])
      .map(cfRangeToRef)
      .filter((text: string | undefined): text is string => Boolean(text))
      .join(' ')
    if (!ref) continue

    if (entry.type === 'dataBar') {
      const formatColors = Array.isArray(entry.format) ? entry.format : []
      const color = normalizeRgb(String(formatColors[0] ?? '')) ?? '638EC6'
      // ExcelJS's dataBar rule type omits the bar color; the writer needs
      // explicit cfvo endpoints plus the color to render the bar.
      const rule = {
        type: 'dataBar',
        priority,
        gradient: true,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: `FF${color}` },
      } as unknown as ExcelJS.ConditionalFormattingRule
      worksheet.addConditionalFormatting({ ref, rules: [rule] })
    } else if (entry.type === 'colorGradation') {
      const formatColors = Array.isArray(entry.format) ? entry.format : []
      const colors = formatColors
        .map((value: unknown) => normalizeRgb(String(value)))
        .filter((value: string | undefined): value is string => Boolean(value))
        .map((value: string) => ({ argb: `FF${value}` }))
      if (colors.length < 2) continue
      const cfvo: ExcelJS.Cvfo[] = [{ type: 'min' }]
      if (colors.length === 3) cfvo.push({ type: 'percentile', value: 50 })
      cfvo.push({ type: 'max' })
      worksheet.addConditionalFormatting({
        ref,
        rules: [{
          type: 'colorScale',
          priority,
          cfvo,
          color: colors,
        }],
      })
    } else {
      const conditionName = String(entry.conditionName ?? '')
      const style = fortuneCfFormatToExcelStyle(entry.format)
      let rule: ExcelJS.ConditionalFormattingRule
      if (conditionName === 'textContains') {
        const text = String(entry.conditionValue?.[0] ?? '')
        // The ContainsText type drops `formulae`; exceljs writes it anyway,
        // so construct through an object literal and cast.
        rule = {
          type: 'containsText',
          operator: 'containsText',
          priority,
          text,
          formulae: [`"${text.replace(/"/g, '""')}"`],
          style,
        } as unknown as ExcelJS.ConditionalFormattingRule
      } else {
        rule = {
          type: 'cellIs',
          operator: CONDITION_NAME_TO_CELLIS[conditionName] ?? 'greaterThan',
          priority,
          formulae: (entry.conditionValue ?? []).map((value: unknown) => String(value)),
          style,
        }
      }
      worksheet.addConditionalFormatting({ ref, rules: [rule] })
    }
    priority += 1
  }
}

export async function sheetsToXlsxBuffer(sheets: Sheet[]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  const sourceSheets = sheets.length > 0
    ? sheets
    : [{
        name: 'Sheet1',
        id: 'sheet_0',
        row: 84,
        column: 60,
        status: 1,
        celldata: [],
      } satisfies Sheet]

  const usedNames = new Set<string>()
  for (const [index, sheet] of sourceSheets.entries()) {
    const worksheet = workbook.addWorksheet(uniqueSheetName(sheet.name || `Sheet${index + 1}`, index, usedNames))
    if (sheet.hide === 1) worksheet.state = 'hidden'

    const cells = (sheet.celldata && sheet.celldata.length > 0)
      ? sheet.celldata
      : matrixToCelldata(sheet.data)

    let wroteContent = false
    for (const entry of cells || []) {
      // Skip malformed coordinates rather than letting exceljs misplace or throw.
      if (!validCellCoord(entry.r, entry.c)) continue
      const excelCell = worksheet.getCell(entry.r + 1, entry.c + 1)
      applyFortuneCellValue(excelCell, entry.v)
      applyFortuneCellStyle(excelCell, entry.v)
      // wps_04 F2: cell comments.
      applyFortuneCellComment(excelCell, entry.v)
      wroteContent = true
    }

    applyFortuneSheetMerges(worksheet, sheet)
    // wps_04 F2: borders, images, data validation and conditional formatting.
    applyFortuneBorders(worksheet, sheet)
    applyFortuneImages(workbook, worksheet, sheet)
    applyFortuneDataValidations(worksheet, sheet)
    applyFortuneConditionalFormats(worksheet, sheet)

    if (!wroteContent) {
      worksheet.getCell('A1').value = ''
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return asArrayBuffer(buffer as ArrayBuffer | Uint8Array)
}
