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
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import {
  AppWindow,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  History,
  LetterText,
  MoreHorizontal,
  Paintbrush,
  PencilLine,
  Rocket,
  Search,
  SpellCheck,
  WrapText,
  X,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEditorStore } from '@/stores/editor.store'
import { useTranslation } from '@/lib/i18n/runtime'
import { getThemePreference, setThemePreference, type ThemePreference } from '@/lib/theme'
import {
  useOfficeShortcuts,
  type ShortcutHandlerMap,
} from '@/lib/office-shortcuts'
import { documentBridge } from '../agent/document-bridge'
import { readFileBuffer } from '../utils/file-io'
import {
  createFallbackSystemFontFaces,
  getSystemFontDisplayName,
  getSystemFontFamilyNames,
  loadSystemFontFaces,
  type SystemFontFace,
} from '../utils/system-fonts'
import { DocumentTabBar } from '../components/DocumentTabBar'
import { NotepadCommandBar } from './NotepadCommandBar'
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
  buildHtmlTable,
  preserveBodyNewlinesInHtml,
  renderPlainTextTableDocument,
  replaceTablesInSource,
  serializePlainTextTableDocument,
  serializeTableElement,
  shouldRecoverSyntaxEditMode,
  shouldSkipPreviewTableRebuild,
  stripTableRegions,
} from './notepad-tables'

// GFM tables + soft line breaks so body text stays line-oriented like 记事本.
marked.setOptions({ gfm: true, breaks: true })

function renderNotepadMarkdown(source: string): string {
  const raw = marked.parse(source, { async: false }) as string
  const withTableClass = raw.replace(
    /<table(?![^>]*\bclass=)/gi,
    '<table class="notepad-md-table"',
  )
  const withBodyLines = preserveBodyNewlinesInHtml(withTableClass)
  return DOMPurify.sanitize(withBodyLines)
}

