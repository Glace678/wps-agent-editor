import type {
  ArtifactChangeSummary,
  ArtifactDecision,
  ArtifactDraftManifest,
  ArtifactLocation,
  ArtifactOperation,
  ArtifactOperationDecision,
  ArtifactReviewState,
} from '../../types/artifact-review'

export const MAX_ARTIFACT_OPERATIONS = 500

const ARTIFACT_KINDS = new Set(['word', 'excel', 'pdf', 'presentation', 'code'])
const OPERATION_TYPES = new Set([
  'insert', 'delete', 'replace', 'cell', 'formula', 'format', 'style', 'merge',
  'move', 'resize', 'reorder', 'structure', 'object', 'metadata', 'comment',
])
const VISUAL_TYPES = new Set([
  'addition', 'deletion', 'replacement', 'format', 'range', 'object', 'page-region',
])
const WORD_REGIONS = new Set(['page', 'section', 'header', 'footer', 'margin', 'footnote'])

interface ReviewSnapshot {
  decisions: Record<string, ArtifactOperationDecision>
  enabledOperationIds: string[]
  currentOperationId?: string
}

export interface ArtifactReviewControllerAdapter {
  rebuildCandidate: (
    manifest: ArtifactDraftManifest,
    enabledOperationIds: string[],
  ) => Promise<{ candidateHandle: string; candidateHash: string }>
  saveDraft?: (
    manifest: ArtifactDraftManifest,
    state: ArtifactReviewState,
  ) => Promise<{ candidateHandle?: string; candidateHash?: string } | void>
  discardDraft?: (manifest: ArtifactDraftManifest) => Promise<void>
  locate?: (operation: ArtifactOperation) => void | Promise<void>
  onState?: (state: ArtifactReviewState) => void
}

function cloneDecisions(
  decisions: Record<string, ArtifactOperationDecision>,
): Record<string, ArtifactOperationDecision> {
  return Object.fromEntries(Object.entries(decisions).map(([id, value]) => [id, { ...value }]))
}

function isHash(value: string): boolean {
  return /^[a-f\d]{64}$/i.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateOptionalString(value: unknown, error: string): void {
  if (value !== undefined && (typeof value !== 'string' || !value.trim())) throw new Error(error)
}

function validateSummary(summary: ArtifactChangeSummary | undefined, operationId: string): void {
  if (summary === undefined) return
  if (!isRecord(summary)) throw new Error(`ARTIFACT_CHANGE_SUMMARY_INVALID:${operationId}`)
  for (const field of ['text', 'digest', 'objectType'] as const) {
    if (summary[field] !== undefined && typeof summary[field] !== 'string') {
      throw new Error(`ARTIFACT_CHANGE_SUMMARY_INVALID:${operationId}`)
    }
  }
  if (typeof summary.text === 'string' && summary.text.length > 10_000) {
    throw new Error(`ARTIFACT_CHANGE_SUMMARY_TOO_LARGE:${operationId}`)
  }
  if (summary.attributes !== undefined) {
    if (!isRecord(summary.attributes)) throw new Error(`ARTIFACT_CHANGE_ATTRIBUTES_INVALID:${operationId}`)
    for (const value of Object.values(summary.attributes)) {
      if (
        value !== null
        && typeof value !== 'string'
        && typeof value !== 'boolean'
        && (typeof value !== 'number' || !Number.isFinite(value))
      ) throw new Error(`ARTIFACT_CHANGE_ATTRIBUTES_INVALID:${operationId}`)
    }
  }
  if (
    summary.text === undefined
    && summary.digest === undefined
    && summary.objectType === undefined
    && summary.attributes === undefined
  ) throw new Error(`ARTIFACT_CHANGE_SUMMARY_EMPTY:${operationId}`)
}

function validateRect(rect: { x: number; y: number; width: number; height: number } | undefined): void {
  if (!rect) return
  if (!isRecord(rect)) throw new Error('ARTIFACT_LOCATION_RECT_INVALID')
  const values = [rect.x, rect.y, rect.width, rect.height]
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error('ARTIFACT_LOCATION_RECT_INVALID')
  }
  if (rect.x + rect.width > 1.000001 || rect.y + rect.height > 1.000001) {
    throw new Error('ARTIFACT_LOCATION_RECT_OVERFLOW')
  }
}

function validateNonNegativeInteger(value: unknown, error: string): void {
  if (value !== undefined && (!Number.isInteger(value) || Number(value) < 0)) throw new Error(error)
}

function validateCodeRange(
  range: { start: { offset: number; line: number; column: number }; end: { offset: number; line: number; column: number } },
  error: string,
): void {
  if (!isRecord(range) || !isRecord(range.start) || !isRecord(range.end)) throw new Error(error)
  for (const point of [range.start, range.end]) {
    if (!Number.isInteger(point.offset) || point.offset < 0) throw new Error(error)
    if (!Number.isInteger(point.line) || point.line < 1) throw new Error(error)
    if (!Number.isInteger(point.column) || point.column < 1) throw new Error(error)
  }
  if (range.end.offset < range.start.offset) throw new Error(error)
}

