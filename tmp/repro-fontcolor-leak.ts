import * as core from '@fortune-sheet/core'
import type { Cell, Context, Sheet } from '@fortune-sheet/core'

const { api, defaultContext, getFlowdata, getSheetIndex, updateFormat } = core as any

function buildSheet(name: string, id: string, order: number, status: number): Sheet {
  const celldata: NonNullable<Sheet['celldata']> = []
  const value = name === 'A' ? 'hello' : 'world'
  celldata.push({ r: 0, c: 0, v: { v: value, m: value, fc: '#000000', ff: 'Segoe UI', fs: 11, ct: { fa: 'General', t: 'g' } } })
  celldata.push({ r: 1, c: 1, v: { v: 42, m: '42', ct: { fa: 'General', t: 'n' } } })
  return { name, id, order, status, row: 60, column: 40, celldata }
}

function initContext(sheets: Sheet[]): Context {
  const refs = { globalCache: {}, cellInput: { current: null }, fxInput: { current: null }, canvas: { current: null }, scrollbarX: { current: null }, scrollbarY: { current: null }, cellArea: { current: null }, workbookContainer: { current: null } }
  const ctx: Context = defaultContext(refs as any) as Context
  ctx.luckysheetfile = sheets as any
  ctx.currentSheetId = sheets[0].id as string
  // replicate initSheetData: celldata -> data matrix
  for (const sheet of sheets as any[]) {
    const lastRow = sheet.celldata.length ? Math.max(...sheet.celldata.map((d: any) => d.r)) + 1 : 0
    const lastCol = sheet.celldata.length ? Math.max(...sheet.celldata.map((d: any) => d.c)) + 1 : 0
    const rows = Math.max(lastRow, sheet.row, 60)
    const cols = Math.max(lastCol, sheet.column, 40)
    const data = new Array(rows).fill(0).map(() => new Array(cols).fill(null))
    for (const d of sheet.celldata) data[d.r][d.c] = d.v
    sheet.data = data
    delete sheet.celldata
  }
  ctx.luckysheet_select_save = [{ row: [0, 0], column: [0, 0], row_focus: 0, column_focus: 0 }]
  ctx.luckysheetCellUpdate = []
  ctx.config = (sheets[0] as any).config || {}
  ctx.currentSheetId = sheets[0].id as string
  return ctx
}

function snapshot(ctx: Context): string {
  const out: string[] = []
  for (const sheet of ctx.luckysheetfile as any[]) {
    const cell = sheet.data[0]?.[0]
    out.push(`${sheet.name}: ${JSON.stringify(cell)}`)
  }
  return out.join('\n')
}

function main() {
  const sheets = [buildSheet('SheetA', 'a', 0, 1), buildSheet('SheetB', 'b', 1, 0)]
  const ctx = initContext(sheets)

  console.log('=== BEFORE ===')
  console.log(snapshot(ctx))

  // --- Path 1: Fortune toolbar setAttr('fc', color) on active sheet A ---
  updateFormat(ctx, null, getFlowdata(ctx), 'fc', '#f00f00', undefined)
  console.log('=== AFTER Fortune updateFormat (active A) ===')
  console.log(snapshot(ctx))

  // --- Path 2: ExcelEditor fallback setCellFormatByRange on selection ---
  const sel = [{ row: [0, 0], column: [0, 0] }]
  api.setCellFormatByRange(ctx, 'fc', '#ff0000', sel as any, {})
  console.log('=== AFTER api.setCellFormatByRange (active A) ===')
  console.log(snapshot(ctx))

  // --- Path 3: switch to sheet B then run the same calls again (simulating late recipe) ---
  ctx.currentSheetId = 'b'
  ctx.luckysheet_select_save = [{ row: [0, 0], column: [0, 0], row_focus: 0, column_focus: 0 }]
  updateFormat(ctx, null, getFlowdata(ctx), 'fc', '#f00f00', undefined)
  api.setCellFormatByRange(ctx, 'fc', '#ff0000', sel as any, {})
  console.log('=== AFTER switching to B and repeating ===')
  console.log(snapshot(ctx))

  // --- Path 4: does setCellFormatByRange on B's selection touch A? ---
  const selB = [{ row: [5, 5], column: [5, 5] }]
  api.setCellFormatByRange(ctx, 'fc', '#00ff00', selB as any, {})
  console.log('=== AFTER setCellFormatByRange B5 ===')
  console.log(snapshot(ctx))
  console.log('B5 fc =', ctx.luckysheetfile[1].data[5]?.[5]?.fc)
}

main()
