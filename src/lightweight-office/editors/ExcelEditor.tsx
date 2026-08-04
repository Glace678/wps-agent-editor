import { useCallback, useEffect, useRef, useState } from 'react'
import { Workbook } from '@fortune-sheet/react'
import type { WorkbookInstance } from '@fortune-sheet/react'
import type { Cell, Sheet } from '@fortune-sheet/core'
import { useTranslation } from '@/lib/i18n/runtime'
import { documentBridge } from '../agent/document-bridge'
import { readFileBuffer, saveFileBuffer } from '../utils/file-io'
import { configureFortuneRendering } from '../utils/fortune-rendering'
import {
  excelSheetsShareContentReferences,
  fingerprintExcelSheets,
} from '../utils/excel-dirty'
import {
  DEFAULT_SPREADSHEET_FONT_SIZE,
  sheetsToXlsxBuffer,
  xlsxBufferToSheets,
} from '../utils/xlsx-convert'
import {
  createFallbackSystemFontFaces,
  loadSystemFontFaces,
  normalizeSystemFontFamilyName,
  type SystemFontFace,
} from '../utils/system-fonts'
import { decorateExcelToolbarShortcuts } from '../utils/excel-toolbar-shortcuts'
import { attachExcelLiveResize, type FortuneWorkbookApiLike } from '../utils/excel-live-resize'
import { attachExcelFrameScroll } from '../utils/excel-frame-scroll'

configureFortuneRendering()

interface ExcelEditorProps {
  filePath: string
  onReady: () => void
  onDirty: () => void
  onSaveSuccess: () => void
  onRegisterSave: (fn: (() => Promise<void>) | null) => void
}

type ExcelToolbarPickerKind = 'font' | 'font-size' | 'format'

const EXCEL_FONT_SIZE_MIN = 1
const EXCEL_FONT_SIZE_MAX = 409
const DIRTY_CHECK_SETTLE_MS = 120

// Localized Windows font names are what Excel displays, while users often
// search with the corresponding internal English name. Keep both searchable.
// Unicode escapes keep Chinese aliases correct regardless of file encoding.
const EXCEL_FONT_SEARCH_ALIASES_FOR_PICKER: Record<string, string[]> = {
  simsun: ['songti', '\u5b8b\u4f53'],
  nsimsun: ['xinsongti', '\u65b0\u5b8b\u4f53'],
  fangsong: ['fang song', '\u4eff\u5b8b'],
  kaiti: ['kai ti', '\u6977\u4f53'],
  simhei: ['hei ti', '\u9ed1\u4f53'],
  dengxian: ['deng xian', '\u7b49\u7ebf'],
  microsoftyahei: ['yahei', '\u5fae\u8f6f\u96c5\u9ed1'],
  microsoftyaheiui: ['yahei ui', '\u5fae\u8f6f\u96c5\u9ed1 UI'],
}

/** Fortune toolbar tips for font size (en / zh / es / ru / hi / zh-TW, plus app langs). */
const EXCEL_FONT_SIZE_LABEL_RE =
  /font\s*[- ]?\s*size|\btama[nñ]o\s*(de\s*)?fuente\b|\btama[nñ]o\s*fuente\b|размер\s*шрифта|шрифта\s*размер|फ़ॉन्ट\s*साइज़|\u5b57\u53f7|\u5b57\u865f|\u5b57\u4f53\u5927\u5c0f|\u5b57\u9ad4\u5927\u5c0f|\u5b57\u578b\u5927\u5c0f|schriftgr[oö]ße|taille\s*(de\s*)?(la\s*)?police|tamanho\s*(da\s*)?fonte|フォント\s*サイズ|حجم\s*الخط/

/** Fortune toolbar tips for font family (size/color already filtered above).
 * JS \b is ASCII-only — a Cyrillic token wrapped in \b can never match, so
 * шрифт / формат must stay bare substrings. */
const EXCEL_FONT_LABEL_RE =
  /\bfont\b|\bfuente\b|шрифт|फ़ॉन्ट|\u5b57\u4f53|\u5b57\u9ad4|\bschriftart\b|\bpolice\b|\bfonte\b|フォント|الخط/

const EXCEL_FONT_COLOR_LABEL_RE =
  /font[\s-]*colou?r|text[\s-]*colou?r|\u6587\u672c\u989c\u8272|\u5b57\u4f53\u989c\u8272|\u6587\u5b57\u984f\u8272|\u5b57\u9ad4\u984f\u8272|color\s*(?:de\s*)?(?:texto|fuente)|цвет\s*шрифта/

/** Fortune toolbar tips for cell number format (格式 / Format / …). */
const EXCEL_FORMAT_LABEL_RE =
  /\bformat(?:o|ear)?\b|\bformatear\b|формат|\u683c\u5f0f|प्रारूप|फॉर्मेट|書式|تنسيق/

/** Typical format-list option labels (locale-independent heuristic).
 * Covers the Fortune workbook locales (en / zh / es / ru). */
const EXCEL_FORMAT_OPTION_HINT_RE =
  /automatic|general|plain\s*text|percent|scientific|accounting|currency|custom\s*format|date\s*time|number|\u0430\u0432\u0442\u043e\u043c\u0430\u0442|\u043e\u0431\u044b\u0447\u043d\u044b\u0439\s*\u0442\u0435\u043a\u0441\u0442|\u0447\u0438\u0441\u043b\u043e\u0432|\u043f\u0440\u043e\u0446\u0435\u043d\u0442|\u0432\u0430\u043b\u044e\u0442|\u0434\u0430\u0442\u0430|\u0432\u0440\u0435\u043c\u044f|\u0444\u0438\u043d\u0430\u043d\u0441\u043e\u0432|\u0431\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440|\u0444\u043e\u0440\u043c\u0430\u0442|personalizado|contabilidad|moneda|fecha|porcentaje|cient[i\u00ed]fico|\u81ea\u52a8|\u5e38\u89c4|\u6587\u672c|\u6570\u5b57|\u767e\u5206\u6bd4|\u79d1\u5b66|\u4f1a\u8ba1|\u8d27\u5e01|\u65e5\u671f|\u65f6\u95f4|\u81ea\u5b9a\u4e49/

