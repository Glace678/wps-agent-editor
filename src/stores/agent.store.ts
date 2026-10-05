import { create } from 'zustand'
import type { AgentAttachment, AgentCollaborationEvent, AgentConfig, ChatMessage } from '@/types/agent'
import type {
  CodexImportResult,
  ConversationRecord,
  ConversationSummary,
} from '@/types/generated'
import { dedupeAgentAttachments } from '@/lib/agent-attachments'

// Defensive replay guard for `agent-stream` frames. Frames are accumulated per
// operationId: each frame carries an *incremental* content delta and the store
// concatenates deltas into one event. If the upstream re-emits the exact same
// delta (same runId + operationId + content) — e.g. on a listener resubscribe —
// appending again would duplicate the streamed text. Track the last appended
// delta per operation and skip an exact retransmission. The wire event has no
// chunk/sequence id, so this is best-effort (flagged conditional in the review).
const lastStreamDeltaByOperation = new Map<string, string>()

function streamOperationKey(event: AgentCollaborationEvent): string {
  return `${event.runId}|${event.operationId ?? ''}`
}

interface AgentState {
  agents: AgentConfig[]
  activeAgentId: string | null
  messages: Record<string, ChatMessage[]>
  conversationIds: Record<string, string>
  conversationSummaries: ConversationSummary[]
  codexImportResult: CodexImportResult | null
  isImportingCodex: boolean
  isRunning: boolean
  activeRunId: string | null
  isStopping: boolean
  taskStatus: string
  drafts: Record<string, string>
  attachmentDrafts: Record<string, AgentAttachment[]>
  collaborationEvents: AgentCollaborationEvent[]

  setAgents: (agents: AgentConfig[]) => void
  setActiveAgentId: (id: string | null) => void
  addMessage: (agentId: string, message: ChatMessage) => void
  appendAssistantStream: (agentId: string, runId: string, content: string) => void
  completeAssistantStream: (agentId: string, runId: string, message: ChatMessage) => void
  clearMessages: (agentId: string) => void
  ensureConversationId: (agentId: string) => string
  loadConversation: (agentId: string, conversation: ConversationRecord) => void
  setConversationSummaries: (summaries: ConversationSummary[]) => void
  upsertConversationSummary: (summary: ConversationSummary) => void
  setCodexImportResult: (result: CodexImportResult | null) => void
  setIsImportingCodex: (value: boolean) => void
  setIsRunning: (v: boolean) => void
  setActiveRunId: (runId: string | null) => void
  setIsStopping: (v: boolean) => void
  setTaskStatus: (status: string) => void
  setDraft: (agentId: string, value: string) => void
  appendDraft: (agentId: string, value: string) => void
  addDraftAttachments: (agentId: string, attachments: AgentAttachment[]) => void
  removeDraftAttachment: (agentId: string, path: string) => void
  clearDraftAttachments: (agentId: string) => void
  addCollaborationEvent: (event: AgentCollaborationEvent) => void
  clearCollaborationEvents: () => void
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  activeAgentId: null,
  messages: {},
  conversationIds: {},
  conversationSummaries: [],
  codexImportResult: null,
  isImportingCodex: false,
  isRunning: false,
  activeRunId: null,
  isStopping: false,
  taskStatus: '',
  drafts: {},
  attachmentDrafts: {},
  collaborationEvents: [],

