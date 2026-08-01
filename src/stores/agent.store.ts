import { create } from 'zustand'
import type { AgentConfig, ChatMessage } from '@/types/agent'

interface AgentState {
  agents: AgentConfig[]
  activeAgentId: string | null
  messages: Record<string, ChatMessage[]>
  isRunning: boolean
  taskStatus: string
  drafts: Record<string, string>

  setAgents: (agents: AgentConfig[]) => void
  setActiveAgentId: (id: string | null) => void
  addMessage: (agentId: string, message: ChatMessage) => void
  clearMessages: (agentId: string) => void
  setIsRunning: (v: boolean) => void
  setTaskStatus: (status: string) => void
  setDraft: (agentId: string, value: string) => void
  appendDraft: (agentId: string, value: string) => void
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  activeAgentId: null,
  messages: {},
  isRunning: false,
  taskStatus: '',
  drafts: {},

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
    })),
  setIsRunning: (v) => set({ isRunning: v }),
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
}))
