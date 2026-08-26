export type ArtifactKind = 'word' | 'excel' | 'pdf' | 'presentation' | 'code'

export interface ArtifactNormalizedRect {
  /** Normalized coordinates in the range 0..1. */
  x: number
  y: number
  width: number
  height: number
}

export interface WordArtifactLocation {
  kind: 'word'
  page?: number
  blockId?: string
  blockIndex?: number
  objectId?: string
  offset?: number
  search?: string
  occurrence?: number
  region?: 'page' | 'section' | 'header' | 'footer' | 'margin' | 'footnote'
  rect?: ArtifactNormalizedRect
}

export interface ExcelArtifactLocation {
  kind: 'excel'
  sheetId?: string
  sheetName?: string
  sheetIndex?: number
  range: string
}

export interface PdfArtifactLocation {
  kind: 'pdf'
  pageNumber: number
  pageId?: string
  rect?: ArtifactNormalizedRect
  objectFingerprint?: string
}

export interface PresentationArtifactLocation {
  kind: 'presentation'
  slideIndex: number
  slideId?: string
  nodeId?: string
  rect?: ArtifactNormalizedRect
}

export interface CodeArtifactPoint {
  /** UTF-16 offset, matching Monaco's text model indexing. */
  offset: number
  /** One-based line number. */
  line: number
  /** One-based column number. */
  column: number
}

export interface CodeArtifactRange {
  start: CodeArtifactPoint
  end: CodeArtifactPoint
}

export interface CodeArtifactLocation {
  kind: 'code'
  originalRange: CodeArtifactRange
  candidateRange: CodeArtifactRange
  beforeDigest: string
  afterDigest: string
  contextBeforeDigest?: string
  contextAfterDigest?: string
}

export type ArtifactLocation =
  | WordArtifactLocation
  | ExcelArtifactLocation
  | PdfArtifactLocation
  | PresentationArtifactLocation
  | CodeArtifactLocation

export interface ArtifactTextMetadata {
  encoding: 'utf-8'
  hasBom: boolean
  eol: 'lf' | 'crlf' | 'mixed'
  languageId: string
  dirty: boolean
}

export type ArtifactOperationType =
  | 'insert'
  | 'delete'
  | 'replace'
  | 'cell'
  | 'formula'
  | 'format'
  | 'style'
  | 'merge'
  | 'move'
  | 'resize'
  | 'reorder'
  | 'structure'
  | 'object'
  | 'metadata'
  | 'comment'

export type ArtifactVisualType =
  | 'addition'
  | 'deletion'
  | 'replacement'
  | 'format'
  | 'range'
  | 'object'
  | 'page-region'

export interface ArtifactChangeSummary {
  text?: string
  digest?: string
  objectType?: string
  attributes?: Record<string, string | number | boolean | null>
}

export interface ArtifactDerivedEffect {
  label: string
  location?: ArtifactLocation
  summary?: ArtifactChangeSummary
}

/** One independently reviewable, replayable user-visible change. */
export interface ArtifactOperation {
  id: string
  type: ArtifactOperationType
  label: string
  location: ArtifactLocation
  before?: ArtifactChangeSummary
  after?: ArtifactChangeSummary
  dependsOn?: string[]
  atomicGroupId?: string
  visual: ArtifactVisualType
  /** Opaque producer-owned token persisted for replay and conflict checks. */
  executionRef: string
  derivedEffects?: ArtifactDerivedEffect[]
}

export interface ArtifactProducerIdentity {
  id: string
  version: string
  platform: NodeJS.Platform | string
}

export interface ArtifactProducerCapabilities {
  kinds: ArtifactKind[]
  operationTypes: ArtifactOperationType[]
  canRebuild: boolean
  canRebase: boolean
  canPersistExecutionRefs: boolean
  maxOperations?: number
  protocolVersion: number
}

/** A dependency whose prerequisite operation belongs to another file in the same code batch. */
export interface ArtifactCrossFileDependency {
  /** Operation in this manifest that must be rejected when its prerequisite is rejected. */
  operationId: string
  /** Workspace-relative path of the prerequisite draft. */
  dependsOnRelativePath: string
  /** Operation ID in the prerequisite draft. */
  dependsOnOperationId: string
}

