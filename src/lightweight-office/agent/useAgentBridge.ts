import { desktopApi } from '@/platform'
import { errorMessage } from '@/platform/app-error'
import { subscribeDesktopEvent } from '@/lib/desktop-events'
import { useEffect } from 'react'
import { documentBridge } from './document-bridge'

export function useAgentBridge() {
  useEffect(() => {
    let disposed = false
    const unsubscribeCommand = subscribeDesktopEvent<{
      requestId: string
      command: Parameters<typeof documentBridge.execute>[0]
    }>('lw:agent-command', async (payload) => {
      const { requestId, command } = payload
      let result: unknown
      try {
        result = await documentBridge.execute(command)
      } catch (error) {
        result = { success: false, error: errorMessage(error) }
      }
      // If the bridge (or its host) has torn down, do not attempt to send back:
      // a rejected send here would otherwise be an unhandled rejection and the
      // requestId would never settle.
      if (disposed) return
      try {
        await desktopApi.agents.sendDocumentResult(requestId, result)
      } catch (error) {
        console.warn('[AgentBridge] Failed to send document result for', requestId, error)
      }
    })
    const unsubscribeCancel = subscribeDesktopEvent<{ runId?: string }>('lw:agent-cancel', (payload) => {
      const { runId } = payload
      if (runId) documentBridge.cancelRun(runId)
    })
    const unsubscribeEvents = documentBridge.subscribeDocumentEvents((event) => {
      if (!event.runId) return
      void desktopApi.agents.sendDocumentEvent(event).catch((error: unknown) => {
        console.warn('[AgentBridge] Failed to forward document event:', error)
      })
    })
    return () => {
      disposed = true
      unsubscribeCommand?.()
      unsubscribeCancel?.()
      unsubscribeEvents()
    }
  }, [])
}
