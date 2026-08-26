import type { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC } from './channels'
import { handleTrustedIpc } from './trusted-ipc'
import { getAgents, saveAgent, deleteAgent } from '../services/agent-store.service'
import { createAgentRunId, runAgentChat, runMultiAgentTask, type ChatMessage } from '../services/agent-orchestrator'
import type { AgentEditCommand } from '../services/onlyoffice.service'
import { LIGHTWEIGHT_OFFICE_ENABLED } from '../lightweight-office/config'
import {
  AgentCommandTimeoutError,
  cancelLightweightAgentRun,
  executeLightweightAgentEdit,
  executeVisibleOnlyOfficeAgentEdit,
} from '../lightweight-office/agent-bridge.service'
import { MissingAgentModelError, UnknownProviderError } from '../services/llm-client.service'
import { t } from '../i18n/translate'
import { AGENT_COLLABORATION_ENABLED } from '../../src/lib/agent-collaboration'
import type { AgentCollaborationEvent } from '../../src/types/agent'
import type {
  AgentApprovalRequest,
  AgentApprovalResponse,
  AgentUserDocumentActivity,
  WordPlaybackControl,
} from '../../src/types/document'
import { invalidatesApproval, isCurrentApprovalResponse } from '../../src/lib/word-agent-approval'

let currentFilePath: string | null = null
let getMainWindow: (() => BrowserWindow | null) | null = null
type ApprovalOutcome = 'continue' | 'end' | 'stale'

interface PendingApproval {
  request: AgentApprovalRequest
  settle: (outcome: ApprovalOutcome) => void
}

interface ActiveAgentRun {
  controller: AbortController
  activities: Map<string, AgentUserDocumentActivity>
  onEvent: (event: AgentCollaborationEvent) => void
  pendingApproval?: PendingApproval
}

const activeRuns = new Map<string, ActiveAgentRun>()

function latestRunEdit(run: ActiveAgentRun, runId: string): AgentUserDocumentActivity | undefined {
  return [...run.activities.values()]
    .filter((activity) => activity.runId === runId && activity.kind === 'edit')
    .sort((a, b) => b.timestamp - a.timestamp)[0]
}

function settleApproval(run: ActiveAgentRun, outcome: ApprovalOutcome): void {
  const pending = run.pendingApproval
  if (!pending) return
  run.pendingApproval = undefined
  pending.settle(outcome)
}

function waitForApproval(
  run: ActiveAgentRun,
  draft: Omit<AgentApprovalRequest, 'approvalId' | 'requestedAt'>,
): Promise<ApprovalOutcome> {
  settleApproval(run, 'stale')
  const request: AgentApprovalRequest = {
    ...draft,
    approvalId: randomUUID(),
    requestedAt: Date.now(),
  }
  const latestEdit = latestRunEdit(run, request.runId)
  if (latestEdit && invalidatesApproval(request, latestEdit)) return Promise.resolve('stale')
  return new Promise((resolve) => {
    let settled = false
    const settle = (outcome: ApprovalOutcome) => {
      if (settled) return
      settled = true
      run.controller.signal.removeEventListener('abort', onAbort)
      resolve(outcome)
    }
    const onAbort = () => settle('end')
    run.controller.signal.addEventListener('abort', onAbort, { once: true })
    run.pendingApproval = { request, settle }
    run.onEvent({
      runId: request.runId,
      type: 'approval-required',
      timestamp: Date.now(),
      agentId: request.agentId,
      agentName: request.agentName,
      planId: request.planId,
      planVersion: request.planVersion,
      revision: request.documentRevision,
      approval: request,
      phase: 'awaiting-approval',
    })
  })
}

