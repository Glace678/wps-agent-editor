import type { WorkbookInstance } from '@fortune-sheet/react'
import {
  excelSelectionsEqual,
  getExcelCellFromSheet,
  resolveExcelCellEditorColors,
  type ExcelFontColorTarget,
} from './excel-color'

export type ExcelCellEditorTextSelection = {
  range: Range
  start: number
  end: number
}

export function getActiveExcelCellEditor(shell: HTMLElement) {
  const editor = shell.querySelector<HTMLElement>(
    '.luckysheet-input-box .luckysheet-cell-input',
  )
  const box = editor?.closest<HTMLElement>('.luckysheet-input-box')
  if (!editor || !box) return null
  const style = getComputedStyle(box)
  if (style.display === 'none' || style.visibility === 'hidden' || box.getClientRects().length === 0) {
    return null
  }
  const editorZIndex = Number.parseInt(style.zIndex, 10)
  if (!Number.isFinite(editorZIndex) || editorZIndex < 0) return null
  return editor
}

export function captureExcelCellEditorTextRange(
  shell: HTMLElement,
): ExcelCellEditorTextSelection | null {
  const editor = getActiveExcelCellEditor(shell)
  const selection = window.getSelection()
  if (!editor || !selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null

  const prefix = document.createRange()
  prefix.selectNodeContents(editor)
  prefix.setEnd(range.startContainer, range.startOffset)
  const start = prefix.toString().length
  prefix.setEnd(range.endContainer, range.endOffset)
  const end = prefix.toString().length
  if (start === end) return null
  return { range: range.cloneRange(), start, end }
}

export function restoreExcelCellEditorTextRange(
  shell: HTMLElement,
  snapshot: ExcelCellEditorTextSelection,
): boolean {
  const editor = getActiveExcelCellEditor(shell)
  const selection = window.getSelection()
  const { range } = snapshot
  if (!editor || !selection
    || !range.startContainer.isConnected
    || !range.endContainer.isConnected
    || !editor.contains(range.startContainer)
    || !editor.contains(range.endContainer)) return false

  try {
    selection.removeAllRanges()
    selection.addRange(range.cloneRange())
    return true
  } catch {
    return false
  }
}

function findExcelEditorTextPoint(editor: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let lastNode: Text | null = null
  let node: Node | null
  while ((node = walker.nextNode())) {
    const textNode = node as Text
    const next = consumed + textNode.data.length
    if (offset <= next) return { node: textNode, offset: offset - consumed }
    consumed = next
    lastNode = textNode
  }
  return lastNode && offset === consumed
    ? { node: lastNode, offset: lastNode.data.length }
    : null
}

export function applyExcelFontColorToEditorTextSelection(
  shell: HTMLElement,
  snapshot: ExcelCellEditorTextSelection,
  color: string | undefined,
) {
  const editor = getActiveExcelCellEditor(shell)
  if (!editor || snapshot.start < 0 || snapshot.start >= snapshot.end) return false

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode())) textNodes.push(node as Text)

  type TextRun = { text: string; style: string }
  const runs: TextRun[] = []
  let consumed = 0
  for (const textNode of textNodes) {
    const text = textNode.data
    const nodeStart = consumed
    const nodeEnd = nodeStart + text.length
    consumed = nodeEnd
    if (!text) continue

    const inheritedStyle = document.createElement('span').style
    const ancestors: HTMLElement[] = []
    let element = textNode.parentElement
    while (element && element !== editor) {
      ancestors.push(element)
      element = element.parentElement
    }
    for (const ancestor of ancestors.reverse()) {
      for (const property of Array.from(ancestor.style)) {
        inheritedStyle.setProperty(
          property,
          ancestor.style.getPropertyValue(property),
          ancestor.style.getPropertyPriority(property),
        )
      }
    }

    const cuts = [0, text.length]
    if (snapshot.start > nodeStart && snapshot.start < nodeEnd) {
      cuts.push(snapshot.start - nodeStart)
    }
    if (snapshot.end > nodeStart && snapshot.end < nodeEnd) {
      cuts.push(snapshot.end - nodeStart)
    }
    cuts.sort((left, right) => left - right)

    for (let index = 0; index < cuts.length - 1; index += 1) {
      const from = cuts[index]
      const to = cuts[index + 1]
      if (from === to) continue
      const style = document.createElement('span').style
      style.cssText = inheritedStyle.cssText
      const pieceStart = nodeStart + from
      const pieceEnd = nodeStart + to
      if (pieceStart >= snapshot.start && pieceEnd <= snapshot.end) {
        if (color) style.color = color
        else style.removeProperty('color')
      }
      const run = { text: text.slice(from, to), style: style.cssText }
      const previous = runs[runs.length - 1]
      if (previous?.style === run.style) previous.text += run.text
      else runs.push(run)
    }
  }
  if (snapshot.end > consumed || runs.length === 0) return false

  editor.replaceChildren(...runs.map((run) => {
    const span = document.createElement('span')
    span.dir = 'auto'
    span.style.cssText = run.style
    span.textContent = run.text
    return span
  }))

  const start = findExcelEditorTextPoint(editor, snapshot.start)
  const end = findExcelEditorTextPoint(editor, snapshot.end)
  const selection = window.getSelection()
  if (start && end && selection) {
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  return true
}

export function syncExcelCellEditorFontColor(
  shell: HTMLElement,
  api: WorkbookInstance,
  target: ExcelFontColorTarget,
  color: string | undefined,
) {
  const editor = getActiveExcelCellEditor(shell)
  if (!excelSelectionsEqual(api.getSelection(), target.selection)) return false
  const firstRange = target.selection[0]
  if (!editor || !firstRange) return false

  const cell = getExcelCellFromSheet(
    api,
    firstRange.row[0],
    firstRange.column[0],
    target.sheetId,
  )
  const foreground = color ?? resolveExcelCellEditorColors(
    cell ? { bg: cell.bg, fc: undefined } : null,
    document.documentElement.classList.contains('dark'),
  ).foreground
  editor.style.color = foreground
  editor.dataset.excelCellForeground = foreground
  editor.querySelectorAll<HTMLElement>('span').forEach((span) => {
    span.style.color = foreground
  })
  return true
}