function excelColumnNumber(label: string): number {
  let value = 0
  for (const char of label.toUpperCase()) value = value * 26 + char.charCodeAt(0) - 64
  return value
}

function validateExcelRange(range: unknown, operationId: string): void {
  if (typeof range !== 'string' || !range.trim()) throw new Error(`ARTIFACT_EXCEL_RANGE_REQUIRED:${operationId}`)
  const match = range.replace(/\$/g, '').match(/^([A-Z]+)([1-9]\d*)(?::([A-Z]+)([1-9]\d*))?$/i)
  if (!match) throw new Error(`ARTIFACT_EXCEL_RANGE_INVALID:${operationId}`)
  const columns = [excelColumnNumber(match[1]), excelColumnNumber(match[3] ?? match[1])]
  const rows = [Number(match[2]), Number(match[4] ?? match[2])]
  if (columns.some((value) => value < 1 || value > 16_384) || rows.some((value) => value > 1_048_576)) {
    throw new Error(`ARTIFACT_EXCEL_RANGE_INVALID:${operationId}`)
  }
}

function validateLocation(location: ArtifactLocation, kind: ArtifactDraftManifest['kind'], operationId: string): void {
  if (!isRecord(location) || typeof location.kind !== 'string') {
    throw new Error(`ARTIFACT_LOCATION_REQUIRED:${operationId}`)
  }
  if (location.kind !== kind) {
    throw new Error(`ARTIFACT_LOCATION_KIND_MISMATCH:${operationId}`)
  }
  switch (location.kind) {
    case 'word':
      if (
        location.page === undefined
        && !location.blockId
        && location.blockIndex === undefined
        && !location.objectId
        && !location.search
        && !location.region
        && !location.rect
      ) throw new Error(`ARTIFACT_WORD_LOCATION_EMPTY:${operationId}`)
      if (location.page !== undefined && (!Number.isInteger(location.page) || location.page < 1)) {
        throw new Error(`ARTIFACT_WORD_PAGE_INVALID:${operationId}`)
      }
      validateNonNegativeInteger(location.blockIndex, `ARTIFACT_WORD_BLOCK_INDEX_INVALID:${operationId}`)
      validateNonNegativeInteger(location.offset, `ARTIFACT_WORD_OFFSET_INVALID:${operationId}`)
      validateNonNegativeInteger(location.occurrence, `ARTIFACT_WORD_OCCURRENCE_INVALID:${operationId}`)
      validateOptionalString(location.blockId, `ARTIFACT_WORD_BLOCK_ID_INVALID:${operationId}`)
      validateOptionalString(location.objectId, `ARTIFACT_WORD_OBJECT_ID_INVALID:${operationId}`)
      validateOptionalString(location.search, `ARTIFACT_WORD_SEARCH_INVALID:${operationId}`)
      if (location.region !== undefined && !WORD_REGIONS.has(location.region)) {
        throw new Error(`ARTIFACT_WORD_REGION_INVALID:${operationId}`)
      }
      validateRect(location.rect)
      break
    case 'excel':
      validateExcelRange(location.range, operationId)
      if (
        !location.sheetId
        && !location.sheetName
        && location.sheetIndex === undefined
      ) throw new Error(`ARTIFACT_EXCEL_SHEET_REQUIRED:${operationId}`)
      validateOptionalString(location.sheetId, `ARTIFACT_EXCEL_SHEET_INVALID:${operationId}`)
      validateOptionalString(location.sheetName, `ARTIFACT_EXCEL_SHEET_INVALID:${operationId}`)
      validateNonNegativeInteger(location.sheetIndex, `ARTIFACT_EXCEL_SHEET_INDEX_INVALID:${operationId}`)
      break
    case 'pdf':
      if (!Number.isInteger(location.pageNumber) || location.pageNumber < 1) {
        throw new Error(`ARTIFACT_PDF_PAGE_INVALID:${operationId}`)
      }
      validateOptionalString(location.pageId, `ARTIFACT_PDF_PAGE_ID_INVALID:${operationId}`)
      validateOptionalString(location.objectFingerprint, `ARTIFACT_PDF_FINGERPRINT_INVALID:${operationId}`)
      validateRect(location.rect)
      break
    case 'presentation':
      if (!Number.isInteger(location.slideIndex) || location.slideIndex < 0) {
        throw new Error(`ARTIFACT_SLIDE_INVALID:${operationId}`)
      }
      validateOptionalString(location.slideId, `ARTIFACT_SLIDE_ID_INVALID:${operationId}`)
      validateOptionalString(location.nodeId, `ARTIFACT_SLIDE_NODE_ID_INVALID:${operationId}`)
      validateRect(location.rect)
      break
    case 'code':
      validateCodeRange(location.originalRange, `ARTIFACT_CODE_ORIGINAL_RANGE_INVALID:${operationId}`)
      validateCodeRange(location.candidateRange, `ARTIFACT_CODE_CANDIDATE_RANGE_INVALID:${operationId}`)
      if (!isHash(location.beforeDigest) || !isHash(location.afterDigest)) {
        throw new Error(`ARTIFACT_CODE_DIGEST_INVALID:${operationId}`)
      }
      if (location.contextBeforeDigest !== undefined && !isHash(location.contextBeforeDigest)) {
        throw new Error(`ARTIFACT_CODE_CONTEXT_DIGEST_INVALID:${operationId}`)
      }
      if (location.contextAfterDigest !== undefined && !isHash(location.contextAfterDigest)) {
        throw new Error(`ARTIFACT_CODE_CONTEXT_DIGEST_INVALID:${operationId}`)
      }
      break
    default:
      throw new Error(`ARTIFACT_LOCATION_KIND_INVALID:${operationId}`)
  }
}

