import crypto from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { AgentEditCommand } from '../services/onlyoffice.service'

const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void; timeout: NodeJS.Timeout }
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
  const win = getMainWindow()
  if (!win || win.isDestroyed()) {
    return Promise.resolve({ success: false, error: 'Main window not ready' })
  }

  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    const timeout = setTimeout(() => {
      pending.delete(requestId)
      reject(new AgentCommandTimeoutError())
    }, 30_000)

    pending.set(requestId, { resolve, reject, timeout })
    win.webContents.send('lw:agent-command', { requestId, command })
  })
}
