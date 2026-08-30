import { desktopApi } from '@/platform'
import { subscribeDesktopEvent } from '@/lib/desktop-events'
import { useEffect } from 'react'
import { documentBridge } from './document-bridge'

export function useAgentBridge() {
  useEffect(() => {
    const unsubscribeCommand = subscribeDesktopEvent<{
      requestId: string
      command: Parameters<typeof documentBridge.execute>[0]
    }>('lw:agent-command', async (payload) => {
      const { requestId, command } = payload
      let result: unknown
      try {
        result = await documentBridge.execute(command)
      } catch (error) {
        result = { success: false, error: error instanceof Error ? error.message : String(error) }
      }
      await desktopApi.agents.sendDocumentResult(requestId, result)
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
      unsubscribeCommand?.()
      unsubscribeCancel?.()
      unsubscribeEvents()
    }
  }, [])
}
