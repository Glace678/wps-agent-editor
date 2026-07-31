import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import type { Cell as ExcelCell, Color as ExcelColor } from 'exceljs'
import type { Cell, CellMatrix, Sheet } from '@fortune-sheet/core'
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
  const rgb = value.replace(/^#/, '').slice(-6)
  return /^[0-9a-f]{6}$/i.test(rgb) ? rgb.toUpperCase() : undefined
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
    console.warn('[ExcelEditor] 无法读取工作簿颜色样式，使用基础格式:', error)
    return null
  }
}

function ensureSheetId(order: number, existing?: string): string {
  return existing && existing.length > 0 ? existing : `sheet_${order}_${Math.random().toString(36).slice(2, 9)}`
}

/** 将二维 data 矩阵转回 Fortune Sheet celldata */
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
          if (cell != null && cell.v !== undefined) {
            celldata.push({
              r,
              c,
              v: {
                v: cell.v as string | number | boolean,
                m: String(cell.w ?? cell.v),
                ct: cell.t === 'n' ? { fa: 'General', t: 'n' } : { fa: 'General', t: 'g' },
                ...(styledSheet
                  ? toFortuneStyle(styledSheet.getCell(r + 1, c + 1), themeColors)
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

export function sheetsToXlsxBuffer(sheets: Sheet[]): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const cells = (sheet.celldata && sheet.celldata.length > 0)
      ? sheet.celldata
      : matrixToCelldata(sheet.data)

    const data: (string | number | boolean | null)[][] = []
    let maxR = 0
    let maxC = 0
    for (const cell of cells || []) {
      maxR = Math.max(maxR, cell.r)
      maxC = Math.max(maxC, cell.c)
    }
    for (let r = 0; r <= maxR; r++) {
      data[r] = []
      for (let c = 0; c <= maxC; c++) data[r][c] = null
    }
    for (const cell of cells || []) {
      const v = cell.v?.v
      if (v !== undefined) data[cell.r][cell.c] = v as string | number | boolean
    }
    const ws = XLSX.utils.aoa_to_sheet(data.length ? data : [['']])
    XLSX.utils.book_append_sheet(wb, ws, sheet.name || 'Sheet1')
  }
  if (wb.SheetNames.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([['']])
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