function enableEditablePreviewRegions(
  root: HTMLElement,
  spellCheckEnabled: boolean,
  includePlainTextRegions: boolean,
) {
  root.querySelectorAll<HTMLTableCellElement>('th, td').forEach((cell) => {
    cell.contentEditable = 'true'
    cell.spellcheck = spellCheckEnabled
    cell.setAttribute('data-notepad-cell', 'true')
    cell.setAttribute('role', 'textbox')
    cell.tabIndex = 0
  })
  if (!includePlainTextRegions) return
  root.querySelectorAll<HTMLElement>('[data-notepad-text-region]').forEach((region) => {
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

const SPELL_CHECK_FORMATS: Array<{ key: SpellCheckFormat; label: string }> = [
  { key: 'txt', label: '.txt' },
  { key: 'markdown', label: '.md' },
  { key: 'subtitles', label: '.srt / .ass' },
  { key: 'lrc', label: '.lrc' },
  { key: 'lic', label: '.lic' },
]

function fontFaceValue(face: Pick<SystemFontFace, 'faceName' | 'weight' | 'style' | 'stretch'>): string {
  return `${face.weight}|${face.style}|${face.stretch}|${encodeURIComponent(face.faceName)}`
}

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

function SettingToggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`relative h-5 w-10 shrink-0 rounded-full border transition-colors ${checked ? 'border-[#0067c0] bg-[#0067c0]' : 'border-black/35 bg-black/10 dark:border-white/40 dark:bg-white/10'} disabled:cursor-not-allowed disabled:opacity-45`}
      onClick={onChange}
    >
      <span className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-[left,background-color] ${checked ? 'left-[21px] bg-white' : 'left-[3px] bg-black/55 dark:bg-white/70'}`} />
    </button>
  )
}

const NOTEPAD_MIN_ZOOM = 10
const NOTEPAD_MAX_ZOOM = 500
const NOTEPAD_ZOOM_STEP = 10

function clampNotepadZoom(value: number): number {
  const stepped = Math.round(value / NOTEPAD_ZOOM_STEP) * NOTEPAD_ZOOM_STEP
  return Math.min(NOTEPAD_MAX_ZOOM, Math.max(NOTEPAD_MIN_ZOOM, stepped))
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
        className={`flex max-h-[calc(100%-2rem)] w-full flex-col rounded-[8px] border border-black/10 bg-[#f9f9f9] text-[#1f1f1f] shadow-2xl dark:border-white/10 dark:bg-[#2b2b2b] dark:text-[#f5f5f5] ${wide ? 'max-w-[720px]' : 'max-w-[400px]'}`}
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
            className="flex h-8 w-8 items-center justify-center rounded-[4px] hover:bg-black/[0.07] dark:hover:bg-white/[0.08]"
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
  'h-8 w-full rounded-[4px] border border-black/15 bg-white px-2.5 text-[13px] outline-none focus:border-[#0067c0] focus:ring-1 focus:ring-[#0067c0] dark:border-white/15 dark:bg-[#202020]'

const dialogButtonClass =
  'h-8 min-w-[82px] rounded-[4px] border border-black/10 bg-white px-4 text-[13px] hover:bg-black/[0.04] disabled:opacity-45 dark:border-white/10 dark:bg-[#333] dark:hover:bg-white/[0.06]'

const settingsGroupClass =
  'overflow-hidden rounded-[7px] border border-black/10 bg-white dark:border-white/10 dark:bg-[#303030]'

const settingsRowClass =
  'flex min-h-[64px] items-center justify-between gap-5 border-b border-black/[0.08] px-4 py-3 last:border-b-0 dark:border-white/[0.08]'

/* Windows 11 Notepad settings metrics: every card has a fixed 16px leading
 * glyph that never scales with document zoom or window size, card titles are
 * 14px regular, descriptions 12px secondary. Icon + 16px gap = 32px, so
 * nested content indents by pl-8 to align with the title text. */
const settingsIconClass = 'h-4 w-4 shrink-0'

/** 14px control text (Win11 body); wider fields keep w-full via the grid. */
const settingsFieldBaseClass =
  'h-8 rounded-[4px] border border-black/15 bg-white px-2.5 text-[14px] outline-none focus:border-[#0067c0] focus:ring-1 focus:ring-[#0067c0] dark:border-white/15 dark:bg-[#202020]'
const settingsFieldClass = `${settingsFieldBaseClass} w-full`
/** Right-aligned combo on a settings card (theme / open-file behavior). */
const settingsComboClass = `${settingsFieldBaseClass} w-auto min-w-[180px] max-w-[260px] shrink-0`

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
  /** Non-table shell of last painted source — skip full DOM rebuild when only cells change. */
  const lastPreviewShellRef = useRef<string | null>(null)
  const tableHistoryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  const displayNameRef = useRef(filePath.split(/[/\\]/).pop() || filePath)
  const dirtyRef = useRef(false)
  const tabsRef = useRef<TextTab[]>([])
  const activeTabIdRef = useRef(createTabId())

  const setCurrentFile = useEditorStore((state) => state.setCurrentFile)
  const setIsDirty = useEditorStore((state) => state.setIsDirty)
  const [zoomPercent, setZoomPercent] = useState(() =>
    clampNotepadZoom(readNumberSetting('notepad-zoom', 100)),
  )
  const zoom = zoomPercent / 100
  const zoomIn = useCallback(() => {
    setZoomPercent((value) => clampNotepadZoom(value + NOTEPAD_ZOOM_STEP))
  }, [])
  const zoomOut = useCallback(() => {
    setZoomPercent((value) => clampNotepadZoom(value - NOTEPAD_ZOOM_STEP))
  }, [])
  const zoomReset = useCallback(() => setZoomPercent(100), [])

  const [text, setText] = useState('')
  const [displayName, setDisplayName] = useState(() => filePath.split(/[/\\]/).pop() || filePath)
  const [encoding, setEncoding] = useState<TextEncoding>('utf-8')
  const [lineEnding, setLineEnding] = useState<LineEnding>('crlf')
  const [documentType, setDocumentType] = useState<'plain' | 'markdown'>(() =>
    filePath.toLowerCase().match(/\.(?:md|markdown)$/) ? 'markdown' : 'plain',
  )
  const [markdownView, setMarkdownView] = useState<'formatted' | 'syntax'>('syntax')
  const [recentFiles, setRecentFiles] = useState<Array<{ path: string; name: string }>>([])
  const [selection, setSelection] = useState<SelectionRange>({ start: 0, end: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [tabs, setTabs] = useState<TextTab[]>([])
  const [activeTabId, setActiveTabId] = useState(activeTabIdRef.current)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const [wordWrap, setWordWrap] = useState(() =>
    readBooleanSetting('notepad-word-wrap', true),
  )
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
  const [fontSize, setFontSize] = useState(() =>
    readNumberSetting('notepad-font-size', 11),
  )
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
  const [pageSetupOpen, setPageSetupOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Windows Notepad: document zoom (wheel AND keyboard) is inert while the
  // settings surface is shown — zoom only ever scales the document text.
  const settingsOpenRef = useRef(false)
  settingsOpenRef.current = settingsOpen
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
      setText(value)
      setDisplayName(name)
      setEncoding(nextEncoding)
      setLineEnding(nextEnding)
      setDocumentType(name.toLowerCase().match(/\.(?:md|markdown)$/) ? 'markdown' : 'plain')
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
        target = await window.api.file.selectSaveFile(defaultName)
      }
      if (!target) return false

      const value = textRef.current
      const targetLineEnding = options?.lineEnding ?? lineEndingRef.current
      const targetEncoding = options?.encoding ?? encodingRef.current
      const diskText = applyLineEnding(value, targetLineEnding)
      await window.api.lw.saveText(target, diskText, targetEncoding)

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
      const opened = await window.api.file.open(target)
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
        await window.api.lw.saveText(tab.path, diskText, tab.encoding)
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
    void window.api.file.getRecent().then((files) => setRecentFiles(files))
  }, [filePath, recentFilesEnabled])

  useEffect(() => {
    localStorage.setItem('notepad-zoom', String(zoomPercent))
  }, [zoomPercent])

  useEffect(() => {
    const root = editorRootRef.current
    if (!root) return
    const handleWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return
      event.preventDefault()
      if (settingsOpen) return
      if (event.deltaY < 0) zoomIn()
      else zoomOut()
    }
    root.addEventListener('wheel', handleWheel, { passive: false })
    return () => root.removeEventListener('wheel', handleWheel)
  }, [loading, settingsOpen, zoomIn, zoomOut])

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
    const target = await window.api.file.selectFile('text')
    if (!target) return
    if (openFileBehavior === 'window') {
      await window.api.window.newWindow(target)
      return
    }
    await window.api.file.open(target)
    setCurrentFile(target)
  }, [openFileBehavior, setCurrentFile])

  const openRecentDocument = useCallback(async (target: string) => {
    if (openFileBehavior === 'window') {
      await window.api.window.newWindow(target)
      return
    }
    await window.api.file.open(target)
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

  const closeTab = useCallback((tabId: string) => {
    if (tabId === activeTabIdRef.current) commitCurrentTab()
    const currentTabs = tabsRef.current
    const index = currentTabs.findIndex((tab) => tab.id === tabId)
    if (index < 0) return
    const tab = currentTabs[index]
    if (tab.dirty && !window.confirm(t('notepad.discardChanges', { names: tab.name }))) return
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
  }, [commitCurrentTab, replaceTabs, restoreTab, setCurrentFile, t])

  const closeDocument = useCallback(() => {
    closeTab(activeTabIdRef.current)
  }, [closeTab])

  const closeWindow = useCallback(() => {
    commitCurrentTab()
    const dirtyTabs = tabsRef.current.filter((tab) => tab.dirty)
    if (dirtyTabs.length > 0) {
      const names = new Intl.ListFormat(language, { style: 'long', type: 'conjunction' })
        .format(dirtyTabs.map((tab) => tab.name))
      if (!window.confirm(t('notepad.discardChanges', { names }))) return
    }
    void window.api.window.close()
  }, [commitCurrentTab, language, t])

  const exitApplication = useCallback(() => {
    commitCurrentTab()
    const dirtyTabs = tabsRef.current.filter((tab) => tab.dirty)
    if (dirtyTabs.length > 0) {
      const names = new Intl.ListFormat(language, { style: 'long', type: 'conjunction' })
        .format(dirtyTabs.map((tab) => tab.name))
      if (!window.confirm(t('notepad.discardChanges', { names }))) return
    }
    void window.api.window.quit()
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

  const formatLines = useCallback(
    (command: string) => {
      const range = currentSelection()
      const lineStart = textRef.current.lastIndexOf('\n', Math.max(0, range.start - 1)) + 1
      const nextBreak = textRef.current.indexOf('\n', range.end)
      const lineEnd = nextBreak < 0 ? textRef.current.length : nextBreak
      const lines = textRef.current.slice(lineStart, lineEnd).split('\n')
      const transformed = lines.map((line, index) => {
        const plain = line.replace(/^(?:#{1,3}\s+|[-*+]\s+|\d+\.\s+|- \[[ xX]\]\s+)/, '')
        if (command === 'heading-1') return `# ${plain}`
        if (command === 'heading-2') return `## ${plain}`
        if (command === 'heading-3') return `### ${plain}`
        if (command === 'bullet-list') return `- ${plain}`
        if (command === 'number-list') return `${index + 1}. ${plain}`
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
      if (command === 'bold') return wrapInline('**')
      if (command === 'italic') return wrapInline('*')
      if (command === 'underline') return wrapInline('<u>', '</u>')
      if (command === 'strikethrough') return wrapInline('~~')
      if (command === 'link') {
        const url = window.prompt(t('notepad.enterLinkAddress'), 'https://')
        if (url) wrapInline('[', `](${url})`)
        return
      }
      if (command === 'clear-format') {
        const range = currentSelection()
        if (range.start === range.end) return
        const selected = textRef.current.slice(range.start, range.end)
        const cleared = selected
          .replace(/^(?:#{1,3}\s+|[-*+]\s+|\d+\.\s+|- \[[ xX]\]\s+)/gm, '')
          .replace(/(\*\*|~~|__)(.*?)\1/g, '$2')
          .replace(/([*_])(.*?)\1/g, '$2')
          .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
        replaceSelection(cleared, true)
        return
      }
      formatLines(command)
    },
    [currentSelection, formatLines, replaceSelection, t, wrapInline],
  )

  const insertTable = useCallback((rows: number, columns: number) => {
    // Insert a real HTML <table> so formatted view draws connected cell borders
    // (not Markdown pipe tables or ASCII "-|-" fake grids that drift with font).
    const range = currentSelection()
    const before = textRef.current.slice(0, range.start)
    const needsLeadingNewline = before.length > 0 && !before.endsWith('\n')
    const table = `${needsLeadingNewline ? '\n' : ''}${buildHtmlTable(
      rows,
      columns,
      (number) => t('notepad.tableColumn', { number }),
      t('notepad.tableContent'),
    )}`
    replaceSelection(table)
    setMarkdownView('formatted')
  }, [currentSelection, replaceSelection, t])

  const syncPreviewToSource = useCallback((recordHistory: boolean) => {
    const root = previewRef.current
    if (!root) return

    const next = documentType === 'plain'
      ? serializePlainTextTableDocument(root)
      : replaceTablesInSource(
          textRef.current,
          Array.from(root.querySelectorAll('table')).map((table) =>
            serializeTableElement(table as HTMLTableElement),
          ),
        )
    if (next === textRef.current) return

    // Shell (non-table body) must stay byte-identical — including every newline below tables.
    lastPreviewShellRef.current = stripTableRegions(next)
    const selection = selectionRef.current
    applyText(next, selection.start, selection.end, recordHistory)
  }, [applyText, documentType])

  const scheduleTableHistoryCommit = useCallback(() => {
    if (tableHistoryTimerRef.current) clearTimeout(tableHistoryTimerRef.current)
    tableHistoryTimerRef.current = setTimeout(() => {
      tableHistoryTimerRef.current = null
      const last = historyRef.current[historyIndexRef.current]
      if (last && last.text === textRef.current) return
      const selection = selectionRef.current
      lastPreviewShellRef.current = stripTableRegions(textRef.current)
      applyText(textRef.current, selection.start, selection.end, true)
    }, 450)
  }, [applyText])

  const handlePreviewInput = useCallback(() => {
    syncPreviewToSource(false)
    scheduleTableHistoryCommit()
  }, [scheduleTableHistoryCommit, syncPreviewToSource])

  const handlePreviewKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    const cell = target?.closest?.('th, td') as HTMLTableCellElement | null
    if (!cell || !previewRef.current?.contains(cell)) return

    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      focusAdjacentTableCell(cell, event.shiftKey ? -1 : 1)
      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      focusAdjacentTableCell(cell, event.shiftKey ? -1 : 1)
    }
  }, [])

  const handlePreviewPaste = useCallback((event: ReactClipboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    const editable = target?.closest?.('th, td, [data-notepad-text-region]')
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
    if (tableHistoryTimerRef.current) {
      clearTimeout(tableHistoryTimerRef.current)
      tableHistoryTimerRef.current = null
    }
    syncPreviewToSource(true)
  }, [syncPreviewToSource])

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
    newWindow: () => { void window.api.window.newWindow() },
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
      else if (settingsOpen) setSettingsOpen(false)
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

  // After all tables are deleted, formatted preview has no contentEditable
  // targets — switch back to syntax so the textarea is the typing surface again.
  useEffect(() => {
    if (!shouldRecoverSyntaxEditMode(text, markdownView)) return
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
  }, [text, markdownView])

  useLayoutEffect(() => {
    if (markdownView !== 'formatted') {
      lastPreviewShellRef.current = null
      return
    }
    // No tables left: recovery effect will flip to syntax; do not paint a
    // dead read-only preview that blocks editing.
    if (shouldRecoverSyntaxEditMode(text, 'formatted')) {
      lastPreviewShellRef.current = null
      return
    }
    const root = previewRef.current
    if (!root) return

    const shell = stripTableRegions(text)
    const domTableHtmls = Array.from(root.querySelectorAll('table')).map((table) =>
      serializeTableElement(table as HTMLTableElement),
    )
    // Skip rebuild only when non-table body is unchanged AND source table cells
    // still match the live DOM (live typing). Undo/redo changes cells without
    // touching the shell — must rebuild so the preview is not stale.
    if (shouldSkipPreviewTableRebuild(text, domTableHtmls, lastPreviewShellRef.current)) {
      enableEditablePreviewRegions(root, activeSpellCheck, documentType === 'plain')
      return
    }

    lastPreviewShellRef.current = shell
    root.innerHTML = formattedHtml
    enableEditablePreviewRegions(root, activeSpellCheck, documentType === 'plain')
  }, [activeSpellCheck, documentType, formattedHtml, markdownView, text])

  useEffect(() => {
    return () => {
      if (tableHistoryTimerRef.current) clearTimeout(tableHistoryTimerRef.current)
    }
  }, [])

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

  const cursor = getCursorPosition(text, selection.start)
  const matches = findTextMatches(text, findQuery, findOptions)
  const activeMatch = matches.findIndex(
    (match) => match.start === selection.start && match.end === selection.end,
  )
  const printSize = `${pageSetup.size} ${pageSetup.orientation}`
  const printMargins = `${pageSetup.margins.top}mm ${pageSetup.margins.right}mm ${pageSetup.margins.bottom}mm ${pageSetup.margins.left}mm`

  return (
    <div
      ref={editorRootRef}
      className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-[#f3f3f3] font-['Segoe_UI'] text-[#1f1f1f] dark:bg-[#202020] dark:text-[#f4f4f4]"
      style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden', contain: 'layout paint size' }}
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
        onNewWindow={() => void window.api.window.newWindow()}
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
        onFont={() => setSettingsOpen(true)}
        onToggleWrap={() => setWordWrap((value) => !value)}
        onToggleStatusBar={() => setStatusBar((value) => !value)}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={zoomReset}
        onMarkdownView={setMarkdownView}
        onFormat={formatText}
        onInsertTable={insertTable}
        onSettings={() => setSettingsOpen(true)}
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
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.stopPropagation()
                      navigateFind(event.shiftKey ? -1 : 1)
                    }
                  }}
                  className={`${inputClass} pl-8 pr-14`}
                  placeholder={t('notepad.find')}
                  aria-label={t('notepad.find')}
                  data-testid="text-find-input"
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] opacity-55">
                  {matches.length ? `${Math.max(1, activeMatch + 1)}/${matches.length}` : '0/0'}
                </span>
              </div>
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
                  <DropdownMenu.Content sideOffset={4} align="end" className="z-[10000] min-w-[180px] rounded-md border border-black/10 bg-[#f9f9f9] p-1 text-[13px] shadow-xl dark:border-white/10 dark:bg-[#2c2c2c]">
                    <DropdownMenu.CheckboxItem className="flex h-8 cursor-default select-none items-center rounded-[4px] px-2 pl-8 outline-none data-[highlighted]:bg-black/[0.07] dark:data-[highlighted]:bg-white/[0.08]" checked={findOptions.matchCase} onCheckedChange={(checked) => setFindOptions((value) => ({ ...value, matchCase: checked === true }))}>
                      <DropdownMenu.ItemIndicator className="absolute left-2">✓</DropdownMenu.ItemIndicator>
                      {t('notepad.matchCase')}
                    </DropdownMenu.CheckboxItem>
                    <DropdownMenu.CheckboxItem className="flex h-8 cursor-default select-none items-center rounded-[4px] px-2 pl-8 outline-none data-[highlighted]:bg-black/[0.07] dark:data-[highlighted]:bg-white/[0.08]" checked={findOptions.wrapAround} onCheckedChange={(checked) => setFindOptions((value) => ({ ...value, wrapAround: checked === true }))}>
                      <DropdownMenu.ItemIndicator className="absolute left-2">✓</DropdownMenu.ItemIndicator>
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

      {markdownView === 'formatted' ? (
        <article
          ref={previewRef}
          className="notepad-markdown-preview min-h-0 w-full flex-1 overflow-auto bg-white px-5 py-4 text-[#1f1f1f] dark:bg-[#1e1e1e] dark:text-[#f2f2f2]"
          style={{
            fontFamily,
            fontSize: `${fontSize * zoom}px`,
            fontWeight,
            fontStyle,
            fontStretch: fontStretchValue(fontStretch),
            lineHeight: 1.55,
          }}
          onInput={handlePreviewInput}
          onKeyDown={handlePreviewKeyDown}
          onPaste={handlePreviewPaste}
          onBlur={handlePreviewBlur}
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
          spellCheck={activeSpellCheck}
          autoCorrect={activeSpellCheck && autoCorrect ? 'on' : 'off'}
          className={`min-h-0 w-full flex-1 resize-none border-0 bg-white px-4 py-3 text-[#1f1f1f] outline-none focus:outline-none focus:ring-0 dark:bg-[#1e1e1e] dark:text-[#f2f2f2] ${wordWrap ? 'whitespace-pre-wrap overflow-x-hidden' : 'whitespace-pre overflow-x-auto'}`}
          style={{
            tabSize: 4,
            fontFamily,
            fontSize: `${fontSize * zoom}px`,
            fontWeight,
            fontStyle,
            fontStretch: fontStretchValue(fontStretch),
            lineHeight: 1.55,
          }}
          aria-label={t('notepad.textEditorAria')}
          data-testid="text-editor-input"
        />
      )}

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
          <span className="min-w-[56px] flex-[1_1_200px] truncate border-l border-black/10 px-3 text-center dark:border-white/10" title={documentType === 'markdown' ? t('notepad.markdown') : t('notepad.plainText')}>{documentType === 'markdown' ? t('notepad.markdown') : t('notepad.plainText')}</span>
          <span className="min-w-[50px] flex-[0_1_68px] truncate border-l border-black/10 px-2 text-center dark:border-white/10">{zoomPercent}%</span>
          <span className="min-w-0 flex-[0.9_1_168px] truncate border-l border-black/10 px-2 text-center dark:border-white/10" title={lineEndingLabel(lineEnding)}>{lineEndingLabel(lineEnding)}</span>
          <span className="min-w-[38px] flex-[0_1_86px] truncate border-l border-black/10 px-2 text-center dark:border-white/10" title={encodingLabel(encoding)}>{encodingLabel(encoding)}</span>
        </div>
      )}

      <pre className="notepad-print-document" aria-hidden="true">{applyLineEnding(text, lineEnding)}</pre>
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
          <div className="space-y-4 text-[13px]">
            <div>
              <label className="mb-1.5 block" htmlFor="notepad-save-encoding">{t('notepad.encoding')}</label>
              <select id="notepad-save-encoding" className={inputClass} value={saveAsEncoding} onChange={(event) => setSaveAsEncoding(event.target.value as TextEncoding)}>
                <option value="gbk">ANSI (GBK)</option>
                <option value="utf-8">UTF-8</option>
                <option value="utf-8-bom">UTF-8 BOM</option>
                <option value="utf-16le">UTF-16 LE</option>
                <option value="utf-16be">UTF-16 BE</option>
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
        <Modal title={t('notepad.notepadSettings')} wide onClose={() => setSettingsOpen(false)}>
          {/* Win11 Notepad typography: body 14px; section headers 14px
              semibold; card titles 14px regular; descriptions 12px secondary.
              None of this scales with document zoom — only editor text does. */}
          <div className="space-y-6 pb-2 text-[14px]">
            <section aria-labelledby="notepad-settings-appearance">
              <h3 id="notepad-settings-appearance" className="mb-2 text-[14px] font-semibold">{t('notepad.appearance')}</h3>
              <div className={settingsGroupClass}>
                <div className={settingsRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <Paintbrush className={settingsIconClass} aria-hidden="true" />
                    <div className="min-w-0">
                      <label className="block" htmlFor="notepad-app-theme">{t('notepad.appTheme')}</label>
                      <p className="mt-0.5 text-[12px] opacity-65">{t('notepad.appThemeDescription')}</p>
                    </div>
                  </div>
                  <select id="notepad-app-theme" className={settingsComboClass} value={themePreference} onChange={(event) => {
                    const preference = event.target.value as ThemePreference
                    setThemePreferenceState(preference)
                    setThemePreference(preference)
                  }}>
                    <option value="system">{t('notepad.useSystemSettings')}</option>
                    <option value="light">{t('notepad.lightTheme')}</option>
                    <option value="dark">{t('notepad.darkTheme')}</option>
                  </select>
                </div>
              </div>
            </section>

            <section aria-labelledby="notepad-settings-text-format">
              <h3 id="notepad-settings-text-format" className="mb-2 text-[14px] font-semibold">{t('notepad.textFormatting')}</h3>
              <div className={settingsGroupClass}>
                <div className="border-b border-black/[0.08] p-4 dark:border-white/[0.08]">
                  <h4 className="flex items-center gap-4">
                    <CaseSensitive className={settingsIconClass} aria-hidden="true" />
                    {t('notepad.font')}
                  </h4>
                  <div className="mt-3 grid grid-cols-1 gap-2 pl-8 sm:grid-cols-[minmax(0,1.7fr)_minmax(120px,1fr)_90px]">
                    <div className="min-w-0">
                      <label className="mb-1 block text-[12px] opacity-70" htmlFor="notepad-font-family">{t('notepad.fontFamily')}</label>
                      <select id="notepad-font-family" className={settingsFieldClass} value={fontFamily} onChange={(event) => {
                        const family = event.target.value
                        const faces = systemFontFaces.filter((face) => face.familyName === family)
                        const nextFace = faces.find((face) =>
                          face.weight === 400 && face.style === 'normal' && face.stretch === 5,
                        ) || faces[0]
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
                      }}>
                        {!fontFamilies.includes(fontFamily) && <option value={fontFamily}>{fontFamily}</option>}
                        {fontFamilies.map((family) => (
                          <option key={family} value={family}>
                            {getSystemFontDisplayName(systemFontFaces, family)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="min-w-0">
                      <label className="mb-1 block text-[12px] opacity-70" htmlFor="notepad-font-style">{t('notepad.style')}</label>
                      <select id="notepad-font-style" className={settingsFieldClass} value={fontFaceValue({ faceName: fontFaceName, weight: fontWeight, style: fontStyle, stretch: fontStretch })} onChange={(event) => {
                        const [weightValue, styleValue, stretchValue, faceNameValue] = event.target.value.split('|')
                        const weight = Number(weightValue)
                        const style = styleValue as SystemFontFace['style']
                        const stretch = Number(stretchValue)
                        const faceName = decodeURIComponent(faceNameValue)
                        setFontWeight(weight)
                        setFontStyle(style)
                        setFontStretch(stretch)
                        setFontFaceName(faceName)
                        localStorage.setItem('notepad-font-weight', String(weight))
                        localStorage.setItem('notepad-font-style', style)
                        localStorage.setItem('notepad-font-stretch', String(stretch))
                        localStorage.setItem('notepad-font-face-name', faceName)
                      }}>
                        {selectedFontFaces.map((face) => (
                          <option key={fontFaceValue(face)} value={fontFaceValue(face)}>{face.faceName}</option>
                        ))}
                      </select>
                    </div>
                    <div className="min-w-0">
                      <label className="mb-1 block text-[12px] opacity-70" htmlFor="notepad-font-size">{t('notepad.size')}</label>
                      <input
                        id="notepad-font-size"
                        type="number"
                        min={8}
                        max={72}
                        step={1}
                        className={settingsFieldClass}
                        value={fontSizeInput}
                        onChange={(event) => {
                          const value = event.target.value
                          setFontSizeInput(value)
                          if (value.trim() === '') return
                          const size = Number(value)
                          if (!Number.isFinite(size) || size < 8 || size > 72) return
                          setFontSize(size)
                          localStorage.setItem('notepad-font-size', String(size))
                        }}
                        onBlur={() => {
                          const parsed = Number(fontSizeInput)
                          const size = fontSizeInput.trim() === '' || !Number.isFinite(parsed)
                            ? fontSize
                            : Math.max(8, Math.min(72, Math.round(parsed)))
                          setFontSize(size)
                          setFontSizeInput(String(size))
                          localStorage.setItem('notepad-font-size', String(size))
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur()
                        }}
                      />
                    </div>
                  </div>
                  <p
                    data-testid="notepad-font-preview"
                    dir={language === 'ar' ? 'rtl' : 'ltr'}
                    lang={language}
                    className="ml-8 mt-4 flex h-[96px] items-center justify-center overflow-hidden rounded-[4px] border border-black/[0.10] px-4 py-3 text-center dark:border-white/[0.10]"
                    style={{
                      fontFamily,
                      fontSize: `${fontSize}px`,
                      fontWeight,
                      fontStyle,
                      fontStretch: fontStretchValue(fontStretch),
                      lineHeight: 1.25,
                    }}
                  >
                    {t('notepad.fontPreview')}
                  </p>
                </div>
                <div className={settingsRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <WrapText className={settingsIconClass} aria-hidden="true" />
                    <div className="min-w-0">
                      <p>{t('notepad.wordWrap')}</p>
                      <p className="mt-0.5 text-[12px] opacity-65">{t('notepad.wordWrapDescription')}</p>
                    </div>
                  </div>
                  <SettingToggle checked={wordWrap} label={t('notepad.wordWrap')} onChange={() => setWordWrap((value) => !value)} />
                </div>
                <div className={settingsRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <LetterText className={settingsIconClass} aria-hidden="true" />
                    <p className="min-w-0">{t('notepad.formatting')}</p>
                  </div>
                  <SettingToggle checked={formattingEnabled} label={t('notepad.formatting')} onChange={() => {
                    setFormattingEnabled((value) => {
                      localStorage.setItem('notepad-formatting-enabled', String(!value))
                      return !value
                    })
                  }} />
                </div>
              </div>
            </section>

            <section aria-labelledby="notepad-settings-open">
              <h3 id="notepad-settings-open" className="mb-2 text-[14px] font-semibold">{t('notepad.openNotepad')}</h3>
              <div className={settingsGroupClass}>
                <div className={settingsRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <AppWindow className={settingsIconClass} aria-hidden="true" />
                    <div className="min-w-0">
                      <label className="block" htmlFor="notepad-open-files-in">{t('notepad.openFile')}</label>
                      <p className="mt-0.5 text-[12px] opacity-65">{t('notepad.openFileDescription')}</p>
                    </div>
                  </div>
                  <select id="notepad-open-files-in" className={settingsComboClass} value={openFileBehavior} onChange={(event) => {
                    const behavior = event.target.value as 'tab' | 'window'
                    setOpenFileBehavior(behavior)
                    localStorage.setItem('notepad-open-files-in', behavior)
                  }}>
                    <option value="tab">{t('notepad.openInNewTab')}</option>
                    <option value="window">{t('notepad.openInNewWindow')}</option>
                  </select>
                </div>
                <fieldset className="border-b border-black/[0.08] px-4 py-3 dark:border-white/[0.08]">
                  <legend className="mb-2 flex items-center gap-4">
                    <Rocket className={settingsIconClass} aria-hidden="true" />
                    {t('notepad.onStartup')}
                  </legend>
                  <label className="flex min-h-8 cursor-pointer items-center gap-3 pl-8">
                    <input type="radio" name="notepad-startup" checked={startupBehavior === 'restore'} onChange={() => {
                      setStartupBehavior('restore')
                      localStorage.setItem('notepad-startup-behavior', 'restore')
                    }} />
                    <span>{t('notepad.continuePreviousSession')}</span>
                  </label>
                  <label className="flex min-h-8 cursor-pointer items-center gap-3 pl-8">
                    <input type="radio" name="notepad-startup" checked={startupBehavior === 'new'} onChange={() => {
                      setStartupBehavior('new')
                      localStorage.setItem('notepad-startup-behavior', 'new')
                    }} />
                    <span>{t('notepad.startNewSessionDiscard')}</span>
                  </label>
                </fieldset>
                <div className={settingsRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <History className={settingsIconClass} aria-hidden="true" />
                    <p className="min-w-0">{t('notepad.recentFiles')}</p>
                  </div>
                  <SettingToggle checked={recentFilesEnabled} label={t('notepad.recentFiles')} onChange={() => {
                    setRecentFilesEnabled((value) => {
                      localStorage.setItem('notepad-recent-files', String(!value))
                      return !value
                    })
                  }} />
                </div>
              </div>
            </section>

            <section aria-labelledby="notepad-settings-spelling">
              <h3 id="notepad-settings-spelling" className="mb-2 text-[14px] font-semibold">{t('notepad.spelling')}</h3>
              <div className={settingsGroupClass}>
                <div className={settingsRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <SpellCheck className={settingsIconClass} aria-hidden="true" />
                    <p className="min-w-0">{t('notepad.spellCheck')}</p>
                  </div>
                  <SettingToggle checked={spellCheck} label={t('notepad.spellCheck')} onChange={() => {
                    setSpellCheck((value) => {
                      localStorage.setItem('notepad-spell-check', String(!value))
                      return !value
                    })
                  }} />
                </div>
                <div className="border-b border-black/[0.08] px-4 py-2 pl-8 dark:border-white/[0.08]">
                  {SPELL_CHECK_FORMATS.map((format) => (
                    <div key={format.key} className="flex min-h-9 items-center justify-between gap-4">
                      <span className={spellCheck ? '' : 'opacity-45'}>{format.label}</span>
                      <SettingToggle
                        checked={spellCheckFormats[format.key]}
                        disabled={!spellCheck}
                        label={t('notepad.spellCheckFormat', { format: format.label })}
                        onChange={() => {
                          setSpellCheckFormats((value) => {
                            const checked = !value[format.key]
                            localStorage.setItem(`notepad-spell-check-${format.key}`, String(checked))
                            return { ...value, [format.key]: checked }
                          })
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className={settingsRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <PencilLine className={settingsIconClass} aria-hidden="true" />
                    <div className="min-w-0">
                      <p>{t('notepad.autoCorrect')}</p>
                      <p className="mt-0.5 text-[12px] opacity-65">{t('notepad.autoCorrectDescription')}</p>
                    </div>
                  </div>
                  <SettingToggle checked={autoCorrect} disabled={!spellCheck} label={t('notepad.autoCorrect')} onChange={() => {
                    setAutoCorrect((value) => {
                      localStorage.setItem('notepad-auto-correct', String(!value))
                      return !value
                    })
                  }} />
                </div>
              </div>
            </section>
          </div>
        </Modal>
      )}
    </div>
  )
}