export interface ArtifactDraftManifest {
  protocolVersion: 1
  draftId: string
  runId?: string
  agentId?: string
  agentName?: string
  documentId: string
  sourceRevision: number
  sourceHash: string
  /** Hash of the on-disk file when the source snapshot was captured. */
  sourceDiskHash?: string
  sourceName: string
  kind: ArtifactKind
  textMetadata?: ArtifactTextMetadata
  batchId?: string
  relativePath?: string
  crossFileDependencies?: ArtifactCrossFileDependency[]
  candidateHandle: string
  candidateHash: string
  producer: ArtifactProducerIdentity
  operations: ArtifactOperation[]
  createdAt: number
  reviewMode?: 'draft' | 'history-withdrawal'
  historyRevisionId?: string
  replayBaseHash?: string
  historyFinalHash?: string
}

export type ArtifactDecision = 'pending' | 'accepted' | 'rejected' | 'conflict'

export interface ArtifactOperationDecision {
  decision: ArtifactDecision
  decidedAt?: number
  reason?: 'user' | 'dependency' | 'atomic-group' | 'conflict'
  causedBy?: string
  message?: string
}

export type ArtifactReviewPhase =
  | 'validating'
  | 'reviewing'
  | 'paused'
  | 'rebuilding'
  | 'ready-to-save'
  | 'saving'
  | 'saved'
  | 'discarded'
  | 'conflicted'
  | 'failed'

export interface ArtifactReviewState {
  draftId: string
  documentId: string
  sourceName: string
  kind: ArtifactKind
  agentId?: string
  agentName?: string
  phase: ArtifactReviewPhase
  currentOperationId?: string
  currentIndex: number
  decided: number
  total: number
  accepted: number
  rejected: number
  conflicts: number
  decisions: Record<string, ArtifactOperationDecision>
  enabledOperationIds: string[]
  candidateHandle: string
  candidateHash: string
  paused: boolean
  followAgent: boolean
  canUndo: boolean
  canRedo: boolean
  canSave: boolean
  message?: string
}

export interface ArtifactCandidateBuildResult {
  candidateHandle: string
  candidateHash: string
  adapterReceipt: string
}

export interface ArtifactRevisionRecord {
  revisionId: string
  draftId: string
  documentId: string
  sourceName: string
  kind: ArtifactKind
  sourceHash: string
  finalHash: string
  sourceBlobHash: string
  finalBlobHash: string
  producer: ArtifactProducerIdentity
  operations: ArtifactOperation[]
  decisions: Record<string, ArtifactOperationDecision>
  enabledOperationIds: string[]
  adapterReceipt: string
  createdAt: number
  lastAccessedAt: number
}

export interface ArtifactDraftPayload {
  manifest: ArtifactDraftManifest
  originalData: Uint8Array | ArrayBuffer
  candidateData: Uint8Array | ArrayBuffer
}

export interface ArtifactDraftCreateRequest {
  sourcePath: string
  kind: ArtifactKind
  candidateHandle: string
  sourceRevision: number
  producer: ArtifactProducerIdentity
  operations: ArtifactOperation[]
  /** Trusted main-process handle for an in-memory editor snapshot. */
  sourceSnapshotHandle?: string
  textMetadata?: ArtifactTextMetadata
  batchId?: string
  relativePath?: string
  crossFileDependencies?: ArtifactCrossFileDependency[]
  runId?: string
  agentId?: string
  agentName?: string
  documentId?: string
}

export interface ArtifactDraftBatchCreateRequest {
  requests: ArtifactDraftCreateRequest[]
}

export interface ArtifactSourceSnapshotStageRequest {
  sourcePath: string
  data: Uint8Array | ArrayBuffer
  sourceRevision: number
  metadata: ArtifactTextMetadata
}

export interface ArtifactSourceSnapshotStageResult {
  sourceSnapshotHandle: string
  sourceHash: string
  sourceDiskHash: string
}

export interface ArtifactStagedInputReleaseRequest {
  candidateHandles?: string[]
  sourceSnapshotHandles?: string[]
}

export type ArtifactReviewBatchItemStatus =
  | 'pending'
  | 'reviewing'
  | 'ready-to-save'
  | 'saved'
  | 'discarded'
  | 'conflicted'
  | 'failed'

export interface ArtifactReviewBatchItem {
  draftId: string
  documentId: string
  relativePath: string
  status: ArtifactReviewBatchItemStatus
  dependsOnDraftIds?: string[]
}

