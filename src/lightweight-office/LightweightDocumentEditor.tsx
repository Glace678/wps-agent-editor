import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { FileText, Keyboard } from 'lucide-react'
import { useEditorStore } from '@/stores/editor.store'
import {
  useGlobalOfficeShortcutListener,
  useOfficeShortcuts,
  type ShortcutHandlerMap,
} from '@/lib/office-shortcuts'
import { ShortcutSettingsPanel } from '@/components/shortcuts/ShortcutSettingsPanel'
import { useTranslation } from '@/lib/i18n/runtime'
import './styles'
import { MODULE_ID, MODULE_VERSION } from './config'
import { getDocKind } from './utils/file-io'
import { tabIndexByOffset } from './document-tabs'
import { DocumentTabBar } from './components/DocumentTabBar'
import { WordEditor } from './editors/WordEditor'
import { ExcelEditor } from './editors/ExcelEditor'
import { PdfViewer } from './editors/PdfViewer'
import { TextEditor } from './editors/TextEditor'
import { CodeEditor } from './editors/CodeEditor'

interface TabItem {
  id: string
  path: string
  name: string
  kind: 'word' | 'excel' | 'pdf' | 'text' | 'code' | 'unknown'
  dirty: boolean
}

function createTabId(): string {
  return `doc-tab-${crypto.randomUUID()}`
}

/**
 * 编辑器外壳：标签栏与工具栏保持固定尺寸，不参与文档缩放。
 * 整个外壳绝不挂 .document-zoom-target（否则 Ctrl+滚轮会连标签栏一起缩放）；
 * Word 由 DocumentZoom 缩放正文，Excel / 记事本 / PDF 自管缩放
 * （data-manages-document-zoom）。
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
        className="flex max-h-[calc(100%-2rem)] w-full max-w-[720px] flex-col rounded-[8px] border border-black/10 bg-[#f9f9f9] text-[#1f1f1f] shadow-2xl dark:border-white/10 dark:bg-[#2b2b2b] dark:text-[#f5f5f5]"
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
            className="flex h-8 w-8 items-center justify-center rounded-[4px] hover:bg-black/[0.07] dark:hover:bg-white/[0.08]"
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
 * 缩放/适配/旋转等由 PdfViewer 自己的按键监听处理，这里不注册对应 handler，
 * dispatch 会以 no-handler 放行，不拦截事件。
 */
