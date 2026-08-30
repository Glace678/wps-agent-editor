import { desktopApi } from '@/platform'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import CssWorker from 'monaco-editor/languages/features/css/css.worker.js?worker'
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker.js?worker'
import JsonWorker from 'monaco-editor/languages/features/json/json.worker.js?worker'
import TypeScriptWorker from 'monaco-editor/languages/features/typescript/ts.worker.js?worker'
import {
  Bug,
  ChevronRight,
  CornerDownRight,
  CornerUpLeft,
  FileCode2,
  MessageSquareCode,
  MousePointer2,
  Play,
  RotateCcw,
  Send,
  Square,
  StepForward,
  Terminal,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { getCodeLanguage } from '@/lib/code-languages'
import { openAgentAssistant } from '@/lib/code-editor-events'
import { useTranslation } from '@/lib/i18n/runtime'
import { useAgentStore } from '@/stores/agent.store'
import { useDebugStore } from '@/stores/debug.store'
import { usePanelStore } from '@/stores/panel.store'
import type { DebugCommand } from '@/types/code'
import type { DocumentEvent } from '@/types/document'
import { documentBridge } from '../agent/document-bridge'
import { readFileBytes } from '../utils/file-io'
import './code-debug.css'

type MonacoEnvironmentGlobal = typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (moduleId: string, label: string) => Worker
  }
}

;(globalThis as MonacoEnvironmentGlobal).MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TypeScriptWorker()
    return new EditorWorker()
  },
}

const viewStates = new Map<string, monaco.editor.ICodeEditorViewState>()
let themesRegistered = false
let languageDefaultsConfigured = false

const LEGACY_CODE_FONT_SIZE_KEY = 'wps-code-editor-font-size'
const CODE_FONT_SIZE_MIN = 8
const CODE_FONT_SIZE_MAX = 32
const CODE_FONT_SIZE_DEFAULT = 14
const CODE_FONT_LINE_HEIGHT_RATIO = 22 / 14
const CODE_SCROLLBAR_THUMB_HEIGHT = 48
const IMMEDIATE_SCROLL_TYPE = 1 as monaco.editor.ScrollType

const DEBUGGER_EXTENSIONS = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'pyw'])
const NO_BREAKPOINTS: number[] = []

function clampCodeFontSize(value: number): number {
  return Math.min(CODE_FONT_SIZE_MAX, Math.max(CODE_FONT_SIZE_MIN, value))
}

function installFixedVerticalScrollbar(
  editor: monaco.editor.IStandaloneCodeEditor,
  host: HTMLElement,
): monaco.IDisposable {
  const editorRoot = editor.getDomNode()
  if (!editorRoot) return { dispose() {} }

  const track = document.createElement('div')
  const thumb = document.createElement('div')
  track.className = 'wps-code-fixed-scrollbar'
  track.dataset.testid = 'code-fixed-scrollbar'
  track.setAttribute('role', 'presentation')
  track.setAttribute('aria-hidden', 'true')
  thumb.className = 'wps-code-fixed-scrollbar-thumb'
  thumb.dataset.testid = 'code-fixed-scrollbar-thumb'
  track.appendChild(thumb)
  editorRoot.appendChild(track)

  let disposed = false
  let frame = 0
  const hiddenNativeThumbs = new Set<HTMLElement>()

  const getMetrics = () => {
    const trackHeight = track.clientHeight
    const scale = editorRoot.offsetHeight > 0
      ? editorRoot.getBoundingClientRect().height / editorRoot.offsetHeight
      : Number(host.dataset.codeZoom) || 1
    const thumbHeight = Math.min(trackHeight, CODE_SCROLLBAR_THUMB_HEIGHT / Math.max(scale, 0.01))
    const maxScrollTop = Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height)
    return {
      maxScrollTop,
      thumbHeight,
      travel: Math.max(0, trackHeight - thumbHeight),
    }
  }

  const sync = () => {
    frame = 0
    if (disposed) return

    const verticalScrollbars = Array.from(
      editorRoot.querySelectorAll<HTMLElement>('.monaco-scrollable-element > .scrollbar.vertical'),
    )
    const nativeScrollbar = verticalScrollbars.reduce<HTMLElement | null>(
      (largest, candidate) => !largest || candidate.clientHeight > largest.clientHeight ? candidate : largest,
      null,
    )
    const nativeThumb = nativeScrollbar?.querySelector<HTMLElement>(':scope > .slider')
    if (nativeThumb && !hiddenNativeThumbs.has(nativeThumb)) {
      nativeThumb.classList.add('wps-code-native-scrollbar-thumb')
      hiddenNativeThumbs.add(nativeThumb)
    }

    const { maxScrollTop, thumbHeight, travel } = getMetrics()
    track.hidden = maxScrollTop <= 0 || track.clientHeight <= 0
    thumb.style.height = `${thumbHeight}px`
    const ratio = maxScrollTop > 0 ? Math.min(1, Math.max(0, editor.getScrollTop() / maxScrollTop)) : 0
    thumb.style.top = `${ratio * travel}px`
  }

  const scheduleSync = () => {
    if (disposed || frame) return
    frame = requestAnimationFrame(sync)
  }

  const setScrollRatio = (ratio: number) => {
    const { maxScrollTop } = getMetrics()
    editor.setScrollTop(Math.min(1, Math.max(0, ratio)) * maxScrollTop, IMMEDIATE_SCROLL_TYPE)
    scheduleSync()
  }

  const onTrackPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.target === thumb) return
    event.preventDefault()
    const rect = track.getBoundingClientRect()
    const physicalThumbHeight = thumb.getBoundingClientRect().height
    const travel = Math.max(0, rect.height - physicalThumbHeight)
    setScrollRatio(travel > 0 ? (event.clientY - rect.top - physicalThumbHeight / 2) / travel : 0)
  }

  const onThumbPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const startY = event.clientY
    const { maxScrollTop } = getMetrics()
    const startScrollTop = editor.getScrollTop()
    const physicalTravel = Math.max(
      0,
      track.getBoundingClientRect().height - thumb.getBoundingClientRect().height,
    )
    thumb.classList.add('active')
    thumb.setPointerCapture(event.pointerId)

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (physicalTravel <= 0) return
      editor.setScrollTop(
        startScrollTop + (moveEvent.clientY - startY) / physicalTravel * maxScrollTop,
        IMMEDIATE_SCROLL_TYPE,
      )
      scheduleSync()
    }
    const finishDrag = () => {
      thumb.classList.remove('active')
      thumb.removeEventListener('pointermove', onPointerMove)
      thumb.removeEventListener('pointerup', finishDrag)
      thumb.removeEventListener('pointercancel', finishDrag)
    }
    thumb.addEventListener('pointermove', onPointerMove)
    thumb.addEventListener('pointerup', finishDrag)
    thumb.addEventListener('pointercancel', finishDrag)
  }

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) return
    event.preventDefault()
    const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight)
    const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? event.deltaY * lineHeight
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? event.deltaY * editor.getLayoutInfo().height
        : event.deltaY
    editor.setScrollTop(editor.getScrollTop() + delta, IMMEDIATE_SCROLL_TYPE)
    scheduleSync()
  }

  track.addEventListener('pointerdown', onTrackPointerDown)
  thumb.addEventListener('pointerdown', onThumbPointerDown)
  track.addEventListener('wheel', onWheel, { passive: false })
  const scrollDisposable = editor.onDidScrollChange(scheduleSync)
  const layoutDisposable = editor.onDidLayoutChange(scheduleSync)
  const contentDisposable = editor.onDidChangeModelContent(scheduleSync)
  const resizeObserver = new ResizeObserver(scheduleSync)
  resizeObserver.observe(editorRoot)
  const zoomObserver = new MutationObserver(scheduleSync)
  zoomObserver.observe(host, { attributes: true, attributeFilter: ['data-code-zoom', 'style'] })
  scheduleSync()

  return {
    dispose() {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      scrollDisposable.dispose()
      layoutDisposable.dispose()
      contentDisposable.dispose()
      resizeObserver.disconnect()
      zoomObserver.disconnect()
      track.removeEventListener('pointerdown', onTrackPointerDown)
      thumb.removeEventListener('pointerdown', onThumbPointerDown)
      track.removeEventListener('wheel', onWheel)
      hiddenNativeThumbs.forEach((element) => element.classList.remove('wps-code-native-scrollbar-thumb'))
      track.remove()
    },
  }
}

