export interface AgentAttachmentPickerApi {
  selectAttachments?: () => Promise<string[]>
  selectFile: (kind?: 'all' | 'text' | 'presentation') => Promise<string | null>
}

/** Keep the attachment button usable while an older Electron preload is still running. */
export async function selectAgentAttachmentPaths(api: AgentAttachmentPickerApi): Promise<string[]> {
  if (typeof api.selectAttachments === 'function') {
    try {
      return await api.selectAttachments()
    } catch {
      // The renderer may be newer than the main process, which has no matching IPC handler yet.
    }
  }
  const filePath = await api.selectFile('all')
  return filePath ? [filePath] : []
}