function locationSortKey(operation: ArtifactOperation): [number, number, number, string] {
  const location = operation.location
  switch (location.kind) {
    case 'word':
      return [location.page ?? 1, location.blockIndex ?? Number.MAX_SAFE_INTEGER, location.offset ?? 0, operation.id]
    case 'excel': {
      const cell = location.range.match(/^([A-Z]+)(\d+)/i)
      let column = 0
      for (const char of cell?.[1]?.toUpperCase() ?? '') column = column * 26 + char.charCodeAt(0) - 64
      return [location.sheetIndex ?? 0, Number(cell?.[2] ?? 0), column, operation.id]
    }
    case 'pdf':
      return [location.pageNumber, Math.round((location.rect?.y ?? 0) * 1_000_000), Math.round((location.rect?.x ?? 0) * 1_000_000), operation.id]
    case 'presentation':
      return [location.slideIndex, Math.round((location.rect?.y ?? 0) * 1_000_000), Math.round((location.rect?.x ?? 0) * 1_000_000), operation.id]
    case 'code':
      return [location.originalRange.start.line, location.originalRange.start.column, location.originalRange.start.offset, operation.id]
  }
}

function compareLocation(a: ArtifactOperation, b: ArtifactOperation): number {
  const aa = locationSortKey(a)
  const bb = locationSortKey(b)
  for (let index = 0; index < aa.length; index += 1) {
    const av = aa[index]
    const bv = bb[index]
    if (av === bv) continue
    return av < bv ? -1 : 1
  }
  return 0
}

/** Stable topological order with document position used between independent operations. */
export function orderArtifactOperations(operations: ArtifactOperation[]): ArtifactOperation[] {
  const byId = new Map<string, ArtifactOperation>()
  const sourceIndex = new Map<string, number>()
  operations.forEach((operation, index) => {
    if (!operation.id?.trim()) throw new Error('ARTIFACT_OPERATION_ID_REQUIRED')
    if (byId.has(operation.id)) throw new Error(`ARTIFACT_OPERATION_DUPLICATE:${operation.id}`)
    byId.set(operation.id, operation)
    sourceIndex.set(operation.id, index)
  })

  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const operation of operations) {
    const dependencies = [...new Set(operation.dependsOn ?? [])]
    if (dependencies.includes(operation.id)) throw new Error(`ARTIFACT_OPERATION_SELF_DEPENDENCY:${operation.id}`)
    indegree.set(operation.id, dependencies.length)
    for (const dependency of dependencies) {
      if (!byId.has(dependency)) throw new Error(`ARTIFACT_OPERATION_UNKNOWN_DEPENDENCY:${dependency}`)
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), operation.id])
    }
  }

  const ready = operations.filter((operation) => indegree.get(operation.id) === 0)
  const sortReady = () => ready.sort((a, b) => compareLocation(a, b)
    || (sourceIndex.get(a.id) ?? 0) - (sourceIndex.get(b.id) ?? 0))
  sortReady()
  const ordered: ArtifactOperation[] = []
  while (ready.length > 0) {
    const operation = ready.shift()!
    ordered.push(operation)
    for (const id of dependents.get(operation.id) ?? []) {
      const next = (indegree.get(id) ?? 1) - 1
      indegree.set(id, next)
      if (next === 0) ready.push(byId.get(id)!)
    }
    sortReady()
  }
  if (ordered.length !== operations.length) throw new Error('ARTIFACT_OPERATION_DEPENDENCY_CYCLE')
  return ordered
}

