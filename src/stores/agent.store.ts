import { create } from 'zustand'
import type { AgentAttachment, AgentCollaborationEvent, AgentConfig, ChatMessage } from '@/types/agent'
import type {
  CodexImportResult,
  ConversationRecord,
  ConversationSummary,
} from '@/types/generated'
import { dedupeAgentAttachments } from '@/lib/agent-attachments'

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
  removeConversationSummary: (conversationId: string) => void
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

export const useAgentStore = create<AgentState>((set) => ({
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
  ensureConversationId: (agentId) => {
    let conversationId = ''
    set((state) => {
      conversationId = state.conversationIds[agentId] ?? crypto.randomUUID()
      if (state.conversationIds[agentId]) return {}
      return {
        conversationIds: { ...state.conversationIds, [agentId]: conversationId },
      }
    })
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
  removeConversationSummary: (conversationId) => set((state) => ({
    conversationSummaries: state.conversationSummaries.filter(
      (summary) => summary.id !== conversationId,
    ),
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
      collaborationEvents[duplicateIndex] = {
        ...existing,
        ...event,
        content: event.type === 'agent-stream'
          ? `${existing.content ?? ''}${event.content ?? ''}`
          : event.content,
        timestamp: Math.min(existing.timestamp, event.timestamp),
      }
      return { collaborationEvents }
    }
    return {
      collaborationEvents: [...state.collaborationEvents, event].slice(-500),
    }
  }),
  clearCollaborationEvents: () => set({ collaborationEvents: [] }),
}))
