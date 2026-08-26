import type { ProviderReasoningEffort } from './provider'
import type {
  AgentApprovalRequest,
  AgentApprovalResponse,
  AgentUserDocumentActivity,
  DocumentEngine,
  DocumentPosition,
  DocumentRange,
  WordPlaybackState,
} from './document'

export type AgentReasoningSelection =
  | { kind: 'auto' }
  | { kind: 'enabled' }
  | { kind: 'disabled' }
  | { kind: 'effort'; value: ProviderReasoningEffort }
  | { kind: 'budget'; tokens: number }

/** Legacy persisted values are accepted by the main-process migration only. */
export type LegacyAgentReasoningEffort = 'auto' | 'low' | 'medium' | 'high'

export interface AgentConfig {
  id: string
  name: string
  role: string
  systemPrompt: string
  /** User-editable strategy for splitting and ordering document draft operations. */
  documentOperationPrompt: string
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
  name: string
  source: AgentAttachmentSource
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: number
  attachments?: AgentAttachment[]
  cacheUsage?: AgentCacheUsage
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
  | 'document-plan-prepared'
  | 'word-playback-started'
  | 'word-playback-progress'
  | 'word-playback-paused'
  | 'word-playback-resumed'
  | 'word-playback-interrupted'
  | 'word-playback-completed'
  | 'user-document-activity'
  | 'conflict'
  | 'approval-required'
  | 'approval-invalidated'
  | 'approval-resolved'
  | 'run-paused'
  | 'run-cancelled'
  | 'run-complete'
  | 'error'

/** Serializable trace event emitted by the main process while a collaboration runs. */
export interface AgentCollaborationEvent {
  runId: string
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
  page?: number
  blockId?: string
  range?: DocumentRange
  action?: string
  phase?: string
  message?: string
  eventId?: string
  planId?: string
  planVersion?: number
  stepId?: string
  completed?: number
  total?: number
  visual?: string
  playback?: WordPlaybackState
  activity?: AgentUserDocumentActivity
  approval?: AgentApprovalRequest
  approvalResponse?: AgentApprovalResponse
}
