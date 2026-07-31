import { useEffect } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { useFileStore } from '@/stores/file.store'
import { useEditorStore } from '@/stores/editor.store'
import { useAgentBridge } from '@/lightweight-office'
import { invokeOfficeAction } from '@/lib/office-shortcuts'
import {
  APP_MENU_NEW_AGENT_EVENT,
  APP_MENU_RUN_MULTI_AGENT_EVENT,
} from '@/lib/app-menu-events'

export default function App() {
  const { setRecentFiles } = useFileStore()
  useAgentBridge()

  useEffect(() => {
    const initialFile = new URLSearchParams(window.location.search).get('openFile')
    if (initialFile) {
      void window.api.file.open(initialFile).then(() => {
        useEditorStore.getState().setCurrentFile(initialFile)
      })
      return
    }
    if (localStorage.getItem('notepad-startup-behavior') === 'new') return
    const lastFile = localStorage.getItem('notepad-last-file')
    if (!lastFile || useEditorStore.getState().currentFile) return
    void window.api.file.open(lastFile).then(() => {
      useEditorStore.getState().setCurrentFile(lastFile)
    }).catch(() => {
      localStorage.removeItem('notepad-last-file')
    })
  }, [])

  useEffect(() => {
    const disposeOpenFile = window.api.on('menu:open-file', async () => {
      const filePath = await window.api.file.selectFile()
      if (!filePath) return
      await window.api.file.open(filePath)
      useEditorStore.getState().setCurrentFile(filePath)
      const recent = await window.api.file.getRecent()
      setRecentFiles(recent)
      // 同步文件树到该文件所在目录，便于继续浏览
      const sep = window.api.platform === 'win32' ? '\\' : '/'
      const dir = filePath.split(/[/\\]/).slice(0, -1).join(sep)
      if (dir) {
        const entries = await window.api.file.list(dir)
        useFileStore.getState().setCurrentDir(dir)
        useFileStore.getState().setEntries(entries)
      }
    })

    const disposeOpenFolder = window.api.on('menu:open-folder', async () => {
      const folder = await window.api.file.selectFolder()
      if (folder) {
        const entries = await window.api.file.list(folder)
        useFileStore.getState().setCurrentDir(folder)
        useFileStore.getState().setEntries(entries)
      }
    })

    // File menu Save / Print → same Office action handlers as Ctrl+S / Ctrl+P
    const disposeSave = window.api.on('menu:save', () => {
      invokeOfficeAction('save')
    })

    const disposePrint = window.api.on('menu:print', () => {
      if (!invokeOfficeAction('print')) {
        window.print()
      }
    })

    const disposeNewAgent = window.api.on('menu:new-agent', () => {
      window.dispatchEvent(new Event(APP_MENU_NEW_AGENT_EVENT))
    })

    const disposeRunMultiAgent = window.api.on('menu:run-multi-agent', () => {
      window.dispatchEvent(new Event(APP_MENU_RUN_MULTI_AGENT_EVENT))
    })

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