function configureMonaco(): void {
  if (!themesRegistered) {
    monaco.editor.defineTheme('wps-code-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '075DB7', fontStyle: 'bold' },
        { token: 'type', foreground: '087E8B' },
        { token: 'type.identifier', foreground: '087E8B' },
        { token: 'string', foreground: '187A2F' },
        { token: 'number', foreground: 'B24A00' },
        { token: 'comment', foreground: '6A737D', fontStyle: 'italic' },
        { token: 'regexp', foreground: 'A31575' },
      ],
      colors: {
        'editor.background': '#FFFFFF',
        'editor.foreground': '#202124',
        'editor.lineHighlightBackground': '#F3F6F8',
        'editor.selectionBackground': '#ADD6FF',
        'editor.inactiveSelectionBackground': '#DCEBFA',
        'editorGutter.background': '#F8F9FA',
        'editorLineNumber.foreground': '#7A818A',
        'editorLineNumber.activeForeground': '#202124',
        'editorIndentGuide.background1': '#D9DEE3',
      },
    })
    monaco.editor.defineTheme('wps-code-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '65A9FF', fontStyle: 'bold' },
        { token: 'type', foreground: '4EC9B0' },
        { token: 'type.identifier', foreground: '4EC9B0' },
        { token: 'string', foreground: '9CDC8C' },
        { token: 'number', foreground: 'F2A65A' },
        { token: 'comment', foreground: '8B949E', fontStyle: 'italic' },
        { token: 'regexp', foreground: 'D16D9E' },
      ],
      colors: {
        'editor.background': '#181A1F',
        'editor.foreground': '#DDE1E6',
        'editor.lineHighlightBackground': '#22252B',
        'editor.selectionBackground': '#264F78',
        'editor.inactiveSelectionBackground': '#303A46',
        'editorGutter.background': '#15171B',
        'editorLineNumber.foreground': '#7D8590',
        'editorLineNumber.activeForeground': '#E6EDF3',
        'editorIndentGuide.background1': '#30343B',
      },
    })
    themesRegistered = true
  }

  if (!languageDefaultsConfigured) {
    const options: monaco.typescript.CompilerOptions = {
      allowNonTsExtensions: true,
      allowJs: true,
      checkJs: false,
      target: monaco.typescript.ScriptTarget.ESNext,
      module: monaco.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
      jsx: monaco.typescript.JsxEmit.ReactJSX,
      noEmit: true,
    }
    monaco.typescript.typescriptDefaults.setCompilerOptions(options)
    monaco.typescript.javascriptDefaults.setCompilerOptions(options)
    monaco.typescript.typescriptDefaults.setEagerModelSync(true)
    monaco.typescript.javascriptDefaults.setEagerModelSync(true)
    languageDefaultsConfigured = true
  }
}

function decodeSource(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  return new TextDecoder('utf-8').decode(bytes)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark')
}

function isSameFile(left: string, right: string): boolean {
  return left.replace(/\\/g, '/').toLowerCase() === right.replace(/\\/g, '/').toLowerCase()
}

