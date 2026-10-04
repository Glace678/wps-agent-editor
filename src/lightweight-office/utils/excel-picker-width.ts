import {
  getOrderedFontFamilyEntries,
  isSymbolFontFamily,
  normalizeSystemFontFamilyName,
  type SystemFontFace,
} from './system-fonts'
import { EXCEL_TOOLBAR_POPUP_EDGE_INSET } from './excel-toolbar-popup-boundary'
import type { ExcelToolbarPickerKind } from './excel-picker-copy'

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
  { min: number; max: number }
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
export type ExcelPickerWidthStrategy = 'list' | 'placeholder' | 'max'

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
export function collectSystemFontDisplayNames(fontFaces: SystemFontFace[]): string[] {
  const names = new Set<string>()
  for (const face of fontFaces) {
    const displayName = face.displayName.trim()
    const familyName = face.familyName.trim()
    if (displayName) names.add(displayName)
    if (familyName) names.add(familyName)
  }
  return [...names]
}

/** Reorder only the picker DOM. Fortune keeps its default font at internal
 * index zero, while the visible catalog follows Word: Chinese first, then A-Z. */
export function orderExcelFontPickerOptions(
  select: HTMLElement,
  fontFaces: readonly SystemFontFace[],
): void {
  const rankByName = new Map<string, number>()
  const familyByName = new Map<string, string>()
  getOrderedFontFamilyEntries(fontFaces).forEach(({ familyName, displayName }, index) => {
    for (const name of [familyName, displayName]) {
      const key = normalizeSystemFontFamilyName(name)
      if (!key) continue
      rankByName.set(key, index)
      familyByName.set(key, familyName)
    }
  })

  const options = [...select.querySelectorAll<HTMLElement>(':scope > .fortune-toolbar-select-option')]
  options
    .map((option, originalIndex) => {
      const label = option.textContent?.trim() || ''
      const key = normalizeSystemFontFamilyName(label)
      const familyName = familyByName.get(key) || label
      option.classList.toggle('excel-font-picker-symbol-label', isSymbolFontFamily(familyName))
      return {
        option,
        originalIndex,
        rank: rankByName.get(key) ?? Number.MAX_SAFE_INTEGER,
      }
    })
    .sort((left, right) => left.rank - right.rank || left.originalIndex - right.originalIndex)
    .forEach(({ option }) => select.append(option))
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
export function fitExcelToolbarPickerWidth(
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

  const preferredWidth = Math.max(limits.min, Math.min(raw, limits.max))
  const shellWidth = popup.closest<HTMLElement>('.excel-editor-shell')
    ?.getBoundingClientRect().width ?? window.innerWidth
  const editorCap = Math.max(1, Math.floor(
    shellWidth - EXCEL_TOOLBAR_POPUP_EDGE_INSET * 2,
  ))
  const width = Math.min(preferredWidth, editorCap)

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
  popup.dataset.excelPopupPreferredWidth = String(preferredWidth)
  popup.dataset.excelPickerLanguage = language
}
