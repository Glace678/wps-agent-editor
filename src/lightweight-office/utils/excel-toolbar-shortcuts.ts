/**
 * Excel toolbar hover shortcut annotations.
 *
 * Fortune Sheet only ships shortcuts on a few tips (Bold / Italic / Strikethrough).
 * This module appends Microsoft Excel (Windows) chords to the remaining toolbar
 * controls when the tip does not already include one.
 *
 * Chords are grounded in Microsoft support docs for Excel keyboard shortcuts
 * and the shared office-shortcuts catalog where they overlap.
 */

/** Toolbar icon / item id → Excel Windows shortcut (only when one exists). */
export const EXCEL_TOOLBAR_SHORTCUTS: Readonly<Record<string, string>> = {
  // Edit
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Y',

  // Number formats (Excel Format as…)
  'currency-format': 'Ctrl+Shift+$',
  'percentage-format': 'Ctrl+Shift+%',

  // Font style
  bold: 'Ctrl+B',
  italic: 'Ctrl+I',
  underline: 'Ctrl+U',
  // Fortune may already show Alt+Shift+5; we also accept Ctrl+5 (Excel default).
  'strike-through': 'Ctrl+5',
  strikethrough: 'Ctrl+5',

  // Borders
  border: 'Ctrl+Shift+&',
  'border-all': 'Ctrl+Shift+&',

  // Find / print / link / note
  search: 'Ctrl+F',
  findAndReplace: 'Ctrl+F',
  print: 'Ctrl+P',
  link: 'Ctrl+K',
  insertLink: 'Ctrl+K',
  comment: 'Shift+F2',

  // Data
  filter: 'Ctrl+Shift+L',
  filter1: 'Ctrl+Shift+L',

  // Formula
  'formula-sum': 'Alt+=',
  'quick-formula': 'Alt+=',
  autoSum: 'Alt+=',
}

/**
 * Multilingual tip text → shortcut fallback when the icon id is missing or
 * the control is a combo whose tip is localized without an icon id.
 * Longer / more specific patterns first.
 */
const EXCEL_TOOLBAR_TIP_SHORTCUT_PATTERNS: ReadonlyArray<{ re: RegExp, chord: string }> = [
  // Undo / redo
  { re: /^(undo|撤销|撤銷|deshacer|отменить|rückgängig|annuler|desfazer|元に戻す|تراجع)/i, chord: 'Ctrl+Z' },
  { re: /^(redo|重做|重做|rehacer|повторить|wiederholen|rétablir|refazer|やり直し|إعادة)/i, chord: 'Ctrl+Y' },

  // Font style (if icon missing)
  { re: /^(bold|粗体|粗體|negrita|жирный|fett|gras|negrito|太字|عريض)/i, chord: 'Ctrl+B' },
  { re: /^(italic|斜体|斜體|itálica|курсив|kursiv|italique|itálico|斜体|مائل)/i, chord: 'Ctrl+I' },
  { re: /^(underline|下划线|底線|下劃線|subrayado|подчёркнутый|unterstrichen|souligné|sublinhado|下線|تسطير)/i, chord: 'Ctrl+U' },
  { re: /^(strike|strikethrough|删除线|刪除線|tachar|зачерк|durchgestrichen|barré|tachado|取り消し線|يتوسطه)/i, chord: 'Ctrl+5' },

  // Number formats
  { re: /(currency|货币|貨幣|moneda|валют|währung|devise|moeda|通貨|عملة)/i, chord: 'Ctrl+Shift+$' },
  { re: /(percent|百分比|porcent|процент|prozent|pourcent|パーセント|نسبة)/i, chord: 'Ctrl+Shift+%' },

  // Find / print / link / comment / filter / sum
  { re: /(find|search|查找|尋找|buscar|поиск|suchen|recherch|pesquis|検索|بحث)/i, chord: 'Ctrl+F' },
  { re: /^(print|打印|列印|imprimir|печать|drucken|imprimer|印刷|طباعة)/i, chord: 'Ctrl+P' },
  { re: /(insert\s*link|hyperlink|链接|連結|enlace|ссылк|link|lien|リンク|ارتباط)/i, chord: 'Ctrl+K' },
  { re: /^(comment|批注|註解|comentario|комментар|kommentar|commentaire|コメント|تعليق)/i, chord: 'Shift+F2' },
  { re: /^(filter|筛选|篩選|filtro|фильтр|filter|filtre|フィルタ|تصفية)/i, chord: 'Ctrl+Shift+L' },
  { re: /(auto\s*sum|sum|求和|總和|suma|сумм|summe|somme|合計|مجموع)/i, chord: 'Alt+=' },

  // Border
  { re: /^(border|边框|邊框|borde|границ|rahmen|bordure|borda|罫線|حدود)/i, chord: 'Ctrl+Shift+&' },
]

/** True if the tip already carries a keyboard chord annotation. */
export function excelToolbarTipHasShortcut(tip: string): boolean {
  if (!tip) return false
  // Fortune styles: "Bold (Ctrl+B)", "粗体 (Ctrl+B)", "粗體（Ctrl+B）"
  if (/\([^)]*(?:Ctrl|Alt|Shift|Cmd|Command|Meta|⌘|⌃)[^)]*\)/i.test(tip)) return true
  if (/（[^）]*(?:Ctrl|Alt|Shift|Cmd|Command|Meta|⌘|⌃)[^）]*）/i.test(tip)) return true
  // Bare F-keys or chords without parentheses
  if (/\b(?:Ctrl|Alt|Shift)\s*\+/i.test(tip)) return true
  if (/\bF(?:1[0-2]|[1-9])\b/.test(tip)) return true
  return false
}