function recordDocumentActivity(activity: AgentUserDocumentActivity): boolean {
  if (!activity.runId) return false
  const run = activeRuns.get(activity.runId)
  if (!run) return false
  run.activities.set(activity.eventId, activity)
  if (run.activities.size > 200) {
    const oldestEventId = run.activities.keys().next().value
    if (typeof oldestEventId === 'string') run.activities.delete(oldestEventId)
  }
  const pending = run.pendingApproval
  if (pending && invalidatesApproval(pending.request, activity)) {
    const invalidated = pending.request
    settleApproval(run, 'stale')
    run.onEvent({
      runId: activity.runId,
      type: 'approval-invalidated',
      timestamp: Date.now(),
      agentId: invalidated.agentId,
      agentName: invalidated.agentName,
      planId: invalidated.planId,
      planVersion: invalidated.planVersion,
      revision: activity.documentRevision,
      approval: invalidated,
      activity,
      phase: 'expired',
    })
  }
  return true
}

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
    if (['inspectWordDocument', 'searchWordOperations', 'validateWordPlan', 'applyWordPlan', 'controlWordPlayback', 'inspectDocumentArtifact', 'searchDocumentOperations', 'createDocumentDraft'].includes(command.action)) {
      return { success: false, error: 'WORD_DOCUMENT_API_UNAVAILABLE' }
    }
    if (!getMainWindow) return { success: false, error: 'Main window not ready' }
    return executeVisibleOnlyOfficeAgentEdit(getMainWindow, {
      ...command,
      agentId,
      agentName,
    })
  }
}

function localizeAgentError(error: unknown): string {
  console.error('[Agent] request failed:', error)
  if (error instanceof UnknownProviderError) {
    return t('agentUi.unknownProvider', { provider: error.providerId })
  }
  if (error instanceof MissingAgentModelError) {
    return t('agentUi.modelRequired')
  }
  if (error instanceof AgentCommandTimeoutError) {
    return t('agentUi.commandTimeout')
  }
  return t('agentUi.requestFailedGeneric')
}