export function validateArtifactDraftManifest(manifest: ArtifactDraftManifest): ArtifactDraftManifest {
  if (!manifest || typeof manifest !== 'object') throw new Error('ARTIFACT_MANIFEST_REQUIRED')
  if (manifest.protocolVersion !== 1) throw new Error('ARTIFACT_PROTOCOL_UNSUPPORTED')
  if (!ARTIFACT_KINDS.has(manifest.kind)) throw new Error('ARTIFACT_KIND_INVALID')
  if (typeof manifest.draftId !== 'string' || !manifest.draftId.trim()) throw new Error('ARTIFACT_DRAFT_ID_REQUIRED')
  if (typeof manifest.documentId !== 'string' || !manifest.documentId.trim()) throw new Error('ARTIFACT_DOCUMENT_ID_REQUIRED')
  if (typeof manifest.sourceName !== 'string' || !manifest.sourceName.trim()) throw new Error('ARTIFACT_SOURCE_NAME_REQUIRED')
  if (!Number.isInteger(manifest.sourceRevision) || manifest.sourceRevision < 0) {
    throw new Error('ARTIFACT_SOURCE_REVISION_INVALID')
  }
  if (typeof manifest.sourceHash !== 'string' || typeof manifest.candidateHash !== 'string'
    || !isHash(manifest.sourceHash) || !isHash(manifest.candidateHash)) {
    throw new Error('ARTIFACT_HASH_INVALID')
  }
  if (manifest.sourceDiskHash !== undefined && !isHash(manifest.sourceDiskHash)) {
    throw new Error('ARTIFACT_SOURCE_DISK_HASH_INVALID')
  }
  if (manifest.kind === 'code') {
    if (!manifest.textMetadata || manifest.textMetadata.encoding !== 'utf-8') {
      throw new Error('ARTIFACT_CODE_METADATA_REQUIRED')
    }
    if (!['lf', 'crlf', 'mixed'].includes(manifest.textMetadata.eol)) {
      throw new Error('ARTIFACT_CODE_EOL_INVALID')
    }
    if (typeof manifest.textMetadata.hasBom !== 'boolean' || typeof manifest.textMetadata.dirty !== 'boolean') {
      throw new Error('ARTIFACT_CODE_METADATA_INVALID')
    }
    if (typeof manifest.textMetadata.languageId !== 'string' || !manifest.textMetadata.languageId.trim()) {
      throw new Error('ARTIFACT_CODE_LANGUAGE_REQUIRED')
    }
    if (manifest.crossFileDependencies !== undefined) {
      if (!manifest.batchId?.trim() || !manifest.relativePath?.trim()) {
        throw new Error('ARTIFACT_CODE_CROSS_FILE_BATCH_REQUIRED')
      }
      if (!Array.isArray(manifest.crossFileDependencies)) {
        throw new Error('ARTIFACT_CODE_CROSS_FILE_DEPENDENCIES_INVALID')
      }
      const seen = new Set<string>()
      for (const dependency of manifest.crossFileDependencies) {
        if (!isRecord(dependency)
          || typeof dependency.operationId !== 'string' || !dependency.operationId.trim()
          || typeof dependency.dependsOnRelativePath !== 'string' || !dependency.dependsOnRelativePath.trim()
          || typeof dependency.dependsOnOperationId !== 'string' || !dependency.dependsOnOperationId.trim()) {
          throw new Error('ARTIFACT_CODE_CROSS_FILE_DEPENDENCY_INVALID')
        }
        if (dependency.dependsOnRelativePath === manifest.relativePath) {
          throw new Error(`ARTIFACT_CODE_CROSS_FILE_SELF_DEPENDENCY:${dependency.operationId}`)
        }
        const key = `${dependency.operationId}\u0000${dependency.dependsOnRelativePath}\u0000${dependency.dependsOnOperationId}`
        if (seen.has(key)) throw new Error(`ARTIFACT_CODE_CROSS_FILE_DEPENDENCY_DUPLICATE:${dependency.operationId}`)
        seen.add(key)
      }
    }
  } else if (manifest.crossFileDependencies !== undefined) {
    throw new Error('ARTIFACT_CROSS_FILE_DEPENDENCIES_CODE_ONLY')
  }
  if (typeof manifest.candidateHandle !== 'string' || !manifest.candidateHandle.trim()) {
    throw new Error('ARTIFACT_CANDIDATE_HANDLE_REQUIRED')
  }
  if (!isRecord(manifest.producer)
    || typeof manifest.producer.id !== 'string' || !manifest.producer.id.trim()
    || typeof manifest.producer.version !== 'string' || !manifest.producer.version.trim()
    || typeof manifest.producer.platform !== 'string' || !manifest.producer.platform.trim()) {
    throw new Error('ARTIFACT_PRODUCER_REQUIRED')
  }
  if (!Number.isFinite(manifest.createdAt) || manifest.createdAt <= 0) throw new Error('ARTIFACT_CREATED_AT_INVALID')
  if (manifest.reviewMode !== undefined && !['draft', 'history-withdrawal'].includes(manifest.reviewMode)) {
    throw new Error('ARTIFACT_REVIEW_MODE_INVALID')
  }
  if (!Array.isArray(manifest.operations) || manifest.operations.length === 0) {
    throw new Error('ARTIFACT_OPERATIONS_REQUIRED')
  }
  if (manifest.operations.length > MAX_ARTIFACT_OPERATIONS) throw new Error('ARTIFACT_OPERATION_LIMIT')

  for (const operation of manifest.operations) {
    if (!isRecord(operation)) throw new Error('ARTIFACT_OPERATION_INVALID')
    if (typeof operation.id !== 'string' || !operation.id.trim()) throw new Error('ARTIFACT_OPERATION_ID_REQUIRED')
    if (operation.id.length > 256) throw new Error(`ARTIFACT_OPERATION_ID_TOO_LARGE:${operation.id.slice(0, 32)}`)
    if (typeof operation.label !== 'string' || !operation.label.trim()) throw new Error(`ARTIFACT_OPERATION_LABEL_REQUIRED:${operation.id}`)
    if (operation.label.length > 500) throw new Error(`ARTIFACT_OPERATION_LABEL_TOO_LARGE:${operation.id}`)
    if (!OPERATION_TYPES.has(operation.type)) throw new Error(`ARTIFACT_OPERATION_TYPE_INVALID:${operation.id}`)
    if (typeof operation.executionRef !== 'string' || !operation.executionRef.trim()) throw new Error(`ARTIFACT_EXECUTION_REF_REQUIRED:${operation.id}`)
    if (operation.executionRef.length > 4096) throw new Error(`ARTIFACT_EXECUTION_REF_TOO_LARGE:${operation.id}`)
    if (!VISUAL_TYPES.has(operation.visual)) throw new Error(`ARTIFACT_VISUAL_INVALID:${operation.id}`)
    if (operation.dependsOn !== undefined && (!Array.isArray(operation.dependsOn) || operation.dependsOn.some((id) => typeof id !== 'string' || !id.trim()))) {
      throw new Error(`ARTIFACT_DEPENDENCIES_INVALID:${operation.id}`)
    }
    validateOptionalString(operation.atomicGroupId, `ARTIFACT_ATOMIC_GROUP_INVALID:${operation.id}`)
    if (!operation.before && !operation.after) throw new Error(`ARTIFACT_CHANGE_SUMMARY_REQUIRED:${operation.id || '?'}`)
    validateSummary(operation.before, operation.id)
    validateSummary(operation.after, operation.id)
    validateLocation(operation.location, manifest.kind, operation.id)
    if (operation.derivedEffects !== undefined && !Array.isArray(operation.derivedEffects)) {
      throw new Error(`ARTIFACT_DERIVED_EFFECTS_INVALID:${operation.id}`)
    }
    for (const effect of operation.derivedEffects ?? []) {
      if (!isRecord(effect) || typeof effect.label !== 'string' || !effect.label.trim()) {
        throw new Error(`ARTIFACT_DERIVED_EFFECT_LABEL_REQUIRED:${operation.id}`)
      }
      if (effect.location) validateLocation(effect.location, manifest.kind, operation.id)
      validateSummary(effect.summary, operation.id)
    }
  }
  if (manifest.crossFileDependencies) {
    const localOperationIds = new Set(manifest.operations.map(({ id }) => id))
    for (const dependency of manifest.crossFileDependencies) {
      if (!localOperationIds.has(dependency.operationId)) {
        throw new Error(`ARTIFACT_CODE_CROSS_FILE_OPERATION_UNKNOWN:${dependency.operationId}`)
      }
    }
  }
  orderArtifactOperations(manifest.operations)
  if (manifest.kind === 'code') {
    const positioned = [...manifest.operations].sort((left, right) => {
      const a = left.location.kind === 'code' ? left.location.originalRange.start.offset : 0
      const b = right.location.kind === 'code' ? right.location.originalRange.start.offset : 0
      return a - b || left.id.localeCompare(right.id)
    })
    for (let index = 1; index < positioned.length; index += 1) {
      const previous = positioned[index - 1].location
      const current = positioned[index].location
      if (previous.kind !== 'code' || current.kind !== 'code') continue
      const duplicateInsertion = previous.originalRange.start.offset === previous.originalRange.end.offset
        && current.originalRange.start.offset === current.originalRange.end.offset
        && previous.originalRange.start.offset === current.originalRange.start.offset
      if (current.originalRange.start.offset < previous.originalRange.end.offset || duplicateInsertion) {
        throw new Error(`ARTIFACT_CODE_RANGE_OVERLAP:${positioned[index].id}`)
      }
    }
  }
  return manifest
}

