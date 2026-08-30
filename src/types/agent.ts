import type { ProviderReasoningEffort } from './provider'
import type { DocumentEngine, DocumentPosition, DocumentRange } from './document'

export type AgentReasoningSelection =
  | { kind: 'auto' }
  | { kind: 'enabled' }
  | { kind: 'disabled' }
  | { kind: 'effort'; value: ProviderReasoningEffort }
  | { kind: 'budget'; tokens: number }

export interface AgentConfig {
  id: string
  name: string
  role: string
  systemPrompt: string
  providerId: string
  /** Explicit model used by this Agent. Saved Agent requests never infer a default. */
  model: string
  /** Provider/model-specific reasoning selection. */
  reasoning?: AgentReasoningSelection
  color: string
  enabled: boolean
}

export type AgentAttachmentSource = 'browse' | 'recent' | 'tab' | 'picker'

/** A user-selected local file. File contents are loaded only in the main process. */
export interface AgentAttachment {
  path: string
  grantId: string
  name: string
  source: AgentAttachmentSource
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: number
  attachments?: AgentAttachment[]
  cacheUsage?: AgentCacheUsage
  /** Renderer-only correlation key while an assistant response is streaming. */
  streamingRunId?: string
}

/** Provider-reported prompt-cache usage. A rate is never estimated as measured. */
export interface AgentCacheUsage {
  measured: boolean
  requests: number
  promptTokens: number
  cacheReadTokens: number
  cacheMissTokens: number
  cacheWriteTokens: number
  completionTokens: number
  totalTokens: number
  hitRate: number
}

export interface AgentTaskResult {
  agentId: string
  agentName: string
  providerId: string
  model: string
  response: string
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>
  cacheUsage: AgentCacheUsage
}

export type AgentCollaborationEventType =
  | 'run-start'
  | 'task-created'
  | 'task-assigned'
  | 'agent-spawned'
  | 'agent-start'
  | 'agent-question'
  | 'agent-answer'
  | 'agent-message'
  | 'agent-stream'
  | 'agent-tool'
  | 'handoff'
  | 'agent-complete'
  | 'document-operation-prepared'
  | 'document-cursor-moved'
  | 'document-selection-changed'
  | 'document-operation-applied'
  | 'document-operation-rejected'
  | 'document-operation-undone'
  | 'document-revision-changed'
  | 'conflict'
  | 'approval-required'
  | 'run-paused'
  | 'run-cancelled'
  | 'run-complete'
  | 'error'

/** Serializable trace event emitted by the main process while a collaboration runs. */
export interface AgentCollaborationEvent {
  runId: string
  windowLabel: string
  type: AgentCollaborationEventType
  timestamp: number
  agentId?: string
  agentName?: string
  providerId?: string
  model?: string
  fromAgentId?: string
  fromAgentName?: string
  toAgentId?: string
  toAgentName?: string
  content?: string
  tool?: string
  args?: Record<string, unknown>
  result?: unknown
  cacheUsage?: AgentCacheUsage
  error?: string
  operationId?: string
  documentId?: string
  engine?: DocumentEngine
  baseRevision?: number
  revision?: number
  position?: DocumentPosition
  range?: DocumentRange
  action?: string
  phase?: string
  message?: string
}
