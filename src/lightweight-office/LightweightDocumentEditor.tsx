import { desktopApi } from '@/platform'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { FileText, Keyboard } from 'lucide-react'
import { useEditorStore } from '@/stores/editor.store'
import { useFileSessionStore } from '@/stores/file-session.store'
import {
  useGlobalOfficeShortcutListener,
  useOfficeShortcuts,
  type ShortcutHandlerMap,
} from '@/lib/office-shortcuts'
import { ShortcutSettingsPanel } from '@/components/shortcuts/ShortcutSettingsPanel'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslation } from '@/lib/i18n/runtime'
import { WaitingText } from '@/components/ui/animated-ellipsis'
import { MODULE_ID, MODULE_VERSION } from './config'
import {
  getDocKind,
  isImageFile,
} from './utils/file-io'
import { tabIndexByOffset } from './document-tabs'
import { DocumentTabBar } from './components/DocumentTabBar'
import { SaveConfirmDialog } from './components/SaveConfirmDialog'

const WordEditor = lazy(async () => {
  const module = await import('./editors/WordEditor')
  return { default: module.WordEditor }
})

const ExcelEditor = lazy(async () => {
  const module = await import('./editors/ExcelEditor')
  return { default: module.ExcelEditor }
})

const PdfViewer = lazy(async () => {
  const module = await import('./editors/PdfViewer')
  return { default: module.PdfViewer }
})

const TextEditor = lazy(async () => {
  const module = await import('./editors/TextEditor')
  return { default: module.TextEditor }
})

const CodeEditor = lazy(async () => {
  const module = await import('./editors/CodeEditor')
  return { default: module.CodeEditor }
})

const PresentationViewer = lazy(async () => {
  const module = await import('./editors/PresentationViewer')
  return { default: module.PresentationViewer }
})

interface TabItem {
  id: string
  path: string
  name: string
  kind: 'word' | 'excel' | 'slide' | 'pdf' | 'text' | 'code' | 'unknown'
  dirty: boolean
}

function createTabId(): string {
  return `doc-tab-${crypto.randomUUID()}`
}

function sameDocumentPath(left: string, right: string): boolean {
  return desktopApi.app.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function createTab(path: string): TabItem {
  return {
    id: createTabId(),
    path,
    name: path.split(/[/\\]/).pop() || path,
    kind: getDocKind(path),
    dirty: false,
  }
}

/**
 * 编辑器外壳：标签栏与工具栏保持固定尺寸，不参与文档缩放�?
 * 整个外壳绝不�?.document-zoom-target（否�?Ctrl+滚轮会连标签栏一起缩放）�?
 * Word �?DocumentZoom 缩放正文，Excel / 记事�?/ PDF 自管缩放
 * （data-manages-document-zoom）�?
 */
function EditorPanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      {children}
    </div>
  )
}

function ShortcutSettingsModal({ onClose }: { onClose: () => void }) {
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
        className="flex max-h-[calc(100%-2rem)] w-full max-w-[720px] flex-col rounded-2xl border border-black/10 bg-[#f9f9f9] text-[#1f1f1f] shadow-2xl dark:border-white/10 dark:bg-[#2b2b2b] dark:text-[#f5f5f5]"
        role="dialog"
        aria-modal="true"
        aria-label={t('appShell.shortcutSettings')}
      >
        <header className="flex h-12 items-center justify-between px-5">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold">
            <Keyboard className="h-4 w-4" />
            {t('appShell.shortcutSettings')}
          </h2>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-black/[0.07] dark:hover:bg-white/[0.08]"
            aria-label={t('appShell.close')}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 pb-5">
          <ShortcutSettingsPanel onClose={onClose} />
        </div>
      </section>
    </div>
  )
}

/**
 * Shared Office-style shortcuts for Word / Excel / PDF shells.
 * Text editor registers its own richer handler map.
 * PDF 借用 word 上下文注册（nav/file 类绑定的 contexts 都是 'all'）；
 * 缩放/适配/旋转等由 PdfViewer 自己的按键监听处理，这里不注册对�?handler�?
 * dispatch 会以 no-handler 放行，不拦截事件�?
 */
