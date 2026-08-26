import type { AgentAttachment, AgentAttachmentSource } from '@/types/agent'

export const AGENT_ATTACHMENT_MIME = 'application/x-wps-agent-attachments'
export const MAX_AGENT_ATTACHMENTS = 12

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[/\\]/).filter(Boolean).pop() || filePath
}

export function createAgentAttachment(
  filePath: string,
  source: AgentAttachmentSource,
): AgentAttachment {
  return {
    path: filePath,
    name: fileNameFromPath(filePath),
    source,
  }
}

export function dedupeAgentAttachments(
  current: AgentAttachment[],
  incoming: AgentAttachment[],
): AgentAttachment[] {
  const result = [...current]
  const seen = new Set(current.map((attachment) => attachment.path.toLocaleLowerCase()))
  for (const attachment of incoming) {
    if (!attachment.path || seen.has(attachment.path.toLocaleLowerCase())) continue
    result.push(attachment)
    seen.add(attachment.path.toLocaleLowerCase())
    if (result.length >= MAX_AGENT_ATTACHMENTS) break
  }
  return result
}

export function writeAgentAttachmentDragData(
  dataTransfer: DataTransfer,
  attachments: AgentAttachment[],
): void {
  if (attachments.length === 0) return
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(AGENT_ATTACHMENT_MIME, JSON.stringify(attachments))
}

export function hasAgentAttachmentDragData(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(AGENT_ATTACHMENT_MIME)
}

export function readAgentAttachmentDragData(dataTransfer: DataTransfer): AgentAttachment[] {
  const raw = dataTransfer.getData(AGENT_ATTACHMENT_MIME)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is AgentAttachment => {
        if (!item || typeof item !== 'object') return false
        const candidate = item as Partial<AgentAttachment>
        return typeof candidate.path === 'string'
          && typeof candidate.name === 'string'
          && ['browse', 'recent', 'tab', 'picker'].includes(candidate.source || '')
      })
      .slice(0, MAX_AGENT_ATTACHMENTS)
  } catch {
    return []
  }
}
