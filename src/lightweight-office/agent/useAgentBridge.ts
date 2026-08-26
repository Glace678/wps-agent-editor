import { useEffect } from 'react'
import { LIGHTWEIGHT_OFFICE_ENABLED } from '../config'
import { buildRendererArtifactCandidate, documentBridge } from './document-bridge'

export function useAgentBridge() {
  useEffect(() => {
    if (!LIGHTWEIGHT_OFFICE_ENABLED) return

    const unsubscribeCommand = window.api.on('lw:agent-command', async (payload) => {
      const { requestId, command } = payload as {
        requestId: string
        command: Parameters<typeof documentBridge.execute>[0]
      }
      let result: unknown
      try {
        result = await documentBridge.execute(command)
      } catch (error) {
        result = { success: false, error: error instanceof Error ? error.message : String(error) }
      }
      await window.api.lw.sendAgentResult(requestId, result)
    })
    const unsubscribeCancel = window.api.on('lw:agent-cancel', (payload) => {
      const { runId } = payload as { runId?: string }
      if (runId) documentBridge.cancelRun(runId)
    })
    const unsubscribePlaybackControl = window.api.on('lw:word-playback-control', (payload) => {
      const { control } = payload as { control?: Parameters<typeof documentBridge.controlWordPlayback>[0] }
      if (control) documentBridge.controlWordPlayback(control)
    })
    const unsubscribeArtifactProducer = window.api.artifact.onProducerRebuild(async (request) => {
      try {
        const data = await buildRendererArtifactCandidate(request)
        await window.api.artifact.submitProducerResult({ requestId: request.requestId, success: true, data })
      } catch (error) {
        await window.api.artifact.submitProducerResult({
          requestId: request.requestId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }).catch((submitError: unknown) => {
          console.warn('[AgentBridge] Failed to report artifact rebuild failure:', submitError)
        })
      }
    })
    const unsubscribeEvents = documentBridge.subscribeDocumentEvents((event) => {
      if (!event.runId) return
      if (event.type === 'user-activity' && event.activity) {
        void window.api.agent.reportDocumentActivity(event.activity).catch((error: unknown) => {
          console.warn('[AgentBridge] Failed to report document activity:', error)
        })
      }
      void window.api.lw.sendAgentEvent(event).catch((error: unknown) => {
        console.warn('[AgentBridge] Failed to forward document event:', error)
      })
    })
    return () => {
      unsubscribeCommand?.()
      unsubscribeCancel?.()
      unsubscribePlaybackControl?.()
      unsubscribeArtifactProducer?.()
      unsubscribeEvents()
    }
  }, [])
}