function makeDecision(decision: ArtifactDecision): ArtifactOperationDecision {
  return { decision }
}

export class ArtifactReviewController {
  private readonly manifest: ArtifactDraftManifest
  private readonly adapter: ArtifactReviewControllerAdapter
  private readonly operations: ArtifactOperation[]
  private readonly byId: Map<string, ArtifactOperation>
  private readonly dependents = new Map<string, Set<string>>()
  private readonly groups = new Map<string, Set<string>>()
  private decisions: Record<string, ArtifactOperationDecision>
  private enabledOperationIds: Set<string>
  private currentOperationId?: string
  private paused = false
  private followAgent = true
  private phase: ArtifactReviewState['phase'] = 'reviewing'
  private message?: string
  private candidateHandle: string
  private candidateHash: string
  private undoStack: ReviewSnapshot[] = []
  private redoStack: ReviewSnapshot[] = []
  private transaction: Promise<unknown> = Promise.resolve()

  constructor(
    manifest: ArtifactDraftManifest,
    adapter: ArtifactReviewControllerAdapter,
    initialState?: ArtifactReviewState,
  ) {
    this.manifest = validateArtifactDraftManifest(manifest)
    this.adapter = adapter
    this.operations = orderArtifactOperations(manifest.operations)
    this.byId = new Map(this.operations.map((operation) => [operation.id, operation]))
    const operationIds = new Set(this.operations.map((operation) => operation.id))
    if (initialState && initialState.draftId !== manifest.draftId) {
      throw new Error('ARTIFACT_REVIEW_STATE_DRAFT_MISMATCH')
    }
    this.decisions = Object.fromEntries(this.operations.map((operation) => [
      operation.id,
      initialState?.decisions[operation.id]
        ? { ...initialState.decisions[operation.id] }
        : makeDecision('pending'),
    ]))
    this.enabledOperationIds = new Set(
      initialState
        ? initialState.enabledOperationIds.filter((id) => operationIds.has(id))
        : this.operations.map((operation) => operation.id),
    )
    this.currentOperationId = initialState?.currentOperationId && operationIds.has(initialState.currentOperationId)
      ? initialState.currentOperationId
      : this.operations[0]?.id
    this.candidateHandle = initialState?.candidateHandle || manifest.candidateHandle
    this.candidateHash = initialState?.candidateHash || manifest.candidateHash
    this.paused = initialState?.paused ?? false
    this.followAgent = initialState?.followAgent ?? true
    this.phase = initialState && !['saving', 'rebuilding'].includes(initialState.phase)
      ? initialState.phase
      : 'reviewing'
    this.message = initialState?.message

    for (const operation of this.operations) {
      for (const dependency of operation.dependsOn ?? []) {
        const ids = this.dependents.get(dependency) ?? new Set<string>()
        ids.add(operation.id)
        this.dependents.set(dependency, ids)
      }
      if (operation.atomicGroupId) {
        const ids = this.groups.get(operation.atomicGroupId) ?? new Set<string>()
        ids.add(operation.id)
        this.groups.set(operation.atomicGroupId, ids)
      }
    }
    this.emit()
  }

