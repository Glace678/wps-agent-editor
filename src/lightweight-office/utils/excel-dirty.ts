import type { Cell, CellMatrix, Sheet } from '@fortune-sheet/core'

/**
 * Pure dirty-detection helpers for Excel (Fortune Sheet).
 *
 * Fortune fires `onChange` for selection/focus/layout churn after load and on
 * plain cell clicks. We fingerprint document *content* only so the tab dirty
 * dot appears solely for real edits.
 */

/** UI / layout fields that must not mark the workbook dirty. */
const VOLATILE_SHEET_KEYS = new Set([
  'luckysheet_select_save',
  'luckysheet_selection_range',
  'jfgird_select_save',
  'scrollLeft',
  'scrollTop',
  'visibledatarow',
  'visibledatacolumn',
  'ch_width',
  'rh_height',
  'zoomRatio',
  'showGridLines',
  // Active sheet highlight — switching sheets is not an edit.
  'status',
  'luckysheet_conditionformat_save',
  'luckysheet_alternateformat_save',
  'luckysheet_chart_active',
  'freezen',
])

function matrixToCelldata(data: CellMatrix | undefined): NonNullable<Sheet['celldata']> {
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

/** Drop undefined keys so {} and missing fields compare equal. */
function stabilizeJson(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stabilizeJson)
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as object).sort()) {
    const entry = (value as Record<string, unknown>)[key]
    if (entry === undefined) continue
    out[key] = stabilizeJson(entry)
  }
  return out
}

function normalizeCellValue(cell: Cell | undefined | null): unknown {
  if (cell == null) return null
  // Keep formula / display / style fields that constitute document content.
  const {
    v, m, f, ct, bg, ff, fc, bl, it, fs, cl, un, vt, ht, tb, tr, rt, mc, qp,
  } = cell as Cell & Record<string, unknown>
  return stabilizeJson({
    v: v ?? null,
    m: m ?? null,
    f: f ?? null,
    ct: ct ?? null,
    bg: bg ?? null,
    ff: ff ?? null,
    fc: fc ?? null,
    bl: bl ?? null,
    it: it ?? null,
    fs: fs ?? null,
    cl: cl ?? null,
    un: un ?? null,
    vt: vt ?? null,
    ht: ht ?? null,
    tb: tb ?? null,
    tr: tr ?? null,
    rt: rt ?? null,
    mc: mc ?? null,
    qp: qp ?? null,
  })
}

function normalizeCells(sheet: Sheet): unknown[] {
  const raw = sheet.celldata?.length
    ? sheet.celldata
    : matrixToCelldata(sheet.data)
  return [...(raw || [])]
    .map((cell) => ({
      r: cell.r,
      c: cell.c,
      v: normalizeCellValue(cell.v),
    }))
    .sort((a, b) => (a.r - b.r) || (a.c - b.c))
}

/**
 * Content fingerprint for a Fortune workbook snapshot.
 * Selection / scroll / active-sheet UI state is excluded.
 */
export function fingerprintExcelSheets(sheets: readonly Sheet[] | null | undefined): string {
  if (!sheets?.length) return '[]'
  const payload = sheets.map((sheet, order) => {
    const record = sheet as Sheet & Record<string, unknown>
    const contentExtras: Record<string, unknown> = {}
    for (const key of [
      'config',
      'calcChain',
      'images',
      'chart',
      'hyperlink',
      'filter',
      'dataVerification',
      'pivotTable',
      'isPivotTable',
    ]) {
      if (record[key] !== undefined) contentExtras[key] = record[key]
    }
    // Explicitly skip volatile keys even if they appear on the object.
    for (const volatile of VOLATILE_SHEET_KEYS) {
      delete contentExtras[volatile]
    }
    return stabilizeJson({
      name: sheet.name ?? `Sheet${order + 1}`,
      id: sheet.id ?? `order_${order}`,
      order: sheet.order ?? order,
      row: sheet.row ?? null,
      column: sheet.column ?? null,
      cells: normalizeCells(sheet),
      ...contentExtras,
    })
  })
  return JSON.stringify(payload)
}

export function excelSheetsContentEqual(
  a: readonly Sheet[] | null | undefined,
  b: readonly Sheet[] | null | undefined,
): boolean {
  return fingerprintExcelSheets(a) === fingerprintExcelSheets(b)
}
