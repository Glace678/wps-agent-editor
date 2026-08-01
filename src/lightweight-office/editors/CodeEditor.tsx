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
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import {
  ChevronRight,
  Copy,
  FileCode2,
  MessageSquareCode,
  Play,
  Send,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getCodeLanguage } from '@/lib/code-languages'
import { openAgentAssistant } from '@/lib/code-editor-events'
import { useTranslation } from '@/lib/i18n/runtime'
import { useAgentStore } from '@/stores/agent.store'
import type { CodeRunResult } from '@/types/code'
import { readFileBytes } from '../utils/file-io'

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
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [isRunning, setIsRunning] = useState(false)
  const [runResult, setRunResult] = useState<CodeRunResult | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<'output' | 'references'>('output')
  const [references, setReferences] = useState<ReferenceItem[]>([])
  const [referenceSymbol, setReferenceSymbol] = useState('')
  const [status, setStatus] = useState('')
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [inlineChatOpen, setInlineChatOpen] = useState(false)
  const [inlineInstruction, setInlineInstruction] = useState('')

  onDirtyRef.current = onDirty
  onReadyRef.current = onReady
  onShellNextTabRef.current = onShellNextTab
  onShellPreviousTabRef.current = onShellPreviousTab
  onShellCloseTabRef.current = onShellCloseTab

  const saveCurrent = useCallback(async () => {
    const model = modelRef.current
    if (!model) return
    await window.api.lw.saveText(filePath, model.getValue(), 'utf-8')
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
    setReferenceSymbol(symbol.value)
    setReferences(items)
    setPanelTab('references')
    setPanelOpen(true)
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
    if (isRunning) return
    setIsRunning(true)
    setPanelTab('output')
    setPanelOpen(true)
    setRunResult(null)
    try {
      await saveCurrent()
      const result = await window.api.lw.runCode(filePath)
      setRunResult(result)
      if (result.errorCode === 'runtime-missing') setStatus(t('codeEditor.runtimeMissing'))
      else if (result.errorCode === 'unsupported') setStatus(t('codeEditor.unsupportedRunner'))
      else if (result.errorCode === 'timeout') setStatus(t('codeEditor.timedOut'))
      else setStatus(t('codeEditor.runFinished', {
        code: result.exitCode ?? -1,
        duration: result.durationMs,
      }))
    } catch (error) {
      setRunResult({
        success: false,
        exitCode: null,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        command: '',
        durationMs: 0,
        errorCode: 'failed',
      })
    } finally {
      setIsRunning(false)
    }
  }, [filePath, isRunning, saveCurrent, t])

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

  useEffect(() => {
    configureMonaco()
    const host = editorHostRef.current
    if (!host || !language) return
    let cancelled = false
    let editor: monaco.editor.IStandaloneCodeEditor | null = null
    const disposables: monaco.IDisposable[] = []
    const uri = monaco.Uri.file(filePath)

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
        editor = monaco.editor.create(host, {
          model,
          theme: getDarkTheme() ? 'wps-code-dark' : 'wps-code-light',
          automaticLayout: true,
          contextmenu: false,
          fontFamily: 'Cascadia Code, Consolas, monospace',
          fontSize: 14,
          lineHeight: 22,
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
        const savedViewState = viewStates.get(filePath)
        if (savedViewState) editor.restoreViewState(savedViewState)

        disposables.push(
          editor.onDidChangeModelContent(() => onDirtyRef.current()),
          editor.onDidChangeCursorPosition((event) => {
            setCursor({ line: event.position.lineNumber, column: event.position.column })
          }),
          editor.onContextMenu((event) => {
            const browserEvent = event.event.browserEvent
            browserEvent.preventDefault()
            setContextMenu({ x: browserEvent.clientX, y: browserEvent.clientY })
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

        setLoadState('ready')
        onReadyRef.current()
        requestAnimationFrame(() => editor?.focus())
      } catch (error) {
        console.error('[CodeEditor] source file load failed:', error)
        if (!cancelled) setLoadState('error')
      }
    }

    void mount()
    return () => {
      cancelled = true
      if (editor) {
        const viewState = editor.saveViewState()
        if (viewState) viewStates.set(filePath, viewState)
      }
      disposables.forEach((disposable) => disposable.dispose())
      editor?.dispose()
      if (editorRef.current === editor) editorRef.current = null
      if (modelRef.current?.uri.toString() === uri.toString()) modelRef.current = null
    }
  }, [filePath, language])

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

  const outputText = runResult
    ? [
        runResult.command ? `> ${runResult.command}` : '',
        runResult.stdout,
        runResult.stderr,
        runResult.errorCode === 'runtime-missing'
          ? t('codeEditor.runtimeMissing')
          : runResult.errorCode === 'unsupported'
            ? t('codeEditor.unsupportedRunner')
            : runResult.errorCode === 'timeout'
              ? t('codeEditor.timedOut')
              : t('codeEditor.runFinished', {
                  code: runResult.exitCode ?? -1,
                  duration: runResult.durationMs,
                }),
      ].filter(Boolean).join('\n')
    : ''

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

  return (
    <TooltipProvider delayDuration={450}>
      <div ref={rootRef} className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background" data-code-editor-root data-testid="code-editor-root">
        <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-card px-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => void runCode()}
            disabled={isRunning || !language?.runnable}
            data-testid="code-run-button"
          >
            <Play className="h-3.5 w-3.5" />
            {isRunning ? t('codeEditor.running') : t('codeEditor.runCode')}
          </Button>
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
                onClick={() => { setPanelOpen((value) => !value); setPanelTab('output') }}
                aria-label={t('codeEditor.output')}
              >
                <Terminal className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('codeEditor.output')}</TooltipContent>
          </Tooltip>
        </div>

        <div className="relative min-h-0 flex-1">
          <div ref={editorHostRef} className="absolute inset-0" data-testid="monaco-editor-host" />
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

        {panelOpen && (
          <div className="flex h-48 shrink-0 flex-col border-t bg-[#fafafa] text-[#1f2328] dark:bg-[#121418] dark:text-[#dfe3e8]" data-testid="code-bottom-panel">
            <div className="flex h-8 shrink-0 items-center border-b px-2">
              <button type="button" className={`h-full border-b-2 px-2 text-xs ${panelTab === 'output' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`} onClick={() => setPanelTab('output')}>
                {t('codeEditor.output')}
              </button>
              <button type="button" className={`h-full border-b-2 px-2 text-xs ${panelTab === 'references' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`} onClick={() => setPanelTab('references')}>
                {t('codeEditor.references')} {references.length > 0 ? `(${references.length})` : ''}
              </button>
              <div className="ml-auto flex items-center gap-0.5">
                {panelTab === 'output' && (
                  <>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRunResult(null)} aria-label={t('codeEditor.clearOutput')}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => void navigator.clipboard.writeText(outputText)} disabled={!outputText} aria-label={t('codeEditor.copyOutput')}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPanelOpen(false)} aria-label={t('codeEditor.closePanel')}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {panelTab === 'output' ? (
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs leading-5">
                {outputText || t('codeEditor.noOutput')}
              </pre>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto py-1">
                {references.map((item) => (
                  <button
                    type="button"
                    key={`${item.line}:${item.column}`}
                    className="flex w-full items-center gap-3 px-3 py-1 text-left text-xs hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                    onClick={() => navigateTo(item.line, item.column)}
                  >
                    <span className="w-16 shrink-0 text-primary">{item.line}:{item.column}</span>
                    <span className="truncate font-mono">{item.preview}</span>
                  </button>
                ))}
                {references.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">{referenceSymbol || t('codeEditor.symbolNotFound')}</p>}
              </div>
            )}
          </div>
        )}

        <div className="flex h-6 shrink-0 items-center gap-4 border-t bg-card px-3 text-[11px] text-muted-foreground">
          <span>{t('codeEditor.lineColumn', cursor)}</span>
          <span>{t('codeEditor.spaces', { count: 2 })}</span>
          <span>UTF-8</span>
          <span>{language?.label}</span>
          {status && <span className="ml-auto max-w-[55%] truncate text-foreground">{status}</span>}
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
                    disabled={item.command === 'run' && (!language?.runnable || isRunning)}
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
