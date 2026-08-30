import { desktopApi } from '@/platform'
import { subscribeDesktopEvent } from '@/lib/desktop-events'
import { useEffect } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { useFileStore } from '@/stores/file.store'
import { useEditorStore } from '@/stores/editor.store'
import { selectFileSession, useFileSessionStore } from '@/stores/file-session.store'
import type { FileSessionState } from '@/types/desktop-api'
import { useAgentBridge } from '@/lightweight-office'
import { loadSystemFontFaces } from '@/lightweight-office/utils/system-fonts'
import { isImageFile } from '@/lightweight-office/utils/file-io'
import { useTranslation } from '@/lib/i18n/runtime'
import { invokeOfficeAction, type OfficeActionId } from '@/lib/office-shortcuts'
import { AGENT_COLLABORATION_ENABLED } from '@/lib/agent-collaboration'
import {
  APP_MENU_NEW_AGENT_EVENT,
  APP_MENU_RUN_MULTI_AGENT_EVENT,
} from '@/lib/app-menu-events'

type EditMenuAction = Extract<
  OfficeActionId,
  'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
>
type ZoomMenuAction = Extract<OfficeActionId, 'zoomIn' | 'zoomOut' | 'zoomReset'>

function runEditMenuAction(action: EditMenuAction, fallbackCommand: string): void {
  if (!invokeOfficeAction(action)) {
    // Binary editors intentionally defer these commands to the WebView. A menu
    // selection needs an explicit command because no keyboard default follows.
    document.execCommand(fallbackCommand)
  }
}

function runZoomMenuAction(action: ZoomMenuAction): void {
  if (invokeOfficeAction(action)) return

  const shortcut = action === 'zoomIn'
    ? { key: '+', code: 'Equal' }
    : action === 'zoomOut'
      ? { key: '-', code: 'Minus' }
      : { key: '0', code: 'Digit0' }
  const target = document.querySelector<HTMLElement>('[data-manages-document-zoom]') ?? window
  target.dispatchEvent(new KeyboardEvent('keydown', {
    ...shortcut,
    bubbles: true,
    cancelable: true,
    ctrlKey: desktopApi.app.platform !== 'darwin',
    metaKey: desktopApi.app.platform === 'darwin',
  }))
}

