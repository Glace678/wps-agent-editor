import { desktopApi } from '@/platform'
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type FocusEvent as ReactFocusEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Search,
  X,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import TurndownService from 'turndown'
import { useEditorStore } from '@/stores/editor.store'
import { useTranslation } from '@/lib/i18n/runtime'
import { getThemePreference, setThemePreference, type ThemePreference } from '@/lib/theme'
import {
  consumeWheelZoomSteps,
  normalizeWheelZoomDelta,
} from '@/components/layout/modules/document-zoom-wheel'
import {
  useOfficeShortcuts,
  type ShortcutHandlerMap,
} from '@/lib/office-shortcuts'
import { documentBridge } from '../agent/document-bridge'
import { readFileBuffer } from '../utils/file-io'
import {
  createFallbackSystemFontFaces,
  getSystemFontFamilyNames,
  loadSystemFontFaces,
  type SystemFontFace,
} from '../utils/system-fonts'
import { DocumentTabBar } from '../components/DocumentTabBar'
import { SaveConfirmDialog } from '../components/SaveConfirmDialog'
import { NotepadCommandBar } from './NotepadCommandBar'
import { NotepadSettingsPage } from './NotepadSettingsPage'
import {
  applyLineEnding,
  countLines,
  decodeTextFile,
  encodingLabel,
  findTextMatches,
  getCursorPosition,
  getLineOffset,
  lineEndingLabel,
  type FindOptions,
  type LineEnding,
  type TextEncoding,
} from './text-editor-utils'
import {
  findMarkdownBodyRegions,
  findPlainTextBodyRegions,
  findTableRegions,
  insertHtmlTableAtSelection,
  preserveBodyNewlinesInHtml,
  removeTableFromSource,
  renderPlainTextTableDocument,
  replaceMarkdownBodyRegion,
  replaceTableInSource,
  serializePlainTextTableDocument,
  serializeTableElement,
  shouldRecoverSyntaxEditMode,
  shouldSkipPreviewTableRebuild,
  stripTableRegions,
} from './notepad-tables'

// GFM tables + soft line breaks so body text stays line-oriented like 记事本.
marked.setOptions({ gfm: true, breaks: true })

const markdownBodySerializer = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  // Turndown appends its own newline around <br>; an empty marker preserves one line break.
  br: '',
})

markdownBodySerializer.addRule('strikethrough', {
  filter: (node) => ['DEL', 'S', 'STRIKE'].includes(node.tagName),
  replacement: (content) => `~~${content}~~`,
})
markdownBodySerializer.addRule('underline', {
  filter: 'u',
  replacement: (content) => `<u>${content}</u>`,
})

function renderMarkdownBodyRegion(source: string, index: number): string {
  const raw = marked.parse(source, { async: false }) as string
  const body = preserveBodyNewlinesInHtml(raw).trim() || '<p><br></p>'
  return `<div data-notepad-markdown-region="${index}">${body}</div>`
}

function renderNotepadMarkdown(source: string): string {
  const tables = findTableRegions(source)
  const parts: string[] = []
  let cursor = 0

  for (let index = 0; index < tables.length; index += 1) {
    const table = tables[index]
    parts.push(renderMarkdownBodyRegion(source.slice(cursor, table.start), index))
    const tableSource = source.slice(table.start, table.end)
    parts.push(/^\s*<table\b/i.test(tableSource)
      ? tableSource
      : marked.parse(tableSource, { async: false }) as string)
    cursor = table.end
  }
  parts.push(renderMarkdownBodyRegion(source.slice(cursor), tables.length))

  const withTableClass = parts.join('').replace(
    /<table(?![^>]*\bclass=)/gi,
    '<table class="notepad-md-table"',
  )
  return DOMPurify.sanitize(withTableClass)
}

