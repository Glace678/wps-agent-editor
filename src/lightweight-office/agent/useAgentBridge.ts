import { useEffect } from 'react'
import { LIGHTWEIGHT_OFFICE_ENABLED } from '../config'
import { documentBridge } from './document-bridge'

export function useAgentBridge() {
  useEffect(() => {
    if (!LIGHTWEIGHT_OFFICE_ENABLED) return

    window.api.on('lw:agent-command', async (payload) => {
      const { requestId, command } = payload as {
        requestId: string
        command: Parameters<typeof documentBridge.execute>[0]
      }
      const result = await documentBridge.execute(command)
      await window.api.lw.sendAgentResult(requestId, result)
    })
  }, [])
}