function useBinaryDocShortcuts(
  kind: 'word' | 'excel' | 'slide' | 'pdf' | null,
  saveRef: MutableRefObject<(() => Promise<void>) | null>,
  tabNav?: {
    nextTab: () => void
    previousTab: () => void
    /** Ctrl+W �?close the active shell document tab (not just clear currentFile). */
    closeActiveTab: () => void
  },
) {
  const setCurrentFile = useEditorStore((s) => s.setCurrentFile)

  const handlers = useMemo<ShortcutHandlerMap>(() => {
    if (!kind) return {}
    return {
      save: () => {
        const pending = saveRef.current?.()
        if (pending) {
          void pending.catch((error) => {
            console.error('Document save failed', error)
          })
        }
      },
      nextTab: () => tabNav?.nextTab(),
      previousTab: () => tabNav?.previousTab(),
      open: () => {
        void (async () => {
          const selected = await desktopApi.files.selectFile('all')
          if (!selected) return
          const target = selected.path
          // 图片等文件交给系统默认应用打开
          if (isImageFile(target)) {
            void desktopApi.files.openExternal(target)
            return
          }
          // 立即切换文件渲染编辑器，最近文件记录后台完�?
          void desktopApi.files.open(target)
          setCurrentFile(target)
        })()
      },
      print: () => {
        window.print()
      },
      // Must remove the tab from DocumentTabBar; setCurrentFile(null) alone leaves it.
      close: () => {
        tabNav?.closeActiveTab()
      },
      closeWindow: () => {
        void desktopApi.app.close()
      },
      // Zoom: Word stays with DocumentZoom; Excel delegates to Fortune Sheet.
      // Clipboard roles stay with the native webview when we return false.
      cut: () => false,
      copy: () => false,
      paste: () => false,
      selectAll: () => false,
      undo: () => false,
      redo: () => false,
    }
  }, [kind, saveRef, setCurrentFile, tabNav])

  useOfficeShortcuts(kind === 'excel' ? 'excel' : 'word', handlers, Boolean(kind))
}

const SHORTCUT_POSITION_KEY = 'officeagentic-shortcut-position'
const TOP_BOTTOM_BAR_GAP = 8
const SNAP_DISTANCE = 12

interface ShortcutPosition { x: number; y: number }