export function registerAgentHandlers(): void {
  handleTrustedIpc(IPC.AGENT_LIST, async () => getAgents())

  handleTrustedIpc(IPC.AGENT_SAVE, async (_e, agent) => saveAgent(agent))

  handleTrustedIpc(IPC.AGENT_DELETE, async (_e, agentId: string) => deleteAgent(agentId))

  handleTrustedIpc(
    IPC.AGENT_CHAT,
    async (_e, payload: { agentId: string; messages: ChatMessage[]; conversationId?: string; runId?: string }) => {
      const agents = await getAgents()
      const agent = agents.find((a) => a.id === payload.agentId)
      if (!agent) return { error: t('agentUi.agentNotFound') }

      const onEdit = buildAgentEditHandler(agent.id, agent.name)
      const runId = payload.runId ?? createAgentRunId()
      const controller = new AbortController()
      const onEvent = (event: AgentCollaborationEvent) => {
        const win = getMainWindow?.()
        if (win && !win.isDestroyed()) win.webContents.send(IPC.AGENT_EVENT, event)
      }
      const activeRun: ActiveAgentRun = { controller, activities: new Map(), onEvent }
      activeRuns.set(runId, activeRun)

      try {
        return await runAgentChat(agent, payload.messages, onEdit, {
          runId,
          conversationId: payload.conversationId ?? agent.id,
          onEvent,
          signal: controller.signal,
          requestApproval: (draft) => waitForApproval(activeRun, draft),
          getDocumentActivities: () => [...activeRun.activities.values()],
        })
      } catch (error) {
        return { error: localizeAgentError(error) }
      } finally {
        settleApproval(activeRun, 'end')
        activeRuns.delete(runId)
      }
    },
  )

  handleTrustedIpc(
    IPC.AGENT_RUN_TASK,
    async (_e, payload: { agentIds: string[]; task: string; runId?: string; rootAgentId?: string }) => {
      if (!AGENT_COLLABORATION_ENABLED) {
        return { error: t('agentUi.requestFailedGeneric') }
      }
      if (!payload || !Array.isArray(payload.agentIds) || typeof payload.task !== 'string') {
        return { error: t('agentUi.requestFailedGeneric') }
      }
      const allAgents = await getAgents()
      const uniqueIds = [...new Set(payload.agentIds.filter((id): id is string => typeof id === 'string'))]
      const selected = uniqueIds
        .map((id) => allAgents.find((a) => a.id === id))
        .filter((agent): agent is typeof allAgents[number] => Boolean(agent?.enabled))

      const task = payload.task.trim()
      if (!task || selected.length < 2 || selected.length !== uniqueIds.length) {
        return { error: t('agentUi.enableAtLeastTwo') }
      }

      const runId = payload.runId ?? createAgentRunId()
      const controller = new AbortController()
      const onEvent = (event: AgentCollaborationEvent) => {
        const win = getMainWindow?.()
        if (win && !win.isDestroyed()) win.webContents.send(IPC.AGENT_EVENT, event)
      }
      const activeRun: ActiveAgentRun = { controller, activities: new Map(), onEvent }
      activeRuns.set(runId, activeRun)
      try {
        return await runMultiAgentTask(
          selected,
          task,
          (agent) => buildAgentEditHandler(agent.id, agent.name),
          {
            runId,
            onEvent,
            signal: controller.signal,
            rootAgentId: payload.rootAgentId,
            requestApproval: (draft) => waitForApproval(activeRun, draft),
            getDocumentActivities: () => [...activeRun.activities.values()],
          },
        )
      } catch (error) {
        return { error: localizeAgentError(error) }
      } finally {
        settleApproval(activeRun, 'end')
        activeRuns.delete(runId)
      }
    },
  )

  handleTrustedIpc(IPC.AGENT_CANCEL, async (_e, runId: string) => {
    if (typeof runId !== 'string' || !runId.trim()) return { success: false }
    const run = activeRuns.get(runId)
    if (!run) return { success: false, alreadyFinished: true }
    settleApproval(run, 'end')
    run.controller.abort()
    if (getMainWindow) cancelLightweightAgentRun(getMainWindow, runId)
    return { success: true }
  })

  handleTrustedIpc(IPC.AGENT_DOCUMENT_ACTIVITY, async (_e, activity: AgentUserDocumentActivity) => {
    if (!activity || typeof activity.eventId !== 'string' || typeof activity.runId !== 'string') {
      return { success: false }
    }
    return { success: recordDocumentActivity(activity) }
  })

  handleTrustedIpc(IPC.AGENT_APPROVAL_RESPONSE, async (_e, response: AgentApprovalResponse) => {
    if (!response || typeof response.runId !== 'string' || typeof response.approvalId !== 'string') {
      return { success: false }
    }
    const run = activeRuns.get(response.runId)
    const pending = run?.pendingApproval
    if (!run || !pending) return { success: false, stale: true }
    const request = pending.request
    const latestEdit = latestRunEdit(run, response.runId)
    const matches = isCurrentApprovalResponse(request, response)
      && (!latestEdit || !invalidatesApproval(request, latestEdit))
    if (!matches) return { success: false, stale: true }
    settleApproval(run, response.decision === 'continue' ? 'continue' : 'end')
    run.onEvent({
      runId: response.runId,
      type: 'approval-resolved',
      timestamp: Date.now(),
      agentId: request.agentId,
      agentName: request.agentName,
      planId: response.planId,
      planVersion: response.planVersion,
      revision: response.documentRevision,
      approval: request,
      approvalResponse: response,
      phase: response.decision,
    })
    return { success: true }
  })

  handleTrustedIpc(
    IPC.AGENT_PLAYBACK_CONTROL,
    async (_e, payload: { runId?: string; control?: WordPlaybackControl }) => {
      if (!payload?.runId || !payload.control || !activeRuns.has(payload.runId)) return { success: false }
      const win = getMainWindow?.()
      if (!win || win.isDestroyed()) return { success: false }
      win.webContents.send(IPC.LW_WORD_PLAYBACK_CONTROL, payload)
      return { success: true }
    },
  )
}