/** Append " (Chord)" when missing. Leaves existing tips untouched. */
export function appendExcelToolbarShortcut(tip: string, chord: string): string {
  const base = tip.trim()
  if (!base || !chord || excelToolbarTipHasShortcut(base)) return tip
  return `${base} (${chord})`
}

/** Resolve icon id from a Fortune toolbar control (svg <use href="#id">). */
export function getExcelToolbarIconId(el: HTMLElement): string | null {
  const use = el.querySelector('use')
  if (!use) return null
  const href =
    use.getAttribute('href')
    || use.getAttribute('xlink:href')
    || use.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    || ''
  const id = href.startsWith('#') ? href.slice(1) : href
  return id || null
}

/** Look up a shortcut for a toolbar control by icon id, then tip text. */
export function resolveExcelToolbarShortcut(
  iconId: string | null,
  tip: string,
): string | null {
  if (iconId) {
    const byId = EXCEL_TOOLBAR_SHORTCUTS[iconId]
    if (byId) return byId
  }

  const text = tip.trim()
  if (!text) return null

  for (const { re, chord } of EXCEL_TOOLBAR_TIP_SHORTCUT_PATTERNS) {
    if (re.test(text)) return chord
  }
  return null
}

/**
 * Ensure the hover box (.fortune-tooltip) shows the full tip text, e.g.
 * 「撤销 (Ctrl+Z)」. Fortune renders this node as the visible popup on hover.
 */
export function syncExcelToolbarTooltipNode(el: HTMLElement, fullTip: string): void {
  if (!fullTip) return
  let tooltipNode = el.querySelector<HTMLElement>(':scope > .fortune-tooltip')
  if (!tooltipNode) {
    tooltipNode = document.createElement('div')
    tooltipNode.className = 'fortune-tooltip'
    el.appendChild(tooltipNode)
  }
  if (tooltipNode.textContent !== fullTip) {
    tooltipNode.textContent = fullTip
  }
}

/**
 * Decorate a single Fortune toolbar control (button or combo).
 * Hover box must show: 「功能名 (快捷键)」 e.g. 撤销 (Ctrl+Z).
 * Re-applies after React resets tip text (does not permanently skip).
 */
export function decorateExcelToolbarControl(el: HTMLElement): boolean {
  const dataTipsRaw = el.getAttribute('data-tips') || ''
  const ariaRaw = el.getAttribute('aria-label') || ''
  // Combo aria is often "Format: Automatic" — match on the tip head only.
  const tipForMatch = dataTipsRaw || ariaRaw.split(':')[0] || ariaRaw

  if (!tipForMatch.trim()) return false

  // Already annotated (Fortune shipped it, or we did earlier and React kept it).
  if (excelToolbarTipHasShortcut(tipForMatch)) {
    const full = dataTipsRaw || tipForMatch
    syncExcelToolbarTooltipNode(el, full)
    el.dataset.excelShortcutDecorated = 'true'
    return false
  }

  const iconId = getExcelToolbarIconId(el)
  const chord = resolveExcelToolbarShortcut(iconId, tipForMatch)
  if (!chord) return false

  // Build final tip: "撤销" + " (Ctrl+Z)" → "撤销 (Ctrl+Z)"
  const nextDataTips = appendExcelToolbarShortcut(dataTipsRaw || tipForMatch, chord)
  if (dataTipsRaw !== nextDataTips) {
    el.setAttribute('data-tips', nextDataTips)
  }

  if (ariaRaw) {
    const colon = ariaRaw.indexOf(': ')
    if (colon > 0) {
      const head = ariaRaw.slice(0, colon)
      const tail = ariaRaw.slice(colon)
      el.setAttribute('aria-label', `${appendExcelToolbarShortcut(head, chord)}${tail}`)
    } else {
      el.setAttribute('aria-label', appendExcelToolbarShortcut(ariaRaw, chord))
    }
  } else {
    el.setAttribute('aria-label', nextDataTips)
  }

  // Visible hover box under the button — must show name + (shortcut).
  syncExcelToolbarTooltipNode(el, nextDataTips)

  el.dataset.excelShortcutDecorated = 'true'
  el.dataset.excelShortcutChord = chord
  return nextDataTips !== dataTipsRaw
}

/** Decorate every toolbar button / combo inside an Excel shell. */
export function decorateExcelToolbarShortcuts(shell: HTMLElement): number {
  const controls = shell.querySelectorAll<HTMLElement>(
    [
      '.fortune-toolbar .fortune-toolbar-button[data-tips]',
      '.fortune-toolbar .fortune-toolbar-combo-button[data-tips]',
      '.fortune-toolbar .fortune-toolbar-combo-arrow[data-tips]',
      '.fortune-toolbar-more-container .fortune-toolbar-button[data-tips]',
      '.fortune-toolbar-more-container .fortune-toolbar-combo-button[data-tips]',
    ].join(', '),
  )
  let updated = 0
  for (const el of controls) {
    if (decorateExcelToolbarControl(el)) updated += 1
  }
  return updated
}
