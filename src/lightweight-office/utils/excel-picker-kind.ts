import {
  EXCEL_BG_COLOR_LABEL_RE,
  EXCEL_FONT_COLOR_LABEL_RE,
  EXCEL_FONT_LABEL_RE,
  EXCEL_FONT_SIZE_LABEL_RE,
  EXCEL_FORMAT_LABEL_RE,
  EXCEL_FORMAT_OPTION_HINT_RE,
} from './excel-picker-labels'
import type { ExcelToolbarPickerKind } from './excel-picker-copy'

/**
 * Identify font / font-size / format combo popups across Fortune locales.
 * Label match covers en/zh/es/ru/hi (+ app UI langs); option heuristics
 * recover when aria-label is missing or localized in an unexpected form.
 */
export function getExcelToolbarPickerKindForPicker(
  popup: HTMLElement,
): ExcelToolbarPickerKind | null {
  const container = popup.closest<HTMLElement>('.fortune-toobar-combo-container')
  const button = container?.querySelector<HTMLElement>('.fortune-toolbar-combo-button')
  const label = [button?.getAttribute('aria-label'), button?.dataset.tips]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()

  // Font color / background color / non-list combos must not get a search field.
  if (EXCEL_FONT_COLOR_LABEL_RE.test(label) || EXCEL_BG_COLOR_LABEL_RE.test(label)) {
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
    && nonNumeric.some((text) => /[A-Za-z一-鿿぀-ヿЀ-ӿ]/.test(text))

  if (looksLikeFontList) return 'font'
  return null
}
