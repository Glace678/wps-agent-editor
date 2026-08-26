export type DocumentEngine = 'superdoc' | 'onlyoffice' | 'monaco' | 'text' | 'excel'

export type DocumentOperationKind =
  | 'insert-text'
  | 'replace-text'
  | 'delete-text'
  | 'append-paragraph'
  | 'word-operation'
  | 'set-cell'
  | 'read-document'

export interface DocumentPosition {
  line?: number
  column?: number
  offset?: number
}

export interface DocumentRange {
  start: DocumentPosition
  end?: DocumentPosition
}

export type WordEditVisualKind =
  | 'text-insert'
  | 'text-replace'
  | 'text-delete'
  | 'format'
  | 'paragraph'
  | 'table-cell'
  | 'table-row'
  | 'table-column'
  | 'image'
  | 'page-region'
  | 'object-anchor'

/** Stable, serializable location hint used for ordering and visual playback. */
export interface WordEditAnchor {
  page?: number
  blockId?: string
  /** Exact text used only to resolve an unambiguous visual target. */
  search?: string
  occurrence?: number
  contextBefore?: string
  contextAfter?: string
  position?: DocumentPosition
  target?: unknown
  region?: 'page' | 'section' | 'header' | 'footer' | 'margin' | 'footnote'
}

/** One real SuperDoc Document API operation in an Agent plan. */
export interface WordEditPlanStep {
  id: string
  operationId: string
  input: unknown
  options?: Record<string, unknown>
  dependsOn?: string[]
  anchor?: WordEditAnchor
  visual?: WordEditVisualKind
  label?: string
}

export interface WordEditPlan {
  planId: string
  documentRevision: number
  documentApiRevision?: string
  version?: number
  steps: WordEditPlanStep[]
}

export type WordPlaybackPhase =
  | 'idle'
  | 'validating'
  | 'running'
  | 'paused'
  | 'interrupted'
  | 'awaiting-approval'
  | 'completed'
  | 'cancelled'
  | 'failed'

export interface WordPlaybackState {
  runId?: string
  planId?: string
  agentId?: string
  agentName?: string
  phase: WordPlaybackPhase
  completed: number
  total: number
  currentStepId?: string
  currentOperationId?: string
  currentAction?: string
  followAgent: boolean
  skipAnimations: boolean
  message?: string
}

export type AgentUserDocumentActivityKind = 'viewport' | 'selection' | 'edit'

/** Debounced semantic activity sent to the Agent, never raw key or wheel events. */
export interface AgentUserDocumentActivity {
  eventId: string
  runId?: string
  documentId?: string
  documentRevision: number
  documentApiRevision?: string
  timestamp: number
  kind: AgentUserDocumentActivityKind
  visiblePages?: number[]
  focusedBlockIds?: string[]
  selectionText?: string
  selectionTarget?: unknown
  before?: string
  after?: string
  contextBefore?: string
  contextAfter?: string
}

export interface AgentApprovalRequest {
  approvalId: string
  runId: string
  planId: string
  planVersion: number
  documentRevision: number
  documentApiRevision?: string
  agentId?: string
  agentName?: string
  remainingSteps: number
  summary?: string
  changes?: Array<{ id: string; operationId: string; label?: string }>
  requestedAt: number
}

export interface AgentApprovalResponse {
  approvalId: string
  runId: string
  planId: string
  planVersion: number
  documentRevision: number
  documentApiRevision?: string
  decision: 'continue' | 'end'
}

export type WordPlaybackControl =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'locate' }
  | { type: 'skip-animations'; enabled?: boolean }
  | { type: 'cancel' }

/** A single user-visible change proposed by an Agent. */
export interface DocumentOperation {
  operationId: string
  runId?: string
  agentId?: string
  agentName?: string
  documentId?: string
  engine?: DocumentEngine
  baseRevision?: number
  kind: DocumentOperationKind
  range?: DocumentRange
  text?: string
  beforeText?: string
  afterText?: string
  search?: string
  replace?: string
  all?: boolean
  row?: number
  col?: number
  value?: string
  undoGroupId?: string
}

export type DocumentEventType =
  | 'operation-prepared'
  | 'cursor-moved'
  | 'selection-changed'
  | 'operation-applied'
  | 'operation-rejected'
  | 'operation-undone'
  | 'revision-changed'
  | 'conflict'
  | 'plan-prepared'
  | 'playback-started'
  | 'playback-progress'
  | 'playback-paused'
  | 'playback-resumed'
  | 'playback-interrupted'
  | 'playback-completed'
  | 'user-activity'
  | 'approval-required'
  | 'approval-resolved'
  | 'run-cancelled'

export interface DocumentEvent {
  eventId: string
  type: DocumentEventType
  timestamp: number
  operationId?: string
  runId?: string
  agentId?: string
  agentName?: string
  documentId?: string
  engine?: DocumentEngine
  revision?: number
  baseRevision?: number
  position?: DocumentPosition
  page?: number
  blockId?: string
  range?: DocumentRange
  text?: string
  beforeText?: string
  afterText?: string
  message?: string
  planId?: string
  planVersion?: number
  stepId?: string
  completed?: number
  total?: number
  action?: string
  phase?: string
  visual?: WordEditVisualKind
  playback?: WordPlaybackState
  activity?: AgentUserDocumentActivity
  approval?: AgentApprovalRequest
}

export interface DocumentOperationResult {
  success: boolean
  operationId?: string
  revision?: number
  changed?: boolean
  content?: string
  error?: string
  [key: string]: unknown
}
