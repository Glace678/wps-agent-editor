import { create } from 'zustand'
import type { AgentAttachment, AgentCollaborationEvent, AgentConfig, ChatMessage } from '@/types/agent'
import type { AgentApprovalRequest, WordPlaybackState } from '@/types/document'
import type { ArtifactDraftManifest, ArtifactReviewState } from '@/types/artifact-review'
import { dedupeAgentAttachments } from '@/lib/agent-attachments'

interface AgentState {
  agents: AgentConfig[]
  activeAgentId: string | null
  messages: Record<string, ChatMessage[]>
  conversationIds: Record<string, string>
  isRunning: boolean
  activeRunId: string | null
  isStopping: boolean
  taskStatus: string
  drafts: Record<string, string>
  attachmentDrafts: Record<string, AgentAttachment[]>
  collaborationEvents: AgentCollaborationEvent[]
  pendingApproval: AgentApprovalRequest | null
  approvalStatus: 'idle' | 'submitting' | 'expired'
  wordPlayback: WordPlaybackState | null
  artifactDraft: ArtifactDraftManifest | null
  artifactReview: ArtifactReviewState | null
  artifactReviewQueue: Array<{ manifest: ArtifactDraftManifest; state: ArtifactReviewState }>

  setAgents: (agents: AgentConfig[]) => void
  setActiveAgentId: (id: string | null) => void
  addMessage: (agentId: string, message: ChatMessage) => void
  clearMessages: (agentId: string) => void
  ensureConversationId: (agentId: string) => string
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
  setPendingApproval: (approval: AgentApprovalRequest | null) => void
  setApprovalStatus: (status: AgentState['approvalStatus']) => void
  setWordPlayback: (playback: WordPlaybackState | null) => void
  setArtifactReview: (manifest: ArtifactDraftManifest | null, state: ArtifactReviewState | null) => void
  activateArtifactReview: (draftId: string) => void
  finishArtifactReview: (draftId: string, state: ArtifactReviewState) => void
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  activeAgentId: null,
  messages: {},
  conversationIds: {},
  isRunning: false,
  activeRunId: null,
  isStopping: false,
  taskStatus: '',
  drafts: {},
  attachmentDrafts: {},
  collaborationEvents: [],
  pendingApproval: null,
  approvalStatus: 'idle',
  wordPlayback: null,
  artifactDraft: null,
  artifactReview: null,
  artifactReviewQueue: [],

  setAgents: (agents) => set({ agents }),
  setActiveAgentId: (id) => set({ activeAgentId: id }),
  addMessage: (agentId, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [agentId]: [...(state.messages[agentId] || []), { ...message, timestamp: Date.now() }],
      },
    })),
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
    const duplicateIndex = event.eventId
      ? state.collaborationEvents.findIndex((existing) => existing.eventId === event.eventId)
      : -1
    if (duplicateIndex >= 0) {
      const collaborationEvents = [...state.collaborationEvents]
      const existing = collaborationEvents[duplicateIndex]
      collaborationEvents[duplicateIndex] = {
        ...existing,
        ...event,
        timestamp: Math.min(existing.timestamp, event.timestamp),
      }
      return { collaborationEvents }
    }
    return {
      collaborationEvents: [...state.collaborationEvents, event].slice(-500),
    }
  }),
  clearCollaborationEvents: () => set({
    collaborationEvents: [],
    pendingApproval: null,
    approvalStatus: 'idle',
    wordPlayback: null,
    artifactDraft: null,
    artifactReview: null,
    artifactReviewQueue: [],
  }),
  setPendingApproval: (pendingApproval) => set({ pendingApproval }),
  setApprovalStatus: (approvalStatus) => set({ approvalStatus }),
  setWordPlayback: (wordPlayback) => set({ wordPlayback }),
  setArtifactReview: (artifactDraft, artifactReview) => set((current) => {
    if (!artifactDraft || !artifactReview) {
      return { artifactDraft: null, artifactReview: null, artifactReviewQueue: [] }
    }
    const nextItem = { manifest: artifactDraft, state: artifactReview }
    const existingIndex = current.artifactReviewQueue.findIndex(({ manifest }) => manifest.draftId === artifactDraft.draftId)
    const artifactReviewQueue = existingIndex >= 0
      ? current.artifactReviewQueue.map((item, index) => index === existingIndex ? nextItem : item)
      : [...current.artifactReviewQueue, nextItem]
    const activeDraftId = current.artifactDraft?.draftId
    if (activeDraftId && activeDraftId !== artifactDraft.draftId) {
      const active = artifactReviewQueue.find(({ manifest }) => manifest.draftId === activeDraftId)
      if (active && !['saved', 'discarded'].includes(active.state.phase)) {
        return { artifactReviewQueue, artifactDraft: active.manifest, artifactReview: active.state }
      }
    }
    return { artifactReviewQueue, artifactDraft, artifactReview }
  }),
  activateArtifactReview: (draftId) => set((current) => {
    const item = current.artifactReviewQueue.find(({ manifest, state }) => (
      manifest.draftId === draftId && !['saved', 'discarded'].includes(state.phase)
    ))
    return item ? { artifactDraft: item.manifest, artifactReview: item.state } : {}
  }),
  finishArtifactReview: (draftId, finishedState) => set((current) => {
    const updated = current.artifactReviewQueue.map((item) => (
      item.manifest.draftId === draftId ? { ...item, state: finishedState } : item
    ))
    const finished = updated.find(({ manifest }) => manifest.draftId === draftId)
    const next = updated.find(({ manifest, state }) => (
      manifest.draftId !== draftId
      && !['saved', 'discarded'].includes(state.phase)
      && (!finished?.manifest.batchId || manifest.batchId === finished.manifest.batchId)
    )) ?? updated.find(({ state }) => !['saved', 'discarded'].includes(state.phase))
    if (!next) return { artifactDraft: null, artifactReview: null, artifactReviewQueue: [] }
    return { artifactReviewQueue: updated, artifactDraft: next.manifest, artifactReview: next.state }
  }),
}))