function normalizeExcelPickerSearchText(value: string) {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/[\s'"_-]+/g, '')
    .toLocaleLowerCase()
}

interface ExcelPickerCopy {
  placeholder: string
  empty: string
  invalid: string
}

function getExcelPickerCopyForPicker(
  kind: ExcelToolbarPickerKind,
  language: string,
  placeholders: {
    font: string
    fontSize: string
    format: string
  },
): ExcelPickerCopy {
  const isZh = language === 'zh-CN'

  if (kind === 'font') {
    return {
      placeholder: placeholders.font,
      empty: isZh
        ? '\u6ca1\u6709\u5339\u914d\u7684\u5b57\u4f53\uff0c\u6309 Enter \u4f7f\u7528\u8f93\u5165\u7684\u5b57\u4f53'
        : 'No matching font. Press Enter to use the typed font.',
      invalid: '',
    }
  }

  if (kind === 'font-size') {
    return {
      placeholder: placeholders.fontSize,
      empty: isZh
        ? `\u8bf7\u8f93\u5165 ${EXCEL_FONT_SIZE_MIN} \u5230 ${EXCEL_FONT_SIZE_MAX} \u4e4b\u95f4\u7684\u5b57\u53f7`
        : `Enter a size from ${EXCEL_FONT_SIZE_MIN} to ${EXCEL_FONT_SIZE_MAX}.`,
      invalid: isZh
        ? `\u5b57\u53f7\u9700\u4ecb\u4e8e ${EXCEL_FONT_SIZE_MIN} \u548c ${EXCEL_FONT_SIZE_MAX} \u4e4b\u95f4`
        : `Font size must be from ${EXCEL_FONT_SIZE_MIN} to ${EXCEL_FONT_SIZE_MAX}.`,
    }
  }

  // format
  return {
    placeholder: placeholders.format,
    empty: isZh
      ? '\u6ca1\u6709\u5339\u914d\u7684\u683c\u5f0f'
      : 'No matching format.',
    invalid: '',
  }
}

/**
 * Identify font / font-size / format combo popups across Fortune locales.
 * Label match covers en/zh/es/ru/hi (+ app UI langs). Option heuristics
 * recover when aria-label is missing or localized in an unexpected form.
 */
function getExcelToolbarPickerKindForPicker(
  popup: HTMLElement,
): ExcelToolbarPickerKind | null {
  const container = popup.closest<HTMLElement>('.fortune-toobar-combo-container')
  const button = container?.querySelector<HTMLElement>('.fortune-toolbar-combo-button')
  const label = [button?.getAttribute('aria-label'), button?.dataset.tips]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()

  // Font color / other non-list combos must not get a search field.
  if (EXCEL_FONT_COLOR_LABEL_RE.test(label)) {
    return null
  }

  if (EXCEL_FONT_SIZE_LABEL_RE.test(label)) return 'font-size'
  if (EXCEL_FORMAT_LABEL_RE.test(label)) return 'format'
  if (EXCEL_FONT_LABEL_RE.test(label)) return 'font'

  const options = [...popup.querySelectorAll<HTMLElement>('.fortune-toolbar-select-option')]
  if (options.length === 0) return null

  const texts = options.map((option) => option.textContent?.trim() || '').filter(Boolean)
  if (texts.length === 0) return null

  // Pure numeric lists are font sizes (8, 9, 10, 11…).
  if (texts.every((text) => /^\d+(?:\.\d+)?$/.test(text))) return 'font-size'

  // Number-format menus mix tokens like "Automatic" / "##0.00" / "Custom formats".
  const looksLikeFormatList =
    texts.length >= 6
    && texts.length <= 40
    && texts.some((text) => EXCEL_FORMAT_OPTION_HINT_RE.test(text.toLocaleLowerCase()))
  if (looksLikeFormatList) return 'format'

  // Font lists are long and mostly non-numeric family names (Arial, 微软雅黑…).
  const nonNumeric = texts.filter((text) => !/^\d+(?:\.\d+)?%?$/.test(text))
  const looksLikeFontList =
    texts.length >= 8
    && nonNumeric.length >= Math.max(6, Math.floor(texts.length * 0.7))
    && nonNumeric.some((text) => /[A-Za-z\u4e00-\u9fff\u3040-\u30ff\u0400-\u04ff]/.test(text))

  if (looksLikeFontList) return 'font'
  return null
}

// Match CSS: .excel-toolbar-picker-search padding 10px L/R
const EXCEL_PICKER_HEADER_PAD_X = 20
// Match CSS: .excel-toolbar-picker-search-input padding 8px L/R + 1px border ×2
const EXCEL_PICKER_INPUT_PAD_X = 16
const EXCEL_PICKER_INPUT_BORDER_X = 2
// Match Fortune: .fortune-toolbar-select-option padding 8px 12px → 12+12
const EXCEL_PICKER_OPTION_PAD_X = 24
// Font-size options are 1–2 digits; use tighter side pad for that column only.
const EXCEL_FONT_SIZE_OPTION_PAD_X = 16
// Submenu rows ("Custom formats ▸"): label plus the 14px flyout arrow + gap.
const EXCEL_PICKER_SUBMENU_ARROW_X = 22
// 1px safety against sub-pixel rounding — do NOT pad extra (causes trailing black strip).
const EXCEL_PICKER_SNAP = 1

/** Per-picker size clamps (font-size must stay compact). */
const EXCEL_PICKER_WIDTH_LIMITS: Record<
  ExcelToolbarPickerKind,
  { min: number, max: number }
> = {
  font: { min: 160, max: 520 },
  // Digits + short localized hint only — never as wide as the font menu.
  'font-size': { min: 56, max: 168 },
  // Real rows peak around ~260px (visible label metrics); 320 is a guard only.
  format: { min: 120, max: 320 },
}

/**
 * Language + kind width strategy (not one global algorithm).
 *
 * - list:        drive width from the longest list label (short UI languages)
 * - placeholder: drive width from the search hint (long translated hints)
 * - max:         take the larger of the two (font inventory / mixed format lists)
 */
type ExcelPickerWidthStrategy = 'list' | 'placeholder' | 'max'

function isCjkUiLanguage(language: string): boolean {
  return language === 'zh-CN' || language === 'ja'
}

function isLongHintLanguage(language: string): boolean {
  return language === 'pt'
    || language === 'es'
    || language === 'fr'
    || language === 'de'
    || language === 'ru'
    || language === 'ar'
}

function resolveExcelPickerWidthStrategy(
  kind: ExcelToolbarPickerKind,
  language: string,
  placeholderWidth: number,
  longestLabelWidth: number,
): ExcelPickerWidthStrategy {
  // --- Font size: options are only short numbers (9…72). ---
  // Always hug the placeholder; list never expands the panel (digits << hint).
  // CJK short hints ("字号" / "サイズ") → still placeholder-driven, stays narrow.
  // Long-hint languages → placeholder-driven with a hard max clamp above.
  if (kind === 'font-size') {
    return 'placeholder'
  }

  // --- Format: short CJK labels → list; long Western hints → placeholder. ---
  if (kind === 'format') {
    if (isCjkUiLanguage(language)) {
      return longestLabelWidth >= placeholderWidth ? 'list' : 'placeholder'
    }
    if (isLongHintLanguage(language) && placeholderWidth >= longestLabelWidth) {
      return 'placeholder'
    }
    return 'max'
  }

  // --- Font family: list is the scanned system font inventory. ---
  // (a) short placeholder (zh/ja/en-short) → longest font name
  // (b) long placeholder (pt/es/fr/…) → placeholder text
  if (isCjkUiLanguage(language)) {
    return longestLabelWidth >= placeholderWidth ? 'list' : 'placeholder'
  }
  if (isLongHintLanguage(language) && placeholderWidth > longestLabelWidth) {
    return 'placeholder'
  }
  // en and mixed: classic max so neither clips
  return 'max'
}

/**
 * Collect display labels from the scanned system font inventory.
 * Prefer localized displayName (what the Excel list shows) over familyName.
 */
function collectSystemFontDisplayNames(fontFaces: SystemFontFace[]): string[] {
  const names = new Set<string>()
  for (const face of fontFaces) {
    const displayName = face.displayName.trim()
    const familyName = face.familyName.trim()
    if (displayName) names.add(displayName)
    if (familyName) names.add(familyName)
  }
  return [...names]
}

/**
 * Measure text with a real DOM node using the same font metrics as the search
 * input / option list (more accurate than canvas for CJK / localized UI fonts).
 */
function measureExcelPickerTextWidth(
  text: string,
  reference: HTMLElement,
  fontSize = '12px',
): number {
  if (!text) return 0
  const style = window.getComputedStyle(reference)
  const probe = document.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  probe.textContent = text
  probe.style.cssText = [
    'position:absolute',
    'left:-99999px',
    'top:0',
    'visibility:hidden',
    'pointer-events:none',
    'white-space:nowrap',
    `font-style:${style.fontStyle || 'normal'}`,
    `font-weight:${style.fontWeight || '400'}`,
    `font-size:${fontSize}`,
    `font-family:${style.fontFamily || "'Segoe UI','Microsoft YaHei UI',Arial,sans-serif"}`,
    `letter-spacing:${style.letterSpacing || 'normal'}`,
    'padding:0',
    'margin:0',
    'border:0',
  ].join(';')
  document.body.appendChild(probe)
  const width = Math.ceil(probe.getBoundingClientRect().width)
  probe.remove()
  return width
}

/**
 * Size a toolbar search picker by kind + language strategy.
 * Text width is measured from the actual label strings — never from
 * option.scrollWidth (that inherits a bloated parent width and stretches
 * the font-size menu).
 */
function fitExcelToolbarPickerWidth(
  popup: HTMLElement,
  select: HTMLElement,
  input: HTMLInputElement,
  placeholder: string,
  kind: ExcelToolbarPickerKind,
  language: string,
  extraLabels: string[] = [],
) {
  const limits = EXCEL_PICKER_WIDTH_LIMITS[kind]
  const optionPad = kind === 'font-size'
    ? EXCEL_FONT_SIZE_OPTION_PAD_X
    : EXCEL_PICKER_OPTION_PAD_X

  const placeholderWidth = measureExcelPickerTextWidth(placeholder, input)

  // Pure text metrics only (no scrollWidth — it mirrors the current panel width).
  let longestLabelWidth = 0
  let longestLabel = ''
  const considerName = (name: string, trailingWidth = 0) => {
    if (!name) return
    const textWidth = measureExcelPickerTextWidth(name, input) + trailingWidth
    if (textWidth > longestLabelWidth) {
      longestLabelWidth = textWidth
      longestLabel = name
    }
  }

  for (const name of extraLabels) considerName(name)
  for (const option of select.querySelectorAll<HTMLElement>('.fortune-toolbar-select-option')) {
    // Options inside a collapsed flyout ("More formats") size that flyout, not
    // this popup — and their host row's textContent would concatenate every
    // nested label into one bogus extra-wide line.
    if (option.closest('.toolbar-item-sub-menu')) continue
    const menuLine = option.querySelector<HTMLElement>('.fortune-toolbar-menu-line')
    if (menuLine) {
      considerName(menuLine.textContent?.trim() || '', EXCEL_PICKER_SUBMENU_ARROW_X)
      continue
    }
    considerName(option.textContent?.trim() || '')
  }

  const widthForPlaceholder =
    placeholderWidth
    + EXCEL_PICKER_INPUT_PAD_X
    + EXCEL_PICKER_INPUT_BORDER_X
    + EXCEL_PICKER_HEADER_PAD_X
    + EXCEL_PICKER_SNAP

  const widthForLongestLabel =
    longestLabelWidth
    + optionPad
    + EXCEL_PICKER_SNAP

  const strategy = resolveExcelPickerWidthStrategy(
    kind,
    language,
    placeholderWidth,
    longestLabelWidth,
  )

  let raw: number
  if (strategy === 'placeholder') {
    raw = widthForPlaceholder
  } else if (strategy === 'list') {
    // Still never clip the placeholder — list mode only means list is preferred
    // when it is already the wider signal.
    raw = Math.max(widthForLongestLabel, widthForPlaceholder)
  } else {
    raw = Math.max(widthForPlaceholder, widthForLongestLabel)
  }

  const viewportCap = Math.max(limits.min, Math.floor(window.innerWidth * 0.92))
  const width = Math.max(limits.min, Math.min(raw, limits.max, viewportCap))

  // Override Fortune's nowrap expansion so our text-based width sticks.
  popup.style.whiteSpace = 'normal'
  popup.style.minWidth = `${width}px`
  popup.style.width = `${width}px`
  popup.style.maxWidth = `${width}px`
  popup.style.boxSizing = 'border-box'
  popup.style.overflow = 'hidden'
  select.style.minWidth = '100%'
  select.style.width = '100%'
  select.style.maxWidth = '100%'
  select.style.boxSizing = 'border-box'
  input.style.width = '100%'
  input.style.maxWidth = '100%'
  input.style.boxSizing = 'border-box'

  if (longestLabel) {
    popup.dataset.excelPickerLongestLabel = longestLabel
  }
  popup.dataset.excelPickerWidthStrategy = strategy
  popup.dataset.excelPickerWidthMode = strategy
  popup.dataset.excelPickerContentWidth = String(width)
  popup.dataset.excelPickerLanguage = language
}

function parseExcelFontSizeForPicker(value: string): number | null {
  const normalized = value.trim().replace(/\s*(?:pt|\u78c5)\s*$/i, '')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null

  const size = Number(normalized)
  if (!Number.isFinite(size) || size < EXCEL_FONT_SIZE_MIN || size > EXCEL_FONT_SIZE_MAX) {
    return null
  }

  return Math.round(size * 100) / 100
}

function isAuthoredExcelCellColor(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isImplicitFortuneFontColor(value: unknown) {
  if (!isAuthoredExcelCellColor(value)) return true
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '')
  return normalized === 'rgb(51,51,51)' || normalized === 'rgba(51,51,51,1)'
}

type ExcelSelection = NonNullable<ReturnType<WorkbookInstance['getSelection']>>
type ExcelFontColorCommand = { color: string | undefined }

function isExcelFontColorCombo(container: Element | null): container is HTMLElement {
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

function getExcelFontColorCombo(target: Element): HTMLElement | null {
  const container = target.closest('.fortune-toobar-combo-container')
  return isExcelFontColorCombo(container) ? container : null
}

function isExcelFontColorPickerTrigger(target: Element) {
  return getExcelFontColorCombo(target) !== null
    && target.closest('.fortune-toolbar-combo-button, .fortune-toolbar-combo-arrow') !== null
}

function normalizeExcelToolbarColor(value: string | null | undefined): string | undefined {
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

function getExcelFontColorCommand(target: Element): ExcelFontColorCommand | null {
  const combo = getExcelFontColorCombo(target)
  const mainButton = target.closest('.fortune-toolbar-combo-button')
  if (combo && mainButton) {
    const recentColor = combo.previousElementSibling
    const color = recentColor instanceof HTMLElement
      ? normalizeExcelToolbarColor(
          recentColor.style.backgroundColor || getComputedStyle(recentColor).backgroundColor,
        )
      : undefined
    return color ? { color } : null
  }

  const popup = target.closest('.fortune-toolbar-combo-popup')
  if (!combo || !popup || !combo.contains(popup)) return null

  const swatch = target.closest<HTMLElement>('.fortune-toolbar-color-picker-item')
  if (swatch) {
    const color = normalizeExcelToolbarColor(swatch.style.backgroundColor)
    return color ? { color } : null
  }
  if (target.closest('#fortune-custom-color .color-reset')) return { color: undefined }
  if (target.closest('#fortune-custom-color .button-primary')) {
    const input = popup.querySelector<HTMLInputElement>('#fortune-custom-color input[type="color"]')
    const color = normalizeExcelToolbarColor(input?.value)
    return color ? { color } : null
  }
  return null
}

function isExcelCellEditorActiveWithoutSelection(shell: HTMLElement) {
  const editor = shell.querySelector<HTMLElement>('.luckysheet-input-box-inner')
  const box = editor?.closest<HTMLElement>('#luckysheet-input-box')
  if (!editor || !box) return false
  const style = getComputedStyle(box)
  if (style.display === 'none' || style.visibility === 'hidden' || box.getClientRects().length === 0) {
    return false
  }
  const editorZIndex = Number.parseInt(style.zIndex, 10)
  if (!Number.isFinite(editorZIndex) || editorZIndex < 0) return false

  const selection = window.getSelection()
  const hasSelectedEditorText = Boolean(
    selection
      && !selection.isCollapsed
      && selection.anchorNode
      && selection.focusNode
      && editor.contains(selection.anchorNode)
      && editor.contains(selection.focusNode),
  )
  return !hasSelectedEditorText
}

function cloneExcelSelection(selection: ExcelSelection): ExcelSelection {
  return selection.map((range) => ({
    row: [...range.row],
    column: [...range.column],
  }))
}

function comparableExcelColor(value: unknown): string | null {
  if (!isAuthoredExcelCellColor(value)) return null
  return normalizeExcelToolbarColor(value) ?? value.trim().toLowerCase()
}

function getExcelCellFromActiveSheet(api: WorkbookInstance, row: number, column: number) {
  return api.getSheet()?.data?.[row]?.[column] ?? null
}

function excelSelectionUsesFontColor(
  api: WorkbookInstance,
  selection: ExcelSelection,
  color: string | undefined,
) {
  const expected = comparableExcelColor(color)
  for (const range of selection) {
    for (let row = range.row[0]; row <= range.row[1]; row += 1) {
      for (let column = range.column[0]; column <= range.column[1]; column += 1) {
        const cell = getExcelCellFromActiveSheet(api, row, column)
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

function applyExcelFontColorToSelection(
  api: WorkbookInstance,
  selection: ExcelSelection,
  color: string | undefined,
) {
  const calls: Parameters<WorkbookInstance['batchCallApis']>[0] = [{
    name: 'setCellFormatByRange',
    args: ['fc', color, selection],
  }]

  for (const range of selection) {
    for (let row = range.row[0]; row <= range.row[1]; row += 1) {
      for (let column = range.column[0]; column <= range.column[1]; column += 1) {
        const ct = getExcelCellFromActiveSheet(api, row, column)?.ct
        if (ct?.t !== 'inlineStr' || !Array.isArray(ct.s)) continue
        calls.push({
          name: 'setCellFormat',
          args: [row, column, 'ct', {
            ...ct,
            fa: ct.fa || 'General',
            s: ct.s.map((run: unknown) => (
              run && typeof run === 'object' ? { ...run, fc: color } : run
            )),
          }],
        })
      }
    }
  }

  api.batchCallApis(calls)
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

export function ExcelEditor({ filePath, onReady, onDirty, onSaveSuccess, onRegisterSave }: ExcelEditorProps) {
  const { language, t } = useTranslation()
  const shellRef = useRef<HTMLDivElement>(null)
  const workbookRef = useRef<WorkbookInstance | null>(null)
  const readyRef = useRef(false)
  /** Ignore Fortune churn until the workbook has settled after open. */
  const suppressDirtyRef = useRef(true)
  /** Content fingerprint of the last saved / loaded workbook (not UI selection). */
  const baselineFingerprintRef = useRef('')
  const lastContentSnapshotRef = useRef<readonly Sheet[] | null>(null)
  const dirtyCheckTimerRef = useRef<number | null>(null)
  const dirtyReportedRef = useRef(false)
  const activeCellColorSyncRef = useRef<() => void>(() => {})
  const sheetsRef = useRef<Sheet[]>([])
  const onDirtyRef = useRef(onDirty)
  const onReadyRef = useRef(onReady)
  const translationRef = useRef(t)
  const [sheets, setSheets] = useState<Sheet[] | null>(null)
  const [error, setError] = useState(false)
  const [fontLibraryReady, setFontLibraryReady] = useState(false)
  const [fontFaces, setFontFaces] = useState<SystemFontFace[]>([])

  onDirtyRef.current = onDirty
  onReadyRef.current = onReady
  translationRef.current = t

  const cancelPendingDirtyCheck = useCallback(() => {
    if (dirtyCheckTimerRef.current === null) return
    window.clearTimeout(dirtyCheckTimerRef.current)
    dirtyCheckTimerRef.current = null
  }, [])

  const scheduleDirtyCheck = useCallback(() => {
    cancelPendingDirtyCheck()

    const run = () => {
      dirtyCheckTimerRef.current = null
      const resizeState = shellRef.current?.dataset.excelLiveResize
      if (resizeState && resizeState !== 'idle' && !resizeState.startsWith('rejected:')) {
        dirtyCheckTimerRef.current = window.setTimeout(run, DIRTY_CHECK_SETTLE_MS)
        return
      }
      if (suppressDirtyRef.current || dirtyReportedRef.current) return

      const nextFingerprint = fingerprintExcelSheets(sheetsRef.current)
      if (nextFingerprint === baselineFingerprintRef.current) return
      dirtyReportedRef.current = true
      onDirtyRef.current()
    }

    dirtyCheckTimerRef.current = window.setTimeout(run, DIRTY_CHECK_SETTLE_MS)
  }, [cancelPendingDirtyCheck])

  useEffect(() => () => cancelPendingDirtyCheck(), [cancelPendingDirtyCheck])

  const workbookLanguage = language === 'zh-CN'
    ? 'zh'
    : language === 'es' || language === 'ru'
      ? language
      : 'en'

  useEffect(() => {
    let cancelled = false
    const fallbackFonts = createFallbackSystemFontFaces(language)

    // Word and Notepad already use this shared, cached system-font provider.
    // Configure Fortune before mounting its toolbar so Excel receives the
    // exact same family inventory rather than its built-in short list.
    setFontLibraryReady(false)
    setFontFaces(fallbackFonts)
    configureFortuneRendering(fallbackFonts)
    void loadSystemFontFaces(language)
      .then((fontFaces) => {
        if (cancelled) return
        configureFortuneRendering(fontFaces)
        setFontFaces(fontFaces)
        setFontLibraryReady(true)
      })
      .catch(() => {
        if (cancelled) return
        configureFortuneRendering(fallbackFonts)
        setFontFaces(fallbackFonts)
        setFontLibraryReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [language])

  useEffect(() => {
    let cancelled = false
    setSheets(null)
    setError(false)
    workbookRef.current = null
    readyRef.current = false
    suppressDirtyRef.current = true
    baselineFingerprintRef.current = ''
    lastContentSnapshotRef.current = null
    dirtyReportedRef.current = false
    cancelPendingDirtyCheck()
    documentBridge.clear()

    async function load() {
      try {
        console.log('[ExcelEditor] 开始加载文件:', filePath)
        const buffer = await readFileBuffer(filePath)
        console.log('[ExcelEditor] 文件读取成功，大小:', buffer.byteLength, 'bytes')
        if (cancelled) return
        const loaded = await xlsxBufferToSheets(buffer)
        console.log('[ExcelEditor] 解析成功，工作表数:', loaded.length)
        sheetsRef.current = loaded
        lastContentSnapshotRef.current = loaded
        // Provisional baseline until Fortune expands the model after mount.
        baselineFingerprintRef.current = fingerprintExcelSheets(loaded)
        setSheets(loaded)
      } catch (err) {
        console.error('[ExcelEditor] 加载错误:', err)
        if (!cancelled) setError(true)
      }
    }

    load()
    return () => {
      cancelled = true
      documentBridge.clear()
      onRegisterSave(null)
    }
  }, [cancelPendingDirtyCheck, filePath, onRegisterSave])

  useEffect(() => {
    onRegisterSave(async () => {
      const api = workbookRef.current
      const snapshot = api?.getAllSheets?.() ?? sheetsRef.current
      sheetsRef.current = snapshot
      lastContentSnapshotRef.current = snapshot
      const buffer = await sheetsToXlsxBuffer(snapshot)
      await saveFileBuffer(filePath, buffer)
      // Saved state becomes the new clean baseline (clears the tab dirty dot).
      cancelPendingDirtyCheck()
      baselineFingerprintRef.current = fingerprintExcelSheets(snapshot)
      dirtyReportedRef.current = false
      onSaveSuccess()
    })
  }, [cancelPendingDirtyCheck, filePath, onRegisterSave, onSaveSuccess])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell || !sheets) return
    // Live content preview while dragging column/row resize handles.
    if (localStorage.getItem('wps-live-resize-disabled') === '1') return
    return attachExcelLiveResize(
      shell,
      () => workbookRef.current as FortuneWorkbookApiLike | null,
    )
    // fontLibraryReady gates the shell render: when fonts settle AFTER the
    // file parse, an effect keyed on sheets alone runs once against a null
    // shell and never re-attaches.
  }, [sheets, fontLibraryReady])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell || !sheets || !fontLibraryReady) return

    type PendingFontColorCommand = {
      color: string | undefined
      selection: ExcelSelection
    }

    let fallbackArmed = false
    let pendingCommand: PendingFontColorCommand | null = null
    const pendingTimers = new Set<number>()

    const captureCommand = (color: string | undefined): PendingFontColorCommand | null => {
      const api = workbookRef.current
      const selection = api?.getSelection()
      if (!api || !selection?.length) return null
      return { color, selection: cloneExcelSelection(selection) }
    }

    const scheduleFallback = (command: PendingFontColorCommand) => {
      const timer = window.setTimeout(() => {
        pendingTimers.delete(timer)
        const api = workbookRef.current
        if (!api) return

        // Let Fortune handle a genuine rich-text selection first. Its collapsed-
        // caret branch is a no-op, so only write the whole cell when nothing changed.
        if (!excelSelectionUsesFontColor(api, command.selection, command.color)) {
          applyExcelFontColorToSelection(api, command.selection, command.color)
        }
        activeCellColorSyncRef.current()
      }, 0)
      pendingTimers.add(timer)
    }

    const handleFontColorPointer = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return

      if (isExcelFontColorPickerTrigger(target)) {
        const editorNeedsFallback = isExcelCellEditorActiveWithoutSelection(shell)
        fallbackArmed = event.type === 'mousedown'
          ? editorNeedsFallback
          : fallbackArmed || editorNeedsFallback
        return
      }

      const command = getExcelFontColorCommand(target)
      if (command) {
        const editorNeedsFallback = fallbackArmed
          || isExcelCellEditorActiveWithoutSelection(shell)
        if (editorNeedsFallback && !pendingCommand) {
          pendingCommand = captureCommand(command.color)
        }

        if (event.type === 'click') {
          const commandToApply = pendingCommand
          pendingCommand = null
          fallbackArmed = false
          if (commandToApply) scheduleFallback(commandToApply)
        }
        return
      }

      if (event.type === 'mousedown') {
        fallbackArmed = false
        pendingCommand = null
      }
    }

    shell.addEventListener('mousedown', handleFontColorPointer, true)
    shell.addEventListener('click', handleFontColorPointer, true)

    return () => {
      shell.removeEventListener('mousedown', handleFontColorPointer, true)
      shell.removeEventListener('click', handleFontColorPointer, true)
      for (const timer of pendingTimers) window.clearTimeout(timer)
      pendingTimers.clear()
    }
  }, [sheets, fontLibraryReady])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell || !sheets) return
    if (localStorage.getItem('wps-smooth-excel-scroll-disabled') === '1') return
    return attachExcelFrameScroll(shell)
  }, [sheets, fontLibraryReady])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell || !sheets || !fontLibraryReady) return

    let syncFrame: number | null = null
    const syncActiveCellColors = () => {
      syncFrame = null
      const editor = shell.querySelector<HTMLElement>('.luckysheet-input-box-inner')
      const api = workbookRef.current
      const selection = api?.getSelection?.()?.[0]
      const row = selection?.row?.[0]
      const column = selection?.column?.[0]
      if (!editor || !api || row === undefined || column === undefined) return

      const cell = {
        bg: api.getCellValue(row, column, { type: 'bg' }) as Cell['bg'],
        fc: api.getCellValue(row, column, { type: 'fc' }) as Cell['fc'],
      }
      const colors = resolveExcelCellEditorColors(
        cell,
        document.documentElement.classList.contains('dark'),
      )
      if (editor.style.backgroundColor !== colors.background) {
        editor.style.backgroundColor = colors.background
      }
      if (editor.style.color !== colors.foreground) editor.style.color = colors.foreground
      editor.dataset.excelCellBackground = colors.background
      editor.dataset.excelCellForeground = colors.foreground
    }

    const scheduleActiveCellColorSync = () => {
      if (syncFrame !== null) cancelAnimationFrame(syncFrame)
      syncFrame = requestAnimationFrame(syncActiveCellColors)
    }
    activeCellColorSyncRef.current = scheduleActiveCellColorSync

    const editorObserver = new MutationObserver(scheduleActiveCellColorSync)
    editorObserver.observe(shell, { childList: true, subtree: true })
    const editorThemeObserver = new MutationObserver(scheduleActiveCellColorSync)
    editorThemeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    shell.addEventListener('mousedown', scheduleActiveCellColorSync, true)
    shell.addEventListener('dblclick', scheduleActiveCellColorSync, true)
    shell.addEventListener('keydown', scheduleActiveCellColorSync, true)
    shell.addEventListener('click', scheduleActiveCellColorSync, true)
    scheduleActiveCellColorSync()

    return () => {
      activeCellColorSyncRef.current = () => {}
      editorObserver.disconnect()
      editorThemeObserver.disconnect()
      shell.removeEventListener('mousedown', scheduleActiveCellColorSync, true)
      shell.removeEventListener('dblclick', scheduleActiveCellColorSync, true)
      shell.removeEventListener('keydown', scheduleActiveCellColorSync, true)
      shell.removeEventListener('click', scheduleActiveCellColorSync, true)
      if (syncFrame !== null) cancelAnimationFrame(syncFrame)
    }
  }, [sheets, fontLibraryReady])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell || !sheets) return

    // Fortune Sheet only observes window.resize. Forward container resizes
    // (sidebar dragging, split-pane changes) so its canvas and scrollbars
    // remain flush with the visible Excel viewport.
    //
    // One forward costs a full worksheet relayout: canvas backing realloc +
    // complete redraw + a Workbook React render (100-400ms on real sheets).
    // Panel collapse/expand animations and divider drags resize the container
    // every frame; forwarding each tick used to serialize ~10 of those and
    // froze the renderer for >1s. So while a panel animation or drag is in
    // progress, hold the forward and emit a single one when it settles.
    const PANEL_BUSY_SELECTOR = '[data-animating="true"], [data-panel-resizing="true"]'
    const isPanelBusy = () => document.querySelector(PANEL_BUSY_SELECTOR) !== null
    let pendingForward = false
    let lastForwardAt = 0
    let trailingTimer: number | null = null
    let busyPollFrame: number | null = null

    const forwardResizeNow = () => {
      pendingForward = false
      lastForwardAt = performance.now()
      window.dispatchEvent(new Event('resize'))
    }

    const waitForPanelIdle = () => {
      if (busyPollFrame !== null) return
      const poll = () => {
        busyPollFrame = null
        if (!pendingForward) return
        if (isPanelBusy()) {
          busyPollFrame = requestAnimationFrame(poll)
          return
        }
        forwardResizeNow()
      }
      busyPollFrame = requestAnimationFrame(poll)
    }

    const notifyFortuneOfResize = () => {
      pendingForward = true
      if (isPanelBusy()) {
        waitForPanelIdle()
        return
      }
      // Isolated resize (window maximize, layout settle): forward promptly.
      if (performance.now() - lastForwardAt > 300) {
        forwardResizeNow()
        return
      }
      // Burst (e.g. OS window edge drag): coalesce to a trailing forward.
      if (trailingTimer !== null) return
      trailingTimer = window.setTimeout(() => {
        trailingTimer = null
        if (!pendingForward) return
        if (isPanelBusy()) waitForPanelIdle()
        else forwardResizeNow()
      }, 120)
    }

    const resizeObserver = new ResizeObserver(notifyFortuneOfResize)
    resizeObserver.observe(shell)
    const themeObserver = new MutationObserver(notifyFortuneOfResize)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    notifyFortuneOfResize()

    const handleNativeZoomWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return

      const buttons = shell.querySelectorAll<HTMLElement>(
        '.fortune-zoom-container > .fortune-zoom-button[role="button"]',
      )
      const button = event.deltaY < 0
        ? buttons.item(buttons.length - 1)
        : buttons.item(0)
      if (!button) return

      event.preventDefault()
      event.stopPropagation()
      button.click()
    }

    const focusWorksheet = () => {
      requestAnimationFrame(() => {
        shell.querySelector<HTMLElement>('.fortune-sheet-overlay')?.focus({ preventScroll: true })
      })
    }

    let screenshotReturnFocus: HTMLElement | null = null

    const restoreScreenshotFocus = () => {
      requestAnimationFrame(() => {
        if (screenshotReturnFocus?.isConnected) {
          screenshotReturnFocus.focus({ preventScroll: true })
          screenshotReturnFocus = null
          return
        }
        shell.querySelector<HTMLElement>('.fortune-sheet-overlay')?.focus({ preventScroll: true })
      })
    }

    const decorateCloseControl = (control: HTMLElement, label: string) => {
      control.dataset.fortuneCloseControl = 'true'
      control.setAttribute('role', 'button')
      control.setAttribute('aria-label', label)
      control.setAttribute('title', `${label} (Esc)`)
      control.tabIndex = 0
    }

    const updateScreenshotClipboardStatus = (
      dialog: HTMLElement,
      status: 'copying' | 'copied' | 'error',
      message: string,
    ) => {
      let statusNode = dialog.querySelector<HTMLElement>('.excel-screenshot-clipboard-status')
      if (!statusNode) {
        statusNode = document.createElement('div')
        statusNode.className = 'excel-screenshot-clipboard-status'
        statusNode.setAttribute('role', 'status')
        statusNode.setAttribute('aria-live', 'polite')
        statusNode.setAttribute('aria-atomic', 'true')
        dialog.querySelector('.fortune-modal-dialog-header')
          ?.insertAdjacentElement('afterend', statusNode)
      }
      if (statusNode.dataset.status !== status) statusNode.dataset.status = status
      if (statusNode.textContent !== message) statusNode.textContent = message
    }

    const copyScreenshotToClipboard = async (
      dialog: HTMLElement,
      previewImage: HTMLImageElement,
    ) => {
      if (previewImage.dataset.fortuneClipboardState) return
      previewImage.dataset.fortuneClipboardState = 'copying'
      dialog.dataset.fortuneClipboardStatus = 'copying'
      updateScreenshotClipboardStatus(
        dialog,
        'copying',
        translationRef.current('excelEditor.copyingScreenshot'),
      )

      try {
        const result = await window.api.lw.copyImageToClipboard(previewImage.src)
        if (!dialog.isConnected) return
        previewImage.dataset.fortuneClipboardState = 'copied'
        dialog.dataset.fortuneClipboardStatus = 'copied'
        dialog.dataset.clipboardImageWidth = String(result.width)
        dialog.dataset.clipboardImageHeight = String(result.height)
        updateScreenshotClipboardStatus(
          dialog,
          'copied',
          translationRef.current('excelEditor.screenshotCopied'),
        )
      } catch (error) {
        console.error('[ExcelEditor] 复制截图到剪贴板失败:', error)
        if (!dialog.isConnected) return
        previewImage.dataset.fortuneClipboardState = 'error'
        dialog.dataset.fortuneClipboardStatus = 'error'
        updateScreenshotClipboardStatus(
          dialog,
          'error',
          translationRef.current('excelEditor.screenshotCopyFailed'),
        )
      }
    }

    const decorateFortuneDialogs = () => {
      const translate = translationRef.current
      const searchDialog = shell.querySelector<HTMLElement>('#fortune-search-replace')
      if (searchDialog) {
        searchDialog.setAttribute('role', 'dialog')
        searchDialog.setAttribute('aria-label', translate('excelEditor.findReplace'))
        searchDialog.setAttribute('aria-modal', 'false')

        const searchClose = searchDialog.querySelector<HTMLElement>(
          '.icon-close.fortune-modal-dialog-icon-close',
        )
        if (searchClose) {
          decorateCloseControl(searchClose, translate('excelEditor.closeFindReplace'))
        }

        const searchCloseButton = searchDialog.querySelector<HTMLElement>('.close-button')
        if (searchCloseButton) {
          decorateCloseControl(searchCloseButton, translate('excelEditor.closeFindReplace'))
        }
      }

      shell.querySelectorAll<HTMLElement>('.fortune-modal-container .fortune-dialog').forEach((dialog) => {
        const previewImage = dialog.querySelector<HTMLImageElement>(
          '.fortune-dialog-box-content img',
        )
        const isScreenshotPreview = previewImage?.src.startsWith('data:image/png;base64,') ?? false
        dialog.dataset.fortuneDialogKind = isScreenshotPreview ? 'screenshot-preview' : 'modal'
        dialog.setAttribute('role', 'dialog')
        dialog.setAttribute('aria-modal', isScreenshotPreview ? 'true' : 'false')
        dialog.setAttribute(
          'aria-label',
          isScreenshotPreview
            ? translate('excelEditor.screenshotPreview')
            : translate('excelEditor.excelDialog'),
        )

        if (isScreenshotPreview && previewImage) {
          const header = dialog.querySelector<HTMLElement>('.fortune-modal-dialog-header')
          if (header) {
            header.dataset.excelDialogTitle = translate('excelEditor.screenshotPreview')
          }

          const clipboardState = previewImage.dataset.fortuneClipboardState
          if (!clipboardState) {
            void copyScreenshotToClipboard(dialog, previewImage)
          } else if (clipboardState === 'copying') {
            updateScreenshotClipboardStatus(
              dialog,
              'copying',
              translate('excelEditor.copyingScreenshot'),
            )
          } else if (clipboardState === 'copied') {
            updateScreenshotClipboardStatus(
              dialog,
              'copied',
              translate('excelEditor.screenshotCopied'),
            )
          } else if (clipboardState === 'error') {
            updateScreenshotClipboardStatus(
              dialog,
              'error',
              translate('excelEditor.screenshotCopyFailed'),
            )
          }
        }

        const closeControl = dialog.querySelector<HTMLElement>('.fortune-modal-dialog-icon-close')
        if (closeControl) {
          const isNewScreenshotPreview = isScreenshotPreview
            && closeControl.dataset.fortuneCloseControl !== 'true'
          decorateCloseControl(
            closeControl,
            isScreenshotPreview
              ? translate('excelEditor.closeScreenshotPreview')
              : translate('excelEditor.closeDialog'),
          )
          if (isNewScreenshotPreview) {
            screenshotReturnFocus = document.activeElement instanceof HTMLElement
              && shell.contains(document.activeElement)
              ? document.activeElement
              : null
            closeControl.focus({ preventScroll: true })
          }
        }
      })
    }

    const findTopmostCloseControl = () => {
      const modalClose = shell.querySelector<HTMLElement>(
        '.fortune-modal-container .fortune-modal-dialog-icon-close',
      )
      if (modalClose) return modalClose
      return shell.querySelector<HTMLElement>(
        '#fortune-search-replace .icon-close, #fortune-search-replace .close-button',
      )
    }

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const screenshotClose = shell.querySelector<HTMLElement>(
        '[data-fortune-dialog-kind=screenshot-preview] .fortune-modal-dialog-icon-close',
      )
      if (event.key === 'Tab' && screenshotClose) {
        event.preventDefault()
        event.stopPropagation()
        screenshotClose.focus({ preventScroll: true })
        return
      }

      if (
        target instanceof HTMLElement
        && target.dataset.fortuneCloseControl === 'true'
        && (event.key === 'Enter' || event.key === ' ')
      ) {
        event.preventDefault()
        event.stopPropagation()
        target.click()
        return
      }

      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return
      const closeControl = findTopmostCloseControl()
      if (!closeControl) return

      event.preventDefault()
      event.stopPropagation()
      closeControl.click()
    }

    const handleDialogClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return

      const clickedClose = target.closest<HTMLElement>('[data-fortune-close-control=true]')
      if (clickedClose && shell.contains(clickedClose)) {
        const isScreenshotPreview = clickedClose.closest<HTMLElement>('.fortune-dialog')
          ?.dataset.fortuneDialogKind === 'screenshot-preview'
        if (isScreenshotPreview) restoreScreenshotFocus()
        else focusWorksheet()
        return
      }

      if (!(target instanceof HTMLElement) || !target.matches('.fortune-modal-container')) return

      const dialog = target.querySelector<HTMLElement>('.fortune-dialog')
      if (dialog?.dataset.fortuneDialogKind !== 'screenshot-preview') return

      const closeControl = dialog.querySelector<HTMLElement>('.fortune-modal-dialog-icon-close')
      if (!closeControl) return
      closeControl.click()
    }

    const dialogObserver = new MutationObserver(decorateFortuneDialogs)
    dialogObserver.observe(shell, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    })
    decorateFortuneDialogs()

    // Hover box under toolbar icons: 「撤销 (Ctrl+Z)」 — name + shortcut in parentheses.
    // Re-run after Fortune/React remounts toolbar items (undo enable/disable, overflow, etc.).
    let toolbarShortcutTimer: number | null = null
    const scheduleToolbarShortcutDecoration = () => {
      if (toolbarShortcutTimer !== null) return
      toolbarShortcutTimer = window.setTimeout(() => {
        toolbarShortcutTimer = null
        decorateExcelToolbarShortcuts(shell)
      }, 0)
    }
    const toolbarShortcutObserver = new MutationObserver(scheduleToolbarShortcutDecoration)
    toolbarShortcutObserver.observe(shell, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-tips', 'aria-label', 'class'],
    })
    decorateExcelToolbarShortcuts(shell)
    // Fortune paints the toolbar one frame later after Workbook mount.
    requestAnimationFrame(() => {
      decorateExcelToolbarShortcuts(shell)
      window.setTimeout(() => decorateExcelToolbarShortcuts(shell), 50)
      window.setTimeout(() => decorateExcelToolbarShortcuts(shell), 200)
    })

    shell.addEventListener('wheel', handleNativeZoomWheel, {
      capture: true,
      passive: false,
    })
    shell.addEventListener('keydown', handleDialogKeyDown, true)
    shell.addEventListener('click', handleDialogClick, true)

    return () => {
      resizeObserver.disconnect()
      themeObserver.disconnect()
      dialogObserver.disconnect()
      toolbarShortcutObserver.disconnect()
      if (toolbarShortcutTimer !== null) window.clearTimeout(toolbarShortcutTimer)
      shell.removeEventListener('wheel', handleNativeZoomWheel, true)
      shell.removeEventListener('keydown', handleDialogKeyDown, true)
      shell.removeEventListener('click', handleDialogClick, true)
      pendingForward = false
      if (busyPollFrame !== null) cancelAnimationFrame(busyPollFrame)
      if (trailingTimer !== null) window.clearTimeout(trailingTimer)
    }
    // fontLibraryReady gates the shell render (see live-resize effect above).
  }, [sheets, fontLibraryReady, t])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell || !fontLibraryReady || !sheets) return

    const fontSearchTerms = new Map<string, string[]>()
    const addFontSearchTerms = (name: string, terms: string[]) => {
      const key = normalizeSystemFontFamilyName(name)
      if (!key || terms.length === 0) return
      const existing = fontSearchTerms.get(key) || []
      fontSearchTerms.set(key, [...new Set([...existing, ...terms])])
    }

    for (const face of fontFaces) {
      const familyName = face.familyName.trim()
      const displayName = face.displayName.trim() || familyName
      const aliases = EXCEL_FONT_SEARCH_ALIASES_FOR_PICKER[
        normalizeExcelPickerSearchText(familyName)
      ] || []
      const terms = [displayName, familyName, face.faceName, ...aliases]
        .filter(Boolean)
      addFontSearchTerms(displayName, terms)
      addFontSearchTerms(familyName, terms)
    }

    // Scanned system-font inventory drives font-picker width (longest name).
    const systemFontDisplayNames = collectSystemFontDisplayNames(fontFaces)

    const decoratePicker = (popup: HTMLElement) => {
      if (popup.dataset.excelPickerSearchReady === 'true') return

      const kind = getExcelToolbarPickerKindForPicker(popup)
      if (!kind) return

      const container = popup.closest<HTMLElement>('.fortune-toobar-combo-container')
      const select = popup.querySelector<HTMLElement>('.fortune-toolbar-select')
      if (!container || !select) return

      popup.dataset.excelPickerSearchReady = 'true'
      popup.dataset.excelPickerKind = kind

      const copy = getExcelPickerCopyForPicker(
        kind,
        language,
        {
          font: t('excelEditor.fontSearchPlaceholder'),
          fontSize: t('excelEditor.fontSizeSearchPlaceholder'),
          format: t('excelEditor.formatSearchPlaceholder'),
        },
      )
      const searchHeader = document.createElement('div')
      searchHeader.className = 'excel-toolbar-picker-search'

      const input = document.createElement('input')
      input.className = 'excel-toolbar-picker-search-input'
      // Use text (not search) so Chromium does not reserve a clear-button gutter
      // that shortens the field and paints a dark strip on the trailing edge.
      input.type = 'text'
      input.inputMode = kind === 'font-size' ? 'decimal' : 'search'
      input.autocomplete = 'off'
      input.spellcheck = false
      input.placeholder = copy.placeholder
      input.title = copy.placeholder
      input.dir = language === 'ar' ? 'rtl' : 'ltr'
      input.setAttribute('role', 'combobox')
      input.setAttribute('aria-autocomplete', 'both')
      input.setAttribute('aria-expanded', 'true')
      input.setAttribute('aria-label', copy.placeholder)
      input.setAttribute(
        'data-testid',
        kind === 'font'
          ? 'excel-font-search'
          : kind === 'font-size'
            ? 'excel-font-size-input'
            : 'excel-format-search',
      )
      searchHeader.append(input)

      const empty = document.createElement('div')
      empty.className = 'excel-toolbar-picker-empty'
      empty.hidden = true
      // Pin search outside the scrolling option list so rows never paint through it.
      // (Sticky inside .fortune-toolbar-select still let options slide under the field.)
      popup.insertBefore(searchHeader, select)
      select.append(empty)

      // Per kind + language strategy (font / format / font-size differ).
      // Font: scanned system-font inventory; format/size: list labels only.
      fitExcelToolbarPickerWidth(
        popup,
        select,
        input,
        copy.placeholder,
        kind,
        language,
        kind === 'font' ? systemFontDisplayNames : [],
      )

      const getOptions = () => Array.from(select.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement
          && child.classList.contains('fortune-toolbar-select-option'),
      )
      const getVisibleOptions = () => getOptions().filter((option) => !option.hidden)
      const comboText = container.querySelector<HTMLElement>('.fortune-toolbar-combo-text')
        ?.textContent?.trim() || ''
      const selectionAtOpen = workbookRef.current?.getSelection()
      let activeOption: HTMLElement | null = null

      const setActiveOption = (option: HTMLElement | null, scrollIntoView = false) => {
        for (const candidate of getOptions()) {
          candidate.classList.toggle('excel-toolbar-picker-option-active', candidate === option)
        }
        activeOption = option
        if (scrollIntoView) option?.scrollIntoView({ block: 'nearest' })
      }

      const filterOptions = (resetActive = false) => {
        const query = normalizeExcelPickerSearchText(input.value)
        const visibleOptions: HTMLElement[] = []

        for (const option of getOptions()) {
          const name = option.textContent?.trim() || ''
          const searchableTerms = kind === 'font'
            ? [name, ...(fontSearchTerms.get(normalizeSystemFontFamilyName(name)) || [])]
            : [name]
          const matches = !query || searchableTerms.some(
            (term) => normalizeExcelPickerSearchText(term).includes(query),
          )
          option.hidden = !matches
          option.setAttribute('aria-hidden', String(!matches))
          if (matches) visibleOptions.push(option)
        }

        if (resetActive || !activeOption || activeOption.hidden) {
          const current = normalizeExcelPickerSearchText(comboText)
          const exact = query && kind === 'font'
            ? visibleOptions.find((option) => {
              const name = option.textContent?.trim() || ''
              const terms = [name, ...(fontSearchTerms.get(normalizeSystemFontFamilyName(name)) || [])]
              return terms.some((term) => normalizeExcelPickerSearchText(term) === query)
            })
            : undefined
          const selected = !query && current
            ? visibleOptions.find(
              (option) => normalizeExcelPickerSearchText(option.textContent?.trim() || '') === current,
            )
            : undefined
          setActiveOption(exact || selected || visibleOptions[0] || null)
        }

        const showEmpty = query.length > 0 && visibleOptions.length === 0
        empty.hidden = !showEmpty
        if (showEmpty) empty.textContent = copy.empty
      }

      const closePicker = () => {
        container.querySelector<HTMLElement>('.fortune-toolbar-combo-arrow')?.click()
      }

      const applyCellFormat = (attribute: 'ff' | 'fs', value: string | number) => {
        const api = workbookRef.current
        const selection = api?.getSelection() || selectionAtOpen
        if (!api || !selection?.length) return false
        api.setCellFormatByRange(attribute, value, selection)
        return true
      }

      const applyOption = (option: HTMLElement) => {
        const optionValue = option.textContent?.trim() || ''
        if (!optionValue) return

        if (kind === 'font') {
          if (applyCellFormat('ff', optionValue)) closePicker()
          else option.click()
          return
        }

        if (kind === 'format') {
          // Number formats are applied through Fortune's own option handler.
          option.click()
          return
        }

        const size = parseExcelFontSizeForPicker(optionValue)
        if (size !== null && applyCellFormat('fs', size)) closePicker()
        else option.click()
      }

      const applyInput = () => {
        const typedValue = input.value.trim()
        const visibleOptions = getVisibleOptions()

        if (kind === 'font-size') {
          if (!typedValue) {
            if (activeOption) applyOption(activeOption)
            return
          }

          const size = parseExcelFontSizeForPicker(typedValue)
          if (size === null) {
            empty.textContent = copy.invalid
            empty.hidden = false
            return
          }

          const typedSearch = normalizeExcelPickerSearchText(typedValue)
          const exactOption = visibleOptions.find(
            (option) => normalizeExcelPickerSearchText(option.textContent?.trim() || '') === typedSearch,
          )
          if (exactOption) {
            applyOption(exactOption)
            return
          }

          if (applyCellFormat('fs', size)) closePicker()
          return
        }

        if (kind === 'format') {
          if (activeOption) {
            applyOption(activeOption)
            return
          }
          if (visibleOptions[0]) applyOption(visibleOptions[0])
          return
        }

        if (activeOption) {
          applyOption(activeOption)
          return
        }
        if (visibleOptions[0]) {
          applyOption(visibleOptions[0])
          return
        }
        if (typedValue && applyCellFormat('ff', typedValue)) closePicker()
      }

      const moveActiveOption = (direction: 1 | -1) => {
        const visibleOptions = getVisibleOptions()
        if (!visibleOptions.length) return
        const currentIndex = activeOption ? visibleOptions.indexOf(activeOption) : -1
        const nextIndex = currentIndex < 0
          ? direction === 1 ? 0 : visibleOptions.length - 1
          : (currentIndex + direction + visibleOptions.length) % visibleOptions.length
        setActiveOption(visibleOptions[nextIndex], true)
      }

      input.addEventListener('input', (event) => {
        event.stopPropagation()
        filterOptions(true)
      })
      input.addEventListener('change', (event) => event.stopPropagation())
      input.addEventListener('beforeinput', (event) => event.stopPropagation())
      input.addEventListener('compositionstart', (event) => event.stopPropagation())
      input.addEventListener('compositionupdate', (event) => event.stopPropagation())
      input.addEventListener('compositionend', (event) => event.stopPropagation())
      input.addEventListener('keydown', (event) => {
        // Fortune's worksheet keyboard handler is attached above this popup.
        // Keep normal typing inside the editable picker instead of letting the
        // worksheet consume the key and steal focus from the input.
        event.stopPropagation()
        if (event.isComposing || event.keyCode === 229) return

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          event.stopPropagation()
          moveActiveOption(event.key === 'ArrowDown' ? 1 : -1)
          return
        }

        if (event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          applyInput()
          return
        }

        if (event.key === 'Tab') {
          event.stopPropagation()
          applyInput()
          return
        }

        if (event.key === 'Escape') {
          event.preventDefault()
          closePicker()
        }
      })
      input.addEventListener('keyup', (event) => event.stopPropagation())
      input.addEventListener('keypress', (event) => event.stopPropagation())

      filterOptions(true)
      requestAnimationFrame(() => {
        if (popup.isConnected) input.focus({ preventScroll: true })
      })
    }

    const decorateOpenPickers = () => {
      shell.querySelectorAll<HTMLElement>('.fortune-toolbar-combo-popup').forEach(decoratePicker)
    }

    let decorationTimer: number | null = null
    const schedulePickerDecoration = () => {
      if (decorationTimer !== null) return
      decorationTimer = window.setTimeout(() => {
        decorationTimer = null
        decorateOpenPickers()
      }, 0)
    }

    // React creates the popup after the combo's click handler runs. The
    // observer covers all render paths; the click retry also guarantees that
    // a real toolbar click gets the editable input on its next frame.
    const handleToolbarComboClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (!target.closest('.fortune-toolbar-combo-button, .fortune-toolbar-combo-arrow')) return
      schedulePickerDecoration()
    }

    const pickerObserver = new MutationObserver(schedulePickerDecoration)
    pickerObserver.observe(shell, { childList: true, subtree: true })
    shell.addEventListener('click', handleToolbarComboClick, true)
    decorateOpenPickers()

    return () => {
      pickerObserver.disconnect()
      shell.removeEventListener('click', handleToolbarComboClick, true)
      if (decorationTimer !== null) window.clearTimeout(decorationTimer)
    }
  }, [fontFaces, fontLibraryReady, language, sheets])

  // Fortune Sheet 在 onChange 引用变化时会重新触发 effect；必须保持回调稳定。
  // Only mark dirty when workbook *content* diverges from the saved baseline —
  // selection / click / layout onChange must not light the tab dirty dot.
  const handleChange = useCallback((data: Sheet[]) => {
    sheetsRef.current = data
    activeCellColorSyncRef.current()
    const contentReferencesUnchanged = excelSheetsShareContentReferences(
      lastContentSnapshotRef.current,
      data,
    )
    lastContentSnapshotRef.current = data
    if (suppressDirtyRef.current || dirtyReportedRef.current) return
    if (contentReferencesUnchanged && dirtyCheckTimerRef.current === null) return
    scheduleDirtyCheck()
  }, [scheduleDirtyCheck])

  const handleWorkbookRef = useCallback((api: WorkbookInstance | null) => {
    workbookRef.current = api
    if (!api || readyRef.current) return
    readyRef.current = true
    documentBridge.setExcel(api, filePath)
    // Wait for Fortune's post-mount normalization, then lock the clean baseline.
    // (Single rAF was too short — click/selection still looked "dirty".)
    window.setTimeout(() => {
      const snapshot = workbookRef.current?.getAllSheets?.() ?? sheetsRef.current
      sheetsRef.current = snapshot
      lastContentSnapshotRef.current = snapshot
      baselineFingerprintRef.current = fingerprintExcelSheets(snapshot)
      dirtyReportedRef.current = false
      suppressDirtyRef.current = false
    }, 500)
    onReadyRef.current()
  }, [filePath])

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-destructive">
        {t('excelEditor.cannotLoadGeneric')}
      </div>
    )
  }

  if (!sheets || !fontLibraryReady) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {sheets ? t('appShell.loadingSystemFonts') : t('excelEditor.loading')}
      </div>
    )
  }

  return (
    <div
      ref={shellRef}
      // No permanent transform/will-change here: a persistently composited
      // layer is exempt from Chromium's device-pixel snapping, and at
      // fractional DPR (Windows 125%/134%/150%) the whole worksheet canvas
      // gets bilinearly resampled into soft, blurry text. Promotion is applied
      // only while panels animate (see fortune-sheet-theme.css).
      className="excel-editor-shell h-full min-h-0 w-full"
      data-manages-document-zoom
      data-testid="excel-editor-shell"
    >
      <Workbook
        key={`${filePath}:${workbookLanguage}`}
        ref={handleWorkbookRef}
        data={sheets}
        onChange={handleChange}
        lang={workbookLanguage}
        defaultFontSize={DEFAULT_SPREADSHEET_FONT_SIZE}
      />
    </div>
  )
}
