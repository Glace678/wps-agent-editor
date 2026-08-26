import { BrowserWindow } from 'electron'
import { IPC } from './channels'
import { handleTrustedIpc } from './trusted-ipc'
import { t } from '../i18n/translate'
import {
  buildEditorConfig,
  type AgentEditCommand,
} from '../services/onlyoffice.service'
import { handleAgentResult } from '../lightweight-office/agent-bridge.service'
import { executeVisibleOnlyOfficeAgentEdit } from '../lightweight-office/agent-bridge.service'
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
  handleTrustedIpc(IPC.OO_AGENT_RESULT, async (_e, payload: { requestId: string; result: unknown }) => {
    handleAgentResult(payload.requestId, payload.result)
    return { success: true }
  })
  handleTrustedIpc(IPC.OO_GET_CONFIG, async (_e, filePath: string) => {
    const ready = await isOfflineEditorReady()
    if (!ready) {
      throw new Error('OFFICE_NOT_READY')
    }

    const ooConfig = getConfig()
    const registration = await bindDocumentToBridge(filePath)
    const config = await buildEditorConfig(
      filePath,
      'user-001',
      t('wordEditor.user'),
      ooConfig,
      registration,
    )
    currentFilePath = filePath
    setCurrentFileForAgent(filePath)

    return {
      config,
      documentServerUrl: ooConfig.documentServerUrl,
    }
  })

  handleTrustedIpc(IPC.OO_FORCE_SAVE, async () => {
    return { success: true, message: 'Force save requested' }
  })

  handleTrustedIpc(IPC.OO_GET_STATUS, async () => {
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

  handleTrustedIpc(
    IPC.OO_AGENT_EDIT,
    async (event, payload: { agentId: string; agentName: string; command: AgentEditCommand }) => {
      if (!currentFilePath) {
        return { success: false, error: 'No document open' }
      }
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { success: false, error: 'Main window not ready' }
      return executeVisibleOnlyOfficeAgentEdit(() => win, {
        ...payload.command,
        agentId: payload.agentId,
        agentName: payload.agentName,
      })
    },
  )
}

export function getOnlyOfficeConfig() {
  return getConfig()
}