export interface ArtifactReviewBatchManifest {
  protocolVersion: 1
  batchId: string
  runId?: string
  agentId?: string
  agentName?: string
  workspaceRoot: string
  items: ArtifactReviewBatchItem[]
  createdAt: number
}

export interface ArtifactReviewBatchState {
  batchId: string
  currentDraftId?: string
  currentIndex: number
  total: number
  decidedFiles: number
  savedFiles: number
  discardedFiles: number
  items: ArtifactReviewBatchItem[]
}

export interface CodeWorkspaceArtifact {
  artifactId: string
  relativePath: string
  languageId: string
  size: number
  revision: number
  sourceHash: string
  dirty: boolean
}

export interface CodeWorkspaceActiveSnapshot {
  sourcePath: string
  data: Uint8Array | ArrayBuffer
  metadata: ArtifactTextMetadata
  revision: number
}

export interface CodeWorkspaceInspectRequest {
  workspaceRoot: string
  activeSnapshot?: CodeWorkspaceActiveSnapshot
}

export interface CodeWorkspaceInspectResult {
  workspaceId: string
  artifacts: CodeWorkspaceArtifact[]
  truncated: boolean
}

export interface CodeArtifactReadRequest {
  artifactId: string
  /** Current renderer workspace. Main verifies the opaque handle is still bound to it. */
  workspaceRoot: string
  startOffset?: number
  endOffset?: number
}

export interface CodeArtifactResolveRequest {
  artifactId: string
  /** Current renderer workspace. Main verifies the opaque handle is still bound to it. */
  workspaceRoot: string
}

export interface CodeArtifactReadResult {
  artifact: CodeWorkspaceArtifact
  content: string
  startOffset: number
  endOffset: number
  totalLength: number
  truncated: boolean
}

/** Trusted renderer-only resolution; never include this object in a model tool result. */
export interface CodeArtifactResolvedSnapshot {
  artifact: CodeWorkspaceArtifact
  sourcePath: string
  data: Uint8Array | ArrayBuffer
  metadata: ArtifactTextMetadata
  sourceDiskHash: string
}

export interface CodeDraftEditInput {
  id: string
  label: string
  startOffset: number
  endOffset: number
  beforeText: string
  afterText: string
  dependsOn?: string[]
  atomicGroupId?: string
}

export interface CodeDraftFilePlan {
  artifactId: string
  baseRevision: number
  baseHash: string
  edits: CodeDraftEditInput[]
}

export interface CodeDraftCreateRequest {
  protocolVersion: 1
  planId: string
  files: CodeDraftFilePlan[]
}

export interface CodeDraftCreateResult {
  batch: ArtifactReviewBatchManifest
  drafts: ArtifactDraftSummary[]
}

export interface ArtifactDraftSummary {
  manifest: ArtifactDraftManifest
  reviewState?: ArtifactReviewState
}

export interface ArtifactReviewEvent {
  eventId: string
  type: 'draft-opened' | 'state-changed' | 'candidate-rebuilt' | 'draft-saved' | 'draft-discarded' | 'error'
  draftId: string
  timestamp: number
  manifest?: ArtifactDraftManifest
  state?: ArtifactReviewState
  revision?: ArtifactRevisionRecord
  error?: string
  batchId?: string
}

export type ArtifactReviewCommand =
  | { type: 'accept'; operationId: string }
  | { type: 'reject'; operationId: string }
  | { type: 'accept-all' }
  | { type: 'reject-all' }
  | { type: 'previous' }
  | { type: 'next' }
  | { type: 'locate'; operationId?: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'save' }
  | { type: 'discard' }

export interface ArtifactProducerAdapter {
  readonly identity: ArtifactProducerIdentity
  readonly capabilities: ArtifactProducerCapabilities
  openDraft(manifest: ArtifactDraftManifest): Promise<void>
  buildCandidate(manifest: ArtifactDraftManifest): Promise<ArtifactCandidateBuildResult>
  rebuildCandidate(
    manifest: ArtifactDraftManifest,
    enabledOperationIds: string[],
    context?: { replayBaseData?: Uint8Array | ArrayBuffer; replayBaseHash?: string },
  ): Promise<ArtifactCandidateBuildResult>
  rebaseOperations(
    manifest: ArtifactDraftManifest,
    currentSourceHash: string,
  ): Promise<{ operations: ArtifactOperation[]; conflicts: string[] }>
  closeDraft(draftId: string): Promise<void>
}
