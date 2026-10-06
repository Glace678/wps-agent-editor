import { create } from 'zustand'
import type { AgentAttachment, AgentCollaborationEvent, AgentConfig, ChatMessage } from '@/types/agent'
import type {
  CodexImportResult,
  ConversationRecord,
  ConversationSummary,
} from '@/types/generated'
import { dedupeAgentAttachments } from '@/lib/agent-attachments'
import { capCollaborationEvents } from '@/lib/collaboration-events'

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

// wps_06 E1: stream placeholders are keyed per invocation (`inv:<agent>:
// <token>`), while completions may still arrive addressed by the run id
// (single-chat path / error results). Remembers the most recent invocation
// key per (agent, runId) so such completions still land on the right bubble.
const lastStreamKeyByRun = new Map<string, string>()

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
  appendAssistantStream: (agentId: string, streamKey: string, runId: string, content: string) => void
  completeAssistantStream: (agentId: string, runIdOrKey: string, message: ChatMessage) => void
  /**
   * Finalizes every streaming bubble belonging to `runId` (or all runs when
   * null), preserving partial text. Empty cancelled bubbles are dropped.
   * wps_06 A4: stop/error used to leave placeholders spinning forever.
   */
  settleStreamingMessages: (runId: string | null, outcome: 'cancelled' | 'error') => void
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
  appendAssistantStream: (agentId, streamKey, runId, content) => set((state) => {
    if (!content) return {}
    lastStreamKeyByRun.set(`${agentId}|${runId}`, streamKey)
    const current = state.messages[agentId] || []
    const index = current.findIndex((message) => message.streamingRunId === streamKey)
    const next = [...current]
    if (index < 0) {
      next.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content,
        timestamp: Date.now(),
        streamingRunId: streamKey,
      })
    } else {
      next[index] = { ...next[index], content: `${next[index].content}${content}` }
    }
    return { messages: { ...state.messages, [agentId]: next } }
  }),
  completeAssistantStream: (agentId, runIdOrKey, message) => set((state) => {
    const current = state.messages[agentId] || []
    let index = current.findIndex((entry) => entry.streamingRunId === runIdOrKey)
    // wps_06 E1: fall back to the latest invocation key of this (agent, run).
    if (index < 0) {
      const aliased = lastStreamKeyByRun.get(`${agentId}|${runIdOrKey}`)
      if (aliased !== undefined) {
        index = current.findIndex((entry) => entry.streamingRunId === aliased)
      }
    }
    // Carry the placeholder's stable id onto the completed bubble; mint one
    // only when completion arrives without a streamed placeholder.
    const completed = {
      ...message,
      id: index >= 0 ? current[index].id : crypto.randomUUID(),
      timestamp: Date.now(),
      streamingRunId: undefined,
    }
    if (index < 0) {
      return { messages: { ...state.messages, [agentId]: [...current, completed] } }
    }
    const next = [...current]
    next[index] = completed
    return { messages: { ...state.messages, [agentId]: next } }
  }),
  settleStreamingMessages: (runId, outcome) => set((state) => {
    // Collect the stream keys recorded for the targeted run(s): the map is
    // keyed `${agentId}|${runId}`.
    const keysByAgent = new Map<string, Set<string>>()
    for (const [mapKey, streamKey] of lastStreamKeyByRun) {
      const separator = mapKey.indexOf('|')
      const mappedAgentId = mapKey.slice(0, separator)
      const mappedRunId = mapKey.slice(separator + 1)
      if (runId !== null && mappedRunId !== runId) continue
      let set = keysByAgent.get(mappedAgentId)
      if (!set) {
        set = new Set()
        keysByAgent.set(mappedAgentId, set)
      }
      set.add(streamKey)
    }
    const messages = { ...state.messages }
    let changed = false
    for (const [agentId, keys] of keysByAgent) {
      const current = messages[agentId]
      if (!current) continue
      const next: ChatMessage[] = []
      let agentChanged = false
      for (const message of current) {
        if (message.streamingRunId && keys.has(message.streamingRunId)) {
          agentChanged = true
          // A cancelled bubble with no text never rendered real content.
          if (outcome === 'cancelled' && message.content.trim() === '') {
            continue
          }
          next.push({ ...message, streamingRunId: undefined })
        } else {
          next.push(message)
        }
      }
      if (agentChanged) {
        messages[agentId] = next
        changed = true
      }
    }
    // Also catch any streaming bubble whose runId mapping was never recorded
    // (e.g. stream frames with an unparseable operationId) when a specific
    // run settles, and always when settling every run.
    for (const [agentId, current] of Object.entries(state.messages)) {
      if (current.some((message) => message.streamingRunId !== undefined && !keysByAgent.get(agentId)?.has(message.streamingRunId))) {
        const keys = keysByAgent.get(agentId)
        const next: ChatMessage[] = []
        let agentChanged = false
        for (const message of current) {
          const stray = message.streamingRunId !== undefined && (runId === null || !keys?.has(message.streamingRunId))
          if (stray && runId === null) {
            agentChanged = true
            if (outcome === 'cancelled' && message.content.trim() === '') continue
            next.push({ ...message, streamingRunId: undefined })
          } else {
            next.push(message)
          }
        }
        if (agentChanged) {
          messages[agentId] = next
          changed = true
        }
      }
    }
    if (!changed) return {}
    for (const [mapKey] of lastStreamKeyByRun) {
      const separator = mapKey.indexOf('|')
      if (runId === null || mapKey.slice(separator + 1) === runId) {
        lastStreamKeyByRun.delete(mapKey)
      }
    }
    return { messages }
  }),
  clearMessages: (agentId) =>
    set((state) => ({
      messages: { ...state.messages, [agentId]: [] },
      conversationIds: { ...state.conversationIds, [agentId]: crypto.randomUUID() },
    })),
  // wps_09 A-2: the fast path stays outside set(), but the mint is a
  // check-and-set inside the set() callback so two interleaved calls cannot
  // both mint and have the later write win. The authoritative value is read
  // back after set (zustand applies set synchronously).
  ensureConversationId: (agentId) => {
    const existing = get().conversationIds[agentId]
    if (existing) return existing
    set((state) => (
      state.conversationIds[agentId]
        ? {}
        : { conversationIds: { ...state.conversationIds, [agentId]: crypto.randomUUID() } }
    ))
    return get().conversationIds[agentId]
  },
  loadConversation: (agentId, conversation) => set((state) => ({
    messages: {
      ...state.messages,
      // ConversationMessage has no renderer id; mint one for the session so
      // loaded bubbles have stable keys for as long as they stay in the store.
      [agentId]: conversation.messages.map((message) => ({
        ...message,
        id: crypto.randomUUID(),
      })),
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
      // wps_06 D2: bounded retention with protected run boundaries and an
      // inserted truncation marker instead of a silent blind slice.
      collaborationEvents: capCollaborationEvents([...state.collaborationEvents, event]),
    }
  }),
  clearCollaborationEvents: () => {
    lastStreamDeltaByOperation.clear()
    lastStreamKeyByRun.clear()
    return set({ collaborationEvents: [] })
  },
}))
