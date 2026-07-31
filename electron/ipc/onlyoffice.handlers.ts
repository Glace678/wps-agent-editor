import { ipcMain } from 'electron'
import { IPC } from './channels'
import { t } from '../i18n/translate'
import {
  buildEditorConfig,
  type AgentEditCommand,
} from '../services/onlyoffice.service'
import { executeAgentEdit } from '../windows/agent-editor.window'
import { setCurrentFileForAgent } from './agent.handlers'
import {
  getOfflineOnlyOfficeConfig,
  bindDocumentToBridge,
  getOfflineStatus,
  isOfflineEditorReady,
} from '../services/offline-office.service'

let currentFilePath: string | null = null

function getConfig() {
  return getOfflineOnlyOfficeConfig()
}

export function registerOnlyOfficeHandlers(): void {
  ipcMain.handle(IPC.OO_GET_CONFIG, async (_e, filePath: string) => {
    const ready = await isOfflineEditorReady()
    if (!ready) {
      throw new Error('OFFICE_NOT_READY')
    }

    currentFilePath = filePath
    setCurrentFileForAgent(filePath)
    const ooConfig = getConfig()

    const config = await buildEditorConfig(filePath, 'user-001', t('wordEditor.user'), ooConfig)
    bindDocumentToBridge(config.document.key, filePath)

    return {
      config: {
        ...config,
        editorConfig: {
          ...config.editorConfig,
          callbackUrl: `${ooConfig.bridgeUrl}/callback`,
        },
      },
      documentServerUrl: ooConfig.documentServerUrl,
    }
  })

  ipcMain.handle(IPC.OO_FORCE_SAVE, async () => {
    return { success: true, message: 'Force save requested' }
  })

  ipcMain.handle(IPC.OO_GET_STATUS, async () => {
    const state = await getOfflineStatus()
    const ooConfig = getConfig()
    return {
      serverUrl: ooConfig.documentServerUrl,
      bridgeUrl: ooConfig.bridgeUrl,
      connected: state.offlineReady,
      offlineReady: state.offlineReady,
      officeStatus: state.status,
      message: state.message,
      currentFile: currentFilePath,
    }
  })

  ipcMain.handle(
    IPC.OO_AGENT_EDIT,
    async (_e, payload: { agentId: string; agentName: string; command: AgentEditCommand }) => {
      if (!currentFilePath) {
        return { success: false, error: 'No document open' }
      }
      return executeAgentEdit(
        payload.agentId,
        payload.agentName,
        currentFilePath,
        payload.command,
        getConfig(),
      )
    },
  )
}

export function getOnlyOfficeConfig() {
  return getConfig()
}
