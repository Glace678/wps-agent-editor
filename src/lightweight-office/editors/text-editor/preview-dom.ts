export function elementForNode(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement
}

export function rangeInsideRoot(root: HTMLElement, range: Range): boolean {
  return root.contains(range.startContainer) && root.contains(range.endContainer)
}

/**
 * Map source character offsets onto the formatted preview DOM. Plain-text
 * regions render their source verbatim (escaped entities decode back to the
 * same characters), so a textarea selection maps 1:1 while it stays inside
 * the text regions.
 */
export function locatePreviewRangeByOffsets(root: HTMLElement, start: number, end: number): Range | null {
  if (end <= start) return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let startBound: { node: Node; offset: number } | null = null
  let endBound: { node: Node; offset: number } | null = null
  let node: Node | null = null
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0
    if (!startBound && start <= consumed + length) {
      startBound = { node, offset: Math.min(start - consumed, length) }
    }
    if (end <= consumed + length) {
      endBound = { node, offset: Math.min(end - consumed, length) }
      break
    }
    consumed += length
  }
  if (!startBound || !endBound) return null
  const range = document.createRange()
  range.setStart(startBound.node, startBound.offset)
  range.setEnd(endBound.node, endBound.offset)
  return range.collapsed ? null : range
}

export function enableEditablePreviewRegions(
  root: HTMLElement,
  spellCheckEnabled: boolean,
) {
  root.querySelectorAll<HTMLTableCellElement>('th, td').forEach((cell) => {
    cell.contentEditable = 'true'
    cell.spellcheck = spellCheckEnabled
    cell.setAttribute('data-notepad-cell', 'true')
    cell.setAttribute('role', 'textbox')
    cell.tabIndex = 0
  })
  root.querySelectorAll<HTMLElement>(
    '[data-notepad-text-region], [data-notepad-markdown-region]',
  ).forEach((region) => {
    region.contentEditable = 'true'
    region.spellcheck = spellCheckEnabled
    region.setAttribute('role', 'textbox')
    region.tabIndex = 0
  })
}

export function focusAdjacentTableCell(cell: HTMLTableCellElement, direction: 1 | -1): boolean {
  const table = cell.closest('table')
  if (!table) return false
  const cells = Array.from(table.querySelectorAll<HTMLTableCellElement>('th, td'))
  const index = cells.indexOf(cell)
  if (index < 0) return false
  const next = cells[index + direction]
  if (!next) return false
  next.focus()
  const selection = window.getSelection()
  if (selection) {
    const range = document.createRange()
    range.selectNodeContents(next)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  return true
}

export function focusMarkdownBodyRegion(
  root: HTMLElement,
  regionIndex: number,
  direction: 1 | -1,
): boolean {
  const region = root.querySelector<HTMLElement>(
    `[data-notepad-markdown-region="${regionIndex}"]`,
  )
  if (!region) return false
  region.focus()
  const selection = window.getSelection()
  if (selection) {
    const range = document.createRange()
    range.selectNodeContents(region)
    range.collapse(direction > 0)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  return true
}

export function focusPlainTextBodyRegion(
  root: HTMLElement,
  regionIndex: number,
  atEnd: boolean,
): boolean {
  const region = root.querySelector<HTMLElement>(
    `[data-notepad-text-region="${regionIndex}"]`,
  )
  if (!region) return false
  region.focus()
  const selection = window.getSelection()
  if (selection) {
    const range = document.createRange()
    range.selectNodeContents(region)
    range.collapse(atEnd)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  return true
}