function readStoredPosition(): ShortcutPosition | null {
  try {
    const raw = localStorage.getItem(SHORTCUT_POSITION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ShortcutPosition
    return Number.isFinite(parsed.x) && Number.isFinite(parsed.y) ? parsed : null
  } catch {
    return null
  }
}

/** Floating shortcuts button, draggable within the area with edge snapping. */
function ShortcutFloatButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  const [position, setPosition] = useState<ShortcutPosition | null>(readStoredPosition)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number; moved: boolean } | null>(null)

  const clampAndSnap = useCallback((x: number, y: number): ShortcutPosition => {
    const button = buttonRef.current
    const parent = button?.parentElement
    if (!button || !parent) return { x, y }
    const w = button.offsetWidth
    const h = button.offsetHeight
    const maxX = parent.clientWidth - w
    const maxY = parent.clientHeight - h
    let nx = Math.min(Math.max(0, x), Math.max(0, maxX))
    let ny = Math.min(Math.max(TOP_BOTTOM_BAR_GAP, y), Math.max(TOP_BOTTOM_BAR_GAP, maxY - TOP_BOTTOM_BAR_GAP))
    // Snap to edges and to top/bottom bars
    if (nx <= SNAP_DISTANCE) nx = 0
    if (maxX - nx <= SNAP_DISTANCE) nx = maxX
    if (ny - TOP_BOTTOM_BAR_GAP <= SNAP_DISTANCE) ny = TOP_BOTTOM_BAR_GAP
    if (maxY - ny <= SNAP_DISTANCE) ny = maxY - TOP_BOTTOM_BAR_GAP
    return { x: Math.round(nx), y: Math.round(ny) }
  }, [])

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    const button = event.currentTarget
    const rect = button.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    }
    button.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const parent = buttonRef.current?.parentElement
    if (!parent) return
    const parentRect = parent.getBoundingClientRect()
    const next = clampAndSnap(
      event.clientX - parentRect.left - drag.offsetX,
      event.clientY - parentRect.top - drag.offsetY,
    )
    drag.moved = true
    setPosition(next)
  }

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (buttonRef.current?.hasPointerCapture(event.pointerId)) {
      buttonRef.current.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    if (drag.moved && position) {
      try { localStorage.setItem(SHORTCUT_POSITION_KEY, JSON.stringify(position)) } catch { /* ignore */ }
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={buttonRef}
            type="button"
            className="absolute z-20 flex h-8 items-center gap-1.5 rounded-md border border-black/10 bg-white/95 px-2.5 text-[12px] shadow-sm hover:bg-white dark:border-white/10 dark:bg-[#2a2a2a]/95 dark:hover:bg-[#2a2a2a] touch-none"
            style={position
              ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' }
              : { right: 12, bottom: 48 }}
            onClick={(event) => {
              if (dragRef.current?.moved) { event.preventDefault(); return }
              onClick()
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            data-testid="open-shortcut-settings"
          >
            <Keyboard className="h-3.5 w-3.5" />
            {t('appShell.shortcuts')}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px]">
          <p className="text-[13px] font-semibold leading-tight">{t('appShell.shortcutSettings')}</p>
          <p className="mt-1 text-[12px] leading-snug opacity-75">{t('appShell.shortcuts')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function LightweightDocumentEditor() {
  const { t } = useTranslation()
  const currentFile = useEditorStore((s) => s.currentFile)
  const setEditorReady = useEditorStore((s) => s.setEditorReady)
  const setIsDirty = useEditorStore((s) => s.setIsDirty)
  const setCurrentFile = useEditorStore((s) => s.setCurrentFile)
  const sessionHydrated = useFileSessionStore((state) => state.hydrated)
  const restoredOpenFiles = useFileSessionStore((state) => state.openFiles)
  const restoredActiveFile = useFileSessionStore((state) => state.activeFile)
  const setSessionDocuments = useFileSessionStore((state) => state.setDocuments)
  const saveRef = useRef<(() => Promise<void>) | null>(null)
  const [shortcutSettingsOpen, setShortcutSettingsOpen] = useState(false)

  const [tabs, setTabs] = useState<TabItem[]>([])
  const [activeTabId, setActiveTabId] = useState<string>('')
  const activeTabIdRef = useRef('')
  const tabsRef = useRef<TabItem[]>([])
  const sessionRestoreAppliedRef = useRef(false)
  const [sessionReadyToPersist, setSessionReadyToPersist] = useState(false)

  const activateTab = useCallback((tabId: string) => {
    activeTabIdRef.current = tabId
    setActiveTabId(tabId)
  }, [])

  const switchTab = useCallback(
    (tabId: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId)
      if (tab) {
        activateTab(tabId)
        setCurrentFile(tab.path, tab.name)
      }
    },
    [activateTab, setCurrentFile],
  )

  const switchTabByOffset = useCallback(
    (offset: 1 | -1) => {
      const list = tabsRef.current
      if (list.length === 0) return
      const currentIndex = list.findIndex((tab) => tab.id === activeTabId)
      const nextIndex = tabIndexByOffset(list.length, currentIndex, offset)
      const next = list[nextIndex]
      if (next) {
        activateTab(next.id)
        setCurrentFile(next.path, next.name)
      }
    },
    [activateTab, activeTabId, setCurrentFile],
  )

  const reorderTabs = useCallback((orderedIds: string[]) => {
    const byId = new Map(tabsRef.current.map((tab) => [tab.id, tab]))
    const next = orderedIds
      .map((id) => byId.get(id))
      .filter((tab): tab is TabItem => Boolean(tab))
    // Append any missing (safety)
    for (const tab of tabsRef.current) {
      if (!orderedIds.includes(tab.id)) next.push(tab)
    }
    tabsRef.current = next
    setTabs(next)
  }, [])

  const [savePromptTab, setSavePromptTab] = useState<TabItem | null>(null)

  const performCloseTab = useCallback(
    (tabId: string) => {
      const currentTabs = tabsRef.current
      const index = currentTabs.findIndex((t) => t.id === tabId)
      if (index < 0) return

      const remaining = currentTabs.filter((t) => t.id !== tabId)
      tabsRef.current = remaining
      setTabs(remaining)

      if (activeTabIdRef.current !== tabId) return

      if (remaining.length > 0) {
        // Prefer neighbor (like browser tabs), not always the first tab.
        const nextTab = remaining[Math.min(index, remaining.length - 1)]
        activateTab(nextTab.id)
        setCurrentFile(nextTab.path, nextTab.name)
      } else {
        activateTab('')
        setCurrentFile(null)
      }
    },
    [activateTab, setCurrentFile],
  )

  const closeTab = useCallback(
    (tabId: string, force = false) => {
      const target = tabsRef.current.find((t) => t.id === tabId)
      if (!target) return
      if (target.dirty && !force) {
        setSavePromptTab(target)
        return
      }
      performCloseTab(tabId)
    },
    [performCloseTab],
  )

  const handleDialogSave = useCallback(async () => {
    if (!savePromptTab) return
    const tabToClose = savePromptTab
    if (tabToClose.id !== activeTabIdRef.current) {
      saveRef.current = null
      switchTab(tabToClose.id)
    }

    const deadline = Date.now() + 5_000
    while (!saveRef.current && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 25))
    }
    const save = saveRef.current
    if (!save) {
      console.error('Document save handler was not registered before the close timeout')
      return
    }

    try {
      await save()
    } catch (error) {
      console.error('Document save failed while closing a tab', error)
      return
    }
    performCloseTab(tabToClose.id)
    setSavePromptTab(null)
  }, [performCloseTab, savePromptTab, switchTab])

  const handleDialogDontSave = useCallback(() => {
    if (savePromptTab) {
      performCloseTab(savePromptTab.id)
    }
    setSavePromptTab(null)
  }, [performCloseTab, savePromptTab])

  const handleDialogCancel = useCallback(() => {
    setSavePromptTab(null)
  }, [])

  const closeActiveTab = useCallback(() => {
    const id = activeTabId || tabsRef.current[0]?.id
    if (id) closeTab(id)
  }, [activeTabId, closeTab])

  const newDocument = useCallback(() => {
    void (async () => {
      const selected = await desktopApi.files.selectFile('all')
      if (!selected) return
      const target = selected.path
      // 图片等文件交给系统默认应用打开
      if (isImageFile(target)) {
        await desktopApi.files.openExternal(target)
        return
      }
      await desktopApi.files.open(target)
    })()
  }, [])

  const handleDirty = useCallback(() => {
    setIsDirty(true)
    if (activeTabId) {
      const nextTabs = tabsRef.current.map((tab) =>
        tab.id === activeTabId ? { ...tab, dirty: true } : tab,
      )
      tabsRef.current = nextTabs
      setTabs(nextTabs)
    }
  }, [activeTabId, setIsDirty])

  const handleSaveSuccess = useCallback(() => {
    setIsDirty(false)
    if (activeTabId) {
      const nextTabs = tabsRef.current.map((tab) =>
        tab.id === activeTabId ? { ...tab, dirty: false } : tab,
      )
      tabsRef.current = nextTabs
      setTabs(nextTabs)
    }
  }, [activeTabId, setIsDirty])

  useEffect(() => {
    if (!sessionHydrated || sessionRestoreAppliedRef.current) return
    sessionRestoreAppliedRef.current = true

    const currentPath = useEditorStore.getState().currentFile
    const paths = [...restoredOpenFiles]
    if (currentPath && !paths.some((path) => sameDocumentPath(path, currentPath))) {
      paths.push(currentPath)
    }
    const restoredTabs = paths.map(createTab)
    tabsRef.current = restoredTabs
    setTabs(restoredTabs)

    const targetPath = currentPath
      ?? restoredTabs.find((tab) => (
        restoredActiveFile && sameDocumentPath(tab.path, restoredActiveFile)
      ))?.path
      ?? restoredTabs.at(-1)?.path
      ?? null
    const targetTab = targetPath
      ? restoredTabs.find((tab) => sameDocumentPath(tab.path, targetPath))
      : undefined
    activateTab(targetTab?.id ?? '')
    if (targetTab && (!currentPath || !sameDocumentPath(currentPath, targetTab.path))) {
      setCurrentFile(targetTab.path, targetTab.name)
    }
    setSessionReadyToPersist(true)
  }, [
    activateTab,
    restoredActiveFile,
    restoredOpenFiles,
    sessionHydrated,
    setCurrentFile,
  ])

  useEffect(() => {
    if (currentFile) {
      const existing = tabsRef.current.find((tab) => sameDocumentPath(tab.path, currentFile))
      if (!existing) {
        const newTab = createTab(currentFile)
        const nextTabs = [...tabsRef.current, newTab]
        tabsRef.current = nextTabs
        setTabs(nextTabs)
        activateTab(newTab.id)
      } else if (activeTabId !== existing.id) {
        activateTab(existing.id)
      }
    }
  }, [activateTab, currentFile, activeTabId])

  useEffect(() => {
    if (!sessionReadyToPersist) return
    const activeFile = tabs.find((tab) => tab.id === activeTabId)?.path
      ?? (currentFile && tabs.some((tab) => sameDocumentPath(tab.path, currentFile))
        ? currentFile
        : null)
    setSessionDocuments(tabs.map((tab) => tab.path), activeFile)
  }, [
    activeTabId,
    currentFile,
    sessionReadyToPersist,
    setSessionDocuments,
    tabs,
  ])

  const handleRegisterSave = useCallback((fn: (() => Promise<void>) | null) => {
    saveRef.current = fn
  }, [])

  const handleReady = useCallback(() => {
    setEditorReady(true)
  }, [setEditorReady])

  useEffect(() => {
    // Drop the previous editor's save callback on file switch so a save shortcut
    // fired before the new editor registers cannot invoke the old document's save.
    saveRef.current = null
    setEditorReady(false)
    setIsDirty(false)
    void desktopApi.documents.setCurrentFile(currentFile)
  }, [currentFile, setEditorReady, setIsDirty])

  // Shared Office shortcut dispatch for all document kinds
  useGlobalOfficeShortcutListener(true)

  const kind = currentFile ? getDocKind(currentFile) : null
  // PDF 也要注册外壳快捷键（Ctrl+Tab/W/O/P），否则 PDF 标签激活时它们全部失效
  const binaryKind = kind === 'word' || kind === 'excel' || kind === 'slide' || kind === 'pdf'
    ? kind
    : null
  const tabNav = useMemo(
    () => ({
      nextTab: () => switchTabByOffset(1),
      previousTab: () => switchTabByOffset(-1),
      closeActiveTab,
    }),
    [switchTabByOffset, closeActiveTab],
  )
  useBinaryDocShortcuts(binaryKind, saveRef, tabNav)

  const codeHandlers = useMemo<ShortcutHandlerMap>(() => ({
    save: () => {
      const pending = saveRef.current?.()
      if (pending) {
        void pending.catch((error) => {
          console.error('Document save failed', error)
        })
      }
    },
    nextTab: () => switchTabByOffset(1),
    previousTab: () => switchTabByOffset(-1),
    close: closeActiveTab,
    cut: () => false,
    copy: () => false,
    paste: () => false,
    selectAll: () => false,
    undo: () => false,
    redo: () => false,
  }), [closeActiveTab, switchTabByOffset])
  useOfficeShortcuts('text', codeHandlers, kind === 'code')

  // Empty-state still supports open / new window / shortcut settings
  const emptyHandlers = useMemo<ShortcutHandlerMap>(
    () => ({
      open: () => {
        void (async () => {
          const selected = await desktopApi.files.selectFile('all')
          if (!selected) return
          const target = selected.path
          // 图片等文件交给系统默认应用打开
          if (isImageFile(target)) {
            void desktopApi.files.openExternal(target)
            return
          }
          // 立即切换文件渲染编辑器，最近文件记录后台完�?
          void desktopApi.files.open(target)
          setCurrentFile(target)
        })()
      },
      newWindow: () => {
        void desktopApi.app.newWindow()
      },
    }),
    [setCurrentFile],
  )
  useOfficeShortcuts('text', emptyHandlers, !currentFile)

  const renderContent = () => {
    if (!currentFile) {
      return (
        <div className="relative flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
          <FileText className="h-16 w-16 opacity-20" />
          <div className="text-center">
            <p className="text-lg font-medium">{t('lightweightOffice.selectFileStart')}</p>
            <p className="mt-2 text-xs text-green-600">
              {t('lightweightOffice.lightweightModule')} {MODULE_ID} ·{' '}
              {t('lightweightOffice.version', { version: MODULE_VERSION })} ·{' '}
              {t('lightweightOffice.noDocumentServer')}
            </p>
            <button
              type="button"
              className="mt-4 inline-flex items-center gap-2 rounded-md border border-black/10 px-3 py-1.5 text-sm text-foreground hover:bg-black/[0.04] dark:border-white/10 dark:hover:bg-white/[0.06]"
              onClick={() => setShortcutSettingsOpen(true)}
              data-testid="open-shortcut-settings-empty"
            >
              <Keyboard className="h-4 w-4" />
              {t('appShell.shortcutSettings')}
            </button>
          </div>
        </div>
      )
    }

    if (kind === 'word') {
      return (
        <div className="relative flex h-full min-h-0 flex-1 flex-col">
          <Suspense
            fallback={(
              <div className="flex min-h-0 flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
                <WaitingText text={t('wordEditor.loading')} />
              </div>
            )}
          >
            <WordEditor
              filePath={currentFile}
              onReady={handleReady}
              onDirty={handleDirty}
              onSaveSuccess={handleSaveSuccess}
              onRegisterSave={handleRegisterSave}
            />
          </Suspense>
          <ShortcutFloatButton onClick={() => setShortcutSettingsOpen(true)} />
        </div>
      )
    }

    if (kind === 'excel') {
      return (
        <div className="relative flex h-full min-h-0 flex-1 flex-col">
          <Suspense
            fallback={(
              <div className="flex min-h-0 flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
                <WaitingText text={t('excelEditor.loading')} />
              </div>
            )}
          >
            <ExcelEditor
              filePath={currentFile}
              onReady={handleReady}
              onDirty={handleDirty}
              onSaveSuccess={handleSaveSuccess}
              onRegisterSave={handleRegisterSave}
            />
          </Suspense>
          <ShortcutFloatButton onClick={() => setShortcutSettingsOpen(true)} />
        </div>
      )
    }

    if (kind === 'pdf') {
      // PDF 自管缩放（data-manages-document-zoom）：只放大页面位图宽度，
      // 标签栏在外层保持固定尺寸
      return (
        <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense
            fallback={(
              <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
                <WaitingText text={t('pdfViewer.loadingPdf')} />
              </div>
            )}
          >
            <PdfViewer
              filePath={currentFile}
              onReady={handleReady}
              onDirty={handleDirty}
              onSaveSuccess={handleSaveSuccess}
              onRegisterSave={handleRegisterSave}
            />
          </Suspense>
        </div>
      )
    }

    if (kind === 'slide') {
      return (
        <Suspense
          fallback={(
            <div className="flex min-h-0 flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
              <WaitingText text={t('presentationViewer.loading')} />
            </div>
          )}
        >
          <PresentationViewer
            filePath={currentFile}
            onReady={handleReady}
            onDirty={handleDirty}
            onSaveSuccess={handleSaveSuccess}
            onRegisterSave={handleRegisterSave}
          />
        </Suspense>
      )
    }

    if (kind === 'code') {
      return (
        <Suspense
          fallback={(
            <div className="flex min-h-0 flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
              <WaitingText text={t('codeEditor.loading')} />
            </div>
          )}
        >
          <CodeEditor
            filePath={currentFile}
            onReady={handleReady}
            onDirty={handleDirty}
            onSaveSuccess={handleSaveSuccess}
            onRegisterSave={handleRegisterSave}
            onShellNextTab={() => switchTabByOffset(1)}
            onShellPreviousTab={() => switchTabByOffset(-1)}
            onShellCloseTab={closeActiveTab}
          />
        </Suspense>
      )
    }

    return (
      <Suspense
        fallback={(
          <div className="flex min-h-0 flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
            <WaitingText text={t('notepad.loadingTextFile')} />
          </div>
        )}
      >
        <TextEditor
          filePath={currentFile}
          onReady={handleReady}
          onDirty={handleDirty}
          onSaveSuccess={handleSaveSuccess}
          onRegisterSave={handleRegisterSave}
          showTabBar={false}
          onShellNextTab={() => switchTabByOffset(1)}
          onShellPreviousTab={() => switchTabByOffset(-1)}
          onShellCloseTab={closeActiveTab}
        />
      </Suspense>
    )
  }

  return (
    <EditorPanel>
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        {tabs.length > 0 && (
          <DocumentTabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelect={switchTab}
            onClose={closeTab}
            onReorder={reorderTabs}
            onNew={newDocument}
            showKindIcons
            testId="shell-document-tab-bar"
          />
        )}
        {renderContent()}
      </div>
      {shortcutSettingsOpen && (
        <ShortcutSettingsModal onClose={() => setShortcutSettingsOpen(false)} />
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
    </EditorPanel>
  )
}