  getManifest(): ArtifactDraftManifest {
    return this.manifest
  }

  getOperations(): readonly ArtifactOperation[] {
    return this.operations
  }

  getState(): ArtifactReviewState {
    const values = Object.values(this.decisions)
    const accepted = values.filter(({ decision }) => decision === 'accepted').length
    const rejected = values.filter(({ decision }) => decision === 'rejected').length
    const conflicts = values.filter(({ decision }) => decision === 'conflict').length
    const decided = accepted + rejected + conflicts
    const index = Math.max(0, this.operations.findIndex(({ id }) => id === this.currentOperationId))
    const allDecided = decided === this.operations.length
    const conflictsAreLockedKeeps = this.manifest.reviewMode === 'history-withdrawal'
    return {
      draftId: this.manifest.draftId,
      documentId: this.manifest.documentId,
      sourceName: this.manifest.sourceName,
      kind: this.manifest.kind,
      agentId: this.manifest.agentId,
      agentName: this.manifest.agentName,
      phase: this.phase === 'reviewing' && allDecided && (conflicts === 0 || conflictsAreLockedKeeps)
        ? 'ready-to-save'
        : this.phase,
      currentOperationId: this.currentOperationId,
      currentIndex: index,
      decided,
      total: this.operations.length,
      accepted,
      rejected,
      conflicts,
      decisions: cloneDecisions(this.decisions),
      enabledOperationIds: this.operations.filter(({ id }) => this.enabledOperationIds.has(id)).map(({ id }) => id),
      candidateHandle: this.candidateHandle,
      candidateHash: this.candidateHash,
      paused: this.paused,
      followAgent: this.followAgent,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      canSave: allDecided
        && (conflicts === 0 || conflictsAreLockedKeeps)
        && this.phase !== 'saving'
        && this.phase !== 'failed',
      message: this.message,
    }
  }

  pause(): void {
    this.paused = true
    this.followAgent = false
    this.phase = 'paused'
    this.emit()
  }

  resume(): void {
    this.paused = false
    this.followAgent = true
    this.phase = 'reviewing'
    this.emit()
  }

  userNavigated(): void {
    this.paused = true
    this.followAgent = false
    this.phase = 'paused'
    this.emit()
  }

  async locate(operationId = this.currentOperationId): Promise<void> {
    if (!operationId) return
    const operation = this.requireOperation(operationId)
    this.currentOperationId = operationId
    this.paused = false
    this.followAgent = true
    this.phase = 'reviewing'
    await this.adapter.locate?.(operation)
    this.emit()
  }

  previous(): void {
    this.move(-1)
  }