export default function App() {
  const { setRecentFiles } = useFileStore()
  const { language } = useTranslation()
  useAgentBridge()

  useEffect(() => {
    // A pending update is healthy only after the renderer mounted and completed
    // a native IPC round trip. Failure leaves the independent guardian armed.
    void desktopApi.app.markStartupHealthy().catch((error: unknown) => {
      console.error('[startup-health] Failed to confirm the updated application', error)
    })
  }, [])

  // 应用启动时即预热系统字体，避免第一次打开 Word/Excel 时等待 PowerShell 枚举
  useEffect(() => {
    void loadSystemFontFaces(language)
  }, [language])

  useEffect(() => {
    let pending: FileSessionState | null = null
    let saving = false
    let scheduled = false

    const flush = async () => {
      if (saving) return
      saving = true
      try {
        while (pending) {
          const snapshot = pending
          pending = null
          try {
            await desktopApi.files.saveSession(snapshot)
          } catch (error) {
            console.error('[file-session] Failed to persist the workspace session', error)
          }
        }
      } finally {
        saving = false
      }
    }

    const unsubscribe = useFileSessionStore.subscribe((state) => {
      if (!state.hydrated) return
      pending = selectFileSession(state)
      if (scheduled) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        void flush()
      })
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    const openGrantedFile = async (filePath: string) => {
      if (disposed) return
      if (isImageFile(filePath)) {
        await desktopApi.files.openExternal(filePath)
        return
      }
      await desktopApi.files.open(filePath)
      useEditorStore.getState().setCurrentFile(filePath)
    }

    const drainStartupFiles = async (): Promise<number> => {
      const startupFiles = await desktopApi.app.takeStartupFiles()
      for (const startupFile of startupFiles) {
        await openGrantedFile(startupFile.path)
      }
      return startupFiles.length
    }

    void (async () => {
      // Register first, then drain. A second-instance notification only signals
      // that this window's one-shot native queue has work; no absolute path is
      // exposed in a WebView URL or low-trust event payload.
      try {
        unlisten = await desktopApi.app.listen('app:open-file', () => {
          void drainStartupFiles().catch((error) => {
            console.error('[startup-files] Failed to consume additional files', error)
          })
        })
      } catch (error) {
        console.error('[startup-files] Failed to listen for additional files', error)
      }
      if (disposed) {
        unlisten?.()
        return
      }

      let restoredSession: FileSessionState = {
        mainDirectory: null,
        currentDirectory: null,
        recentDirectories: [],
        openFiles: [],
        activeFile: null,
      }
      try {
        restoredSession = await desktopApi.files.loadSession()
      } catch (error) {
        console.error('[file-session] Failed to restore the workspace session', error)
      }
      const restoreDocuments = localStorage.getItem('notepad-startup-behavior') !== 'new'
      useFileSessionStore.getState().hydrate(restoreDocuments
        ? restoredSession
        : { ...restoredSession, openFiles: [], activeFile: null })

      if (await drainStartupFiles()) return
      if (!restoreDocuments || useEditorStore.getState().currentFile) return
      if (restoredSession.activeFile) {
        useEditorStore.getState().setCurrentFile(restoredSession.activeFile)
        return
      }

      const lastFile = localStorage.getItem('notepad-last-file')
      if (!lastFile || useEditorStore.getState().currentFile) return
      // A persisted absolute path is never trusted directly. Reopening is only
      // allowed when the native recent-files service issues a fresh grant.
      const recent = await desktopApi.files.getRecent()
      const grantedLastFile = recent.find((entry) => entry.path === lastFile)
      if (!grantedLastFile) {
        localStorage.removeItem('notepad-last-file')
        return
      }
      await openGrantedFile(grantedLastFile.path).catch(() => {
        localStorage.removeItem('notepad-last-file')
      })
    })().catch((error: unknown) => {
      console.error('[startup-files] Failed to consume startup files', error)
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    const disposeOpenFile = subscribeDesktopEvent('menu:open-file', async () => {
      const selectedFile = await desktopApi.files.selectFile()
      if (!selectedFile) return
      const filePath = selectedFile.path
      // 图片等文件交给系统默认应用打开
      if (isImageFile(filePath)) {
        void desktopApi.files.openExternal(filePath)
        const recent = await desktopApi.files.getRecent()
        setRecentFiles(recent)
        return
      }
      // 立即切换文件并渲染编辑器，最近文件/快照在后台记录
      await desktopApi.files.open(filePath)
      useEditorStore.getState().setCurrentFile(filePath)
      const recent = await desktopApi.files.getRecent()
      setRecentFiles(recent)
      // 同步文件树到该文件所在目录，便于继续浏览
      const sep = desktopApi.app.platform === 'win32' ? '\\' : '/'
      const dir = filePath.split(/[/\\]/).slice(0, -1).join(sep)
      // A file-dialog grant authorizes the selected file, not its parent.
      // Keep the existing tree unless that directory already has its own grant.
      if (dir && desktopApi.files.getGrantId(dir)) {
        const entries = await desktopApi.files.list(dir)
        useFileStore.getState().setCurrentDir(dir)
        useFileStore.getState().setEntries(entries)
        useFileSessionStore.getState().visitDirectory(dir)
      }
    })

    const disposeOpenFolder = subscribeDesktopEvent('menu:open-folder', async () => {
      const selectedFolder = await desktopApi.files.selectFolder()
      if (selectedFolder) {
        const folder = selectedFolder.path
        const entries = await desktopApi.files.list(folder)
        useFileStore.getState().setCurrentDir(folder)
        useFileStore.getState().setEntries(entries)
        useFileSessionStore.getState().visitDirectory(folder)
      }
    })

    // File menu Save / Print → same Office action handlers as Ctrl+S / Ctrl+P
    const disposeSave = subscribeDesktopEvent('menu:save', () => {
      invokeOfficeAction('save')
    })

    const disposePrint = subscribeDesktopEvent('menu:print', () => {
      if (!invokeOfficeAction('print')) {
        window.print()
      }
    })

    const disposeUndo = subscribeDesktopEvent('menu:undo', () => {
      runEditMenuAction('undo', 'undo')
    })
    const disposeRedo = subscribeDesktopEvent('menu:redo', () => {
      runEditMenuAction('redo', 'redo')
    })
    const disposeCut = subscribeDesktopEvent('menu:cut', () => {
      runEditMenuAction('cut', 'cut')
    })
    const disposeCopy = subscribeDesktopEvent('menu:copy', () => {
      runEditMenuAction('copy', 'copy')
    })
    const disposePaste = subscribeDesktopEvent('menu:paste', () => {
      runEditMenuAction('paste', 'paste')
    })
    const disposeSelectAll = subscribeDesktopEvent('menu:select-all', () => {
      runEditMenuAction('selectAll', 'selectAll')
    })

    const disposeZoomReset = subscribeDesktopEvent('menu:reset-zoom', () => {
      runZoomMenuAction('zoomReset')
    })
    const disposeZoomIn = subscribeDesktopEvent('menu:zoom-in', () => {
      runZoomMenuAction('zoomIn')
    })
    const disposeZoomOut = subscribeDesktopEvent('menu:zoom-out', () => {
      runZoomMenuAction('zoomOut')
    })

    const disposeNewAgent = subscribeDesktopEvent('menu:new-agent', () => {
      window.dispatchEvent(new Event(APP_MENU_NEW_AGENT_EVENT))
    })

    const disposeRunMultiAgent = AGENT_COLLABORATION_ENABLED
      ? subscribeDesktopEvent('menu:run-multi-agent', () => {
          window.dispatchEvent(new Event(APP_MENU_RUN_MULTI_AGENT_EVENT))
        })
      : () => {}

    return () => {
      disposeOpenFile()
      disposeOpenFolder()
      disposeSave()
      disposePrint()
      disposeUndo()
      disposeRedo()
      disposeCut()
      disposeCopy()
      disposePaste()
      disposeSelectAll()
      disposeZoomReset()
      disposeZoomIn()
      disposeZoomOut()
      disposeNewAgent()
      disposeRunMultiAgent()
    }
  }, [setRecentFiles])

  return <AppLayout />
}