function useBinaryDocShortcuts(
  kind: 'word' | 'excel' | 'pdf' | null,
  saveRef: MutableRefObject<(() => Promise<void>) | null>,
  tabNav?: {
    nextTab: () => void
    previousTab: () => void
    /** Ctrl+W — close the active shell document tab (not just clear currentFile). */
    closeActiveTab: () => void
  },
) {
  const setCurrentFile = useEditorStore((s) => s.setCurrentFile)

  const handlers = useMemo<ShortcutHandlerMap>(() => {
    if (!kind) return {}
    return {
      save: () => {
        void saveRef.current?.()
      },
      nextTab: () => tabNav?.nextTab(),
      previousTab: () => tabNav?.previousTab(),
      open: () => {
        void (async () => {
          const target = await window.api.file.selectFile('all')
          if (target) {
            await window.api.file.open(target)
            setCurrentFile(target)
          }
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
        void window.api.window.close()
      },
      // Zoom: Word stays with DocumentZoom; Excel delegates to Fortune Sheet.
      // Clipboard roles left to native/Electron when we return false
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

export function LightweightDocumentEditor() {
  const { t } = useTranslation()
  const currentFile = useEditorStore((s) => s.currentFile)
  const setEditorReady = useEditorStore((s) => s.setEditorReady)
  const setIsDirty = useEditorStore((s) => s.setIsDirty)
  const setCurrentFile = useEditorStore((s) => s.setCurrentFile)
  const saveRef = useRef<(() => Promise<void>) | null>(null)
  const [shortcutSettingsOpen, setShortcutSettingsOpen] = useState(false)

  const [tabs, setTabs] = useState<TabItem[]>([])
  const [activeTabId, setActiveTabId] = useState<string>('')
  const tabsRef = useRef<TabItem[]>([])

  const switchTab = useCallback(
    (tabId: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId)
      if (tab) {
        setActiveTabId(tabId)
        setCurrentFile(tab.path, tab.name)
      }
    },
    [setCurrentFile],
  )

  const switchTabByOffset = useCallback(
    (offset: 1 | -1) => {
      const list = tabsRef.current
      if (list.length === 0) return
      const currentIndex = list.findIndex((tab) => tab.id === activeTabId)
      const nextIndex = tabIndexByOffset(list.length, currentIndex, offset)
      const next = list[nextIndex]
      if (next) {
        setActiveTabId(next.id)
        setCurrentFile(next.path, next.name)
      }
    },
    [activeTabId, setCurrentFile],
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

  const closeTab = useCallback(
    (tabId: string) => {
      const currentTabs = tabsRef.current
      const index = currentTabs.findIndex((t) => t.id === tabId)
      if (index < 0) return

      const remaining = currentTabs.filter((t) => t.id !== tabId)
      tabsRef.current = remaining
      setTabs(remaining)

      if (activeTabId !== tabId) return

      if (remaining.length > 0) {
        // Prefer neighbor (like browser tabs), not always the first tab.
        const nextTab = remaining[Math.min(index, remaining.length - 1)]
        setActiveTabId(nextTab.id)
        setCurrentFile(nextTab.path, nextTab.name)
      } else {
        setActiveTabId('')
        setCurrentFile(null)
      }
    },
    [activeTabId, setCurrentFile],
  )

  const closeActiveTab = useCallback(() => {
    const id = activeTabId || tabsRef.current[0]?.id
    if (id) closeTab(id)
  }, [activeTabId, closeTab])

  const newDocument = useCallback(() => {
    void (async () => {
      const target = await window.api.file.selectFile('all')
      if (target) {
        await window.api.file.open(target)
      }
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
    if (currentFile) {
      const existing = tabsRef.current.find((t) => t.path === currentFile)
      if (!existing) {
        const name = currentFile.split(/[/\\]/).pop() || currentFile
        const kind = getDocKind(currentFile)
        const newTab: TabItem = {
          id: `tab-${Date.now()}`,
          path: currentFile,
          name,
          kind,
          dirty: false,
        }
        const nextTabs = [...tabsRef.current, newTab]
        tabsRef.current = nextTabs
        setTabs(nextTabs)
        setActiveTabId(newTab.id)
      } else if (activeTabId !== existing.id) {
        setActiveTabId(existing.id)
      }
    }
  }, [currentFile, activeTabId, setCurrentFile])

  const handleRegisterSave = useCallback((fn: (() => Promise<void>) | null) => {
    saveRef.current = fn
  }, [])

  const handleReady = useCallback(() => {
    setEditorReady(true)
  }, [setEditorReady])

  useEffect(() => {
    setEditorReady(false)
    setIsDirty(false)
    void window.api.lw.setCurrentFile(currentFile)
  }, [currentFile, setEditorReady, setIsDirty])

  // Shared Office shortcut dispatch for all document kinds
  useGlobalOfficeShortcutListener(true)

  const kind = currentFile ? getDocKind(currentFile) : null
  // PDF 也要注册外壳快捷键（Ctrl+Tab/W/O/P），否则 PDF 标签激活时它们全部失效
  const binaryKind = kind === 'word' || kind === 'excel' || kind === 'pdf' ? kind : null
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
    save: () => { void saveRef.current?.() },
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
          const target = await window.api.file.selectFile('all')
          if (target) {
            await window.api.file.open(target)
            setCurrentFile(target)
          }
        })()
      },
      newWindow: () => {
        void window.api.window.newWindow()
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
            <p className="mt-1 text-sm">{t('lightweightOffice.formatSupport')}</p>
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
          <WordEditor
            filePath={currentFile}
            onReady={handleReady}
            onDirty={handleDirty}
            onSaveSuccess={handleSaveSuccess}
            onRegisterSave={handleRegisterSave}
          />
          <button
            type="button"
            className="absolute bottom-3 right-3 z-20 flex h-8 items-center gap-1.5 rounded-md border border-black/10 bg-white/95 px-2.5 text-[12px] shadow-sm hover:bg-white dark:border-white/10 dark:bg-[#2a2a2a]/95"
            onClick={() => setShortcutSettingsOpen(true)}
            title={t('appShell.shortcutSettings')}
            data-testid="open-shortcut-settings"
          >
            <Keyboard className="h-3.5 w-3.5" />
            {t('appShell.shortcuts')}
          </button>
        </div>
      )
    }

    if (kind === 'excel') {
      return (
        <div className="relative flex h-full min-h-0 flex-1 flex-col">
          <ExcelEditor
            filePath={currentFile}
            onReady={handleReady}
            onDirty={handleDirty}
            onSaveSuccess={handleSaveSuccess}
            onRegisterSave={handleRegisterSave}
          />
          <button
            type="button"
            className="absolute bottom-3 right-3 z-20 flex h-8 items-center gap-1.5 rounded-md border border-black/10 bg-white/95 px-2.5 text-[12px] shadow-sm hover:bg-white dark:border-white/10 dark:bg-[#2a2a2a]/95"
            onClick={() => setShortcutSettingsOpen(true)}
            title={t('appShell.shortcutSettings')}
            data-testid="open-shortcut-settings"
          >
            <Keyboard className="h-3.5 w-3.5" />
            {t('appShell.shortcuts')}
          </button>
        </div>
      )
    }

    if (kind === 'pdf') {
      // PDF 自管缩放（data-manages-document-zoom）：只放大页面位图宽度，
      // 标签栏在外层保持固定尺寸
      return (
        <div className="min-h-0 flex-1 overflow-hidden">
          <PdfViewer filePath={currentFile} onReady={handleReady} />
        </div>
      )
    }

    if (kind === 'code') {
      return (
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
      )
    }

    return (
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
    </EditorPanel>
  )
}