interface ReferenceItem {
  line: number
  column: number
  preview: string
}

type CodeCommand =
  | 'run'
  | 'definition'
  | 'declaration'
  | 'type-definition'
  | 'implementation'
  | 'references'
  | 'peek'
  | 'all-references'
  | 'all-implementations'
  | 'call-hierarchy'
  | 'type-hierarchy'
  | 'add-chat'
  | 'inline-chat'
  | 'explain'
  | 'review'
  | 'rename'
  | 'change-all'
  | 'refactor'
  | 'source-action'
  | 'cut'
  | 'copy'
  | 'paste'

interface CodeEditorProps {
  filePath: string
  onReady: () => void
  onDirty: () => void
  onSaveSuccess: () => void
  onRegisterSave: (save: (() => Promise<void>) | null) => void
  onShellNextTab?: () => void
  onShellPreviousTab?: () => void
  onShellCloseTab?: () => void
}

export function CodeEditor({
  filePath,
  onReady,
  onDirty,
  onSaveSuccess,
  onRegisterSave,
  onShellNextTab,
  onShellPreviousTab,
  onShellCloseTab,
}: CodeEditorProps) {
  const { t } = useTranslation()
  const language = useMemo(() => getCodeLanguage(filePath), [filePath])
  const rootRef = useRef<HTMLDivElement>(null)
  const editorHostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const onDirtyRef = useRef(onDirty)
  const onReadyRef = useRef(onReady)
  const onShellNextTabRef = useRef(onShellNextTab)
  const onShellPreviousTabRef = useRef(onShellPreviousTab)
  const onShellCloseTabRef = useRef(onShellCloseTab)
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [fontSize, setFontSize] = useState(CODE_FONT_SIZE_DEFAULT)
  const [isRunning, setIsRunning] = useState(false)
  const [status, setStatus] = useState('')
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [agentCursor, setAgentCursor] = useState<{ x: number; y: number; label: string } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [inlineChatOpen, setInlineChatOpen] = useState(false)
  const [inlineInstruction, setInlineInstruction] = useState('')

  const debugStatus = useDebugStore((s) => s.status)
  const fileBreakpoints = useDebugStore((s) => (filePath ? s.breakpoints[filePath] : undefined))
  const debugBreakpoints = fileBreakpoints ?? NO_BREAKPOINTS
  const debugCurrentFile = useDebugStore((s) => s.currentFile)
  const debugCurrentLine = useDebugStore((s) => s.currentLine)
  const pendingNavigation = usePanelStore((s) => s.pendingNavigation)

  onDirtyRef.current = onDirty
  onReadyRef.current = onReady
  onShellNextTabRef.current = onShellNextTab
  onShellPreviousTabRef.current = onShellPreviousTab
  onShellCloseTabRef.current = onShellCloseTab

  const debuggable = Boolean(language?.runnable && language?.language === 'javascript'
    || language?.runnable && language?.language === 'typescript'
    || language?.runnable && language?.language === 'python'
    || DEBUGGER_EXTENSIONS.has(filePath.split('.').pop()?.toLowerCase() ?? ''))
  const debugging = debugStatus !== 'idle'
  const paused = debugStatus === 'paused'

  const [hintVisible, setHintVisible] = useState(false)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showHint = useCallback(() => {
    setHintVisible(true)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHintVisible(false), 900)
  }, [])

  const changeFontSize = useCallback((delta: number) => {
    setFontSize((previous) => {
      const next = clampCodeFontSize(previous + delta)
      if (next !== previous) showHint()
      return next
    })
  }, [showHint])

  const resetFontSize = useCallback(() => {
    setFontSize(CODE_FONT_SIZE_DEFAULT)
    showHint()
  }, [showHint])

  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    }
  }, [])

  useEffect(() => {
    setFontSize(CODE_FONT_SIZE_DEFAULT)
  }, [filePath])

  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_CODE_FONT_SIZE_KEY)
    } catch {
      // ignore
    }
  }, [])

  const saveCurrent = useCallback(async () => {
    const model = modelRef.current
    if (!model) return
    await desktopApi.documents.saveText(filePath, model.getValue(), 'utf-8')
    onSaveSuccess()
  }, [filePath, onSaveSuccess])

  useEffect(() => {
    onRegisterSave(saveCurrent)
    return () => onRegisterSave(null)
  }, [onRegisterSave, saveCurrent])

  const getWordAtCursor = useCallback(() => {
    const editor = editorRef.current
    const model = modelRef.current
    const position = editor?.getPosition()
    if (!editor || !model || !position) return null
    const word = model.getWordAtPosition(position)
    return word ? { value: word.word, range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn) } : null
  }, [])

  const navigateTo = useCallback((line: number, column: number) => {
    const editor = editorRef.current
    if (!editor) return
    editor.setPosition({ lineNumber: line, column })
    editor.revealLineInCenter(line)
    editor.focus()
  }, [])

  useEffect(() => {
    if (!pendingNavigation) return
    const { line, column, file } = pendingNavigation
    if (file && !isSameFile(file, filePath)) return
    navigateTo(line, column)
  }, [pendingNavigation, filePath, navigateTo])

  const fileDefinition = useCallback((): boolean => {
    const model = modelRef.current
    const symbol = getWordAtCursor()
    if (!model || !symbol) {
      setStatus(t('codeEditor.symbolNotFound'))
      return false
    }

    const escaped = escapeRegExp(symbol.value)
    const declaration = new RegExp(
      `\\b(?:class|interface|enum|struct|type|namespace|module|function|def|fn|func|sub|const|let|var|val|void|int|long|short|float|double|bool|boolean|string|char|auto)\\s+${escaped}\\b`,
    )
    const callable = new RegExp(`\\b${escaped}\\s*\\([^;]*\\)\\s*(?:\\{|=>|:)`)
    const lines = model.getLinesContent()
    for (let index = 0; index < lines.length; index += 1) {
      if (!declaration.test(lines[index]) && !callable.test(lines[index])) continue
      const column = lines[index].search(new RegExp(`\\b${escaped}\\b`)) + 1
      navigateTo(index + 1, Math.max(1, column))
      return true
    }
    setStatus(t('codeEditor.symbolNotFound'))
    return false
  }, [getWordAtCursor, navigateTo, t])

  const collectReferences = useCallback((): boolean => {
    const model = modelRef.current
    const symbol = getWordAtCursor()
    if (!model || !symbol) {
      setStatus(t('codeEditor.symbolNotFound'))
      return false
    }
    const matches = model.findMatches(symbol.value, false, false, true, null, false, 500)
    const items = matches.map((match) => ({
      line: match.range.startLineNumber,
      column: match.range.startColumn,
      preview: model.getLineContent(match.range.startLineNumber).trim(),
    }))
    usePanelStore.getState().setReferences(symbol.value, items)
    setStatus(t('codeEditor.referencesFound', { count: items.length, symbol: symbol.value }))
    return items.length > 0
  }, [getWordAtCursor, t])

  const runAction = useCallback(async (actionId: string): Promise<boolean> => {
    const action = editorRef.current?.getAction(actionId)
    if (!action?.isSupported()) return false
    await action.run()
    return true
  }, [])

  const sendCodeToChat = useCallback((prompt: string, includeWholeFile = false) => {
    const editor = editorRef.current
    const model = modelRef.current
    const state = useAgentStore.getState()
    if (!editor || !model) return
    if (!state.activeAgentId) {
      setStatus(t('codeEditor.selectAgentFirst'))
      openAgentAssistant()
      return
    }

    const selection = editor.getSelection()
    const selected = selection && !selection.isEmpty() ? model.getValueInRange(selection) : ''
    const source = (includeWholeFile ? model.getValue() : selected || model.getValue()).slice(0, 20_000)
    const fence = language?.language || 'text'
    const content = `${prompt}\n\nFile: ${filePath}\n\n\`\`\`${fence}\n${source}\n\`\`\``
    state.appendDraft(state.activeAgentId, content)
    openAgentAssistant()
    setStatus(t('codeEditor.addedToChat'))
  }, [filePath, language?.language, t])

  const runCode = useCallback(async () => {
    if (isRunning || useDebugStore.getState().status !== 'idle') return
    setIsRunning(true)
    try {
      await saveCurrent()
      const result = await desktopApi.process.runCode(filePath)
      const lines = [
        result.command ? `> ${result.command}` : '',
        result.stdout,
        result.stderr,
        result.errorCode === 'runtime-missing'
          ? t('codeEditor.runtimeMissing')
          : result.errorCode === 'unsupported'
            ? t('codeEditor.unsupportedRunner')
            : result.errorCode === 'timeout'
              ? t('codeEditor.timedOut')
              : t('codeEditor.runFinished', {
                  code: result.exitCode ?? -1,
                  duration: result.durationMs,
                }),
      ].filter(Boolean).join('\n')
      usePanelStore.getState().showRunResult({
        text: lines,
        command: result.command,
        exitCode: result.exitCode,
        success: result.success,
        errorCode: result.errorCode,
      })
      if (result.errorCode === 'runtime-missing') setStatus(t('codeEditor.runtimeMissing'))
      else if (result.errorCode === 'unsupported') setStatus(t('codeEditor.unsupportedRunner'))
      else if (result.errorCode === 'timeout') setStatus(t('codeEditor.timedOut'))
      else setStatus(t('codeEditor.runFinished', {
        code: result.exitCode ?? -1,
        duration: result.durationMs,
      }))
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      usePanelStore.getState().showRunResult({
        text,
        command: '',
        exitCode: null,
        success: false,
        errorCode: 'failed',
      })
      setStatus(text)
    } finally {
      setIsRunning(false)
    }
  }, [filePath, isRunning, saveCurrent, t])

  const startDebug = useCallback(async () => {
    if (useDebugStore.getState().status !== 'idle') return
    if (!debuggable) {
      setStatus(t('codeEditor.debugUnsupported'))
      return
    }
    await saveCurrent()
    const breakpoints = (useDebugStore.getState().breakpoints[filePath] ?? []).map((line) => ({ file: filePath, line }))
    useDebugStore.getState().setStatus('starting')
    usePanelStore.getState().openTab('debug-console')
    setStatus(t('codeEditor.debugStarting'))
    const result = await desktopApi.process.debugStart(filePath, breakpoints)
    if (result.ok) {
      useDebugStore.getState().startSession(filePath, result.kind ?? 'node')
      setStatus(t('codeEditor.debugRunning'))
    } else if (result.error === 'unsupported') {
      useDebugStore.getState().endSession()
      setStatus(t('codeEditor.debugUnsupported'))
    } else {
      useDebugStore.getState().endSession()
      setStatus(t('codeEditor.debugStartFailed'))
    }
  }, [debuggable, filePath, saveCurrent, t])

  const stopDebug = useCallback(() => {
    void desktopApi.process.debugStop()
    useDebugStore.getState().endSession()
    setStatus(t('codeEditor.debugSessionEnded'))
  }, [t])

  const debugCommand = useCallback((command: DebugCommand) => {
    void desktopApi.process.debugCommand(command)
  }, [])

  const toggleDebug = useCallback(() => {
    if (useDebugStore.getState().status === 'idle') {
      void startDebug()
    } else {
      debugCommand('continue')
    }
  }, [debugCommand, startDebug])

  const openChangeAll = useCallback(async () => {
    const editor = editorRef.current
    const symbol = getWordAtCursor()
    if (!editor || !symbol) {
      setStatus(t('codeEditor.symbolNotFound'))
      return
    }
    editor.setSelection(symbol.range)
    await runAction('editor.action.changeAll')
  }, [getWordAtCursor, runAction, t])

  const executeCommand = useCallback(async (command: CodeCommand) => {
    setContextMenu(null)
    const semantic = async (actionId: string, fallback = fileDefinition) => {
      if (!await runAction(actionId) && !fallback()) setStatus(t('codeEditor.semanticUnavailable'))
    }

    switch (command) {
      case 'run': await runCode(); break
      case 'definition': await semantic('editor.action.revealDefinition'); break
      case 'declaration': await semantic('editor.action.revealDeclaration'); break
      case 'type-definition': await semantic('editor.action.goToTypeDefinition'); break
      case 'implementation': await semantic('editor.action.goToImplementation'); break
      case 'references':
        if (!await runAction('editor.action.goToReferences')) collectReferences()
        break
      case 'peek': await semantic('editor.action.peekDefinition'); break
      case 'all-references': collectReferences(); break
      case 'all-implementations':
        if (!await runAction('editor.action.goToImplementation')) collectReferences()
        break
      case 'call-hierarchy':
        if (!await runAction('editor.showCallHierarchy')) setStatus(t('codeEditor.semanticUnavailable'))
        break
      case 'type-hierarchy':
        if (!await runAction('editor.showTypeHierarchy')) setStatus(t('codeEditor.semanticUnavailable'))
        break
      case 'add-chat': sendCodeToChat(t('codeEditor.addFileToChat'), true); break
      case 'inline-chat': setInlineChatOpen(true); break
      case 'explain': sendCodeToChat(t('codeEditor.explainPrompt')); break
      case 'review': sendCodeToChat(t('codeEditor.reviewPrompt')); break
      case 'rename':
        if (!await runAction('editor.action.rename')) await openChangeAll()
        break
      case 'change-all': await openChangeAll(); break
      case 'refactor':
        if (!await runAction('editor.action.refactor')) setStatus(t('codeEditor.semanticUnavailable'))
        break
      case 'source-action':
        if (!await runAction('editor.action.sourceAction')) setStatus(t('codeEditor.semanticUnavailable'))
        break
      case 'cut': await runAction('editor.action.clipboardCutAction'); break
      case 'copy': await runAction('editor.action.clipboardCopyAction'); break
      case 'paste': await runAction('editor.action.clipboardPasteAction'); break
    }
  }, [collectReferences, fileDefinition, openChangeAll, runAction, runCode, sendCodeToChat, t])

  const executeCommandRef = useRef(executeCommand)
  executeCommandRef.current = executeCommand
  const saveCurrentRef = useRef(saveCurrent)
  saveCurrentRef.current = saveCurrent
  const toggleDebugRef = useRef(toggleDebug)
  toggleDebugRef.current = toggleDebug
  const stopDebugRef = useRef(stopDebug)
  stopDebugRef.current = stopDebug
  const debugCommandRef = useRef(debugCommand)
  debugCommandRef.current = debugCommand

  useEffect(() => {
    const unsubscribe = documentBridge.subscribeDocumentEvents((event: DocumentEvent) => {
      if (event.engine !== 'monaco' || event.type !== 'cursor-moved' || !event.position?.line || !event.position.column) return
      const editor = editorRef.current
      if (!editor) return
      const visible = editor.getScrolledVisiblePosition({
        lineNumber: event.position.line,
        column: event.position.column,
      })
      if (!visible) return
      setAgentCursor({ x: visible.left, y: visible.top, label: event.agentName || 'Agent' })
      window.setTimeout(() => setAgentCursor(null), 1800)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    configureMonaco()
    const host = editorHostRef.current
    if (!host || !language) return
    let cancelled = false
    let editor: monaco.editor.IStandaloneCodeEditor | null = null
    const disposables: monaco.IDisposable[] = []
    const uri = monaco.Uri.file(filePath)
    const unsubscribePlainText = documentBridge.subscribePlainText((value) => {
      const model = modelRef.current
      if (!model || model.getValue() === value) return
      model.pushEditOperations(
        [],
        [{ range: model.getFullModelRange(), text: value }],
        () => null,
      )
    })

    const mount = async () => {
      setLoadState('loading')
      try {
        let model = monaco.editor.getModel(uri)
        if (!model) {
          const bytes = await readFileBytes(filePath)
          if (cancelled) return
          model = monaco.editor.createModel(decodeSource(bytes), language.language, uri)
        } else {
          monaco.editor.setModelLanguage(model, language.language)
        }
        if (cancelled) return

        modelRef.current = model
        documentBridge.setPlainText(model.getValue(), filePath, 'system')
        editor = monaco.editor.create(host, {
          model,
          theme: getDarkTheme() ? 'wps-code-dark' : 'wps-code-light',
          automaticLayout: true,
          contextmenu: false,
          fontFamily: 'Cascadia Code, Consolas, monospace',
          fontSize: CODE_FONT_SIZE_DEFAULT,
          lineHeight: Math.round(CODE_FONT_SIZE_DEFAULT * CODE_FONT_LINE_HEIGHT_RATIO),
          fontLigatures: true,
          minimap: { enabled: true, maxColumn: 100, renderCharacters: false },
          bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
          guides: { bracketPairs: true, indentation: true },
          folding: true,
          glyphMargin: true,
          stickyScroll: { enabled: true },
          smoothScrolling: true,
          cursorSmoothCaretAnimation: 'on',
          cursorBlinking: 'smooth',
          scrollBeyondLastLine: false,
          renderWhitespace: 'selection',
          renderControlCharacters: true,
          formatOnPaste: true,
          formatOnType: true,
          linkedEditing: true,
          padding: { top: 8, bottom: 8 },
          wordWrap: 'off',
        })
        editorRef.current = editor
        documentBridge.setCodeEditor({
          getValue: () => model.getValue(),
          getPosition: () => editor?.getPosition() ?? null,
          getLineCount: () => model.getLineCount(),
          getLineMaxColumn: (lineNumber) => model.getLineMaxColumn(lineNumber),
          executeEdits: (source, edits) => {
            editor?.executeEdits(source, edits)
          },
          setPosition: (position) => editor?.setPosition(position),
          revealPositionInCenter: (position) => editor?.revealPositionInCenter(position),
        }, filePath)
        decorationsRef.current = editor.createDecorationsCollection([])
        disposables.push(installFixedVerticalScrollbar(editor, host))
        const savedViewState = viewStates.get(filePath)
        if (savedViewState) editor.restoreViewState(savedViewState)

        disposables.push(
          editor.onDidChangeModelContent(() => {
            documentBridge.setPlainText(model.getValue(), filePath)
            onDirtyRef.current()
          }),
          editor.onDidChangeCursorPosition((event) => {
            setCursor({ line: event.position.lineNumber, column: event.position.column })
          }),
          editor.onContextMenu((event) => {
            const browserEvent = event.event.browserEvent
            browserEvent.preventDefault()
            setContextMenu({ x: browserEvent.clientX, y: browserEvent.clientY })
          }),
          editor.onMouseDown((event) => {
            const target = event.target
            const gutterClick = target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
              || target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
            if (!gutterClick || !debuggable) return
            const line = target.position?.lineNumber
            if (line) useDebugStore.getState().toggleBreakpoint(filePath, line)
          }),
        )

        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { void saveCurrentRef.current() })
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Tab, () => onShellNextTabRef.current?.())
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Tab, () => onShellPreviousTabRef.current?.())
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => onShellCloseTabRef.current?.())
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyN, () => { void executeCommandRef.current('run') })
        editor.addCommand(monaco.KeyCode.F12, () => { void executeCommandRef.current('definition') })
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12, () => { void executeCommandRef.current('implementation') })
        editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F12, () => { void executeCommandRef.current('references') })
        editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.F12, () => { void executeCommandRef.current('all-references') })
        editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyH, () => { void executeCommandRef.current('call-hierarchy') })
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => { void executeCommandRef.current('inline-chat') })
        editor.addCommand(monaco.KeyCode.F2, () => { void executeCommandRef.current('rename') })
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F2, () => { void executeCommandRef.current('change-all') })
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR, () => { void executeCommandRef.current('refactor') })
        editor.addCommand(monaco.KeyCode.F5, () => { toggleDebugRef.current() })
        editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F5, () => { stopDebugRef.current() })
        editor.addCommand(monaco.KeyCode.F10, () => { debugCommandRef.current('step-over') })
        editor.addCommand(monaco.KeyCode.F11, () => { debugCommandRef.current('step-into') })
        editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F11, () => { debugCommandRef.current('step-out') })
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.F5, () => {
          stopDebugRef.current()
          setTimeout(() => void toggleDebugRef.current(), 60)
        })

        setLoadState('ready')
        onReadyRef.current()
        requestAnimationFrame(() => editor?.focus())
      } catch (error) {
        console.error('[CodeEditor] source file load failed:', error)
        if (!cancelled) setLoadState('error')
      }
    }

    void mount()

    let wheelAccumulator = 0
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      wheelAccumulator += event.deltaY
      const steps = Math.trunc(wheelAccumulator / 100)
      if (steps === 0) return
      wheelAccumulator -= steps * 100
      changeFontSize(-steps)
    }
    host.addEventListener('wheel', onWheel, { passive: false, capture: true })

    return () => {
      cancelled = true
      unsubscribePlainText()
      documentBridge.clear()
      host.removeEventListener('wheel', onWheel, { capture: true })
      if (editor) {
        const viewState = editor.saveViewState()
        if (viewState) viewStates.set(filePath, viewState)
      }
      disposables.forEach((disposable) => disposable.dispose())
      editor?.dispose()
      if (editorRef.current === editor) editorRef.current = null
      if (modelRef.current?.uri.toString() === uri.toString()) modelRef.current = null
      decorationsRef.current = null
    }
  }, [filePath, language])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const decorations: monaco.editor.IModelDeltaDecoration[] = []
    for (const line of debugBreakpoints) {
      decorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: 'wps-debug-breakpoint-glyph',
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      })
    }
    const isCurrentFile = debugCurrentFile !== null && isSameFile(debugCurrentFile, filePath)
    if (isCurrentFile && debugCurrentLine !== null) {
      decorations.push({
        range: new monaco.Range(debugCurrentLine, 1, debugCurrentLine, 1),
        options: {
          isWholeLine: true,
          className: 'wps-debug-current-line',
          glyphMarginClassName: 'wps-debug-current-glyph',
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      })
    }
    decorationsRef.current?.set(decorations)
  }, [debugBreakpoints, debugCurrentFile, debugCurrentLine, filePath])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) return
      const target = event.target
      if (!(target instanceof Element) || !target.closest('[data-code-editor-root]')) return
      const isPlus = event.key === '+' || event.key === '=' || event.code === 'Equal' || event.code === 'NumpadAdd'
      const isMinus = event.key === '-' || event.key === '_' || event.code === 'Minus' || event.code === 'NumpadSubtract'
      const isReset = event.key === '0' || event.code === 'Digit0' || event.code === 'Numpad0'
      if (!isPlus && !isMinus && !isReset) return
      event.preventDefault()
      event.stopPropagation()
      if (isReset) resetFontSize()
      else changeFontSize(isPlus ? 1 : -1)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [changeFontSize, resetFontSize])

  useEffect(() => {
    const applyTheme = () => monaco.editor.setTheme(getDarkTheme() ? 'wps-code-dark' : 'wps-code-light')
    const observer = new MutationObserver(applyTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    applyTheme()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const close = (event: MouseEvent) => {
      const menu = (event.target as Element).closest?.('[data-code-context-menu]')
      if (menu) return
      setContextMenu(null)
    }
    const closeOnBlur = () => setContextMenu(null)
    window.addEventListener('mousedown', close, true)
    window.addEventListener('blur', closeOnBlur)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('blur', closeOnBlur)
    }
  }, [contextMenu])

  const submitInlineChat = () => {
    const instruction = inlineInstruction.trim()
    if (!instruction) return
    sendCodeToChat(t('codeEditor.inlinePrompt', { instruction }))
    setInlineInstruction('')
    setInlineChatOpen(false)
  }

  const menuStyle: CSSProperties | undefined = contextMenu
    ? (() => {
        const maxHeight = Math.max(160, window.innerHeight - 8)
        const expectedHeight = Math.min(672, maxHeight)
        return {
          left: Math.max(4, Math.min(contextMenu.x, window.innerWidth - 290)),
          top: Math.max(4, Math.min(contextMenu.y, window.innerHeight - expectedHeight - 4)),
          maxHeight,
        }
      })()
    : undefined

  const menuGroups: Array<Array<{ command: CodeCommand; label: string; shortcut?: string; arrow?: boolean }>> = [
    [{ command: 'run', label: t('codeEditor.runCode'), shortcut: 'Ctrl+Alt+N' }],
    [
      { command: 'definition', label: t('codeEditor.goToDefinition'), shortcut: 'F12' },
      { command: 'declaration', label: t('codeEditor.goToDeclaration') },
      { command: 'type-definition', label: t('codeEditor.goToTypeDefinition') },
      { command: 'implementation', label: t('codeEditor.goToImplementation'), shortcut: 'Ctrl+F12' },
      { command: 'references', label: t('codeEditor.goToReferences'), shortcut: 'Shift+F12' },
      { command: 'peek', label: t('codeEditor.peek'), arrow: true },
      { command: 'all-references', label: t('codeEditor.findAllReferences'), shortcut: 'Shift+Alt+F12' },
      { command: 'all-implementations', label: t('codeEditor.findAllImplementations') },
      { command: 'call-hierarchy', label: t('codeEditor.showCallHierarchy'), shortcut: 'Shift+Alt+H' },
      { command: 'type-hierarchy', label: t('codeEditor.showTypeHierarchy') },
    ],
    [
      { command: 'add-chat', label: t('codeEditor.addFileToChat') },
      { command: 'inline-chat', label: t('codeEditor.inlineChat'), shortcut: 'Ctrl+I' },
      { command: 'explain', label: t('codeEditor.explain') },
      { command: 'review', label: t('codeEditor.review') },
    ],
    [
      { command: 'rename', label: t('codeEditor.renameSymbol'), shortcut: 'F2' },
      { command: 'change-all', label: t('codeEditor.changeAllOccurrences'), shortcut: 'Ctrl+F2' },
      { command: 'refactor', label: t('codeEditor.refactor'), shortcut: 'Ctrl+Shift+R' },
      { command: 'source-action', label: t('codeEditor.sourceAction') },
    ],
    [
      { command: 'cut', label: t('codeEditor.cut'), shortcut: 'Ctrl+X' },
      { command: 'copy', label: t('codeEditor.copy'), shortcut: 'Ctrl+C' },
      { command: 'paste', label: t('codeEditor.paste'), shortcut: 'Ctrl+V' },
    ],
  ]

  const editorZoom = fontSize / CODE_FONT_SIZE_DEFAULT
  const zoomPercent = Math.round(editorZoom * 100)
  const editorHostStyle: CSSProperties = {
    width: `${100 / editorZoom}%`,
    height: `${100 / editorZoom}%`,
    transform: `scale(${editorZoom})`,
    transformOrigin: 'left top',
  }

  const debugTooltipClass = 'h-7 w-7'

  return (
    <TooltipProvider delayDuration={450}>
      <div ref={rootRef} className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background" data-manages-document-zoom data-code-editor-root data-testid="code-editor-root">
        <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-card px-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => void runCode()}
            disabled={isRunning || !language?.runnable || debugging}
            data-testid="code-run-button"
          >
            <Play className="h-3.5 w-3.5" />
            {isRunning ? t('codeEditor.running') : t('codeEditor.runCode')}
          </Button>
          <span className="h-4 w-px bg-border" aria-hidden="true" />
          {debugging ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={debugTooltipClass}
                    onClick={() => debugCommand('continue')}
                    disabled={!paused}
                    aria-label={t('codeEditor.continueDebug')}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('codeEditor.continueDebug')} (F5)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={debugTooltipClass}
                    onClick={() => debugCommand('step-over')}
                    disabled={!paused}
                    aria-label={t('codeEditor.stepOver')}
                  >
                    <StepForward className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('codeEditor.stepOver')} (F10)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={debugTooltipClass}
                    onClick={() => debugCommand('step-into')}
                    disabled={!paused}
                    aria-label={t('codeEditor.stepInto')}
                  >
                    <CornerDownRight className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('codeEditor.stepInto')} (F11)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={debugTooltipClass}
                    onClick={() => debugCommand('step-out')}
                    disabled={!paused}
                    aria-label={t('codeEditor.stepOut')}
                  >
                    <CornerUpLeft className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('codeEditor.stepOut')} (Shift+F11)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={debugTooltipClass}
                    onClick={() => {
                      stopDebug()
                      setTimeout(() => void startDebug(), 60)
                    }}
                    aria-label={t('codeEditor.restartDebug')}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('codeEditor.restartDebug')} (Ctrl+Shift+F5)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={debugTooltipClass}
                    onClick={stopDebug}
                    aria-label={t('codeEditor.stopDebug')}
                  >
                    <Square className="h-3 w-3 fill-current" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('codeEditor.stopDebug')} (Shift+F5)</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={() => void startDebug()}
                  disabled={!debuggable || isRunning}
                  data-testid="code-debug-button"
                >
                  <Bug className="h-3.5 w-3.5" />
                  {t('codeEditor.startDebug')}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('codeEditor.startDebug')} (F5)</TooltipContent>
            </Tooltip>
          )}
          <span className="h-4 w-px bg-border" aria-hidden="true" />
          <FileCode2 className="ml-1 h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="truncate text-xs font-medium">{language?.label ?? t('codeEditor.title')}</span>
          <span className="ml-auto truncate text-[11px] text-muted-foreground">{filePath}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => usePanelStore.getState().openTab('output')}
                aria-label={t('codeEditor.output')}
              >
                <Terminal className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('codeEditor.output')}</TooltipContent>
          </Tooltip>
        </div>

        <div className="relative min-h-0 flex-1">
          <div
            ref={editorHostRef}
            className="absolute left-0 top-0"
            data-testid="monaco-editor-host"
            data-code-zoom={editorZoom}
            style={editorHostStyle}
          />
          {agentCursor && (
            <div
              className="pointer-events-none absolute z-20"
              style={{ left: agentCursor.x, top: agentCursor.y }}
              data-testid="agent-live-cursor"
            >
              <MousePointer2 className="absolute -left-1 -top-1 h-4 w-4 fill-fuchsia-500 text-fuchsia-700 drop-shadow" />
              <span className="absolute left-1 top-0 whitespace-nowrap rounded bg-fuchsia-600 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">
                {agentCursor.label}
              </span>
            </div>
          )}
          {loadState === 'loading' && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background text-sm text-muted-foreground">
              {t('codeEditor.loading')}
            </div>
          )}
          {loadState === 'error' && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background text-sm text-destructive">
              {t('codeEditor.cannotLoad')}
            </div>
          )}

          {inlineChatOpen && (
            <div className="absolute left-6 right-6 top-3 z-30 border border-primary/40 bg-card p-2 shadow-xl" data-testid="code-inline-chat">
              <div className="flex items-start gap-2">
                <MessageSquareCode className="mt-2 h-4 w-4 shrink-0 text-primary" />
                <textarea
                  autoFocus
                  rows={2}
                  className="min-h-14 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-sm outline-none"
                  placeholder={t('codeEditor.inlinePlaceholder')}
                  value={inlineInstruction}
                  onChange={(event) => setInlineInstruction(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      submitInlineChat()
                    }
                    if (event.key === 'Escape') setInlineChatOpen(false)
                  }}
                />
                <Button type="button" size="sm" className="h-8 gap-1" onClick={submitInlineChat} disabled={!inlineInstruction.trim()}>
                  <Send className="h-3.5 w-3.5" />
                  {t('codeEditor.sendToChat')}
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setInlineChatOpen(false)} aria-label={t('codeEditor.cancel')}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
        {hintVisible && (
          <div
            className="pointer-events-none absolute bottom-9 left-1/2 z-30 -translate-x-1/2 rounded-md bg-foreground/85 px-3 py-1.5 text-xs font-medium text-background shadow-lg"
            role="status"
            aria-live="polite"
          >
            {t('appShell.documentZoom', { percent: zoomPercent })}
          </div>
        )}

        <div className="flex h-6 shrink-0 items-center border-t bg-card px-3 text-[11px] text-muted-foreground select-none">
          <div className="flex items-center gap-4 min-w-0">
            <span>{t('codeEditor.lineColumn', cursor)}</span>
            <span>{t('codeEditor.spaces', { count: 2 })}</span>
            <span>UTF-8</span>
            <span>{language?.label}</span>
            {debugging && (
              <span className={paused ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}>
                {paused
                  ? `${t('codeEditor.debugPaused')}${debugCurrentLine ? ` ${debugCurrentLine}` : ''}`
                  : t('codeEditor.debugRunning')}
              </span>
            )}
          </div>
          {status && <span className="ml-auto mr-3 max-w-[40%] truncate text-foreground">{status}</span>}
          <div className={cn('flex items-center shrink-0', !status && 'ml-auto')}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={resetFontSize}
                  aria-label={t('appShell.documentZoom', { percent: zoomPercent })}
                  data-testid="code-editor-zoom-status"
                >
                  <span>{zoomPercent}%</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {t('appShell.documentZoom', { percent: zoomPercent })} (Ctrl+0)
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {contextMenu && createPortal(
          <div
            className="fixed z-[2147483200] w-[286px] overflow-y-auto rounded-[4px] border border-black/15 bg-card py-1 text-[13px] text-card-foreground shadow-2xl dark:border-white/15"
            style={menuStyle}
            data-code-context-menu
            role="menu"
            onMouseDown={(event) => event.stopPropagation()}
          >
            {menuGroups.map((group, groupIndex) => (
              <div key={groupIndex} className={groupIndex > 0 ? 'border-t border-border py-1' : 'pb-1'}>
                {group.map((item) => (
                  <button
                    type="button"
                    role="menuitem"
                    key={item.command}
                    className="flex h-7 w-full items-center px-3 text-left outline-none hover:bg-accent focus:bg-accent disabled:opacity-45"
                    onClick={() => void executeCommand(item.command)}
                    disabled={item.command === 'run' && (!language?.runnable || isRunning || debugging)}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.shortcut && <span className="ml-4 shrink-0 text-[11px] text-muted-foreground">{item.shortcut}</span>}
                    {item.arrow && <ChevronRight className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  </button>
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}
      </div>
    </TooltipProvider>
  )
}