function serializeMarkdownBodyRegion(region: HTMLElement): string {
  return markdownBodySerializer.turndown(region)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

function serializePlainTextBodyRegion(region: HTMLElement): string {
  return (region.innerText ?? region.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

function elementForNode(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement
}

function rangeInsideRoot(root: HTMLElement, range: Range): boolean {
  return root.contains(range.startContainer) && root.contains(range.endContainer)
}

/**
 * Map source character offsets onto the formatted preview DOM. Plain-text
 * regions render their source verbatim (escaped entities decode back to the
 * same characters), so a textarea selection maps 1:1 while it stays inside
 * the text regions.
 */
function locatePreviewRangeByOffsets(root: HTMLElement, start: number, end: number): Range | null {
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

function serializeBodyRegionAtCaret(
  region: HTMLElement,
  range: Range,
  documentType: 'plain' | 'markdown',
): { source: string; offset: number } | null {
  if (!region.contains(range.startContainer)) return null

  let markerText = 'NOTEPADTABLEINSERTIONCARET'
  while (region.textContent?.includes(markerText)) markerText += 'X'
  const marker = document.createElement('span')
  marker.setAttribute('data-notepad-table-insertion-caret', 'true')
  marker.textContent = markerText

  const caret = range.cloneRange()
  caret.collapse(true)
  caret.insertNode(marker)
  const serialized = documentType === 'markdown'
    ? serializeMarkdownBodyRegion(region).trim()
    : serializePlainTextBodyRegion(region)
  marker.remove()

  const offset = serialized.indexOf(markerText)
  if (offset < 0) return null
  return {
    source: serialized.slice(0, offset) + serialized.slice(offset + markerText.length),
    offset,
  }
}

function enableEditablePreviewRegions(
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

function focusAdjacentTableCell(cell: HTMLTableCellElement, direction: 1 | -1): boolean {
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

function focusMarkdownBodyRegion(
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

function focusPlainTextBodyRegion(
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

function markTableRowInsertTarget(
  previous: HTMLTableRowElement | null,
  next: HTMLTableRowElement | null,
): void {
  if (previous && previous !== next) {
    previous.removeAttribute('data-notepad-row-insert-after')
  }
  if (next) next.setAttribute('data-notepad-row-insert-after', 'true')
}

function markTableSelected(
  previous: HTMLTableElement | null,
  next: HTMLTableElement | null,
): void {
  if (previous && previous !== next) {
    previous.removeAttribute('data-notepad-table-selected')
    previous.removeAttribute('aria-selected')
  }
  if (next) {
    next.setAttribute('data-notepad-table-selected', 'true')
    next.setAttribute('aria-selected', 'true')
  }
}

function clearTableRowSelection(table: HTMLTableElement | null): void {
  table?.querySelectorAll<HTMLTableRowElement>('tr[data-notepad-row-selected="true"]')
    .forEach((row) => row.removeAttribute('data-notepad-row-selected'))
}

function markTableRowRangeSelected(
  table: HTMLTableElement,
  start: HTMLTableRowElement | null,
  end: HTMLTableRowElement | null,
): void {
  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'))
  const startIndex = start ? rows.indexOf(start) : -1
  const endIndex = end ? rows.indexOf(end) : -1
  if (startIndex < 0 || endIndex < 0) return

  const first = Math.min(startIndex, endIndex)
  const last = Math.max(startIndex, endIndex)
  clearTableRowSelection(table)
  rows.slice(first, last + 1).forEach((row) => {
    row.setAttribute('data-notepad-row-selected', 'true')
  })
  const allRowsSelected = first === 0 && last === rows.length - 1
  markTableSelected(table, allRowsSelected ? table : null)
}

function tableRowAtPoint(
  table: HTMLTableElement,
  clientY: number,
): HTMLTableRowElement | null {
  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'))
  return rows.find((row) => {
    const rect = row.getBoundingClientRect()
    return clientY >= rect.top && clientY <= rect.bottom
  }) ?? null
}

function insertTableRowAfter(row: HTMLTableRowElement): HTMLTableRowElement | null {
  const table = row.closest('table') as HTMLTableElement | null
  if (!table) return null

  const columnCount = Math.max(
    1,
    Array.from(row.cells).reduce((count, cell) => count + Math.max(1, cell.colSpan), 0),
  )
  const parentSection = row.parentElement as HTMLTableSectionElement | null
  const body = table.tBodies[0] ?? table.createTBody()
  const inserted = parentSection?.tagName === 'THEAD'
    ? body.insertRow(0)
    : parentSection instanceof HTMLTableSectionElement
      ? parentSection.insertRow(row.sectionRowIndex + 1)
      : table.insertRow(row.rowIndex + 1)
  for (let index = 0; index < columnCount; index += 1) {
    const cell = inserted.insertCell()
    cell.append(document.createElement('br'))
  }
  return inserted
}

interface TextEditorProps {
  filePath: string
  onReady: () => void

  onDirty: () => void
  onSaveSuccess: () => void
  onRegisterSave: (fn: (() => Promise<void>) | null) => void
  showTabBar?: boolean
  /** When embedded under the shell tab strip, tab shortcuts operate on outer document tabs. */
  onShellNextTab?: () => void
  onShellPreviousTab?: () => void
  /** Ctrl+W closes the outer shell tab (not only the inner notepad tab model). */
  onShellCloseTab?: () => void
}

interface SelectionRange {
  start: number
  end: number
}

interface TableDragCandidate {
  table: HTMLTableElement
  row: HTMLTableRowElement | null
  startCell: HTMLTableCellElement | null
  startRow: HTMLTableRowElement | null
  currentRow: HTMLTableRowElement | null
  startX: number
  startY: number
  selected: boolean
}

interface PendingTableInsertion {
  tableIndex: number
}

interface HistoryEntry extends SelectionRange {
  text: string
}

interface TextTab {
  id: string
  path: string | null
  name: string
  text: string
  savedText: string
  encoding: TextEncoding
  lineEnding: LineEnding
  selection: SelectionRange
  history: HistoryEntry[]
  historyIndex: number
  dirty: boolean
}

interface PageSetup {
  size: 'A4' | 'Letter'
  orientation: 'portrait' | 'landscape'
  margins: { top: number; right: number; bottom: number; left: number }
  header: string
  footer: string
}

type SpellCheckFormat = 'txt' | 'markdown' | 'subtitles' | 'lrc' | 'lic'

function fontStretchValue(stretch: number): string {
  return [
    'normal',
    'ultra-condensed',
    'extra-condensed',
    'condensed',
    'semi-condensed',
    'normal',
    'semi-expanded',
    'expanded',
    'extra-expanded',
    'ultra-expanded',
  ][stretch] || 'normal'
}

function spellCheckFormatForName(name: string): SpellCheckFormat | null {
  const extension = name.toLowerCase().match(/\.([^.]+)$/)?.[1]
  if (!extension) return 'txt'
  if (extension === 'txt') return 'txt'
  if (extension === 'md' || extension === 'markdown') return 'markdown'
  if (extension === 'srt' || extension === 'ass') return 'subtitles'
  if (extension === 'lrc') return 'lrc'
  if (extension === 'lic') return 'lic'
  return null
}

const NOTEPAD_MIN_ZOOM = 10
const NOTEPAD_MAX_ZOOM = 500
const NOTEPAD_ZOOM_STEP = 10
const NOTEPAD_WHEEL_ZOOM_IDLE_MS = 160
const NOTEPAD_FONT_POINT_TO_PIXEL = 96 / 72

function clampNotepadZoom(value: number): number {
  const stepped = Math.round(value / NOTEPAD_ZOOM_STEP) * NOTEPAD_ZOOM_STEP
  return Math.min(NOTEPAD_MAX_ZOOM, Math.max(NOTEPAD_MIN_ZOOM, stepped))
}

interface NotepadZoomAnchor {
  surface: HTMLElement
  viewportX: number
  viewportY: number
  scrollLeft: number
  scrollTop: number
  scrollWidth: number
  scrollHeight: number
}

function applyNotepadTextZoom(
  root: HTMLElement | null,
  fontSizePoints: number,
  percent: number,
): void {
  if (!root) return
  const pixels = fontSizePoints * NOTEPAD_FONT_POINT_TO_PIXEL * (percent / 100)
  root.style.setProperty('--notepad-editor-font-size', `${pixels}px`)
}

function restoreNotepadZoomAnchor(
  anchor: NotepadZoomAnchor | null,
  wordWrap: boolean,
): void {
  if (!anchor?.surface.isConnected) return
  const { surface } = anchor

  const verticalProgress = (
    anchor.scrollTop + anchor.viewportY
  ) / Math.max(1, anchor.scrollHeight)
  const nextScrollTop = verticalProgress * surface.scrollHeight - anchor.viewportY
  surface.scrollTop = Math.min(
    Math.max(0, nextScrollTop),
    Math.max(0, surface.scrollHeight - surface.clientHeight),
  )

  if (wordWrap) {
    surface.scrollLeft = 0
    return
  }

  const horizontalProgress = (
    anchor.scrollLeft + anchor.viewportX
  ) / Math.max(1, anchor.scrollWidth)
  const nextScrollLeft = horizontalProgress * surface.scrollWidth - anchor.viewportX
  surface.scrollLeft = Math.min(
    Math.max(0, nextScrollLeft),
    Math.max(0, surface.scrollWidth - surface.clientWidth),
  )
}

function createTabId(): string {
  return `notepad-tab-${crypto.randomUUID()}`
}

function expandPrintTemplate(template: string, fileName: string): string {
  const now = new Date()
  return template
    .replaceAll('&f', fileName)
    .replaceAll('&d', now.toLocaleDateString())
    .replaceAll('&t', now.toLocaleTimeString())
    .replaceAll('&p', '1')
    .replaceAll('&&', '&')
}

function readBooleanSetting(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

function readNumberSetting(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : fallback
  } catch {
    return fallback
  }
}

function escapeNotepadLinkText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function escapeNotepadLinkAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/25 p-4 backdrop-blur-[1px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className={`flex max-h-[calc(100%-2rem)] w-full flex-col rounded-2xl border border-black/10 bg-[#f9f9f9] text-[#1f1f1f] shadow-2xl dark:border-white/10 dark:bg-[#2b2b2b] dark:text-[#f5f5f5] ${wide ? 'max-w-[720px]' : 'max-w-[400px]'}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Windows 11 Notepad settings uses a large page title; small utility
            dialogs (Go to / Page setup / Save as) keep the compact header. */}
        <header className={`flex items-center justify-between px-5 ${wide ? 'h-14' : 'h-12'}`}>
          <h2 className={wide ? 'text-[20px] font-semibold' : 'text-[16px] font-semibold'}>{title}</h2>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-black/[0.07] dark:hover:bg-white/[0.08]"
            aria-label={t('menu.close')}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 pb-5">{children}</div>
      </section>
    </div>
  )
}

const inputClass =
  'h-8 w-full rounded-lg border border-black/15 bg-white px-3 text-[13px] outline-none focus:border-[#0067c0] focus:ring-1 focus:ring-[#0067c0] dark:border-white/15 dark:bg-[#202020]'

const dialogButtonClass =
  'h-8 min-w-[82px] rounded-lg border border-black/10 bg-white px-4 text-[13px] hover:bg-black/[0.04] disabled:opacity-45 dark:border-white/10 dark:bg-[#333] dark:hover:bg-white/[0.06]'

const marginLabelKeys = {
  top: 'notepad.marginTop',
  bottom: 'notepad.marginBottom',
  left: 'notepad.marginLeft',
  right: 'notepad.marginRight',
} as const

export function TextEditor({
  filePath,
  onReady,
  onDirty,
  onSaveSuccess,
  onRegisterSave,
  showTabBar = true,
  onShellNextTab,
  onShellPreviousTab,
  onShellCloseTab,
}: TextEditorProps) {
  const { language, t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLElement>(null)
  const editorViewportRef = useRef<HTMLDivElement>(null)
  /** Non-table shell of last painted source — skip full DOM rebuild when only cells change. */
  const lastPreviewShellRef = useRef<string | null>(null)
  /** Exact source already represented by a live contentEditable DOM mutation. */
  const livePreviewSourceRef = useRef<string | null>(null)
  /**
   * Inline format requested from the syntax view on a plain document. Plain
   * text has no `~~`/`**` syntax to insert, so the click is deferred to the
   * formatted preview, where execCommand draws a real strike-through line.
   */
  const pendingPlainFormatRef = useRef<{ command: string; start: number; end: number } | null>(null)
  /** Keep a plain document in the formatted view for a formatting session; the
   * table-only auto-recovery stays off until the user leaves the view. */
  const keepPlainFormattedRef = useRef(false)
  const tableHistoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rowInsertTargetRef = useRef<HTMLTableRowElement | null>(null)
  const tableDragCandidateRef = useRef<TableDragCandidate | null>(null)
  const selectedTableRef = useRef<HTMLTableElement | null>(null)
  const previewSelectionRef = useRef<Range | null>(null)
  const pendingTableInsertionRef = useRef<PendingTableInsertion | null>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const textRef = useRef('')
  const savedTextRef = useRef('')
  const currentPathRef = useRef<string | null>(filePath)
  const encodingRef = useRef<TextEncoding>('utf-8')
  const lineEndingRef = useRef<LineEnding>('crlf')
  const selectionRef = useRef<SelectionRange>({ start: 0, end: 0 })
  const historyRef = useRef<HistoryEntry[]>([])
  const historyIndexRef = useRef(-1)
  const readyOnceRef = useRef(false)
  const editorRootRef = useRef<HTMLDivElement>(null)
  const zoomStatusRef = useRef<HTMLSpanElement>(null)
  const displayNameRef = useRef(filePath.split(/[/\\]/).pop() || filePath)
  const dirtyRef = useRef(false)
  const tabsRef = useRef<TextTab[]>([])
  const activeTabIdRef = useRef(createTabId())

  const setCurrentFile = useEditorStore((state) => state.setCurrentFile)
  const setIsDirty = useEditorStore((state) => state.setIsDirty)
  const notepadFontSizeRef = useRef(readNumberSetting('notepad-font-size', 11))
  const [zoomPercent, setZoomPercent] = useState(() =>
    clampNotepadZoom(readNumberSetting('notepad-zoom', 100)),
  )
  const zoom = zoomPercent / 100
  const liveZoomPercentRef = useRef(zoomPercent)
  const appliedZoomPercentRef = useRef(zoomPercent)
  const wheelZoomGestureRef = useRef<{
    accumulatedDelta: number
    direction: -1 | 0 | 1
    frame: number | null
    idleTimer: ReturnType<typeof setTimeout> | null
    anchor: NotepadZoomAnchor | null
    clientX: number | null
    clientY: number | null
  }>({
    accumulatedDelta: 0,
    direction: 0,
    frame: null,
    idleTimer: null,
    anchor: null,
    clientX: null,
    clientY: null,
  })

  const getZoomSurface = useCallback(
    (): HTMLElement | null => textareaRef.current ?? previewRef.current,
    [],
  )

  const updateZoomIndicator = useCallback((percent: number) => {
    if (editorRootRef.current) {
      editorRootRef.current.dataset.zoom = String(percent / 100)
    }
    if (zoomStatusRef.current) {
      zoomStatusRef.current.textContent = `${percent}%`
    }
  }, [])

  const captureZoomAnchor = useCallback(
    (clientX?: number | null, clientY?: number | null): NotepadZoomAnchor | null => {
      const surface = getZoomSurface()
      if (!surface) return null
      const rect = surface.getBoundingClientRect()
      const viewportX = clientX == null
        ? surface.clientWidth / 2
        : Math.min(surface.clientWidth, Math.max(0, clientX - rect.left))
      const viewportY = clientY == null
        ? surface.clientHeight / 2
        : Math.min(surface.clientHeight, Math.max(0, clientY - rect.top))
      return {
        surface,
        viewportX,
        viewportY,
        scrollLeft: surface.scrollLeft,
        scrollTop: surface.scrollTop,
        scrollWidth: surface.scrollWidth,
        scrollHeight: surface.scrollHeight,
      }
    },
    [getZoomSurface],
  )

  const applyLiveZoom = useCallback(
    (nextPercent: number, clientX?: number | null, clientY?: number | null) => {
      const next = clampNotepadZoom(nextPercent)
      const gesture = wheelZoomGestureRef.current
      const surface = getZoomSurface()
      if (!surface) return
      if (!gesture.anchor || gesture.anchor.surface !== surface) {
        gesture.anchor = captureZoomAnchor(clientX, clientY)
      }

      applyNotepadTextZoom(editorRootRef.current, notepadFontSizeRef.current, next)
      liveZoomPercentRef.current = next
      updateZoomIndicator(next)
      restoreNotepadZoomAnchor(gesture.anchor, wordWrapRef.current)
    },
    [captureZoomAnchor, getZoomSurface, updateZoomIndicator],
  )

  const takeWheelZoomAnchor = useCallback((): NotepadZoomAnchor | null => {
    const gesture = wheelZoomGestureRef.current
    if (gesture.frame !== null) cancelAnimationFrame(gesture.frame)
    if (gesture.idleTimer !== null) clearTimeout(gesture.idleTimer)
    const anchor = gesture.anchor
    gesture.accumulatedDelta = 0
    gesture.direction = 0
    gesture.frame = null
    gesture.idleTimer = null
    gesture.anchor = null
    gesture.clientX = null
    gesture.clientY = null
    return anchor
  }, [])

  const commitZoom = useCallback(
    (nextPercent: number) => {
      const next = clampNotepadZoom(nextPercent)
      liveZoomPercentRef.current = next
      updateZoomIndicator(next)

      if (next === appliedZoomPercentRef.current) {
        return
      }

      setZoomPercent(next)
    },
    [updateZoomIndicator],
  )

  const commitWheelZoom = useCallback(() => {
    const next = liveZoomPercentRef.current
    takeWheelZoomAnchor()
    commitZoom(next)
  }, [commitZoom, takeWheelZoomAnchor])

  const cancelZoomGesture = useCallback(() => {
    takeWheelZoomAnchor()
    applyNotepadTextZoom(
      editorRootRef.current,
      notepadFontSizeRef.current,
      appliedZoomPercentRef.current,
    )
    liveZoomPercentRef.current = appliedZoomPercentRef.current
    updateZoomIndicator(appliedZoomPercentRef.current)
  }, [takeWheelZoomAnchor, updateZoomIndicator])

  const applyDiscreteZoom = useCallback(
    (nextPercent: number) => {
      takeWheelZoomAnchor()
      applyLiveZoom(nextPercent)
      const gesture = wheelZoomGestureRef.current
      if (gesture.idleTimer !== null) clearTimeout(gesture.idleTimer)
      gesture.idleTimer = setTimeout(commitWheelZoom, NOTEPAD_WHEEL_ZOOM_IDLE_MS)
    },
    [applyLiveZoom, commitWheelZoom, takeWheelZoomAnchor],
  )
  const zoomIn = useCallback(
    () => applyDiscreteZoom(liveZoomPercentRef.current + NOTEPAD_ZOOM_STEP),
    [applyDiscreteZoom],
  )
  const zoomOut = useCallback(
    () => applyDiscreteZoom(liveZoomPercentRef.current - NOTEPAD_ZOOM_STEP),
    [applyDiscreteZoom],
  )
  const zoomReset = useCallback(() => applyDiscreteZoom(100), [applyDiscreteZoom])

  const [text, setText] = useState('')
  const [displayName, setDisplayName] = useState(() => filePath.split(/[/\\]/).pop() || filePath)
  const [encoding, setEncoding] = useState<TextEncoding>('utf-8')
  const [lineEnding, setLineEnding] = useState<LineEnding>('crlf')
  const [documentType, setDocumentType] = useState<'plain' | 'markdown'>(() =>
    filePath.toLowerCase().match(/\.(?:md|markdown)$/) ? 'markdown' : 'plain',
  )
  const [markdownView, setMarkdownView] = useState<'formatted' | 'syntax'>(() =>
    'syntax',
  )
  const [settingsInitialSection, setSettingsInitialSection] = useState<
    'theme' | 'font' | 'startup' | 'spelling' | undefined
  >(undefined)
  const [recentFiles, setRecentFiles] = useState<Array<{ path: string; name: string }>>([])
  const [selection, setSelection] = useState<SelectionRange>({ start: 0, end: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [tabs, setTabs] = useState<TextTab[]>([])
  const [activeTabId, setActiveTabId] = useState(activeTabIdRef.current)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [savePromptTab, setSavePromptTab] = useState<TextTab | null>(null)

  const [wordWrap, setWordWrap] = useState(() =>
    readBooleanSetting('notepad-word-wrap', true),
  )
  const wordWrapRef = useRef(wordWrap)
  wordWrapRef.current = wordWrap
  const [statusBar, setStatusBar] = useState(() =>
    readBooleanSetting('notepad-status-bar', true),
  )
  const [formattingEnabled, setFormattingEnabled] = useState(() =>
    readBooleanSetting('notepad-formatting-enabled', true),
  )
  const [spellCheck, setSpellCheck] = useState(() =>
    readBooleanSetting('notepad-spell-check', true),
  )
  const [autoCorrect, setAutoCorrect] = useState(() =>
    readBooleanSetting('notepad-auto-correct', true),
  )
  const [recentFilesEnabled, setRecentFilesEnabled] = useState(() =>
    readBooleanSetting('notepad-recent-files', true),
  )
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(getThemePreference)
  const [openFileBehavior, setOpenFileBehavior] = useState<'tab' | 'window'>(() =>
    localStorage.getItem('notepad-open-files-in') === 'window' ? 'window' : 'tab',
  )
  const [startupBehavior, setStartupBehavior] = useState<'restore' | 'new'>(() =>
    localStorage.getItem('notepad-startup-behavior') === 'new' ? 'new' : 'restore',
  )
  const [fontFamily, setFontFamily] = useState(
    // Windows Notepad's default editor face is Consolas at 11 pt.  Keep the
    // UI chrome on Segoe UI (the root container) and apply this only to text.
    () => localStorage.getItem('notepad-font-family') || 'Consolas',
  )
  const [fontSize, setFontSize] = useState(() => notepadFontSizeRef.current)
  notepadFontSizeRef.current = fontSize
  const [fontSizeInput, setFontSizeInput] = useState(() =>
    String(readNumberSetting('notepad-font-size', 11)),
  )
  const [fontWeight, setFontWeight] = useState(() =>
    readNumberSetting('notepad-font-weight', 400),
  )
  const [fontStyle, setFontStyle] = useState<SystemFontFace['style']>(() => {
    const value = localStorage.getItem('notepad-font-style')
    return value === 'italic' || value === 'oblique' ? value : 'normal'
  })
  const [fontStretch, setFontStretch] = useState(() =>
    readNumberSetting('notepad-font-stretch', 5),
  )
  const [fontFaceName, setFontFaceName] = useState(
    () => localStorage.getItem('notepad-font-face-name') || 'Regular',
  )
  const [systemFontFaces, setSystemFontFaces] = useState<SystemFontFace[]>(
    () => createFallbackSystemFontFaces(language),
  )
  const [spellCheckFormats, setSpellCheckFormats] = useState<Record<SpellCheckFormat, boolean>>(() => ({
    txt: readBooleanSetting('notepad-spell-check-txt', true),
    markdown: readBooleanSetting('notepad-spell-check-markdown', true),
    subtitles: readBooleanSetting('notepad-spell-check-subtitles', true),
    lrc: readBooleanSetting('notepad-spell-check-lrc', true),
    lic: readBooleanSetting('notepad-spell-check-lic', true),
  }))

  const [findOpen, setFindOpen] = useState(false)
  const [replaceMode, setReplaceMode] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [findOptions, setFindOptions] = useState<FindOptions>({
    matchCase: false,
    wrapAround: true,
  })
  const [goToOpen, setGoToOpen] = useState(false)
  const [goToLine, setGoToLine] = useState('1')
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkText, setLinkText] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [pageSetupOpen, setPageSetupOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsPageRef = useRef<HTMLElement>(null)
  const settingsExitAnimationRef = useRef<Animation | null>(null)
  // Windows Notepad: document zoom (wheel AND keyboard) is inert while the
  // settings surface is shown — zoom only ever scales the document text.
  const settingsOpenRef = useRef(false)
  settingsOpenRef.current = settingsOpen
  const closeSettings = useCallback(() => {
    if (!settingsOpenRef.current) return
    const page = settingsPageRef.current
    settingsOpenRef.current = false
    settingsExitAnimationRef.current?.cancel()

    if (
      !page
      || typeof page.animate !== 'function'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setSettingsOpen(false)
      return
    }

    const animation = page.animate(
      [
        { opacity: 1, transform: 'translateX(0)' },
        { opacity: 0, transform: 'translateX(18px)' },
      ],
      { duration: 167, easing: 'cubic-bezier(1, 0, 1, 1)', fill: 'forwards' },
    )
    settingsExitAnimationRef.current = animation
    animation.finished.then(() => {
      if (settingsExitAnimationRef.current !== animation) return
      settingsExitAnimationRef.current = null
      setSettingsOpen(false)
    }).catch(() => {
      if (settingsExitAnimationRef.current !== animation) return
      settingsExitAnimationRef.current = null
      setSettingsOpen(false)
    })
  }, [])

  useEffect(() => {
    if (!settingsOpen) return
    settingsExitAnimationRef.current?.cancel()
    settingsExitAnimationRef.current = null
    settingsOpenRef.current = true
  }, [settingsOpen])
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [saveAsEncoding, setSaveAsEncoding] = useState<TextEncoding>('utf-8')
  const [saveAsLineEnding, setSaveAsLineEnding] = useState<LineEnding>('crlf')
  const [pageSetup, setPageSetup] = useState<PageSetup>({
    size: 'A4',
    orientation: 'portrait',
    margins: { top: 20, right: 20, bottom: 20, left: 20 },
    header: '&f',
    footer: t('notepad.defaultFooter'),
  })
  const localizedDefaultsRef = useRef({
    language,
    untitled: t('notepad.untitled'),
    untitledMarkdown: t('notepad.untitledMarkdown'),
    footer: t('notepad.defaultFooter'),
  })

  useEffect(() => {
    const previous = localizedDefaultsRef.current
    if (previous.language === language) return

    const next = {
      language,
      untitled: t('notepad.untitled'),
      untitledMarkdown: t('notepad.untitledMarkdown'),
      footer: t('notepad.defaultFooter'),
    }
    const renameDefault = (name: string) => {
      if (name === previous.untitled) return next.untitled
      if (name === previous.untitledMarkdown) return next.untitledMarkdown
      return name
    }

    const nextTabs = tabsRef.current.map((tab) => tab.path
      ? tab
      : { ...tab, name: renameDefault(tab.name) })
    tabsRef.current = nextTabs
    setTabs(nextTabs)

    if (!currentPathRef.current) {
      const nextName = renameDefault(displayNameRef.current)
      displayNameRef.current = nextName
      setDisplayName(nextName)
    }

    setPageSetup((value) => value.footer === previous.footer
      ? { ...value, footer: next.footer }
      : value)
    localizedDefaultsRef.current = next
  }, [language, t])

  const fontFamilies = useMemo(() => {
    return getSystemFontFamilyNames(systemFontFaces)
  }, [systemFontFaces])
  const selectedFontFaces = useMemo(() => {
    const faces = systemFontFaces.filter((face) => face.familyName === fontFamily)
    if (faces.length > 0) return faces
    return [{
      familyName: fontFamily,
      displayName: fontFamily,
      faceName: fontFaceName,
      weight: fontWeight,
      style: fontStyle,
      stretch: fontStretch,
    }]
  }, [fontFaceName, fontFamily, fontStretch, fontStyle, fontWeight, systemFontFaces])
  const activeSpellCheckFormat = spellCheckFormatForName(displayName)
  const activeSpellCheck = spellCheck
    && activeSpellCheckFormat !== null
    && spellCheckFormats[activeSpellCheckFormat]

  const syncHistoryState = useCallback(() => {
    setCanUndo(historyIndexRef.current > 0)
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1)
  }, [])

  const replaceTabs = useCallback((next: TextTab[]) => {
    tabsRef.current = next
    setTabs(next)
  }, [])

  const captureCurrentTab = useCallback((): TextTab | null => {
    const existing = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)
    if (!existing) return null
    return {
      ...existing,
      path: currentPathRef.current,
      name: displayNameRef.current,
      text: textRef.current,
      savedText: savedTextRef.current,
      encoding: encodingRef.current,
      lineEnding: lineEndingRef.current,
      selection: { ...selectionRef.current },
      history: historyRef.current.map((entry) => ({ ...entry })),
      historyIndex: historyIndexRef.current,
      dirty: dirtyRef.current,
    }
  }, [])

  const commitCurrentTab = useCallback(() => {
    const snapshot = captureCurrentTab()
    if (!snapshot) return
    replaceTabs(tabsRef.current.map((tab) => tab.id === snapshot.id ? snapshot : tab))
  }, [captureCurrentTab, replaceTabs])

  const registerLoadedTab = useCallback((
    value: string,
    path: string | null,
    name: string,
    nextEncoding: TextEncoding,
    nextEnding: LineEnding,
  ) => {
    const tab: TextTab = {
      id: activeTabIdRef.current,
      path,
      name,
      text: value,
      savedText: value,
      encoding: nextEncoding,
      lineEnding: nextEnding,
      selection: { start: 0, end: 0 },
      history: [{ text: value, start: 0, end: 0 }],
      historyIndex: 0,
      dirty: false,
    }
    const exists = tabsRef.current.some((candidate) => candidate.id === tab.id)
    replaceTabs(exists
      ? tabsRef.current.map((candidate) => candidate.id === tab.id ? tab : candidate)
      : [...tabsRef.current, tab])
  }, [replaceTabs])

  const updateDirtyState = useCallback(
    (value: string) => {
      const nextDirty =
        value !== savedTextRef.current || (!currentPathRef.current && value.length > 0)
      dirtyRef.current = nextDirty
      setIsDirty(nextDirty)
      const nextTabs = tabsRef.current.map((tab) => tab.id === activeTabIdRef.current
        ? { ...tab, dirty: nextDirty, text: value }
        : tab)
      tabsRef.current = nextTabs
      setTabs(nextTabs)
      if (nextDirty) onDirty()
    },
    [onDirty, setIsDirty],
  )

  const focusSelection = useCallback((start: number, end = start) => {
    selectionRef.current = { start, end }
    setSelection({ start, end })
    requestAnimationFrame(() => {
      const editor = textareaRef.current
      if (!editor) return
      editor.focus()
      editor.setSelectionRange(start, end)
    })
  }, [])

  const restoreTab = useCallback((tab: TextTab) => {
    textRef.current = tab.text
    savedTextRef.current = tab.savedText
    currentPathRef.current = tab.path
    displayNameRef.current = tab.name
    dirtyRef.current = tab.dirty
    encodingRef.current = tab.encoding
    lineEndingRef.current = tab.lineEnding
    selectionRef.current = { ...tab.selection }
    historyRef.current = tab.history.map((entry) => ({ ...entry }))
    historyIndexRef.current = tab.historyIndex
    previewSelectionRef.current = null
    pendingTableInsertionRef.current = null
    pendingPlainFormatRef.current = null
    keepPlainFormattedRef.current = false
    setText(tab.text)
    setDisplayName(tab.name)
    setIsDirty(tab.dirty)
    setEncoding(tab.encoding)
    setLineEnding(tab.lineEnding)
    setDocumentType(tab.name.toLowerCase().match(/\.(?:md|markdown)$/) ? 'markdown' : 'plain')
    setSelection({ ...tab.selection })
    syncHistoryState()
    documentBridge.setPlainText(tab.text, tab.path || tab.name)
    requestAnimationFrame(() => focusSelection(tab.selection.start, tab.selection.end))
  }, [focusSelection, setIsDirty, syncHistoryState])

  const syncBridge = useCallback((value: string) => {
    documentBridge.setPlainText(value, currentPathRef.current || 'Untitled.txt')
  }, [])

  const applyText = useCallback(
    (value: string, start: number, end: number, recordHistory: boolean) => {
      textRef.current = value
      setText(value)
      selectionRef.current = { start, end }
      setSelection({ start, end })

      if (recordHistory) {
        const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1)
        nextHistory.push({ text: value, start, end })
        if (nextHistory.length > 500) nextHistory.shift()
        historyRef.current = nextHistory
        historyIndexRef.current = nextHistory.length - 1
        syncHistoryState()
      }

      syncBridge(value)
      updateDirtyState(value)
    },
    [syncBridge, syncHistoryState, updateDirtyState],
  )

  useEffect(() => documentBridge.subscribePlainText((value) => {
    if (value === textRef.current) return
    const cursor = Math.min(selectionRef.current.start, value.length)
    applyText(value, cursor, cursor, true)
  }), [applyText])

  const resetDocument = useCallback(
    (value: string, path: string | null, name: string, nextEncoding: TextEncoding, nextEnding: LineEnding) => {
      textRef.current = value
      savedTextRef.current = value
      currentPathRef.current = path
      displayNameRef.current = name
      dirtyRef.current = false
      encodingRef.current = nextEncoding
      lineEndingRef.current = nextEnding
      selectionRef.current = { start: 0, end: 0 }
      historyRef.current = [{ text: value, start: 0, end: 0 }]
      historyIndexRef.current = 0
      previewSelectionRef.current = null
      pendingTableInsertionRef.current = null
      pendingPlainFormatRef.current = null
      keepPlainFormattedRef.current = false
      setText(value)
      setDisplayName(name)
      setEncoding(nextEncoding)
      setLineEnding(nextEnding)
      const isMd = Boolean(name.toLowerCase().match(/\.(?:md|markdown)$/))
      setDocumentType(isMd ? 'markdown' : 'plain')
      if (isMd) setMarkdownView('syntax')
      setSelection({ start: 0, end: 0 })
      setIsDirty(false)
      syncHistoryState()
      documentBridge.setPlainText(value, path || 'Untitled.txt')
      registerLoadedTab(value, path, name, nextEncoding, nextEnding)
    },
    [registerLoadedTab, setIsDirty, syncHistoryState],
  )

  const saveDocument = useCallback(
    async (
      saveAs: boolean,
      options?: { encoding: TextEncoding; lineEnding: LineEnding },
    ): Promise<boolean> => {
      let target = currentPathRef.current
      if (saveAs || !target) {
        const defaultName = /\.[^./\\]+$/.test(displayName) ? displayName : `${displayName}.txt`
        target = (await desktopApi.files.selectSaveFile(defaultName))?.path ?? null
      }
      if (!target) return false

      const value = textRef.current
      const targetLineEnding = options?.lineEnding ?? lineEndingRef.current
      const targetEncoding = options?.encoding ?? encodingRef.current
      const diskText = applyLineEnding(value, targetLineEnding)
      await desktopApi.documents.saveText(target, diskText, targetEncoding)

      savedTextRef.current = value
      currentPathRef.current = target
      dirtyRef.current = false
      encodingRef.current = targetEncoding
      lineEndingRef.current = targetLineEnding
      setEncoding(targetEncoding)
      setLineEnding(targetLineEnding)
      setIsDirty(false)
      documentBridge.setPlainText(value, target)

      const nextName = target.split(/[/\\]/).pop() || target
      displayNameRef.current = nextName
      setDisplayName(nextName)
      setDocumentType(nextName.toLowerCase().match(/\.(?:md|markdown)$/) ? 'markdown' : 'plain')
      const opened = await desktopApi.files.open(target)
      setRecentFiles(opened.recent)
      if (target !== filePath) setCurrentFile(target, nextName)
      const current = captureCurrentTab()
      if (current) {
        replaceTabs(tabsRef.current.map((tab) => tab.id === current.id
          ? { ...current, path: target, name: nextName, savedText: value, dirty: false }
          : tab))
      }
      onSaveSuccess()
      return true
    },
    [captureCurrentTab, displayName, filePath, onSaveSuccess, replaceTabs, setCurrentFile, setIsDirty],
  )

  const saveAllDocuments = useCallback(async () => {
    commitCurrentTab()
    const originalId = activeTabIdRef.current
    for (const tab of [...tabsRef.current]) {
      if (!tab.dirty) continue
      if (tab.path) {
        const diskText = applyLineEnding(tab.text, tab.lineEnding)
        await desktopApi.documents.saveText(tab.path, diskText, tab.encoding)
        replaceTabs(tabsRef.current.map((candidate) => candidate.id === tab.id
          ? { ...candidate, savedText: candidate.text, dirty: false }
          : candidate))
        continue
      }
      activeTabIdRef.current = tab.id
      setActiveTabId(tab.id)
      restoreTab(tab)
      if (!await saveDocument(false)) break
      commitCurrentTab()
    }
    const original = tabsRef.current.find((tab) => tab.id === originalId)
    if (original) {
      activeTabIdRef.current = original.id
      setActiveTabId(original.id)
      restoreTab(original)
    }
  }, [commitCurrentTab, replaceTabs, restoreTab, saveDocument])

  useEffect(() => {
    if (tabsRef.current.length > 0 && currentPathRef.current === filePath) {
      setLoading(false)
      if (!readyOnceRef.current) {
        readyOnceRef.current = true
        onReady()
      }
      return
    }

    const existingTab = tabsRef.current.find((tab) => tab.path === filePath)
    if (existingTab) {
      commitCurrentTab()
      activeTabIdRef.current = existingTab.id
      setActiveTabId(existingTab.id)
      restoreTab(existingTab)
      setLoading(false)
      if (!readyOnceRef.current) {
        readyOnceRef.current = true
        onReady()
      }
      return
    }

    if (tabsRef.current.length > 0) {
      commitCurrentTab()
      const nextId = createTabId()
      activeTabIdRef.current = nextId
      setActiveTabId(nextId)
    }

    let cancelled = false
    setLoading(true)
    setError(false)
    readyOnceRef.current = false
    documentBridge.clear()
    onRegisterSave(null)

    async function load() {
      try {
        const buffer = await readFileBuffer(filePath)
        if (cancelled) return
        const decoded = decodeTextFile(buffer)
        const name = filePath.split(/[/\\]/).pop() || filePath
        resetDocument(decoded.text, filePath, name, decoded.encoding, decoded.lineEnding)
        localStorage.setItem('notepad-last-file', filePath)
        setLoading(false)
        if (!readyOnceRef.current) {
          readyOnceRef.current = true
          onReady()
        }
      } catch (loadError) {
        if (cancelled) return
        console.error('[TextEditor] text file load failed:', loadError)
        setError(true)
        setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      documentBridge.clear()
      onRegisterSave(null)
    }
  }, [commitCurrentTab, filePath, onReady, onRegisterSave, resetDocument, restoreTab])

  useEffect(() => {
    onRegisterSave(async () => {
      await saveDocument(false)
    })
  }, [onRegisterSave, saveDocument])

  useEffect(() => {
    if (!findOpen) return
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }, [findOpen, replaceMode])

  useEffect(() => {
    localStorage.setItem('notepad-word-wrap', String(wordWrap))
  }, [wordWrap])

  useEffect(() => {
    void loadSystemFontFaces(language).then((fonts) => {
      if (fonts.length === 0) return
      setSystemFontFaces(fonts)
      const familyFaces = fonts.filter((face) => face.familyName === fontFamily)
      if (
        familyFaces.length === 0
        || familyFaces.some((face) =>
          face.weight === fontWeight
          && face.style === fontStyle
          && face.stretch === fontStretch
          && face.faceName === fontFaceName,
        )
      ) return
      const next = familyFaces.find((face) =>
        face.weight === 400 && face.style === 'normal' && face.stretch === 5,
      )
        || familyFaces[0]
      setFontWeight(next.weight)
      setFontStyle(next.style)
      setFontStretch(next.stretch)
      setFontFaceName(next.faceName)
      localStorage.setItem('notepad-font-weight', String(next.weight))
      localStorage.setItem('notepad-font-style', next.style)
      localStorage.setItem('notepad-font-stretch', String(next.stretch))
      localStorage.setItem('notepad-font-face-name', next.faceName)
    }).catch(() => {})
  }, [language])

  useEffect(() => {
    localStorage.setItem('notepad-status-bar', String(statusBar))
  }, [statusBar])

  useEffect(() => {
    if (!recentFilesEnabled) {
      setRecentFiles([])
      return
    }
    void desktopApi.files.getRecent().then((files) => setRecentFiles(files))
  }, [filePath, recentFilesEnabled])

  useEffect(() => {
    localStorage.setItem('notepad-zoom', String(zoomPercent))
  }, [zoomPercent])

  useLayoutEffect(() => {
    applyNotepadTextZoom(editorRootRef.current, fontSize, zoomPercent)
    appliedZoomPercentRef.current = zoomPercent
    liveZoomPercentRef.current = zoomPercent
    updateZoomIndicator(zoomPercent)
  }, [fontSize, updateZoomIndicator, zoomPercent])

  useLayoutEffect(() => {
    const viewport = editorViewportRef.current
    if (!viewport) return

    const syncViewportWidth = () => {
      const width = viewport.getBoundingClientRect().width
      if (width > 0) {
        const nextWidth = `${Math.round(width * 100) / 100}px`
        if (viewport.style.getPropertyValue('--notepad-content-width') !== nextWidth) {
          viewport.style.setProperty('--notepad-content-width', nextWidth)
        }
      }

      // Wrapped text must always start at the viewport's inline origin. A
      // stale scrollLeft after a resize/zoom is what produces a blank column.
      if (wordWrap) {
        if (textareaRef.current) textareaRef.current.scrollLeft = 0
        if (previewRef.current) previewRef.current.scrollLeft = 0
      }
    }

    const resizeObserver = new ResizeObserver(syncViewportWidth)
    resizeObserver.observe(viewport)
    syncViewportWidth()
    return () => resizeObserver.disconnect()
  }, [loading, markdownView, wordWrap])

  useEffect(() => {
    const root = editorRootRef.current
    if (!root) return

    const flushWheelZoom = () => {
      const gesture = wheelZoomGestureRef.current
      gesture.frame = null
      const { steps, remainder } = consumeWheelZoomSteps(gesture.accumulatedDelta)
      gesture.accumulatedDelta = remainder
      if (steps === 0) return
      applyLiveZoom(
        liveZoomPercentRef.current - steps * NOTEPAD_ZOOM_STEP,
        gesture.clientX,
        gesture.clientY,
      )
    }

    const handleWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const delta = normalizeWheelZoomDelta(event.deltaY, event.deltaMode)
      if (delta === 0) return
      event.preventDefault()
      if (settingsOpenRef.current) return
      event.stopPropagation()

      const gesture = wheelZoomGestureRef.current
      const direction = Math.sign(delta) as -1 | 1
      if (gesture.direction !== 0 && gesture.direction !== direction) {
        gesture.accumulatedDelta = 0
      }
      gesture.direction = direction
      gesture.accumulatedDelta += delta
      gesture.clientX = event.clientX
      gesture.clientY = event.clientY

      if (gesture.frame === null) {
        gesture.frame = requestAnimationFrame(flushWheelZoom)
      }
      if (gesture.idleTimer !== null) clearTimeout(gesture.idleTimer)
      gesture.idleTimer = setTimeout(commitWheelZoom, NOTEPAD_WHEEL_ZOOM_IDLE_MS)
    }
    root.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      root.removeEventListener('wheel', handleWheel)
      cancelZoomGesture()
    }
  }, [applyLiveZoom, cancelZoomGesture, commitWheelZoom, loading])

  useLayoutEffect(() => {
    commitWheelZoom()
  }, [activeTabId, commitWheelZoom, markdownView, settingsOpen])

  const currentSelection = useCallback((): SelectionRange => {
    const editor = textareaRef.current
    if (!editor) return selectionRef.current
    return { start: editor.selectionStart, end: editor.selectionEnd }
  }, [])

  const syncSelection = useCallback(() => {
    const next = currentSelection()
    selectionRef.current = next
    setSelection(next)
  }, [currentSelection])

  const capturePreviewSelection = useCallback(() => {
    const root = previewRef.current
    const domSelection = window.getSelection()
    if (!root || !domSelection || domSelection.rangeCount === 0) return
    const range = domSelection.getRangeAt(0)
    if (!rangeInsideRoot(root, range)) return
    previewSelectionRef.current = range.cloneRange()
  }, [])

  useEffect(() => {
    if (markdownView !== 'formatted') {
      previewSelectionRef.current = null
      return
    }
    document.addEventListener('selectionchange', capturePreviewSelection)
    return () => document.removeEventListener('selectionchange', capturePreviewSelection)
  }, [capturePreviewSelection, markdownView])

  const replaceSelection = useCallback(
    (replacement: string, selectReplacement = false) => {
      const range = currentSelection()
      const next =
        textRef.current.slice(0, range.start) + replacement + textRef.current.slice(range.end)
      const start = range.start
      const end = selectReplacement ? start + replacement.length : start + replacement.length
      applyText(next, selectReplacement ? start : end, end, true)
      focusSelection(selectReplacement ? start : end, end)
    },
    [applyText, currentSelection, focusSelection],
  )

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    applyText(
      event.currentTarget.value,
      event.currentTarget.selectionStart,
      event.currentTarget.selectionEnd,
      true,
    )
  }

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return
    historyIndexRef.current -= 1
    const entry = historyRef.current[historyIndexRef.current]
    // Force formatted preview rebuild so table cells match restored source.
    lastPreviewShellRef.current = null
    applyText(entry.text, entry.start, entry.end, false)
    syncHistoryState()
    focusSelection(entry.start, entry.end)
  }, [applyText, focusSelection, syncHistoryState])

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return
    historyIndexRef.current += 1
    const entry = historyRef.current[historyIndexRef.current]
    lastPreviewShellRef.current = null
    applyText(entry.text, entry.start, entry.end, false)
    syncHistoryState()
    focusSelection(entry.start, entry.end)
  }, [applyText, focusSelection, syncHistoryState])

  const newDocument = useCallback(() => {
    commitCurrentTab()
    const nextId = createTabId()
    activeTabIdRef.current = nextId
    setActiveTabId(nextId)
    resetDocument('', null, t('notepad.untitled'), 'utf-8', 'crlf')
    setFindOpen(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [commitCurrentTab, resetDocument, t])

  const newMarkdownDocument = useCallback(() => {
    commitCurrentTab()
    const nextId = createTabId()
    activeTabIdRef.current = nextId
    setActiveTabId(nextId)
    resetDocument('', null, t('notepad.untitledMarkdown'), 'utf-8', 'crlf')
    setMarkdownView('syntax')
    setFindOpen(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [commitCurrentTab, resetDocument, t])

  const openDocument = useCallback(async () => {
    const selected = await desktopApi.files.selectFile('text')
    if (!selected) return
    const target = selected.path
    if (openFileBehavior === 'window') {
      await desktopApi.app.newWindow(target)
      return
    }
    await desktopApi.files.open(target)
    setCurrentFile(target)
  }, [openFileBehavior, setCurrentFile])

  const openRecentDocument = useCallback(async (target: string) => {
    if (openFileBehavior === 'window') {
      await desktopApi.app.newWindow(target)
      return
    }
    await desktopApi.files.open(target)
    setCurrentFile(target)
  }, [openFileBehavior, setCurrentFile])

  const switchTab = useCallback((tabId: string) => {
    if (tabId === activeTabIdRef.current) return
    commitCurrentTab()
    const target = tabsRef.current.find((tab) => tab.id === tabId)
    if (!target) return
    activeTabIdRef.current = tabId
    setActiveTabId(tabId)
    restoreTab(target)
    setFindOpen(false)
  }, [commitCurrentTab, restoreTab])

  const performCloseTab = useCallback((tabId: string) => {
    if (tabId === activeTabIdRef.current) commitCurrentTab()
    const currentTabs = tabsRef.current
    const index = currentTabs.findIndex((tab) => tab.id === tabId)
    if (index < 0) return
    if (currentTabs.length === 1) {
      setCurrentFile(null)
      return
    }
    const remaining = currentTabs.filter((candidate) => candidate.id !== tabId)
    replaceTabs(remaining)
    if (tabId !== activeTabIdRef.current) return
    const next = remaining[Math.min(index, remaining.length - 1)]
    activeTabIdRef.current = next.id
    setActiveTabId(next.id)
    restoreTab(next)
  }, [commitCurrentTab, replaceTabs, restoreTab, setCurrentFile])

  const closeTab = useCallback((tabId: string, force = false) => {
    if (tabId === activeTabIdRef.current) commitCurrentTab()
    const currentTabs = tabsRef.current
    const index = currentTabs.findIndex((tab) => tab.id === tabId)
    if (index < 0) return
    const tab = currentTabs[index]
    if (tab.dirty && !force) {
      setSavePromptTab(tab)
      return
    }
    performCloseTab(tabId)
  }, [commitCurrentTab, performCloseTab])

  const closeDocument = useCallback(() => {
    closeTab(activeTabIdRef.current)
  }, [closeTab])

  const handleDialogSave = useCallback(async () => {
    if (!savePromptTab) return
    const tabToClose = savePromptTab
    if (tabToClose.id === activeTabIdRef.current) {
      const ok = await saveDocument(false)
      if (ok) {
        performCloseTab(tabToClose.id)
        setSavePromptTab(null)
      }
    } else {
      if (tabToClose.path) {
        const diskText = applyLineEnding(tabToClose.text, tabToClose.lineEnding)
        await desktopApi.documents.saveText(tabToClose.path, diskText, tabToClose.encoding)
        performCloseTab(tabToClose.id)
        setSavePromptTab(null)
      } else {
        activeTabIdRef.current = tabToClose.id
        setActiveTabId(tabToClose.id)
        restoreTab(tabToClose)
        const ok = await saveDocument(false)
        if (ok) {
          performCloseTab(tabToClose.id)
          setSavePromptTab(null)
        }
      }
    }
  }, [performCloseTab, restoreTab, saveDocument, savePromptTab])

  const handleDialogDontSave = useCallback(() => {
    if (savePromptTab) {
      performCloseTab(savePromptTab.id)
    }
    setSavePromptTab(null)
  }, [performCloseTab, savePromptTab])

  const handleDialogCancel = useCallback(() => {
    setSavePromptTab(null)
  }, [])

  const closeWindow = useCallback(() => {
    commitCurrentTab()
    const dirtyTabs = tabsRef.current.filter((tab) => tab.dirty)
    if (dirtyTabs.length > 0) {
      const names = new Intl.ListFormat(language, { style: 'long', type: 'conjunction' })
        .format(dirtyTabs.map((tab) => tab.name))
      if (!window.confirm(t('notepad.discardChanges', { names }))) return
    }
    void desktopApi.app.close()
  }, [commitCurrentTab, language, t])

  const exitApplication = useCallback(() => {
    commitCurrentTab()
    const dirtyTabs = tabsRef.current.filter((tab) => tab.dirty)
    if (dirtyTabs.length > 0) {
      const names = new Intl.ListFormat(language, { style: 'long', type: 'conjunction' })
        .format(dirtyTabs.map((tab) => tab.name))
      if (!window.confirm(t('notepad.discardChanges', { names }))) return
    }
    void desktopApi.app.quit()
  }, [commitCurrentTab, language, t])

  const copySelection = useCallback(async () => {
    const range = currentSelection()
    if (range.start === range.end) return
    await navigator.clipboard.writeText(textRef.current.slice(range.start, range.end))
  }, [currentSelection])

  const cutSelection = useCallback(async () => {
    const range = currentSelection()
    if (range.start === range.end) return
    await navigator.clipboard.writeText(textRef.current.slice(range.start, range.end))
    replaceSelection('')
  }, [currentSelection, replaceSelection])

  const paste = useCallback(async () => {
    try {
      replaceSelection(await navigator.clipboard.readText())
    } catch {
      textareaRef.current?.focus()
      document.execCommand('paste')
    }
  }, [replaceSelection])

  const openFind = useCallback((replace: boolean) => {
    const range = currentSelection()
    const selected = textRef.current.slice(range.start, range.end)
    if (selected && !selected.includes('\n')) setFindQuery(selected)
    setReplaceMode(replace)
    setFindOpen(true)
  }, [currentSelection])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  const navigateFind = useCallback(
    (direction: 1 | -1) => {
      const matches = findTextMatches(textRef.current, findQuery, findOptions)
      if (!matches.length) {
        findInputRef.current?.focus()
        return
      }

      const range = currentSelection()
      let match
      if (direction === 1) {
        const from = range.end > range.start ? range.end : range.start
        match = matches.find((candidate) => candidate.start >= from)
          || (findOptions.wrapAround ? matches[0] : undefined)
      } else {
        match = [...matches].reverse().find((candidate) => candidate.end <= range.start)
          || (findOptions.wrapAround ? matches[matches.length - 1] : undefined)
      }
      if (!match) return
      focusSelection(match.start, match.end)
    },
    [currentSelection, findOptions, findQuery, focusSelection],
  )

  const replaceCurrentMatch = useCallback(() => {
    if (!findQuery) return
    const range = currentSelection()
    const selected = textRef.current.slice(range.start, range.end)
    const selectedMatches = findTextMatches(selected, findQuery, findOptions)
    if (selectedMatches.length === 1 && selectedMatches[0].start === 0 && selectedMatches[0].end === selected.length) {
      replaceSelection(replaceText)
      navigateFind(1)
      return
    }
    navigateFind(1)
  }, [currentSelection, findOptions, findQuery, navigateFind, replaceSelection, replaceText])

  const replaceAllMatches = useCallback(() => {
    const matches = findTextMatches(textRef.current, findQuery, findOptions)
    if (!matches.length) return
    let next = textRef.current
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      const match = matches[index]
      next = next.slice(0, match.start) + replaceText + next.slice(match.end)
    }
    const caret = matches[0].start + replaceText.length
    applyText(next, caret, caret, true)
    focusSelection(caret)
  }, [applyText, findOptions, findQuery, focusSelection, replaceText])

  const wrapInline = useCallback(
    (before: string, after = before) => {
      const range = currentSelection()
      const selected = textRef.current.slice(range.start, range.end)
      const replacement = `${before}${selected}${after}`
      const next = textRef.current.slice(0, range.start) + replacement + textRef.current.slice(range.end)
      const start = range.start + before.length
      const end = start + selected.length
      applyText(next, selected ? start : end, end, true)
    focusSelection(selected ? start : end, end)
    },
    [applyText, currentSelection, focusSelection],
  )

  const insertTable = useCallback((rows: number, columns: number) => {
    // Formatted view has no textarea selection. Resolve its live DOM caret back
    // to the corresponding source region before inserting the table block.
    let source = textRef.current
    let range = currentSelection()
    const root = previewRef.current

    if (markdownView === 'formatted' && root) {
      const domSelection = window.getSelection()
      const liveRange = domSelection && domSelection.rangeCount > 0
        ? domSelection.getRangeAt(0)
        : null
      const previewRange = liveRange && rangeInsideRoot(root, liveRange)
        ? liveRange.cloneRange()
        : previewSelectionRef.current?.cloneRange() ?? null

      if (previewRange && rangeInsideRoot(root, previewRange)) {
        const anchor = elementForNode(previewRange.startContainer)
        const table = anchor?.closest('table') as HTMLTableElement | null
        if (table && root.contains(table)) {
          const rawIndex = table.getAttribute('data-notepad-table-index')
          const tableIndex = rawIndex !== null
            ? Number.parseInt(rawIndex, 10)
            : Array.from(root.querySelectorAll('table')).indexOf(table)
          const tableRegion = findTableRegions(source)[tableIndex]
          if (tableRegion) range = { start: tableRegion.end, end: tableRegion.end }
        } else {
          const bodyRegion = anchor?.closest(
            '[data-notepad-text-region], [data-notepad-markdown-region]',
          ) as HTMLElement | null
          if (bodyRegion && root.contains(bodyRegion)) {
            const attribute = documentType === 'markdown'
              ? 'data-notepad-markdown-region'
              : 'data-notepad-text-region'
            const regionIndex = Number.parseInt(bodyRegion.getAttribute(attribute) ?? '', 10)
            const sourceRegions = documentType === 'markdown'
              ? findMarkdownBodyRegions(source)
              : findPlainTextBodyRegions(source)
            const sourceRegion = sourceRegions[regionIndex]
            const serialized = serializeBodyRegionAtCaret(
              bodyRegion,
              previewRange,
              documentType,
            )

            if (sourceRegion && serialized) {
              const currentBody = source.slice(sourceRegion.start, sourceRegion.end)
              let nextBody = serialized.source
              let bodyOffset = serialized.offset

              if (documentType === 'markdown' && /\S/.test(currentBody)) {
                const leading = currentBody.match(/^\s*/)?.[0] ?? ''
                const trailing = currentBody.match(/\s*$/)?.[0] ?? ''
                nextBody = leading + serialized.source + trailing
                bodyOffset += leading.length
              } else if (
                documentType === 'markdown'
                && !/\S/.test(currentBody)
                && serialized.source.length === 0
              ) {
                nextBody = currentBody
                bodyOffset = regionIndex === 0 ? currentBody.length : 0
              }

              source = source.slice(0, sourceRegion.start)
                + nextBody
                + source.slice(sourceRegion.end)
              const sourceOffset = sourceRegion.start + bodyOffset
              range = { start: sourceOffset, end: sourceOffset }
            }
          }
        }
      }
    }

    const insertion = insertHtmlTableAtSelection(
      source,
      range.start,
      range.end,
      rows,
      columns,
      'data-notepad-new-table="true"',
    )
    const tableIndex = findTableRegions(insertion.source).findIndex(
      (region) => region.start === insertion.tableStart,
    )
    pendingTableInsertionRef.current = {
      tableIndex: tableIndex >= 0 ? tableIndex : 0,
    }
    previewSelectionRef.current = null
    livePreviewSourceRef.current = null
    lastPreviewShellRef.current = null
    applyText(insertion.source, insertion.caret, insertion.caret, true)
    setMarkdownView('formatted')
  }, [applyText, currentSelection, documentType, markdownView])

  const syncPlainPreviewToSource = useCallback((recordHistory: boolean) => {
    const root = previewRef.current
    if (!root) return

    const next = serializePlainTextTableDocument(root)
    if (next === textRef.current) return

    livePreviewSourceRef.current = next
    lastPreviewShellRef.current = stripTableRegions(next)
    const selection = selectionRef.current
    applyText(next, selection.start, selection.end, recordHistory)
  }, [applyText])

  const syncMarkdownTableToSource = useCallback((table: HTMLTableElement) => {
    const root = previewRef.current
    if (!root) return
    const rawIndex = table.getAttribute('data-notepad-table-index')
    const tableIndex = rawIndex !== null
      ? Number.parseInt(rawIndex, 10)
      : Array.from(root.querySelectorAll('table')).indexOf(table)
    if (tableIndex < 0) return

    const next = replaceTableInSource(
      textRef.current,
      tableIndex,
      serializeTableElement(table),
    )
    if (next === textRef.current) return

    // Only the active table is replaced. Pipe tables and richer raw HTML tables
    // elsewhere in the document remain byte-identical.
    livePreviewSourceRef.current = next
    lastPreviewShellRef.current = stripTableRegions(next)
    const caret = selectionRef.current
    applyText(next, caret.start, caret.end, false)
  }, [applyText])

  const formatFormattedPreview = useCallback((command: string, link?: { url: string; text: string }): void => {
    const root = previewRef.current
    if (!root) return

    const domSelection = window.getSelection()
    if (!domSelection || domSelection.rangeCount === 0 || !rangeInsideRoot(root, domSelection.getRangeAt(0))) {
      if (previewSelectionRef.current && rangeInsideRoot(root, previewSelectionRef.current)) {
        domSelection?.removeAllRanges()
        domSelection?.addRange(previewSelectionRef.current.cloneRange())
      } else {
        const firstRegion = root.querySelector<HTMLElement>('[data-notepad-markdown-region], [data-notepad-text-region]')
        if (firstRegion) {
          firstRegion.focus()
          const range = document.createRange()
          range.selectNodeContents(firstRegion)
          domSelection?.removeAllRanges()
          domSelection?.addRange(range)
        }
      }
    }

    if (command === 'bold') {
      document.execCommand('bold')
    } else if (command === 'italic') {
      document.execCommand('italic')
    } else if (command === 'strikethrough') {
      document.execCommand('strikeThrough')
    } else if (command === 'underline') {
      document.execCommand('underline')
    } else if (command === 'heading-1' || command === 'title') {
      document.execCommand('formatBlock', false, '<h1>')
    } else if (command === 'heading-2' || command === 'subtitle') {
      document.execCommand('formatBlock', false, '<h2>')
    } else if (command === 'heading-3' || command === 'heading') {
      document.execCommand('formatBlock', false, '<h3>')
    } else if (command === 'heading-4' || command === 'subheading') {
      document.execCommand('formatBlock', false, '<h4>')
    } else if (command === 'heading-5' || command === 'section') {
      document.execCommand('formatBlock', false, '<h5>')
    } else if (command === 'heading-6' || command === 'subsection') {
      document.execCommand('formatBlock', false, '<h6>')
    } else if (command === 'paragraph') {
      document.execCommand('formatBlock', false, '<p>')
    } else if (command === 'bullet-list') {
      document.execCommand('insertUnorderedList')
    } else if (command === 'number-list') {
      document.execCommand('insertOrderedList')
    } else if (command === 'increase-indent') {
      document.execCommand('indent')
    } else if (command === 'decrease-indent') {
      document.execCommand('outdent')
    } else if (command === 'clear-format') {
      document.execCommand('removeFormat')
    } else if (command === 'link') {
      const url = link?.url.trim()
      if (!url) return
      const label = link?.text.trim() ?? ''
      // execCommand targets the focused editable host; after the link dialog
      // had focus, re-focus the region carrying the restored selection first.
      const activeSelection = window.getSelection()
      const activeRange = activeSelection && activeSelection.rangeCount > 0
        && rangeInsideRoot(root, activeSelection.getRangeAt(0))
        ? activeSelection.getRangeAt(0)
        : null
      const host = activeRange
        ? elementForNode(activeRange.startContainer)?.closest<HTMLElement>('[contenteditable="true"]') ?? null
        : null
      if (host) host.focus()
      if (activeSelection && activeRange) {
        activeSelection.removeAllRanges()
        activeSelection.addRange(activeRange)
      }
      const selectedText = activeRange && !activeRange.collapsed ? activeRange.toString() : ''
      if (selectedText && (!label || label === selectedText)) {
        document.execCommand('createLink', false, url)
      } else {
        const anchorHtml
          = `<a href="${escapeNotepadLinkAttribute(url)}">${escapeNotepadLinkText(label || selectedText || url)}</a>`
        document.execCommand('insertHTML', false, anchorHtml)
      }
    }

    capturePreviewSelection()

    const currentSel = window.getSelection()
    const anchor = currentSel?.anchorNode ? elementForNode(currentSel.anchorNode) : null
    const cell = anchor?.closest?.('th, td') as HTMLTableCellElement | null
    const markdownRegion = anchor?.closest?.('[data-notepad-markdown-region]') as HTMLElement | null
      || root.querySelector<HTMLElement>('[data-notepad-markdown-region]')

    if (documentType === 'markdown' && cell && root.contains(cell)) {
      const table = cell.closest('table') as HTMLTableElement | null
      if (table) syncMarkdownTableToSource(table)
    } else if (documentType === 'markdown' && markdownRegion && root.contains(markdownRegion)) {
      const regionIndex = Number.parseInt(
        markdownRegion.getAttribute('data-notepad-markdown-region') ?? '0',
        10,
      )
      if (Number.isInteger(regionIndex)) {
        const next = replaceMarkdownBodyRegion(
          textRef.current,
          regionIndex,
          serializeMarkdownBodyRegion(markdownRegion),
        )
        if (next !== textRef.current) {
          livePreviewSourceRef.current = next
          lastPreviewShellRef.current = stripTableRegions(next)
          applyText(next, selectionRef.current.start, selectionRef.current.end, true)
        }
      }
    } else if (documentType === 'plain') {
      syncPlainPreviewToSource(true)
    }
  }, [
    applyText,
    capturePreviewSelection,
    documentType,
    syncMarkdownTableToSource,
    syncPlainPreviewToSource,
  ])

  const formatLines = useCallback(
    (command: string) => {
      const range = currentSelection()
      const lineStart = textRef.current.lastIndexOf('\n', Math.max(0, range.start - 1)) + 1
      const nextBreak = textRef.current.indexOf('\n', range.end)
      const lineEnd = nextBreak < 0 ? textRef.current.length : nextBreak
      const lines = textRef.current.slice(lineStart, lineEnd).split('\n')
      const transformed = lines.map((line, index) => {
        const plain = line.replace(/^(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|- \[[ xX]\]\s+)/, '')
        if (command === 'heading-1' || command === 'title') return `# ${plain}`
        if (command === 'heading-2' || command === 'subtitle') return `## ${plain}`
        if (command === 'heading-3' || command === 'heading') return `### ${plain}`
        if (command === 'heading-4' || command === 'subheading') return `#### ${plain}`
        if (command === 'heading-5' || command === 'section') return `##### ${plain}`
        if (command === 'heading-6' || command === 'subsection') return `###### ${plain}`
        if (command === 'paragraph') return plain
        if (command === 'bullet-list') return `- ${plain}`
        if (command === 'number-list') return `${index + 1}. ${plain}`
        if (command === 'increase-indent') return `  ${line}`
        if (command === 'decrease-indent') return line.replace(/^(?: {1,2}|\t)/, '')
        if (command === 'check-list') return `- [ ] ${plain}`
        return plain
      }).join('\n')
      const next = textRef.current.slice(0, lineStart) + transformed + textRef.current.slice(lineEnd)
      applyText(next, lineStart, lineStart + transformed.length, true)
      focusSelection(lineStart, lineStart + transformed.length)
    },
    [applyText, currentSelection, focusSelection],
  )

  const formatText = useCallback(
    (command: string) => {
      // 链接通过自定义对话框插入(显示文本 + 地址);确认时再依据当前视图
      // 分发到富文本 createLink/insertHTML 或 Markdown 语法包装。
      if (command === 'link') {
        let selectedText = ''
        if (markdownView === 'formatted') {
          const root = previewRef.current
          const domSelection = window.getSelection()
          const liveRange = domSelection && domSelection.rangeCount > 0 && root
            && rangeInsideRoot(root, domSelection.getRangeAt(0))
            ? domSelection.getRangeAt(0)
            : null
          selectedText = liveRange && !liveRange.collapsed
            ? liveRange.toString()
            : previewSelectionRef.current?.toString() ?? ''
        } else {
          const range = currentSelection()
          selectedText = textRef.current.slice(range.start, range.end)
        }
        setLinkText(selectedText)
        setLinkUrl('')
        setLinkDialogOpen(true)
        return
      }
      if (markdownView === 'formatted') {
        formatFormattedPreview(command)
        return
      }
      // 行内格式(加粗/斜体/下划线/删除线)在语法视图点击时,切换到格式视图
      // 让用户立刻看到真实效果(例如文字上的实线删除线),而不是只插入
      // `~~` 波浪号——纯文本文档甚至没有对应的源码语法可插入。
      if (
        command === 'bold' || command === 'italic'
        || command === 'underline' || command === 'strikethrough'
      ) {
        if (documentType === 'plain') {
          const range = currentSelection()
          if (range.start === range.end) return
          pendingPlainFormatRef.current = { command, start: range.start, end: range.end }
          keepPlainFormattedRef.current = true
          setMarkdownView('formatted')
          return
        }
        if (command === 'bold') wrapInline('**')
        else if (command === 'italic') wrapInline('*')
        else if (command === 'underline') wrapInline('<u>', '</u>')
        else wrapInline('~~')
        setMarkdownView('formatted')
        return
      }
      if (command === 'clear-format') {
        const range = currentSelection()
        if (range.start === range.end) return
        const selected = textRef.current.slice(range.start, range.end)
        const cleared = selected
          .replace(/^(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|- \[[ xX]\]\s+)/gm, '')
          .replace(/(\*\*|~~|__)(.*?)\1/g, '$2')
          .replace(/([*_])(.*?)\1/g, '$2')
          .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
        replaceSelection(cleared, true)
        return
      }
      formatLines(command)
    },
    [currentSelection, documentType, formatFormattedPreview, formatLines, markdownView, replaceSelection, wrapInline],
  )

  const confirmInsertLink = useCallback(() => {
    const rawUrl = linkUrl.trim()
    if (!rawUrl) return
    // Bare domains such as "example.com" default to https; explicit schemes,
    // fragment and root-relative links pass through untouched.
    const url = /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
    const label = linkText.trim()

    if (markdownView === 'formatted') {
      formatFormattedPreview('link', { url, text: label })
    } else {
      const range = currentSelection()
      const selected = textRef.current.slice(range.start, range.end)
      const display = label || selected || url
      // Escape markdown-breaking characters inside the label and URL.
      const safeDisplay = display.replaceAll('[', '\\[').replaceAll(']', '\\]')
      const safeUrl = url.replaceAll('(', '%28').replaceAll(')', '%29').replaceAll(' ', '%20')
      replaceSelection(`[${safeDisplay}](${safeUrl})`)
    }
    setLinkDialogOpen(false)
  }, [currentSelection, formatFormattedPreview, linkText, linkUrl, markdownView, replaceSelection])

  const commitTableHistory = useCallback(() => {
    if (tableHistoryTimerRef.current) clearTimeout(tableHistoryTimerRef.current)
    tableHistoryTimerRef.current = null
    const last = historyRef.current[historyIndexRef.current]
    if (last && last.text === textRef.current) return
    const caret = selectionRef.current
    lastPreviewShellRef.current = stripTableRegions(textRef.current)
    applyText(textRef.current, caret.start, caret.end, true)
  }, [applyText])

  const scheduleTableHistoryCommit = useCallback(() => {
    if (tableHistoryTimerRef.current) clearTimeout(tableHistoryTimerRef.current)
    tableHistoryTimerRef.current = setTimeout(commitTableHistory, 450)
  }, [commitTableHistory])

  const handlePreviewInput = useCallback((event: ReactFormEvent<HTMLElement>) => {
    const root = previewRef.current
    const target = event.target as HTMLElement | null
    const cell = target?.closest?.('th, td') as HTMLTableCellElement | null
    const markdownRegion = target?.closest?.(
      '[data-notepad-markdown-region]',
    ) as HTMLElement | null

    if (documentType === 'markdown' && root && cell && root.contains(cell)) {
      const table = cell.closest('table') as HTMLTableElement | null
      if (table) syncMarkdownTableToSource(table)
    } else if (
      documentType === 'markdown'
      && root
      && markdownRegion
      && root.contains(markdownRegion)
    ) {
      const regionIndex = Number.parseInt(
        markdownRegion.getAttribute('data-notepad-markdown-region') ?? '',
        10,
      )
      if (Number.isInteger(regionIndex)) {
        const next = replaceMarkdownBodyRegion(
          textRef.current,
          regionIndex,
          serializeMarkdownBodyRegion(markdownRegion),
        )
        if (next !== textRef.current) {
          // The live region already contains this body edit. Mark its new shell
          // as painted so the layout effect preserves the DOM selection/caret.
          livePreviewSourceRef.current = next
          lastPreviewShellRef.current = stripTableRegions(next)
          const caret = selectionRef.current
          applyText(next, caret.start, caret.end, false)
        }
      }
    } else if (documentType === 'plain') {
      syncPlainPreviewToSource(false)
    }
    scheduleTableHistoryCommit()
  }, [
    applyText,
    documentType,
    scheduleTableHistoryCommit,
    syncMarkdownTableToSource,
    syncPlainPreviewToSource,
  ])

  const handlePreviewKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    const cell = target?.closest?.('th, td') as HTMLTableCellElement | null
    const root = previewRef.current

    const selectedTable = selectedTableRef.current
    if (selectedTable && root?.contains(selectedTable)) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        clearTableRowSelection(selectedTable)
        markTableSelected(selectedTable, null)
        selectedTableRef.current = null
        tableDragCandidateRef.current = null
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        event.stopPropagation()
        const rawIndex = selectedTable.getAttribute('data-notepad-table-index')
        const tableIndex = rawIndex !== null
          ? Number.parseInt(rawIndex, 10)
          : Array.from(root.querySelectorAll('table')).indexOf(selectedTable)
        if (tableIndex < 0) return

        const allRows = Array.from(selectedTable.querySelectorAll<HTMLTableRowElement>('tr'))
        const selectedRows = allRows.filter((row) =>
          row.getAttribute('data-notepad-row-selected') === 'true',
        )
        if (selectedRows.length > 0 && selectedRows.length < allRows.length) {
          commitTableHistory()
          selectedRows.forEach((row) => row.remove())
          clearTableRowSelection(selectedTable)
          markTableSelected(selectedTable, null)
          selectedTableRef.current = null
          tableDragCandidateRef.current = null
          markTableRowInsertTarget(rowInsertTargetRef.current, null)
          rowInsertTargetRef.current = null
          if (documentType === 'markdown') syncMarkdownTableToSource(selectedTable)
          else syncPlainPreviewToSource(false)
          scheduleTableHistoryCommit()
          return
        }

        const sourceRegion = findTableRegions(textRef.current)[tableIndex]
        const next = removeTableFromSource(textRef.current, tableIndex)
        if (next === textRef.current) return

        commitTableHistory()
        clearTableRowSelection(selectedTable)
        markTableSelected(selectedTable, null)
        selectedTableRef.current = null
        tableDragCandidateRef.current = null
        markTableRowInsertTarget(rowInsertTargetRef.current, null)
        rowInsertTargetRef.current = null
        livePreviewSourceRef.current = null
        lastPreviewShellRef.current = null
        const caret = Math.min(sourceRegion?.start ?? 0, next.length)
        applyText(next, caret, caret, true)
        if (documentType === 'markdown' && findTableRegions(next).length === 0) {
          setMarkdownView('syntax')
          requestAnimationFrame(() => {
            const editor = textareaRef.current
            if (!editor) return
            editor.focus()
            editor.setSelectionRange(caret, caret)
          })
        }
        return
      }
    }

    if (!cell) {
      const row = rowInsertTargetRef.current
      if (
        event.key === 'Enter'
        && root
        && target === root
        && row
        && row.isConnected
        && root.contains(row)
      ) {
        event.preventDefault()
        event.stopPropagation()
        const inserted = insertTableRowAfter(row)
        if (!inserted) return

        markTableRowInsertTarget(row, inserted)
        rowInsertTargetRef.current = inserted
        enableEditablePreviewRegions(root, activeSpellCheck)

        const table = inserted.closest('table') as HTMLTableElement | null
        if (documentType === 'markdown' && table) syncMarkdownTableToSource(table)
        else if (documentType === 'plain') syncPlainPreviewToSource(false)
        scheduleTableHistoryCommit()
        return
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        if (event.shiftKey) {
          document.execCommand('outdent')
        } else {
          document.execCommand('indent')
        }
        const markdownRegion = target?.closest?.('[data-notepad-markdown-region]') as HTMLElement | null
        if (markdownRegion) {
          const regionIndex = Number.parseInt(
            markdownRegion.getAttribute('data-notepad-markdown-region') ?? '0',
            10,
          )
          if (Number.isInteger(regionIndex)) {
            const next = replaceMarkdownBodyRegion(
              textRef.current,
              regionIndex,
              serializeMarkdownBodyRegion(markdownRegion),
            )
            if (next !== textRef.current) {
              livePreviewSourceRef.current = next
              lastPreviewShellRef.current = stripTableRegions(next)
              applyText(next, selectionRef.current.start, selectionRef.current.end, false)
              scheduleTableHistoryCommit()
            }
          }
        }
        return
      }

      return
    }

    if (!root?.contains(cell)) return
    markTableRowInsertTarget(rowInsertTargetRef.current, null)
    rowInsertTargetRef.current = null

    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      // Use Chromium's editing command so consecutive breaks and caret
      // placement follow contenteditable semantics without reaching the
      // editor-wide Enter shortcut chain.
      document.execCommand('insertLineBreak')
      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      const direction = event.shiftKey ? -1 : 1
      if (focusAdjacentTableCell(cell, direction)) return
      if (documentType !== 'markdown') return
      if (!root) return
      const tables = Array.from(root.querySelectorAll('table'))
      const table = cell.closest('table')
      const tableIndex = table ? tables.indexOf(table) : -1
      if (tableIndex >= 0) {
        focusMarkdownBodyRegion(root, tableIndex + (direction > 0 ? 1 : 0), direction)
      }
    }
  }, [
    activeSpellCheck,
    applyText,
    commitTableHistory,
    documentType,
    scheduleTableHistoryCommit,
    syncMarkdownTableToSource,
    syncPlainPreviewToSource,
  ])

  const handlePreviewMouseDown = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const root = previewRef.current
    const target = event.target as HTMLElement | null
    if (!root || !target) return

    const rootRect = root.getBoundingClientRect()
    const verticalScrollbarWidth = root.offsetWidth - root.clientWidth
    const horizontalScrollbarHeight = root.offsetHeight - root.clientHeight
    const onVerticalScrollbar = verticalScrollbarWidth > 0
      && event.clientX >= rootRect.right - verticalScrollbarWidth
    const onHorizontalScrollbar = horizontalScrollbarHeight > 0
      && event.clientY >= rootRect.bottom - horizontalScrollbarHeight
    if (onVerticalScrollbar || onHorizontalScrollbar) return

    markTableSelected(selectedTableRef.current, null)
    clearTableRowSelection(selectedTableRef.current)
    selectedTableRef.current = null
    tableDragCandidateRef.current = null

    const cell = target.closest('th, td') as HTMLTableCellElement | null
    if (cell && root.contains(cell)) {
      markTableRowInsertTarget(rowInsertTargetRef.current, null)
      rowInsertTargetRef.current = null
      const table = cell.closest('table') as HTMLTableElement | null
      if (table) {
        tableDragCandidateRef.current = {
          table,
          row: null,
          startCell: cell,
          startRow: cell.closest('tr') as HTMLTableRowElement | null,
          currentRow: cell.closest('tr') as HTMLTableRowElement | null,
          startX: event.clientX,
          startY: event.clientY,
          selected: false,
        }
        root.setAttribute('data-notepad-dragging', 'true')
      }
      return
    }

    if (target.closest(
      '[data-notepad-text-region], [data-notepad-markdown-region]',
    )) {
      markTableRowInsertTarget(rowInsertTargetRef.current, null)
      rowInsertTargetRef.current = null
      return
    }

    const tables = Array.from(root.querySelectorAll<HTMLTableElement>('table'))
    if (tables.length === 0 || target.closest('table')) return

    const point = { x: event.clientX, y: event.clientY }
    let regionIndex = tables.length
    let atEnd = true
    let bodyDirection: 1 | -1 = 1

    const besideTable = tables.findIndex((table) => {
      const rect = table.getBoundingClientRect()
      return point.y >= rect.top && point.y <= rect.bottom
        && (point.x < rect.left || point.x > rect.right)
    })

    if (besideTable >= 0) {
      const table = tables[besideTable]
      const row = Array.from(table.rows).find((candidate) => {
        const rect = candidate.getBoundingClientRect()
        return point.y >= rect.top && point.y <= rect.bottom
      })
      if (row) {
        tableDragCandidateRef.current = {
          table,
          row,
          startCell: null,
          startRow: row,
          currentRow: row,
          startX: event.clientX,
          startY: event.clientY,
          selected: false,
        }
        root.setAttribute('data-notepad-dragging', 'true')
        return
      }

      const rect = table.getBoundingClientRect()
      const afterTable = point.x > rect.right
      regionIndex = besideTable + (afterTable ? 1 : 0)
      atEnd = !afterTable
      bodyDirection = afterTable ? 1 : -1
    } else {
      const nextTable = tables.findIndex((table) => point.y < table.getBoundingClientRect().top)
      regionIndex = nextTable >= 0 ? nextTable : tables.length
      atEnd = nextTable < 0
      bodyDirection = nextTable >= 0 ? -1 : 1
    }

    const focused = documentType === 'markdown'
      ? focusMarkdownBodyRegion(root, regionIndex, bodyDirection)
      : focusPlainTextBodyRegion(root, regionIndex, atEnd)
    if (!focused) return

    markTableRowInsertTarget(rowInsertTargetRef.current, null)
    rowInsertTargetRef.current = null
    event.preventDefault()
    event.stopPropagation()
  }, [documentType])

  const handlePreviewMouseMove = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const candidate = tableDragCandidateRef.current
    const root = previewRef.current
    if (!candidate || !root || (event.buttons & 1) === 0 || !root.contains(candidate.table)) return

    const distance = Math.hypot(
      event.clientX - candidate.startX,
      event.clientY - candidate.startY,
    )
    if (distance < 5) return

    const target = event.target as HTMLElement | null
    const currentCell = target?.closest?.('th, td') as HTMLTableCellElement | null
    const currentRow = currentCell && candidate.table.contains(currentCell)
      ? currentCell.closest('tr') as HTMLTableRowElement | null
      : tableRowAtPoint(candidate.table, event.clientY)
    if (!currentRow || !candidate.startRow) return

    const crossedCellBoundary = candidate.startCell
      ? currentCell !== candidate.startCell || currentRow !== candidate.startRow
      : true
    if (!crossedCellBoundary && !candidate.row) return

    candidate.selected = true
    candidate.currentRow = currentRow
    markTableRowInsertTarget(rowInsertTargetRef.current, null)
    rowInsertTargetRef.current = null
    markTableRowRangeSelected(candidate.table, candidate.startRow, currentRow)
    selectedTableRef.current = candidate.table
    root.focus({ preventScroll: true })
    window.getSelection()?.removeAllRanges()
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handlePreviewMouseUp = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const candidate = tableDragCandidateRef.current
    tableDragCandidateRef.current = null
    if (!candidate) return

    const root = previewRef.current
    root?.removeAttribute('data-notepad-dragging')
    if (!root || !root.contains(candidate.table)) return
    if (candidate.selected || selectedTableRef.current === candidate.table) {
      root.focus({ preventScroll: true })
      window.getSelection()?.removeAllRanges()
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (candidate.row?.isConnected && root.contains(candidate.row)) {
      markTableRowInsertTarget(rowInsertTargetRef.current, candidate.row)
      rowInsertTargetRef.current = candidate.row
      root.focus({ preventScroll: true })
      window.getSelection()?.removeAllRanges()
      event.preventDefault()
      event.stopPropagation()
    }
  }, [])

  const handlePreviewPaste = useCallback((event: ReactClipboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    const editable = target?.closest?.(
      'th, td, [data-notepad-text-region], [data-notepad-markdown-region]',
    )
    if (!editable || !previewRef.current?.contains(editable)) return
    event.preventDefault()
    const plain = event.clipboardData.getData('text/plain').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    document.execCommand('insertText', false, plain)
  }, [])

  const handlePreviewBlur = useCallback((event: ReactFocusEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null
    if (next && previewRef.current?.contains(next) && (next as HTMLElement).closest?.('th, td')) {
      return
    }
    commitTableHistory()
  }, [commitTableHistory])

  const insertTimeDate = useCallback(() => {
    const now = new Date()
    const date = new Intl.DateTimeFormat(language, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
    const time = new Intl.DateTimeFormat(language, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now)
    replaceSelection(`${time} ${date}`)
  }, [language, replaceSelection])

  const openBing = useCallback(() => {
    const range = currentSelection()
    const query = textRef.current.slice(range.start, range.end).trim()
    if (!query) return
    window.open(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, '_blank', 'noopener')
  }, [currentSelection])

  const goToRequestedLine = useCallback(() => {
    const requested = Math.max(1, Math.min(countLines(textRef.current), Number(goToLine) || 1))
    const offset = getLineOffset(textRef.current, requested)
    setGoToOpen(false)
    focusSelection(offset)
  }, [focusSelection, goToLine])

  const printDocument = useCallback(() => {
    setPageSetupOpen(false)
    requestAnimationFrame(() => window.print())
  }, [])

  const requestSaveAs = useCallback(() => {
    setSaveAsEncoding(encodingRef.current)
    setSaveAsLineEnding(lineEndingRef.current)
    setSaveAsOpen(true)
  }, [])

  const confirmSaveAs = useCallback(async () => {
    setSaveAsOpen(false)
    await saveDocument(true, { encoding: saveAsEncoding, lineEnding: saveAsLineEnding })
  }, [saveAsEncoding, saveAsLineEnding, saveDocument])

  const switchTabByOffset = useCallback((offset: 1 | -1) => {
    commitCurrentTab()
    const currentIndex = tabsRef.current.findIndex((tab) => tab.id === activeTabIdRef.current)
    const nextIndex = (currentIndex + offset + tabsRef.current.length) % tabsRef.current.length
    const next = tabsRef.current[nextIndex]
    if (next) {
      activeTabIdRef.current = next.id
      setActiveTabId(next.id)
      restoreTab(next)
    }
  }, [commitCurrentTab, restoreTab])

  /** Office-common actions → local notepad implementations (shared catalog chords). */
  const officeHandlers = useMemo<ShortcutHandlerMap>(() => ({
    new: () => newDocument(),
    newWindow: () => { void desktopApi.app.newWindow() },
    newMarkdown: () => newMarkdownDocument(),
    open: () => { void openDocument() },
    save: () => { void saveDocument(false) },
    saveAs: () => requestSaveAs(),
    saveAll: () => { void saveAllDocuments() },
    print: () => printDocument(),
    close: () => {
      if (onShellCloseTab) onShellCloseTab()
      else closeDocument()
    },
    closeWindow: () => closeWindow(),
    exit: () => exitApplication(),
    undo: () => undo(),
    redo: () => redo(),
    cut: () => { void cutSelection() },
    copy: () => { void copySelection() },
    paste: () => { void paste() },
    pasteTextOnly: () => { void paste() },
    delete: () => {
      const range = currentSelection()
      if (range.start === range.end) return false
      replaceSelection('')
    },
    selectAll: () => focusSelection(0, textRef.current.length),
    find: () => openFind(false),
    findNext: () => navigateFind(1),
    findPrevious: () => navigateFind(-1),
    replace: () => openFind(true),
    goTo: () => {
      setGoToLine(String(getCursorPosition(textRef.current, currentSelection().start).line))
      setGoToOpen(true)
    },
    bold: () => formatText('bold'),
    italic: () => formatText('italic'),
    underline: () => formatText('underline'),
    strikethrough: () => formatText('strikethrough'),
    hyperlink: () => formatText('link'),
    clearFormat: () => formatText('clear-format'),
    fontDialog: () => setSettingsOpen(true),
    zoomIn: () => {
      if (!settingsOpenRef.current) zoomIn()
    },
    zoomOut: () => {
      if (!settingsOpenRef.current) zoomOut()
    },
    zoomReset: () => {
      if (!settingsOpenRef.current) zoomReset()
    },
    timeDate: () => insertTimeDate(),
    nextTab: () => {
      if (onShellNextTab) onShellNextTab()
      else switchTabByOffset(1)
    },
    previousTab: () => {
      if (onShellPreviousTab) onShellPreviousTab()
      else switchTabByOffset(-1)
    },
    help: () => {
      window.open('https://support.microsoft.com/office', '_blank', 'noopener')
    },
  }), [
    closeDocument,
    closeWindow,
    copySelection,
    currentSelection,
    cutSelection,
    exitApplication,
    focusSelection,
    formatText,
    insertTimeDate,
    navigateFind,
    newDocument,
    newMarkdownDocument,
    onShellCloseTab,
    onShellNextTab,
    onShellPreviousTab,
    openDocument,
    openFind,
    paste,
    printDocument,
    redo,
    replaceSelection,
    requestSaveAs,
    saveAllDocuments,
    saveDocument,
    switchTabByOffset,
    undo,
    zoomIn,
    zoomOut,
    zoomReset,
  ])

  useOfficeShortcuts('text', officeHandlers, true)

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    // Office chords are handled by the shared global dispatcher.
    // Keep only notepad-local UI keys here.
    if (event.key === 'Escape') {
      if (findOpen) closeFind()
      else if (goToOpen) setGoToOpen(false)
      else if (pageSetupOpen) setPageSetupOpen(false)
      else if (saveAsOpen) setSaveAsOpen(false)
      else if (linkDialogOpen) setLinkDialogOpen(false)
      else if (settingsOpen) closeSettings()
      return
    }

    if (findOpen && event.key === 'Enter') {
      event.preventDefault()
      if (replaceMode && event.altKey) replaceCurrentMatch()
      else navigateFind(event.shiftKey ? -1 : 1)
    }
  }

  const formattedHtml = useMemo(
    () => documentType === 'plain'
      ? DOMPurify.sanitize(renderPlainTextTableDocument(text))
      : renderNotepadMarkdown(text),
    [documentType, text],
  )

  const revealPendingTableInsertion = useCallback((root: HTMLElement) => {
    const pending = pendingTableInsertionRef.current
    if (!pending) return

    const newTable = root.querySelector<HTMLTableElement>('table[data-notepad-new-table="true"]')
    const tables = root.querySelectorAll<HTMLTableElement>('table')
    const table = tables[pending.tableIndex] ?? newTable ?? tables[tables.length - 1]
    if (!table) return

    pendingTableInsertionRef.current = null
    table.removeAttribute('data-notepad-new-table')

    const focusAndCenterTable = () => {
      if (!table.isConnected) return

      // Scroll the inserted table into the center of the viewport
      table.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })

      const firstCell = table.querySelector<HTMLTableCellElement>('td, th')
      if (firstCell) {
        firstCell.focus({ preventScroll: true })
        const selection = window.getSelection()
        if (selection) {
          const range = document.createRange()
          range.selectNodeContents(firstCell)
          range.collapse(true)
          selection.removeAllRanges()
          selection.addRange(range)
          previewSelectionRef.current = range.cloneRange()
        }
      }
    }

    focusAndCenterTable()
    requestAnimationFrame(focusAndCenterTable)
    setTimeout(focusAndCenterTable, 30)
  }, [])

  // End a formatted table-editing session when its final table is deleted (plain text files only).
  // A deliberate formatting session (inline format clicked from the syntax view)
  // stays in the formatted view until the user switches back manually.
  useEffect(() => {
    if (documentType === 'markdown') return
    if (!shouldRecoverSyntaxEditMode(text, markdownView, documentType)) return
    if (keepPlainFormattedRef.current) return
    livePreviewSourceRef.current = null
    lastPreviewShellRef.current = null
    setMarkdownView('syntax')
    requestAnimationFrame(() => {
      const editor = textareaRef.current
      if (!editor) return
      editor.focus()
      const caret = selectionRef.current
      const start = Math.min(caret.start, textRef.current.length)
      const end = Math.min(caret.end, textRef.current.length)
      editor.setSelectionRange(start, end)
    })
  }, [documentType, text, markdownView])

  /** Apply an inline format deferred from the syntax view once the preview is painted. */
  const applyPendingPlainFormat = useCallback((root: HTMLElement) => {
    const pending = pendingPlainFormatRef.current
    pendingPlainFormatRef.current = null
    if (!pending) return
    const range = locatePreviewRangeByOffsets(root, pending.start, pending.end)
    if (!range) return
    const selection = window.getSelection()
    if (!selection) return
    root.focus({ preventScroll: true })
    selection.removeAllRanges()
    selection.addRange(range)
    previewSelectionRef.current = range.cloneRange()
    formatFormattedPreview(pending.command)
  }, [formatFormattedPreview])

  useLayoutEffect(() => {
    if (markdownView !== 'formatted') {
      keepPlainFormattedRef.current = false
      markTableSelected(selectedTableRef.current, null)
      selectedTableRef.current = null
      tableDragCandidateRef.current = null
      livePreviewSourceRef.current = null
      lastPreviewShellRef.current = null
      return
    }
    // No tables left: the recovery effect will return plain text sessions to syntax.
    if (
      documentType !== 'markdown'
      && !keepPlainFormattedRef.current
      && shouldRecoverSyntaxEditMode(text, 'formatted', documentType)
    ) {
      livePreviewSourceRef.current = null
      lastPreviewShellRef.current = null
      return
    }
    const root = previewRef.current
    if (!root) {
      livePreviewSourceRef.current = null
      return
    }

    const shell = stripTableRegions(text)
    const domTableHtmls = Array.from(root.querySelectorAll('table')).map((table) =>
      serializeTableElement(table as HTMLTableElement),
    )
    const liveDomAlreadyMatches = livePreviewSourceRef.current === text
      && domTableHtmls.length === findTableRegions(text).length
    livePreviewSourceRef.current = null
    if (liveDomAlreadyMatches) {
      lastPreviewShellRef.current = shell
      enableEditablePreviewRegions(root, activeSpellCheck)
      revealPendingTableInsertion(root)
      return
    }

    // Skip rebuild only when non-table body is unchanged AND source table cells
    // still match the live DOM (live typing). Undo/redo changes cells without
    // touching the shell — must rebuild so the preview is not stale.
    if (shouldSkipPreviewTableRebuild(text, domTableHtmls, lastPreviewShellRef.current)) {
      enableEditablePreviewRegions(root, activeSpellCheck)
      revealPendingTableInsertion(root)
      return
    }

    const prevScrollTop = root.scrollTop
    lastPreviewShellRef.current = shell
    markTableSelected(selectedTableRef.current, null)
    selectedTableRef.current = null
    tableDragCandidateRef.current = null
    root.innerHTML = formattedHtml
    enableEditablePreviewRegions(root, activeSpellCheck)
    if (pendingTableInsertionRef.current) {
      revealPendingTableInsertion(root)
    } else {
      root.scrollTop = prevScrollTop
    }
    applyPendingPlainFormat(root)
  }, [activeSpellCheck, applyPendingPlainFormat, documentType, formattedHtml, markdownView, revealPendingTableInsertion, text])

  const cursor = useMemo(
    () => getCursorPosition(text, selection.start),
    [selection.start, text],
  )
  const matches = useMemo(
    () => findOpen ? findTextMatches(text, findQuery, findOptions) : [],
    [findOpen, findOptions, findQuery, text],
  )
  const activeMatch = useMemo(
    () => matches.findIndex(
      (match) => match.start === selection.start && match.end === selection.end,
    ),
    [matches, selection.end, selection.start],
  )
  const printText = useMemo(() => applyLineEnding(text, lineEnding), [lineEnding, text])

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-sm text-destructive">
        <p className="font-medium">{t('notepad.cannotLoadTextFile')}</p>
        <p className="text-xs text-muted-foreground">{displayName}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('notepad.loadingTextFile')}
      </div>
    )
  }

  const printSize = `${pageSetup.size} ${pageSetup.orientation}`
  const printMargins = `${pageSetup.margins.top}mm ${pageSetup.margins.right}mm ${pageSetup.margins.bottom}mm ${pageSetup.margins.left}mm`

  return (
    <div
      ref={editorRootRef}
      className="relative flex h-full min-h-0 min-w-0 w-full max-w-full flex-1 flex-col overflow-hidden bg-[#f3f3f3] font-['Segoe_UI'] text-[#1f1f1f] dark:bg-[#202020] dark:text-[#f4f4f4]"
      data-testid="text-editor"
      data-notepad-editor
      data-manages-document-zoom
      data-zoom={zoom}
      onKeyDown={handleKeyDown}
    >
      {showTabBar && (
        <DocumentTabBar
          tabs={tabs.map((tab) => ({
            id: tab.id,
            name: tab.name,
            path: tab.path || undefined,
            dirty: tab.dirty,
            kind: 'text',
          }))}
          activeTabId={activeTabId}
          onSelect={switchTab}
          onClose={closeTab}
          onReorder={(orderedIds) => {
            const byId = new Map(tabsRef.current.map((tab) => [tab.id, tab]))
            const next = orderedIds
              .map((id) => byId.get(id))
              .filter((tab): tab is (typeof tabsRef.current)[number] => Boolean(tab))
            for (const tab of tabsRef.current) {
              if (!orderedIds.includes(tab.id)) next.push(tab)
            }
            tabsRef.current = next
            setTabs(next)
          }}
          onNew={newDocument}
          testId="notepad-document-tab-bar"
        />
      )}

      <NotepadCommandBar
        canUndo={canUndo}
        canRedo={canRedo}
        hasSelection={selection.end > selection.start}
        wordWrap={wordWrap}
        statusBar={statusBar}
        formattingEnabled={formattingEnabled}
        markdownEnabled={documentType === 'markdown'}
        zoom={zoomPercent}
        recentFiles={recentFiles}
        markdownView={markdownView}
        onNew={newDocument}
        onNewMarkdown={newMarkdownDocument}
        onNewWindow={() => void desktopApi.app.newWindow()}
        onOpen={() => void openDocument()}
        onOpenRecent={(path) => void openRecentDocument(path)}
        onSave={() => void saveDocument(false)}
        onSaveAs={requestSaveAs}
        onSaveAll={() => void saveAllDocuments()}
        onPageSetup={() => setPageSetupOpen(true)}
        onPrint={printDocument}
        onClose={closeDocument}
        onCloseWindow={closeWindow}
        onExit={exitApplication}
        onUndo={undo}
        onRedo={redo}
        onCut={() => void cutSelection()}
        onCopy={() => void copySelection()}
        onPaste={() => void paste()}
        onDelete={() => replaceSelection('')}
        onFind={() => openFind(false)}
        onFindNext={() => navigateFind(1)}
        onFindPrevious={() => navigateFind(-1)}
        onReplace={() => openFind(true)}
        onGoTo={() => {
          setGoToLine(String(cursor.line))
          setGoToOpen(true)
        }}
        onSelectAll={() => focusSelection(0, textRef.current.length)}
        onTimeDate={insertTimeDate}
        onClearFormat={() => formatText('clear-format')}
        onSearchWeb={openBing}
        onFont={() => {
          setSettingsInitialSection('font')
          setSettingsOpen(true)
        }}
        onToggleWrap={() => setWordWrap((value) => !value)}
        onToggleStatusBar={() => setStatusBar((value) => !value)}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={zoomReset}
        onMarkdownView={setMarkdownView}
        onFormat={formatText}
        onInsertTable={insertTable}
        onSettings={() => {
          setSettingsInitialSection(undefined)
          setSettingsOpen(true)
        }}
      />

      {findOpen && (
        <div className="flex shrink-0 items-start justify-end border-b border-black/[0.08] bg-[#f7f7f7] px-2 py-2 dark:border-white/[0.07] dark:bg-[#252525]">
          <div className="flex w-full max-w-[560px] flex-col gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] hover:bg-black/[0.06] dark:hover:bg-white/[0.07]"
                aria-label={replaceMode
                  ? t('notepad.closeReplaceOptions')
                  : t('notepad.openReplaceOptions')}
                onClick={() => setReplaceMode((value) => !value)}
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${replaceMode ? 'rotate-180' : ''}`} />
              </button>
              <div className="relative min-w-[140px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-55" />
                <input
                  ref={findInputRef}
                  value={findQuery}
                  onChange={(event) => setFindQuery(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); navigateFind(event.shiftKey ? -1 : 1); } }}
                  className={`${inputClass} min-w-[140px] flex-1 pl-8`}
                  placeholder={t('notepad.find')}
                  aria-label={t('notepad.find')}
                  data-testid="text-find-input"
                />
              </div>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] opacity-55">{matches.length ? `${Math.max(1, activeMatch + 1)}/${matches.length}` : '0/0'}</span>
              <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] hover:bg-black/[0.06] dark:hover:bg-white/[0.07]" aria-label={t('notepad.previous')} title={t('notepad.previousShortcut')} onClick={() => navigateFind(-1)}>
                <ChevronUp className="h-4 w-4" />
              </button>
              <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] hover:bg-black/[0.06] dark:hover:bg-white/[0.07]" aria-label={t('notepad.next')} title={t('notepad.nextShortcut')} onClick={() => navigateFind(1)}>
                <ChevronDown className="h-4 w-4" />
              </button>
              <DropdownMenu.Root modal={false}>
                <DropdownMenu.Trigger asChild>
                  <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] hover:bg-black/[0.06] dark:hover:bg-white/[0.07]" aria-label={t('notepad.moreOptions')}>
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content sideOffset={4} align="end" className="z-[10000] min-w-[180px] rounded-md border border-black/10 bg-[#f9f9f9] p-1 text-[13px] shadow-xl dark:border-white/10 dark:bg-[#2c2c2c] dark:text-[#f5f5f5]">
                    <DropdownMenu.CheckboxItem
                      className="flex h-8 cursor-default select-none items-center rounded-[4px] px-2 outline-none data-[highlighted]:bg-black/[0.07] dark:data-[highlighted]:bg-white/[0.08]"
                      checked={findOptions.matchCase}
                      onCheckedChange={(checked) => setFindOptions((value) => ({ ...value, matchCase: Boolean(checked) }))}
                    >
                      {t('notepad.matchCase')}
                    </DropdownMenu.CheckboxItem>
                    <DropdownMenu.CheckboxItem
                      className="flex h-8 cursor-default select-none items-center rounded-[4px] px-2 outline-none data-[highlighted]:bg-black/[0.07] dark:data-[highlighted]:bg-white/[0.08]"
                      checked={findOptions.wrapAround}
                      onCheckedChange={(checked) => setFindOptions((value) => ({ ...value, wrapAround: Boolean(checked) }))}
                    >
                      {t('notepad.wrapAround')}
                    </DropdownMenu.CheckboxItem>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] hover:bg-black/[0.06] dark:hover:bg-white/[0.07]" aria-label={t('notepad.closeFind')} onClick={closeFind}>
                <X className="h-4 w-4" />
              </button>
            </div>

            {replaceMode && (
              <div className="flex min-w-0 items-center gap-1.5">
                <input
                  value={replaceText}
                  onChange={(event) => setReplaceText(event.target.value)}
                  className={`${inputClass} min-w-[140px] flex-1`}
                  placeholder={t('notepad.replaceWith')}
                  aria-label={t('notepad.replaceWith')}
                  data-testid="text-replace-input"
                />
                <button type="button" className={dialogButtonClass} onClick={replaceCurrentMatch}>{t('notepad.replace')}</button>
                <button type="button" className={dialogButtonClass} onClick={replaceAllMatches}>{t('notepad.replaceAll')}</button>
              </div>
            )}
          </div>
        </div>
      )}

      <div
        ref={editorViewportRef}
        className="relative min-h-0 min-w-0 w-full max-w-full flex-1 self-stretch overflow-hidden bg-white dark:bg-[#1e1e1e]"
        data-testid="text-editor-viewport"
      >
        {markdownView === 'formatted' ? (
          <article
            ref={previewRef}
            className="notepad-markdown-preview absolute inset-0 box-border h-full min-h-0 min-w-0 max-h-full max-w-full overflow-auto bg-white px-5 py-4 text-[#1f1f1f] dark:bg-[#1e1e1e] dark:text-[#f2f2f2]"
            style={{
              inlineSize: 'var(--notepad-content-width, 100%)',
              blockSize: '100%',
              overflowWrap: 'anywhere',
              fontFamily,
              fontSize: `var(--notepad-editor-font-size, ${fontSize * NOTEPAD_FONT_POINT_TO_PIXEL * zoom}px)`,
              fontWeight,
              fontStyle,
              fontStretch: fontStretchValue(fontStretch),
              lineHeight: 1.55,
            }}
            onInput={handlePreviewInput}
            onMouseDown={handlePreviewMouseDown}
            onMouseMove={handlePreviewMouseMove}
            onMouseUp={handlePreviewMouseUp}
            onKeyDown={handlePreviewKeyDown}
            onPaste={handlePreviewPaste}
            onBlur={handlePreviewBlur}
            tabIndex={-1}
            aria-label={t('notepad.formattedEditorAria')}
            data-testid="text-editor-formatted-view"
          />
        ) : (
          <textarea
            ref={textareaRef}
            value={text}
            wrap={wordWrap ? 'soft' : 'off'}
            onChange={handleChange}
            onSelect={syncSelection}
            onClick={syncSelection}
            onKeyUp={syncSelection}
            onBlur={syncSelection}
            spellCheck={activeSpellCheck}
            autoCorrect={activeSpellCheck && autoCorrect ? 'on' : 'off'}
            className={`absolute inset-0 box-border h-full min-h-0 min-w-0 max-h-full max-w-full resize-none border-0 bg-white px-4 py-3 text-[#1f1f1f] outline-none focus:outline-none focus:ring-0 dark:bg-[#1e1e1e] dark:text-[#f2f2f2] ${wordWrap ? 'whitespace-pre-wrap overflow-x-hidden' : 'whitespace-pre overflow-x-auto'}`}
            style={{
              inlineSize: 'var(--notepad-content-width, 100%)',
              blockSize: '100%',
              overflowWrap: wordWrap ? 'anywhere' : 'normal',
              tabSize: 4,
              fontFamily,
              fontSize: `var(--notepad-editor-font-size, ${fontSize * NOTEPAD_FONT_POINT_TO_PIXEL * zoom}px)`,
              fontWeight,
              fontStyle,
              fontStretch: fontStretchValue(fontStretch),
              lineHeight: 1.55,
            }}
            aria-label={t('notepad.textEditorAria')}
            data-testid="text-editor-input"
          />
        )}
      </div>

      {statusBar && (
        <div
          className="flex h-8 shrink-0 items-center overflow-hidden border-t border-black/[0.09] bg-[#f3f3f3] text-[12px] text-black/65 dark:border-white/[0.08] dark:bg-[#202020] dark:text-white/65"
          data-testid="text-editor-statusbar"
          data-notepad-statusbar
        >
          <span className="min-w-[96px] flex-[0_1_110px] truncate px-4">{t('notepad.lineColumn', { line: cursor.line, column: cursor.column })}</span>
          <span className="min-w-[64px] flex-[1_1_186px] truncate border-l border-black/10 px-3 dark:border-white/10" title={selection.end > selection.start
            ? t('notepad.selectionCharacterCount', { selected: selection.end - selection.start, total: text.length })
            : t('notepad.characterCount', { count: text.length })}>
            {selection.end > selection.start
              ? t('notepad.selectionCharacterCount', { selected: selection.end - selection.start, total: text.length })
              : t('notepad.characterCount', { count: text.length })}
          </span>
          {documentType === 'markdown' ? (
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="flex min-w-[70px] flex-[1_1_180px] cursor-default select-none items-center justify-center gap-1 border-l border-black/10 px-3 text-center outline-none hover:bg-black/[0.06] data-[state=open]:bg-black/[0.08] dark:border-white/10 dark:hover:bg-white/[0.08] dark:data-[state=open]:bg-white/[0.12]"
                  aria-label={markdownView === 'formatted' ? t('notepad.formattedView') : t('notepad.syntaxView')}
                  data-testid="notepad-status-view-mode"
                >
                  <span className="truncate">
                    {markdownView === 'formatted' ? t('notepad.formattedView') : t('notepad.syntaxView')}
                  </span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content sideOffset={4} align="center" className="z-[10000] min-w-[160px] rounded-md border border-black/10 bg-[#f9f9f9] p-1 text-[13px] shadow-xl dark:border-white/10 dark:bg-[#2c2c2c] dark:text-[#f5f5f5]">
                  <DropdownMenu.CheckboxItem
                    className="relative flex h-8 cursor-default select-none items-center rounded-[4px] px-2 pl-8 outline-none data-[highlighted]:bg-black/[0.07] dark:data-[highlighted]:bg-white/[0.08]"
                    checked={markdownView === 'formatted'}
                    onCheckedChange={() => {
                      // 手动进入格式视图的纯文本会话不被表格恢复逻辑弹回语法视图
                      keepPlainFormattedRef.current = true
                      setMarkdownView('formatted')
                    }}
                  >
                    <DropdownMenu.ItemIndicator className="absolute left-2">
                      <Check className="h-4 w-4" />
                    </DropdownMenu.ItemIndicator>
                    {t('notepad.formattedView')}
                  </DropdownMenu.CheckboxItem>
                  <DropdownMenu.CheckboxItem
                    className="relative flex h-8 cursor-default select-none items-center rounded-[4px] px-2 pl-8 outline-none data-[highlighted]:bg-black/[0.07] dark:data-[highlighted]:bg-white/[0.08]"
                    checked={markdownView === 'syntax'}
                    onCheckedChange={() => setMarkdownView('syntax')}
                  >
                    <DropdownMenu.ItemIndicator className="absolute left-2">
                      <Check className="h-4 w-4" />
                    </DropdownMenu.ItemIndicator>
                    {t('notepad.syntaxView')}
                  </DropdownMenu.CheckboxItem>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : (
            <span className="min-w-[56px] flex-[1_1_200px] truncate border-l border-black/10 px-3 text-center dark:border-white/10" title={t('notepad.plainText')}>{t('notepad.plainText')}</span>
          )}
          <span ref={zoomStatusRef} className="min-w-[50px] flex-[0_1_68px] truncate border-l border-black/10 px-2 text-center dark:border-white/10">{zoomPercent}%</span>
          <span className="min-w-0 flex-[0.9_1_168px] truncate border-l border-black/10 px-2 text-center dark:border-white/10" title={lineEndingLabel(lineEnding)}>{lineEndingLabel(lineEnding)}</span>
          <span className="min-w-[38px] flex-[0_1_86px] truncate border-l border-black/10 px-2 text-center dark:border-white/10" title={encodingLabel(encoding)}>{encodingLabel(encoding)}</span>
        </div>
      )}

      <pre className="notepad-print-document" aria-hidden="true">{printText}</pre>
      <div className="notepad-print-header" aria-hidden="true">{expandPrintTemplate(pageSetup.header, displayName)}</div>
      <div className="notepad-print-footer" aria-hidden="true">{expandPrintTemplate(pageSetup.footer, displayName)}</div>
      <style>{`@page { size: ${printSize}; margin: ${printMargins}; }`}</style>

      {goToOpen && (
        <Modal title={t('notepad.goToLine')} onClose={() => setGoToOpen(false)}>
          <label className="mb-2 block text-[13px]" htmlFor="notepad-go-to-line">{t('notepad.lineNumber')}</label>
          <input
            id="notepad-go-to-line"
            type="number"
            min={1}
            max={countLines(text)}
            value={goToLine}
            onChange={(event) => setGoToLine(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') goToRequestedLine()
            }}
            className={inputClass}
            autoFocus
          />
          <p className="mt-2 text-[12px] opacity-60">{t('notepad.lineRange', { max: countLines(text) })}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={dialogButtonClass} onClick={() => setGoToOpen(false)}>{t('agentConfig.cancel')}</button>
            <button type="button" className={`${dialogButtonClass} border-[#0067c0] bg-[#0067c0] text-white hover:bg-[#005a9e] dark:bg-[#0067c0]`} onClick={goToRequestedLine}>{t('notepad.goToAction')}</button>
          </div>
        </Modal>
      )}

      {linkDialogOpen && (
        <Modal title={t('notepad.link')} onClose={() => setLinkDialogOpen(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              confirmInsertLink()
            }}
          >
            <label className="mb-1.5 block text-[13px]" htmlFor="notepad-link-text">{t('notepad.linkDisplayText')}</label>
            <input
              id="notepad-link-text"
              className={inputClass}
              value={linkText}
              placeholder={t('notepad.linkTextPlaceholder')}
              onChange={(event) => setLinkText(event.target.value)}
            />
            <label className="mb-1.5 mt-3 block text-[13px]" htmlFor="notepad-link-address">{t('notepad.linkAddressLabel')}</label>
            <input
              id="notepad-link-address"
              className={inputClass}
              value={linkUrl}
              placeholder={t('notepad.linkAddressPlaceholder')}
              onChange={(event) => setLinkUrl(event.target.value)}
              autoFocus
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="submit"
                className={`${dialogButtonClass} border-[#0067c0] bg-[#0067c0] text-white hover:bg-[#005a9e] disabled:opacity-45 dark:bg-[#0067c0]`}
                disabled={!linkUrl.trim()}
              >
                {t('notepad.insertLinkAction')}
              </button>
              <button type="button" className={dialogButtonClass} onClick={() => setLinkDialogOpen(false)}>{t('agentConfig.cancel')}</button>
            </div>
          </form>
        </Modal>
      )}

      {pageSetupOpen && (
        <Modal title={t('notepad.pageSetupTitle')} onClose={() => setPageSetupOpen(false)}>
          <div className="grid grid-cols-[100px_1fr] items-center gap-3 text-[13px]">
            <label htmlFor="notepad-page-size">{t('notepad.paperSize')}</label>
            <select id="notepad-page-size" className={inputClass} value={pageSetup.size} onChange={(event) => setPageSetup((value) => ({ ...value, size: event.target.value as PageSetup['size'] }))}>
              <option value="A4">A4</option>
              <option value="Letter">Letter</option>
            </select>
            <label htmlFor="notepad-orientation">{t('notepad.orientation')}</label>
            <select id="notepad-orientation" className={inputClass} value={pageSetup.orientation} onChange={(event) => setPageSetup((value) => ({ ...value, orientation: event.target.value as PageSetup['orientation'] }))}>
              <option value="portrait">{t('notepad.portrait')}</option>
              <option value="landscape">{t('notepad.landscape')}</option>
            </select>
            {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
              <Fragment key={side}>
                <label htmlFor={`notepad-margin-${side}`}>{t(marginLabelKeys[side])}</label>
                <input id={`notepad-margin-${side}`} type="number" min={5} max={50} className={inputClass} value={pageSetup.margins[side]} onChange={(event) => setPageSetup((value) => ({ ...value, margins: { ...value.margins, [side]: Math.max(5, Math.min(50, Number(event.target.value) || 5)) } }))} />
              </Fragment>
            ))}
            <label htmlFor="notepad-print-header">{t('notepad.header')}</label>
            <input id="notepad-print-header" className={inputClass} value={pageSetup.header} onChange={(event) => setPageSetup((value) => ({ ...value, header: event.target.value }))} />
            <label htmlFor="notepad-print-footer">{t('notepad.footer')}</label>
            <input id="notepad-print-footer" className={inputClass} value={pageSetup.footer} onChange={(event) => setPageSetup((value) => ({ ...value, footer: event.target.value }))} />
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={dialogButtonClass} onClick={() => setPageSetupOpen(false)}>{t('agentConfig.cancel')}</button>
            <button type="button" className={`${dialogButtonClass} border-[#0067c0] bg-[#0067c0] text-white hover:bg-[#005a9e] dark:bg-[#0067c0]`} onClick={() => setPageSetupOpen(false)}>{t('notepad.confirm')}</button>
          </div>
        </Modal>
      )}

      {saveAsOpen && (
        <Modal title={t('notepad.saveAsTitle')} onClose={() => setSaveAsOpen(false)}>
          <div className="space-y-3 text-[13px]">
            <div>
              <label className="mb-1.5 block" htmlFor="notepad-save-encoding">{t('notepad.encoding')}</label>
              <select id="notepad-save-encoding" className={inputClass} value={saveAsEncoding} onChange={(event) => setSaveAsEncoding(event.target.value as TextEncoding)}>
                <option value="utf-8">UTF-8</option>
                <option value="utf-16le">UTF-16 LE</option>
                <option value="utf-16be">UTF-16 BE</option>
                <option value="ansi">ANSI</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block" htmlFor="notepad-save-line-ending">{t('notepad.lineEnding')}</label>
              <select id="notepad-save-line-ending" className={inputClass} value={saveAsLineEnding} onChange={(event) => setSaveAsLineEnding(event.target.value as LineEnding)}>
                <option value="crlf">Windows (CRLF)</option>
                <option value="lf">Unix (LF)</option>
                <option value="cr">Macintosh (CR)</option>
              </select>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={dialogButtonClass} onClick={() => setSaveAsOpen(false)}>{t('agentConfig.cancel')}</button>
            <button type="button" className={`${dialogButtonClass} border-[#0067c0] bg-[#0067c0] text-white hover:bg-[#005a9e] dark:bg-[#0067c0]`} onClick={() => void confirmSaveAs()}>{t('notepad.continue')}</button>
          </div>
        </Modal>
      )}

      {settingsOpen && (
        <NotepadSettingsPage
          open={settingsOpen}
          initialSection={settingsInitialSection}
          pageRef={settingsPageRef}
          onClose={closeSettings}
          themePreference={themePreference}
          onThemePreferenceChange={(preference) => {
            setThemePreferenceState(preference)
            setThemePreference(preference)
          }}
          fontFamily={fontFamily}
          fontFamilies={fontFamilies}
          systemFontFaces={systemFontFaces}
          selectedFontFaces={selectedFontFaces}
          fontFaceName={fontFaceName}
          fontWeight={fontWeight}
          fontStyle={fontStyle}
          fontStretch={fontStretch}
          fontSize={fontSize}
          fontSizeInput={fontSizeInput}
          onFontFamilyChange={(family) => {
            const faces = systemFontFaces.filter((face) => face.familyName === family)
            const nextFace = faces.find((face) => face.weight === 400 && face.style === 'normal' && face.stretch === 5) || faces[0]
            setFontFamily(family)
            localStorage.setItem('notepad-font-family', family)
            if (!nextFace) return
            setFontWeight(nextFace.weight)
            setFontStyle(nextFace.style)
            setFontStretch(nextFace.stretch)
            setFontFaceName(nextFace.faceName)
            localStorage.setItem('notepad-font-weight', String(nextFace.weight))
            localStorage.setItem('notepad-font-style', nextFace.style)
            localStorage.setItem('notepad-font-stretch', String(nextFace.stretch))
            localStorage.setItem('notepad-font-face-name', nextFace.faceName)
          }}
          onFontFaceChange={(value) => {
            const [weightValue, styleValue, stretchValue, faceNameValue] = value.split('|')
            const faceName = decodeURIComponent(faceNameValue)
            setFontWeight(Number(weightValue))
            setFontStyle(styleValue as SystemFontFace['style'])
            setFontStretch(Number(stretchValue))
            setFontFaceName(faceName)
            localStorage.setItem('notepad-font-weight', weightValue)
            localStorage.setItem('notepad-font-style', styleValue)
            localStorage.setItem('notepad-font-stretch', stretchValue)
            localStorage.setItem('notepad-font-face-name', faceName)
          }}
          onFontSizeChange={(value) => {
            setFontSizeInput(value)
            const size = Number(value)
            if (!Number.isFinite(size) || size < 8 || size > 72) return
            setFontSize(size)
            localStorage.setItem('notepad-font-size', String(size))
          }}
          wordWrap={wordWrap}
          formattingEnabled={formattingEnabled}
          onWordWrapChange={() => setWordWrap((value) => !value)}
          onFormattingChange={() => {
            setFormattingEnabled((value) => {
              localStorage.setItem('notepad-formatting-enabled', String(!value))
              return !value
            })
          }}
          openFileBehavior={openFileBehavior}
          onOpenFileBehaviorChange={(behavior) => {
            setOpenFileBehavior(behavior)
            localStorage.setItem('notepad-open-files-in', behavior)
          }}
          startupBehavior={startupBehavior}
          onStartupBehaviorChange={(behavior) => {
            setStartupBehavior(behavior)
            localStorage.setItem('notepad-startup-behavior', behavior)
          }}
          recentFilesEnabled={recentFilesEnabled}
          onRecentFilesChange={() => {
            setRecentFilesEnabled((value) => {
              localStorage.setItem('notepad-recent-files', String(!value))
              return !value
            })
          }}
          spellCheck={spellCheck}
          onSpellCheckChange={() => {
            setSpellCheck((value) => {
              localStorage.setItem('notepad-spell-check', String(!value))
              return !value
            })
          }}
          spellCheckFormats={spellCheckFormats}
          onSpellCheckFormatChange={(format) => {
            setSpellCheckFormats((value) => {
              const checked = !value[format]
              localStorage.setItem(`notepad-spell-check-${format}`, String(checked))
              return { ...value, [format]: checked }
            })
          }}
          autoCorrect={autoCorrect}
          onAutoCorrectChange={() => {
            setAutoCorrect((value) => {
              localStorage.setItem('notepad-auto-correct', String(!value))
              return !value
            })
          }}
        />
      )}
      {savePromptTab && (
        <SaveConfirmDialog
          isOpen={Boolean(savePromptTab)}
          fileName={savePromptTab.name}
          onSave={handleDialogSave}
          onDontSave={handleDialogDontSave}
          onCancel={handleDialogCancel}
        />
      )}
    </div>
  )
}
