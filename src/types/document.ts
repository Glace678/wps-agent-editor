export type DocumentEngine = 'superdoc' | 'monaco' | 'text' | 'excel'

export interface AgentEditCommand {
  action:
    | 'insertText'
    | 'replaceText'
    | 'readDocument'
    | 'appendParagraph'
    | 'setCellValue'
    | 'insertCodeText'
    | 'replaceCodeRange'
    | 'deleteCodeRange'
  text?: string
  search?: string
  replace?: string
  all?: boolean
  row?: number
  col?: number
  value?: string
  position?: 'cursor' | 'end' | 'start'
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  operationId?: string
  runId?: string
  agentId?: string
  agentName?: string
  baseRevision?: number
}

export type DocumentOperationKind =
  | 'insert-text'
  | 'replace-text'
  | 'delete-text'
  | 'append-paragraph'
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
  range?: DocumentRange
  text?: string
  message?: string
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
