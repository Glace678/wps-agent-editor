import { desktopApi } from '@/platform'
import { subscribeDesktopEvent } from '@/lib/desktop-events'
import { useEffect } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { useFileStore } from '@/stores/file.store'
import { useEditorStore } from '@/stores/editor.store'
import { useAgentBridge } from '@/lightweight-office'
import { loadSystemFontFaces } from '@/lightweight-office/utils/system-fonts'
import { isImageFile } from '@/lightweight-office/utils/file-io'
import { useTranslation } from '@/lib/i18n/runtime'
import { invokeOfficeAction } from '@/lib/office-shortcuts'
import { AGENT_COLLABORATION_ENABLED } from '@/lib/agent-collaboration'
import {
  APP_MENU_NEW_AGENT_EVENT,
  APP_MENU_RUN_MULTI_AGENT_EVENT,
} from '@/lib/app-menu-events'

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
    let disposed = false
    let unlisten: (() => void) | undefined

    const openGrantedFile = async (filePath: string) => {
      if (disposed) return
      if (isImageFile(filePath)) {
        await desktopApi.files.openExternal(filePath)
        return
      }
      void desktopApi.files.open(filePath)
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
      unlisten = await desktopApi.app.listen('app:open-file', () => {
        void drainStartupFiles()
      })
      if (disposed) {
        unlisten()
        return
      }
      if (await drainStartupFiles()) return
      if (localStorage.getItem('notepad-startup-behavior') === 'new') return

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
      void desktopApi.files.open(filePath)
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
      }
    })

    const disposeOpenFolder = subscribeDesktopEvent('menu:open-folder', async () => {
      const selectedFolder = await desktopApi.files.selectFolder()
      if (selectedFolder) {
        const folder = selectedFolder.path
        const entries = await desktopApi.files.list(folder)
        useFileStore.getState().setCurrentDir(folder)
        useFileStore.getState().setEntries(entries)
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
      disposeNewAgent()
      disposeRunMultiAgent()
    }
  }, [setRecentFiles])

  return <AppLayout />
}
