import crypto from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { AgentEditCommand } from '../services/onlyoffice.service'

const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void; timeout: NodeJS.Timeout; runId?: string }
>()

export class AgentCommandTimeoutError extends Error {
  constructor() {
    super('AGENT_COMMAND_TIMEOUT')
    this.name = 'AgentCommandTimeoutError'
  }
}

export function handleAgentResult(requestId: string, result: unknown): void {
  const entry = pending.get(requestId)
  if (!entry) return
  clearTimeout(entry.timeout)
  pending.delete(requestId)
  entry.resolve(result)
}

export function executeLightweightAgentEdit(
  getMainWindow: () => BrowserWindow | null,
  command: AgentEditCommand,
): Promise<unknown> {
  return executeRendererAgentEdit(getMainWindow, 'lw:agent-command', command)
}

export function executeVisibleOnlyOfficeAgentEdit(
  getMainWindow: () => BrowserWindow | null,
  command: AgentEditCommand,
): Promise<unknown> {
  return executeRendererAgentEdit(getMainWindow, 'oo:agent-command', command)
}

function executeRendererAgentEdit(
  getMainWindow: () => BrowserWindow | null,
  channel: 'lw:agent-command' | 'oo:agent-command',
  command: AgentEditCommand,
): Promise<unknown> {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) {
    return Promise.resolve({ success: false, error: 'Main window not ready' })
  }

  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    const timeoutMs = command.action === 'applyWordPlan' || command.action === 'createDocumentDraft'
      ? 120_000
      : 30_000
    const timeout = setTimeout(() => {
      pending.delete(requestId)
      reject(new AgentCommandTimeoutError())
    }, timeoutMs)

    pending.set(requestId, { resolve, reject, timeout, runId: command.runId })
    win.webContents.send(channel, { requestId, command })
  })
}

export function cancelLightweightAgentRun(
  getMainWindow: () => BrowserWindow | null,
  runId: string,
): void {
  for (const [requestId, entry] of pending) {
    if (entry.runId !== runId) continue
    clearTimeout(entry.timeout)
    pending.delete(requestId)
    entry.reject(new Error('AGENT_RUN_CANCELLED'))
  }
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send('lw:agent-cancel', { runId })
  win.webContents.send('oo:agent-cancel', { runId })
}