  setAgents: (agents) => set({ agents }),
  setActiveAgentId: (id) => set({ activeAgentId: id }),
  addMessage: (agentId, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [agentId]: [...(state.messages[agentId] || []), { ...message, timestamp: Date.now() }],
      },
    })),
  appendAssistantStream: (agentId, runId, content) => set((state) => {
    if (!content) return {}
    const current = state.messages[agentId] || []
    const index = current.findIndex((message) => message.streamingRunId === runId)
    const next = [...current]
    if (index < 0) {
      next.push({
        role: 'assistant',
        content,
        timestamp: Date.now(),
        streamingRunId: runId,
      })
    } else {
      next[index] = { ...next[index], content: `${next[index].content}${content}` }
    }
    return { messages: { ...state.messages, [agentId]: next } }
  }),
  completeAssistantStream: (agentId, runId, message) => set((state) => {
    const current = state.messages[agentId] || []
    const index = current.findIndex((entry) => entry.streamingRunId === runId)
    const completed = { ...message, timestamp: Date.now(), streamingRunId: undefined }
    if (index < 0) {
      return { messages: { ...state.messages, [agentId]: [...current, completed] } }
    }
    const next = [...current]
    next[index] = completed
    return { messages: { ...state.messages, [agentId]: next } }
  }),
  clearMessages: (agentId) =>
    set((state) => ({
      messages: { ...state.messages, [agentId]: [] },
      conversationIds: { ...state.conversationIds, [agentId]: crypto.randomUUID() },
    })),
  // Review §08-2.1: read-then-conditional-set outside the set() callback. The
  // previous version computed the result inside set() and smuggled it out via an
  // outer closure, which depended on zustand applying set synchronously.
  ensureConversationId: (agentId) => {
    const existing = get().conversationIds[agentId]
    if (existing) return existing
    const conversationId = crypto.randomUUID()
    set({ conversationIds: { ...get().conversationIds, [agentId]: conversationId } })
    return conversationId
  },
  loadConversation: (agentId, conversation) => set((state) => ({
    messages: {
      ...state.messages,
      [agentId]: conversation.messages.map((message) => ({ ...message })),
    },
    conversationIds: {
      ...state.conversationIds,
      [agentId]: conversation.summary.id,
    },
  })),
  setConversationSummaries: (conversationSummaries) => set({ conversationSummaries }),
  upsertConversationSummary: (summary) => set((state) => ({
    conversationSummaries: [
      summary,
      ...state.conversationSummaries.filter((item) => item.id !== summary.id),
    ].sort((left, right) => right.updatedAt - left.updatedAt),
  })),
  setCodexImportResult: (codexImportResult) => set({ codexImportResult }),
  setIsImportingCodex: (isImportingCodex) => set({ isImportingCodex }),
  setIsRunning: (v) => set({ isRunning: v }),
  setActiveRunId: (runId) => set({ activeRunId: runId }),
  setIsStopping: (v) => set({ isStopping: v }),
  setTaskStatus: (status) => set({ taskStatus: status }),
  setDraft: (agentId, value) => set((state) => ({
    drafts: { ...state.drafts, [agentId]: value },
  })),
  appendDraft: (agentId, value) => set((state) => {
    const current = state.drafts[agentId]?.trimEnd() ?? ''
    return {
      drafts: {
        ...state.drafts,
        [agentId]: current ? `${current}\n\n${value}` : value,
      },
    }
  }),
  addDraftAttachments: (agentId, attachments) => set((state) => ({
    attachmentDrafts: {
      ...state.attachmentDrafts,
      [agentId]: dedupeAgentAttachments(state.attachmentDrafts[agentId] || [], attachments),
    },
  })),
  removeDraftAttachment: (agentId, path) => set((state) => ({
    attachmentDrafts: {
      ...state.attachmentDrafts,
      [agentId]: (state.attachmentDrafts[agentId] || []).filter(
        (attachment) => attachment.path !== path,
      ),
    },
  })),
  clearDraftAttachments: (agentId) => set((state) => ({
    attachmentDrafts: { ...state.attachmentDrafts, [agentId]: [] },
  })),
  addCollaborationEvent: (event) => set((state) => {
    const duplicateIndex = event.operationId
      ? state.collaborationEvents.findIndex((existing) => (
        existing.runId === event.runId
        && existing.operationId === event.operationId
        && existing.type === event.type
        && (event.type === 'agent-stream' || Math.abs(existing.timestamp - event.timestamp) < 2_000)
      ))
      : -1
    if (duplicateIndex >= 0) {
      const collaborationEvents = [...state.collaborationEvents]
      const existing = collaborationEvents[duplicateIndex]
      if (event.type === 'agent-stream') {
        const delta = event.content ?? ''
        const key = streamOperationKey(event)
        // Skip an exact retransmission of the last delta instead of appending it
        // a second time.
        if (delta !== '' && lastStreamDeltaByOperation.get(key) === delta) {
          return state
        }
        lastStreamDeltaByOperation.set(key, delta)
        collaborationEvents[duplicateIndex] = {
          ...existing,
          ...event,
          content: `${existing.content ?? ''}${delta}`,
          timestamp: Math.min(existing.timestamp, event.timestamp),
        }
        return { collaborationEvents }
      }
      collaborationEvents[duplicateIndex] = {
        ...existing,
        ...event,
        content: event.content,
        timestamp: Math.min(existing.timestamp, event.timestamp),
      }
      return { collaborationEvents }
    }
    if (event.type === 'agent-stream' && event.operationId) {
      lastStreamDeltaByOperation.set(streamOperationKey(event), event.content ?? '')
    }
    return {
      collaborationEvents: [...state.collaborationEvents, event].slice(-500),
    }
  }),
  clearCollaborationEvents: () => {
    lastStreamDeltaByOperation.clear()
    return set({ collaborationEvents: [] })
  },
}))
