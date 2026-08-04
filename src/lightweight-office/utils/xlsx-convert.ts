import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import type {
  Alignment as ExcelAlignment,
  Cell as ExcelCell,
  Color as ExcelColor,
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

/* Fortune Sheet falls back to 10pt Times New Roman when a workbook cell has
   no explicit font metadata. Segoe UI at 11pt has much stronger Windows
   hinting for small digits while explicit workbook fonts remain untouched. */
export const DEFAULT_SPREADSHEET_FONT = DEFAULT_OFFICE_FONT_FAMILY
export const DEFAULT_SPREADSHEET_FONT_SIZE = 11
export const DEFAULT_SPREADSHEET_FONT_COLOR = '#000000'

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
  style.fc = fontColor || DEFAULT_SPREADSHEET_FONT_COLOR

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

function applyFortuneCellStyle(excelCell: ExcelCell, cell: Cell | null | undefined): void {
  if (!cell) return

  const fontName = resolveFortuneFontFamily(cell.ff) || DEFAULT_SPREADSHEET_FONT
  const fontColor = fortuneColorToArgb(cell.fc)
  const fontSize = typeof cell.fs === 'number' && Number.isFinite(cell.fs)
    ? cell.fs
    : DEFAULT_SPREADSHEET_FONT_SIZE

  excelCell.font = {
    name: fontName,
    size: fontSize,
    color: fontColor ? { argb: fontColor } : undefined,
    bold: cell.bl === 1,
    italic: cell.it === 1,
    underline: cell.un === 1 || undefined,
    strike: cell.cl === 1,
  }

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

  if (cell.v !== undefined) {
    excelCell.value = cell.v as string | number | boolean
    return
  }

  if (cell.m !== undefined) {
    excelCell.value = String(cell.m)
  }
}

function applyFortuneSheetMerges(worksheet: ExcelJS.Worksheet, sheet: Sheet): void {
  const merges = sheet.config?.merge
  if (!merges) return

  const seen = new Set<string>()
  for (const merge of Object.values(merges)) {
    if (!merge) continue
    const row = Number(merge.r)
    const column = Number(merge.c)
    const rowSpan = Math.max(1, Number(merge.rs) || 1)
    const columnSpan = Math.max(1, Number(merge.cs) || 1)
    if (!Number.isInteger(row) || !Number.isInteger(column)) continue
    if (rowSpan === 1 && columnSpan === 1) continue

    const key = `${row}:${column}:${rowSpan}:${columnSpan}`
    if (seen.has(key)) continue
    seen.add(key)

    worksheet.mergeCells(
      row + 1,
      column + 1,
      row + rowSpan,
      column + columnSpan,
    )
  }
}

function asArrayBuffer(value: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value.slice(0)
  return Uint8Array.from(value).buffer
}

export async function xlsxBufferToSheets(buffer: ArrayBuffer): Promise<Sheet[]> {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const styledWorkbook = await loadStyledWorkbook(buffer)
  const themeColors = parseThemeColors(styledWorkbook?.model.themes)
  return wb.SheetNames.map((name, order) => {
    const ws = wb.Sheets[name]
    const styledSheet = styledWorkbook?.getWorksheet(name)
    const ref = ws['!ref']
    const celldata: NonNullable<Sheet['celldata']> = []
    let maxR = 0
    let maxC = 0

    if (ref) {
      const range = XLSX.utils.decode_range(ref)
      maxR = range.e.r
      maxC = range.e.c
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c })
          const cell = ws[addr]
          if (cell == null || (cell.v === undefined && cell.f === undefined && cell.w === undefined)) continue

          const styledCell = styledSheet?.getCell(r + 1, c + 1)
          const numberFormat = styledCell?.numFmt?.trim() || 'General'
          const cellType = cell.t === 'n'
            ? 'n'
            : cell.t === 'b'
              ? 'b'
              : cell.t === 'd'
                ? 'd'
                : 'g'

          celldata.push({
            r,
            c,
            v: {
              v: cell.v as string | number | boolean,
              m: String(cell.w ?? cell.v ?? ''),
              f: typeof cell.f === 'string' ? cell.f : undefined,
              ct: { fa: numberFormat, t: cellType },
              ...(styledCell
                ? toFortuneStyle(styledCell, themeColors)
                : {
                    ff: DEFAULT_SPREADSHEET_FONT,
                    fs: DEFAULT_SPREADSHEET_FONT_SIZE,
                    fc: DEFAULT_SPREADSHEET_FONT_COLOR,
                  }),
            },
          })
        }
      }
    }

    return {
      name: name || `Sheet${order + 1}`,
      id: ensureSheetId(order),
      celldata,
      order,
      status: order === 0 ? 1 : 0,
      row: Math.max(maxR + 50, 84),
      column: Math.max(maxC + 10, 60),
    } satisfies Sheet
  })
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

  for (const [index, sheet] of sourceSheets.entries()) {
    const worksheet = workbook.addWorksheet(sheet.name || `Sheet${index + 1}`)
    if (sheet.hide === 1) worksheet.state = 'hidden'

    const cells = (sheet.celldata && sheet.celldata.length > 0)
      ? sheet.celldata
      : matrixToCelldata(sheet.data)

    let wroteContent = false
    for (const entry of cells || []) {
      const excelCell = worksheet.getCell(entry.r + 1, entry.c + 1)
      applyFortuneCellValue(excelCell, entry.v)
      applyFortuneCellStyle(excelCell, entry.v)
      wroteContent = true
    }

    applyFortuneSheetMerges(worksheet, sheet)

    if (!wroteContent) {
      worksheet.getCell('A1').value = ''
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return asArrayBuffer(buffer as ArrayBuffer | Uint8Array)
}
