import { ipcMain, type BrowserWindow } from 'electron'
import { IPC } from './channels'
import { getAgents, saveAgent, deleteAgent } from '../services/agent-store.service'
import { runAgentChat, runMultiAgentTask, type ChatMessage } from '../services/agent-orchestrator'
import type { AgentEditCommand } from '../services/onlyoffice.service'
import { executeAgentEdit } from '../windows/agent-editor.window'
import { getOnlyOfficeConfig } from './onlyoffice.handlers'
import { LIGHTWEIGHT_OFFICE_ENABLED } from '../lightweight-office/config'
import {
  AgentCommandTimeoutError,
  executeLightweightAgentEdit,
} from '../lightweight-office/agent-bridge.service'
import { UnknownProviderError } from '../services/llm-client.service'
import { t } from '../i18n/translate'

let currentFilePath: string | null = null
let getMainWindow: (() => BrowserWindow | null) | null = null

export function setAgentMainWindowGetter(fn: () => BrowserWindow | null): void {
  getMainWindow = fn
}

export function setCurrentFileForAgent(filePath: string | null): void {
  currentFilePath = filePath
}

function buildAgentEditHandler(agentId: string, agentName: string) {
  return async (command: AgentEditCommand) => {
    if (!currentFilePath) return { success: false, error: 'No document open' }
    if (LIGHTWEIGHT_OFFICE_ENABLED && getMainWindow) {
      return executeLightweightAgentEdit(getMainWindow, command)
    }
    return executeAgentEdit(
      agentId,
      agentName,
      currentFilePath,
      command,
      getOnlyOfficeConfig(),
    )
  }
}

function localizeAgentError(error: unknown): string {
  console.error('[Agent] request failed:', error)
  if (error instanceof UnknownProviderError) {
    return t('agentUi.unknownProvider', { provider: error.providerId })
  }
  if (error instanceof AgentCommandTimeoutError) {
    return t('agentUi.commandTimeout')
  }
  return t('agentUi.requestFailedGeneric')
}

export function registerAgentHandlers(): void {
  ipcMain.handle(IPC.AGENT_LIST, async () => getAgents())

  ipcMain.handle(IPC.AGENT_SAVE, async (_e, agent) => saveAgent(agent))

  ipcMain.handle(IPC.AGENT_DELETE, async (_e, agentId: string) => deleteAgent(agentId))

  ipcMain.handle(
    IPC.AGENT_CHAT,
    async (_e, payload: { agentId: string; messages: ChatMessage[] }) => {
      const agents = await getAgents()
      const agent = agents.find((a) => a.id === payload.agentId)
      if (!agent) return { error: t('agentUi.agentNotFound') }

      const onEdit = buildAgentEditHandler(agent.id, agent.name)

      try {
        return await runAgentChat(agent, payload.messages, onEdit)
      } catch (error) {
        return { error: localizeAgentError(error) }
      }
    },
  )

  ipcMain.handle(
    IPC.AGENT_RUN_TASK,
    async (_e, payload: { agentIds: string[]; task: string }) => {
      const allAgents = await getAgents()
      const selected = payload.agentIds
        .map((id) => allAgents.find((a) => a.id === id))
        .filter(Boolean) as typeof allAgents

      const lead = selected[0]
      const onEdit = buildAgentEditHandler(lead?.id ?? 'multi', lead?.name ?? 'Agent')

      try {
        return await runMultiAgentTask(selected, payload.task, onEdit)
      } catch (error) {
        return { error: localizeAgentError(error) }
      }
    },
  )
}
