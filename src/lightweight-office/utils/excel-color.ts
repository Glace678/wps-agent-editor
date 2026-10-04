import type { WorkbookInstance } from '@fortune-sheet/react'
import type { Cell } from '@fortune-sheet/core'
import {
  EXCEL_BG_COLOR_LABEL_RE,
  EXCEL_FONT_COLOR_LABEL_RE,
} from './excel-picker-labels'

export type ExcelSelection = NonNullable<ReturnType<WorkbookInstance['getSelection']>>
export type ExcelFontColorCommand = { color: string | undefined }

export type ExcelFontColorTarget = {
  sheetId?: string
  selection: ExcelSelection
}

export function isAuthoredExcelCellColor(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isImplicitFortuneFontColor(value: unknown) {
  if (!isAuthoredExcelCellColor(value)) return true
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '')
  return normalized === 'rgb(51,51,51)' || normalized === 'rgba(51,51,51,1)'
}

export function isExcelFontColorCombo(container: Element | null): boolean {
  if (!(container instanceof HTMLElement)) return false
  const button = container.querySelector<HTMLElement>('.fortune-toolbar-combo-button')
  const icon = button?.querySelector('use')
  const iconHref = icon?.getAttribute('href') || icon?.getAttribute('xlink:href') || ''
  if (iconHref.endsWith('#font-color')) return true

  const label = [button?.getAttribute('aria-label'), button?.dataset.tips]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
  return EXCEL_FONT_COLOR_LABEL_RE.test(label)
}

export function isExcelBgColorCombo(container: Element | null): boolean {
  if (!(container instanceof HTMLElement)) return false
  const button = container.querySelector<HTMLElement>('.fortune-toolbar-combo-button')
  const icon = button?.querySelector('use')
  const iconHref = icon?.getAttribute('href') || icon?.getAttribute('xlink:href') || ''
  if (iconHref.endsWith('#background')) return true

  const label = [button?.getAttribute('aria-label'), button?.dataset.tips]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
  return EXCEL_BG_COLOR_LABEL_RE.test(label)
}

export function isExcelColorCombo(container: Element | null): boolean {
  return isExcelFontColorCombo(container) || isExcelBgColorCombo(container)
}

export function getExcelFontColorCombo(target: Element): HTMLElement | null {
  const container = target.closest<HTMLElement>('.fortune-toobar-combo-container')
  return container && isExcelFontColorCombo(container) ? container : null
}

export function isExcelFontColorPickerTrigger(target: Element) {
  return getExcelFontColorCombo(target) !== null
    && target.closest('.fortune-toolbar-combo-button, .fortune-toolbar-combo-arrow, .fortune-toolbar-combo') !== null
}

export function normalizeExcelToolbarColor(value: string | null | undefined): string | undefined {
  const color = value?.trim().toLowerCase()
  if (!color) return undefined
  if (/^#[0-9a-f]{6}$/.test(color)) return color
  if (/^#[0-9a-f]{3}$/.test(color)) {
    return `#${[...color.slice(1)].map((channel) => channel.repeat(2)).join('')}`
  }

  const channels = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
    return undefined
  }
  return `#${channels
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'))
    .join('')}`
}

export function getExcelFontColorCommand(target: Element): ExcelFontColorCommand | null {
  const combo = getExcelFontColorCombo(target)
  const popup = target.closest('.fortune-toolbar-combo-popup')
  if (!combo || !popup || !combo.contains(popup)) return null

  const swatch = target.closest<HTMLElement>('.fortune-toolbar-color-picker-item')
  if (swatch) {
    const color = normalizeExcelToolbarColor(swatch.style.backgroundColor)
    return color ? { color } : null
  }
  if (target.closest('#fortune-custom-color .color-reset, .excel-color-reset-btn')) return { color: undefined }
  if (target.closest('#fortune-custom-color .button-primary, .excel-color-confirm-btn')) {
    const customPicker = popup.querySelector<HTMLElement>('.excel-circular-color-picker')
    const selectedColor = customPicker?.dataset.selectedColor
    const input = popup.querySelector<HTMLInputElement>('#fortune-custom-color input[type="color"]')
    const color = normalizeExcelToolbarColor(selectedColor || input?.value)
    return color ? { color } : null
  }
  return null
}

export function cloneExcelSelection(selection: ExcelSelection): ExcelSelection {
  return selection.map((range) => ({
    row: [...range.row],
    column: [...range.column],
  }))
}

