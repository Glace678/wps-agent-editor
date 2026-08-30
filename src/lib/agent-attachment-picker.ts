import type { FilesApi, GrantedPath } from '@/types/desktop-api'

export type AgentAttachmentPickerApi = Pick<FilesApi, 'selectAttachments'>

/** Preserve the opaque grant returned by every native file selection. */
export async function selectAgentAttachmentPaths(
  api: AgentAttachmentPickerApi,
): Promise<GrantedPath[]> {
  return api.selectAttachments()
}