  next(): void {
    this.move(1)
  }

  accept(operationId: string): Promise<ArtifactReviewState> {
    return this.enqueue(async () => {
      if (this.decisions[operationId]?.decision === 'conflict') throw new Error('ARTIFACT_OPERATION_CONFLICT')
      this.pushUndo()
      const beforeEnabled = this.enabledSignature()
      const targets = this.acceptanceClosure(operationId)
      for (const id of targets) {
        const current = this.decisions[id]
        if (current?.decision === 'conflict') continue
        this.enabledOperationIds.add(id)
        this.decisions[id] = {
          decision: 'accepted',
          decidedAt: Date.now(),
          reason: id === operationId
            ? 'user'
            : Boolean(this.requireOperation(id).atomicGroupId)
              && this.requireOperation(id).atomicGroupId === this.requireOperation(operationId).atomicGroupId
              ? 'atomic-group'
              : 'dependency',
          causedBy: operationId,
        }
      }
      if (beforeEnabled !== this.enabledSignature()) await this.rebuild()
      this.advanceAfterDecision()
      this.emit()
      return this.getState()
    })
  }

  reject(
    operationId: string,
    externalDependency?: { causedBy: string },
  ): Promise<ArtifactReviewState> {
    return this.enqueue(async () => {
      if (this.decisions[operationId]?.decision === 'conflict') throw new Error('ARTIFACT_OPERATION_CONFLICT')
      this.pushUndo()
      const rejected = this.rejectionClosure(operationId)
      for (const id of rejected) {
        if (this.decisions[id]?.decision === 'conflict') continue
        const operation = this.requireOperation(id)
        const isRequested = id === operationId
        const sameGroup = !isRequested && operation.atomicGroupId
          && operation.atomicGroupId === this.requireOperation(operationId).atomicGroupId
        this.decisions[id] = {
          decision: 'rejected',
          decidedAt: Date.now(),
          reason: isRequested ? externalDependency ? 'dependency' : 'user' : sameGroup ? 'atomic-group' : 'dependency',
          causedBy: isRequested && externalDependency ? externalDependency.causedBy : operationId,
        }
        this.enabledOperationIds.delete(id)
      }
      await this.rebuild()
      this.advanceAfterDecision()
      this.emit()
      return this.getState()
    })
  }

  acceptAll(): Promise<ArtifactReviewState> {
    return this.enqueue(async () => {
      this.pushUndo()
      const beforeEnabled = this.enabledSignature()
      const now = Date.now()
      for (const operation of this.operations) {
        if (this.decisions[operation.id]?.decision !== 'conflict') {
          this.decisions[operation.id] = { decision: 'accepted', decidedAt: now, reason: 'user' }
          this.enabledOperationIds.add(operation.id)
        }
      }
      if (beforeEnabled !== this.enabledSignature()) await this.rebuild()
      this.emit()
      return this.getState()
    })
  }

  rejectAll(): Promise<ArtifactReviewState> {
    return this.enqueue(async () => {
      this.pushUndo()
      const now = Date.now()
      for (const operation of this.operations) {
        if (this.decisions[operation.id]?.decision === 'conflict') continue
        this.decisions[operation.id] = { decision: 'rejected', decidedAt: now, reason: 'user' }
        this.enabledOperationIds.delete(operation.id)
      }
      await this.rebuild()
      this.emit()
      return this.getState()
    })
  }

  undo(): Promise<ArtifactReviewState> {
    return this.enqueue(async () => {
      const snapshot = this.undoStack.pop()
      if (!snapshot) return this.getState()
      this.redoStack.push(this.snapshot())
      const beforeEnabled = this.enabledSignature()
      this.restore(snapshot)
      this.paused = true
      this.followAgent = false
      this.phase = 'paused'
      if (beforeEnabled !== this.enabledSignature()) await this.rebuild('paused')
      this.emit()
      return this.getState()
    })
  }

  redo(): Promise<ArtifactReviewState> {
    return this.enqueue(async () => {
      const snapshot = this.redoStack.pop()
      if (!snapshot) return this.getState()
      this.undoStack.push(this.snapshot())
      const beforeEnabled = this.enabledSignature()
      this.restore(snapshot)
      this.paused = true
      this.followAgent = false
      this.phase = 'paused'
      if (beforeEnabled !== this.enabledSignature()) await this.rebuild('paused')
      this.emit()
      return this.getState()
    })
  }

  markConflict(operationId: string, message: string): void {
    this.requireOperation(operationId)
    this.pushUndo()
    this.decisions[operationId] = {
      decision: 'conflict',
      decidedAt: Date.now(),
      reason: 'conflict',
      message,
    }
    this.phase = 'conflicted'
    this.message = message
    this.emit()
  }