export function excelSelectionsEqual(
  left: ExcelSelection | undefined,
  right: ExcelSelection | undefined,
) {
  if (!left || !right || left.length !== right.length) return false
  return left.every((leftRange, index) => {
    const rightRange = right[index]
    return leftRange.row[0] === rightRange.row[0]
      && leftRange.row[1] === rightRange.row[1]
      && leftRange.column[0] === rightRange.column[0]
      && leftRange.column[1] === rightRange.column[1]
  })
}

export function getExcelSheet(api: WorkbookInstance, sheetId?: string) {
  try {
    return api.getSheet(sheetId ? { id: sheetId } : undefined)
  } catch {
    return null
  }
}

export function getActiveExcelFontColorTarget(api: WorkbookInstance): ExcelFontColorTarget | null {
  const selection = api.getSelection()
  if (!selection?.length) return null
  return {
    sheetId: getExcelSheet(api)?.id,
    selection: cloneExcelSelection(selection),
  }
}

export function comparableExcelColor(value: unknown): string | null {
  if (!isAuthoredExcelCellColor(value)) return null
  return normalizeExcelToolbarColor(value) ?? value.trim().toLowerCase()
}

export function getExcelCellFromSheet(
  api: WorkbookInstance,
  row: number,
  column: number,
  sheetId?: string,
) {
  return getExcelSheet(api, sheetId)?.data?.[row]?.[column] ?? null
}

export function excelSelectionUsesFontColor(
  api: WorkbookInstance,
  target: ExcelFontColorTarget,
  color: string | undefined,
) {
  const expected = comparableExcelColor(color)
  const { selection, sheetId } = target
  for (const range of selection) {
    for (let row = range.row[0]; row <= range.row[1]; row += 1) {
      for (let column = range.column[0]; column <= range.column[1]; column += 1) {
        const cell = getExcelCellFromSheet(api, row, column, sheetId)
        if (comparableExcelColor(cell?.fc) !== expected) {
          return false
        }
        const ct = cell?.ct
        if (ct?.t === 'inlineStr' && Array.isArray(ct.s)) {
          for (const run of ct.s) {
            if (run && typeof run === 'object' && comparableExcelColor(run.fc) !== expected) {
              return false
            }
          }
        }
      }
    }
  }
  return true
}

export function applyExcelFontColorToSelection(
  api: WorkbookInstance,
  target: ExcelFontColorTarget,
  color: string | undefined,
) {
  const { selection, sheetId } = target
  const sheetOption = sheetId ? { id: sheetId } : undefined
  const calls: Parameters<WorkbookInstance['batchCallApis']>[0] = [{
    name: 'setCellFormatByRange',
    args: sheetOption
      ? ['fc', color, selection, sheetOption]
      : ['fc', color, selection],
  }]

  for (const range of selection) {
    for (let row = range.row[0]; row <= range.row[1]; row += 1) {
      for (let column = range.column[0]; column <= range.column[1]; column += 1) {
        const ct = getExcelCellFromSheet(api, row, column, sheetId)?.ct
        if (ct?.t !== 'inlineStr' || !Array.isArray(ct.s)) continue
        calls.push({
          name: 'setCellFormat',
          args: [row, column, 'ct', {
            ...ct,
            fa: ct.fa || 'General',
            s: ct.s.map((run: unknown) => (
              run && typeof run === 'object' ? { ...run, fc: color } : run
            )),
          }, ...(sheetOption ? [sheetOption] : [])],
        })
      }
    }
  }

  api.batchCallApis(calls)
}

export function isExcelInlineStringCell(cell: Cell | null | undefined) {
  return cell?.ct?.t === 'inlineStr' && Array.isArray(cell.ct.s) && cell.ct.s.length > 0
}

export function scheduleExcelCanvasRefresh() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'))
    })
  })
}

export function resolveExcelCellEditorColors(
  cell: Pick<Cell, 'bg' | 'fc'> | null,
  darkMode: boolean,
) {
  const hasBackground = isAuthoredExcelCellColor(cell?.bg)
  const hasFontColor = !isImplicitFortuneFontColor(cell?.fc)
  return {
    background: hasBackground ? cell!.bg!.trim() : darkMode ? '#000000' : '#ffffff',
    foreground: hasFontColor
      ? cell!.fc!.trim()
      : hasBackground
        ? '#000000'
        : darkMode
          ? '#f5f5f5'
          : '#000000',
  }
}