  save(): Promise<ArtifactReviewState> {
    return this.enqueue(async () => {
      const state = this.getState()
      if (!state.canSave) throw new Error('ARTIFACT_REVIEW_INCOMPLETE')
      if (!this.adapter.saveDraft) throw new Error('ARTIFACT_SAVE_UNAVAILABLE')
      this.phase = 'saving'
      this.emit()
      try {
        const result = await this.adapter.saveDraft(this.manifest, this.getState())
        if (result?.candidateHandle) this.candidateHandle = result.candidateHandle
        if (result?.candidateHash) this.candidateHash = result.candidateHash
        this.phase = 'saved'
        this.emit()
        return this.getState()
      } catch (error) {
        this.phase = 'failed'
        this.message = error instanceof Error ? error.message : String(error)
        this.emit()
        throw error
      }
    })
  }

  discard(): Promise<ArtifactReviewState> {
    return this.enqueue(async () => {
      await this.adapter.discardDraft?.(this.manifest)
      this.phase = 'discarded'
      this.emit()
      return this.getState()
    })
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.transaction.then(work, work)
    this.transaction = next.then(() => undefined, () => undefined)
    return next
  }

  private requireOperation(operationId: string): ArtifactOperation {
    const operation = this.byId.get(operationId)
    if (!operation) throw new Error(`ARTIFACT_OPERATION_NOT_FOUND:${operationId}`)
    return operation
  }

  private atomicClosure(initial: Set<string>): Set<string> {
    const result = new Set(initial)
    const queue = [...initial]
    while (queue.length > 0) {
      const operation = this.requireOperation(queue.shift()!)
      if (!operation.atomicGroupId) continue
      for (const id of this.groups.get(operation.atomicGroupId) ?? []) {
        if (result.has(id)) continue
        result.add(id)
        queue.push(id)
      }
    }
    return result
  }

  private rejectionClosure(operationId: string): Set<string> {
    const result = this.atomicClosure(new Set([operationId]))
    const queue = [...result]
    while (queue.length > 0) {
      const id = queue.shift()!
      for (const dependent of this.dependents.get(id) ?? []) {
        for (const expanded of this.atomicClosure(new Set([dependent]))) {
          if (result.has(expanded)) continue
          result.add(expanded)
          queue.push(expanded)
        }
      }
    }
    return result
  }

  private acceptanceClosure(operationId: string): Set<string> {
    const result = this.atomicClosure(new Set([operationId]))
    const queue = [...result]
    while (queue.length > 0) {
      const operation = this.requireOperation(queue.shift()!)
      for (const dependency of operation.dependsOn ?? []) {
        for (const expanded of this.atomicClosure(new Set([dependency]))) {
          if (result.has(expanded)) continue
          result.add(expanded)
          queue.push(expanded)
        }
      }
    }
    return result
  }

  private enabledSignature(): string {
    return this.operations.filter(({ id }) => this.enabledOperationIds.has(id)).map(({ id }) => id).join('|')
  }

  private snapshot(): ReviewSnapshot {
    return {
      decisions: cloneDecisions(this.decisions),
      enabledOperationIds: this.operations.filter(({ id }) => this.enabledOperationIds.has(id)).map(({ id }) => id),
      currentOperationId: this.currentOperationId,
    }
  }

  private restore(snapshot: ReviewSnapshot): void {
    this.decisions = cloneDecisions(snapshot.decisions)
    this.enabledOperationIds = new Set(snapshot.enabledOperationIds)
    this.currentOperationId = snapshot.currentOperationId
  }

  private pushUndo(): void {
    this.undoStack.push(this.snapshot())
    if (this.undoStack.length > 200) this.undoStack.shift()
    this.redoStack = []
  }

  private async rebuild(finalPhase: ArtifactReviewState['phase'] = 'reviewing'): Promise<void> {
    this.phase = 'rebuilding'
    this.emit()
    try {
      const enabled = this.operations.filter(({ id }) => this.enabledOperationIds.has(id)).map(({ id }) => id)
      const result = await this.adapter.rebuildCandidate(this.manifest, enabled)
      this.candidateHandle = result.candidateHandle
      this.candidateHash = result.candidateHash
      this.phase = finalPhase
      this.message = undefined
    } catch (error) {
      this.phase = 'failed'
      this.message = error instanceof Error ? error.message : String(error)
      this.emit()
      throw error
    }
  }

  private advanceAfterDecision(): void {
    const currentIndex = this.operations.findIndex(({ id }) => id === this.currentOperationId)
    const next = this.operations.slice(Math.max(0, currentIndex + 1))
      .find(({ id }) => this.decisions[id]?.decision === 'pending')
      ?? this.operations.find(({ id }) => this.decisions[id]?.decision === 'pending')
    if (next) this.currentOperationId = next.id
  }

  private move(offset: -1 | 1): void {
    const index = Math.max(0, this.operations.findIndex(({ id }) => id === this.currentOperationId))
    const next = Math.min(this.operations.length - 1, Math.max(0, index + offset))
    this.currentOperationId = this.operations[next]?.id
    this.emit()
  }

  private emit(): void {
    this.adapter.onState?.(this.getState())
  }
}
