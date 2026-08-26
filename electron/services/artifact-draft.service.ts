import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type {
  ArtifactCandidateBuildResult,
  ArtifactDraftBatchCreateRequest,
  ArtifactDraftCreateRequest,
  ArtifactDraftManifest,
  ArtifactDraftPayload,
  ArtifactDraftSummary,
  ArtifactProducerAdapter,
  ArtifactProducerIdentity,
  ArtifactReviewCommand,
  ArtifactReviewEvent,
  ArtifactReviewState,
  ArtifactRevisionRecord,
  ArtifactSourceSnapshotStageRequest,
  ArtifactSourceSnapshotStageResult,
  ArtifactStagedInputReleaseRequest,
} from '../../src/types/artifact-review'
import {
  ArtifactReviewController,
  validateArtifactDraftManifest,
} from '../../src/lightweight-office/agent/artifact-review-controller'
import { compareArtifactCandidate, hashArtifact } from './artifact-diff.service'
import { ArtifactReviewHistoryService } from './artifact-review-history.service'
import {
  findHistoryOperationConflicts,
  rebaseHistoryCandidate,
} from './artifact-history-rebase.service'
import { normalizePath } from './file.service'

const HANDLE_PATTERN = /^[a-f\d-]{36}$/i
const MAX_CANDIDATE_SIZE = 512 * 1024 * 1024

interface CandidateEntry {
  handle: string
  filePath: string
  kind: ArtifactDraftManifest['kind']
  producer: ArtifactProducerIdentity
  hash: string
  size: number
  adapterReceipt: string
  createdAt: number
}

interface SourceSnapshotEntry {
  handle: string
  sourcePath: string
  data: Buffer
  sourceHash: string
  sourceDiskHash: string
  sourceRevision: number
  metadata: ArtifactSourceSnapshotStageRequest['metadata']
  createdAt: number
}

interface ActiveDraft {
  sourcePath: string
  originalData: Buffer
  manifest: ArtifactDraftManifest
  adapter: ArtifactProducerAdapter
  adapterReceipt: string
  controller: ArtifactReviewController
  state: ArtifactReviewState
  candidateHandles: Set<string>
  replayBaseData?: Buffer
  historyFinalData?: Buffer
}

export interface StageArtifactCandidateRequest {
  data: Buffer
  kind: ArtifactDraftManifest['kind']
  producer: ArtifactProducerIdentity
  adapterReceipt: string
}

type ArtifactReviewEventSink = (event: ArtifactReviewEvent) => void

async function atomicReplace(destination: string, data: Buffer): Promise<void> {
  const directory = path.dirname(destination)
  const temporary = path.join(directory, `.${path.basename(destination)}.${crypto.randomUUID()}.agent-review.tmp`)
  const handle = await fs.open(temporary, 'wx')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.rename(temporary, destination)
  } catch (error) {
    await fs.rm(temporary, { force: true })
    throw error
  }
}

export class ArtifactDraftService {
  private readonly root: string
  private readonly history: ArtifactReviewHistoryService
  private readonly candidates = new Map<string, CandidateEntry>()
  private readonly sourceSnapshots = new Map<string, SourceSnapshotEntry>()
  private readonly adapters = new Map<string, ArtifactProducerAdapter>()
  private readonly drafts = new Map<string, ActiveDraft>()
  private eventSink?: ArtifactReviewEventSink
  private restorePromise: Promise<void> | null = null
  private eventSuppressionDepth = 0

  constructor(options: { root?: string; history?: ArtifactReviewHistoryService } = {}) {
    this.root = options.root ?? path.join(app.getPath('userData'), 'artifact-drafts')
    this.history = options.history ?? new ArtifactReviewHistoryService()
  }

  setEventSink(sink: ArtifactReviewEventSink | undefined): void {
    this.eventSink = sink
  }

  registerAdapter(adapter: ArtifactProducerAdapter): () => void {
    if (!adapter.identity.id?.trim() || adapter.capabilities.protocolVersion !== 1) {
      throw new Error('ARTIFACT_ADAPTER_INVALID')
    }
    const key = this.adapterKey(adapter.identity)
    this.adapters.set(key, adapter)
    return () => {
      if (this.adapters.get(key) === adapter) this.adapters.delete(key)
    }
  }

  getProducerCapabilities(kind?: ArtifactDraftManifest['kind']): Array<{
    producer: ArtifactProducerIdentity
    capabilities: ArtifactProducerAdapter['capabilities']
  }> {
    return [...this.adapters.values()]
      .filter((adapter) => !kind || adapter.capabilities.kinds.includes(kind))
      .map((adapter) => ({ producer: adapter.identity, capabilities: adapter.capabilities }))
  }

  async stageCandidate(request: StageArtifactCandidateRequest): Promise<ArtifactCandidateBuildResult> {
    if (!Buffer.isBuffer(request.data) || request.data.length === 0) throw new Error('ARTIFACT_CANDIDATE_DATA_REQUIRED')
    if (request.data.length > MAX_CANDIDATE_SIZE) throw new Error('ARTIFACT_CANDIDATE_TOO_LARGE')
    if (!request.adapterReceipt?.trim()) throw new Error('ARTIFACT_ADAPTER_RECEIPT_REQUIRED')
    const handle = crypto.randomUUID()
    const directory = path.join(this.root, 'candidates')
    await fs.mkdir(directory, { recursive: true })
    const filePath = path.join(directory, `${handle}.bin`)
    await fs.writeFile(filePath, request.data, { flag: 'wx' })
    const entry: CandidateEntry = {
      handle,
      filePath,
      kind: request.kind,
      producer: request.producer,
      hash: hashArtifact(request.data),
      size: request.data.length,
      adapterReceipt: request.adapterReceipt,
      createdAt: Date.now(),
    }
    this.candidates.set(handle, entry)
    return { candidateHandle: handle, candidateHash: entry.hash, adapterReceipt: entry.adapterReceipt }
  }

  async stageSourceSnapshot(request: ArtifactSourceSnapshotStageRequest): Promise<ArtifactSourceSnapshotStageResult> {
    const sourcePath = normalizePath(request.sourcePath)
    const data = request.data instanceof ArrayBuffer
      ? Buffer.from(request.data)
      : Buffer.from(request.data.buffer, request.data.byteOffset, request.data.byteLength)
    if (data.length === 0) throw new Error('ARTIFACT_SOURCE_SNAPSHOT_REQUIRED')
    if (data.length > MAX_CANDIDATE_SIZE) throw new Error('ARTIFACT_SOURCE_SNAPSHOT_TOO_LARGE')
    if (!Number.isInteger(request.sourceRevision) || request.sourceRevision < 0) {
      throw new Error('ARTIFACT_SOURCE_REVISION_INVALID')
    }
    const diskData = await fs.readFile(sourcePath)
    const handle = crypto.randomUUID()
    const entry: SourceSnapshotEntry = {
      handle,
      sourcePath,
      data,
      sourceHash: hashArtifact(data),
      sourceDiskHash: hashArtifact(diskData),
      sourceRevision: request.sourceRevision,
      metadata: { ...request.metadata },
      createdAt: Date.now(),
    }
    this.sourceSnapshots.set(handle, entry)
    return {
      sourceSnapshotHandle: handle,
      sourceHash: entry.sourceHash,
      sourceDiskHash: entry.sourceDiskHash,
    }
  }

  async releaseStagedInputs(request: ArtifactStagedInputReleaseRequest): Promise<void> {
    const candidateHandles = request?.candidateHandles ?? []
    const sourceSnapshotHandles = request?.sourceSnapshotHandles ?? []
    if (!Array.isArray(candidateHandles) || !Array.isArray(sourceSnapshotHandles)
      || candidateHandles.length > 200 || sourceSnapshotHandles.length > 200) {
      throw new Error('ARTIFACT_STAGE_RELEASE_INVALID')
    }
    for (const handle of sourceSnapshotHandles) {
      if (typeof handle !== 'string' || !HANDLE_PATTERN.test(handle)) throw new Error('ARTIFACT_SOURCE_HANDLE_INVALID')
      this.sourceSnapshots.delete(handle)
    }
    for (const handle of candidateHandles) {
      if (typeof handle !== 'string' || !HANDLE_PATTERN.test(handle)) throw new Error('ARTIFACT_CANDIDATE_HANDLE_INVALID')
      const inUse = [...this.drafts.values()].some((draft) => draft.candidateHandles.has(handle))
      if (inUse) continue
      const candidate = this.candidates.get(handle)
      if (!candidate) continue
      this.candidates.delete(handle)
      await fs.rm(candidate.filePath, { force: true }).catch(() => {})
    }
  }

  async createDraft(request: ArtifactDraftCreateRequest): Promise<ArtifactDraftSummary> {
    const sourcePath = normalizePath(request.sourcePath)
    const existing = [...this.drafts.values()].find((draft) => (
      draft.sourcePath === sourcePath && !['saved', 'discarded'].includes(draft.state.phase)
    ))
    if (existing) throw new Error(`ARTIFACT_DRAFT_ALREADY_OPEN:${existing.manifest.draftId}`)
    const entry = await this.resolveCandidate(request.candidateHandle)
    if (entry.kind !== request.kind) throw new Error('ARTIFACT_CANDIDATE_KIND_MISMATCH')
    if (this.adapterKey(entry.producer) !== this.adapterKey(request.producer)) {
      throw new Error('ARTIFACT_CANDIDATE_PRODUCER_MISMATCH')
    }
    const adapter = this.adapters.get(this.adapterKey(request.producer))
    if (!adapter) throw new Error('ARTIFACT_PRODUCER_ADAPTER_UNAVAILABLE')
    if (!adapter.capabilities.kinds.includes(request.kind)) throw new Error('ARTIFACT_KIND_UNSUPPORTED_BY_ADAPTER')
    if (!adapter.capabilities.canRebuild || !adapter.capabilities.canPersistExecutionRefs) {
      throw new Error('ARTIFACT_ADAPTER_REPLAY_UNAVAILABLE')
    }
    if (request.operations.some((operation) => !adapter.capabilities.operationTypes.includes(operation.type))) {
      throw new Error('ARTIFACT_OPERATION_UNSUPPORTED_BY_ADAPTER')
    }
    if (request.operations.length > (adapter.capabilities.maxOperations ?? 500)) {
      throw new Error('ARTIFACT_ADAPTER_OPERATION_LIMIT')
    }

    const diskData = await fs.readFile(sourcePath)
    let originalData: Buffer = diskData
    let sourceDiskHash = hashArtifact(diskData)
    let textMetadata = request.textMetadata
    if (request.sourceSnapshotHandle) {
      const snapshot = this.sourceSnapshots.get(request.sourceSnapshotHandle)
      if (!snapshot) throw new Error('ARTIFACT_SOURCE_SNAPSHOT_UNKNOWN')
      this.sourceSnapshots.delete(request.sourceSnapshotHandle)
      if (snapshot.sourcePath !== sourcePath) throw new Error('ARTIFACT_SOURCE_SNAPSHOT_PATH_MISMATCH')
      if (snapshot.sourceRevision !== request.sourceRevision) throw new Error('ARTIFACT_SOURCE_SNAPSHOT_REVISION_MISMATCH')
      originalData = Buffer.from(snapshot.data)
      sourceDiskHash = snapshot.sourceDiskHash
      textMetadata = snapshot.metadata
    }
    const candidateData = await fs.readFile(entry.filePath)
    const sourceHash = hashArtifact(originalData)
    const manifest: ArtifactDraftManifest = {
      protocolVersion: 1,
      draftId: crypto.randomUUID(),
      runId: request.runId,
      agentId: request.agentId,
      agentName: request.agentName,
      // The source identity is derived from the trusted path argument. A model
      // supplied documentId must never redirect adapter replay to another file.
      documentId: sourcePath,
      sourceRevision: request.sourceRevision,
      sourceHash,
      sourceDiskHash,
      sourceName: path.basename(sourcePath),
      kind: request.kind,
      textMetadata,
      batchId: request.batchId,
      relativePath: request.relativePath,
      crossFileDependencies: request.crossFileDependencies,
      candidateHandle: entry.handle,
      candidateHash: entry.hash,
      producer: request.producer,
      operations: request.operations,
      createdAt: Date.now(),
    }
    validateArtifactDraftManifest(manifest)
    this.validateCrossFileDependencyTargets(manifest)
    await compareArtifactCandidate(request.kind, originalData, candidateData, request.operations)
    await adapter.openDraft(manifest)
    let adapterConfirmation: ArtifactCandidateBuildResult
    try {
      adapterConfirmation = await adapter.buildCandidate(manifest)
      if (adapterConfirmation.candidateHandle !== entry.handle || adapterConfirmation.candidateHash !== entry.hash) {
        throw new Error('ARTIFACT_INITIAL_ADAPTER_CONFIRMATION_MISMATCH')
      }
      if (!adapterConfirmation.adapterReceipt?.trim()) throw new Error('ARTIFACT_ADAPTER_RECEIPT_REQUIRED')
    } catch (error) {
      await adapter.closeDraft(manifest.draftId).catch(() => {})
      throw error
    }

    await this.persistOriginalSnapshot(manifest.draftId, originalData)
    const active = this.activateDraft({
      sourcePath,
      originalData,
      manifest,
      adapter,
      adapterReceipt: adapterConfirmation.adapterReceipt,
      candidateHandles: new Set([entry.handle]),
    })
    this.drafts.set(manifest.draftId, active)
    await this.persistDraftState(active)
    this.emit('draft-opened', manifest.draftId, { manifest, state: active.state })
    return { manifest, reviewState: active.state }
  }

  async createDraftBatch(request: ArtifactDraftBatchCreateRequest): Promise<ArtifactDraftSummary[]> {
    if (!request || !Array.isArray(request.requests) || request.requests.length < 2 || request.requests.length > 100) {
      throw new Error('ARTIFACT_DRAFT_BATCH_SIZE_INVALID')
    }
    const batchIds = new Set(request.requests.map(({ batchId }) => batchId).filter(Boolean))
    if (batchIds.size !== 1 || request.requests.some(({ kind, batchId, relativePath }) => (
      kind !== 'code' || !batchId?.trim() || !relativePath?.trim()
    ))) throw new Error('ARTIFACT_DRAFT_BATCH_INVALID')
    const relativePaths = request.requests.map(({ relativePath }) => relativePath!)
    if (new Set(relativePaths).size !== relativePaths.length) {
      throw new Error('ARTIFACT_DRAFT_BATCH_PATH_DUPLICATE')
    }

    const summaries: ArtifactDraftSummary[] = []
    this.eventSuppressionDepth += 1
    try {
      for (const item of request.requests) summaries.push(await this.createDraft(item))
    } catch (error) {
      for (const summary of [...summaries].reverse()) {
        await this.rollbackBatchDraft(summary.manifest.draftId)
      }
      const batchId = request.requests[0].batchId
      const requestPaths = new Set(request.requests.map(({ sourcePath }) => normalizePath(sourcePath)))
      const incomplete = [...this.drafts.values()]
        .filter((draft) => draft.manifest.batchId === batchId && requestPaths.has(draft.sourcePath))
        .map((draft) => draft.manifest.draftId)
      for (const draftId of incomplete.reverse()) await this.rollbackBatchDraft(draftId)
      await this.cleanupStagedBatchInputs(request.requests)
      throw error
    } finally {
      this.eventSuppressionDepth -= 1
    }
    for (const summary of summaries) {
      this.emit('draft-opened', summary.manifest.draftId, {
        manifest: summary.manifest,
        state: summary.reviewState,
      })
    }
    return summaries
  }

  getDraft(draftId: string): ArtifactDraftSummary | null {
    const active = this.drafts.get(draftId)
    return active ? { manifest: active.manifest, reviewState: active.state } : null
  }

  async findDraftByDocument(documentId: string): Promise<ArtifactDraftSummary | null> {
    await this.restorePersistedDrafts()
    const normalized = normalizePath(documentId)
    const active = [...this.drafts.values()].find((draft) => (
      draft.manifest.documentId === documentId || draft.sourcePath === normalized
    ) && !['saved', 'discarded'].includes(draft.state.phase))
    return active ? { manifest: active.manifest, reviewState: active.state } : null
  }

  async getPayload(draftId: string): Promise<ArtifactDraftPayload> {
    const active = this.requireDraft(draftId)
    const candidate = await this.resolveCandidate(active.state.candidateHandle)
    const candidateData = await fs.readFile(candidate.filePath)
    return {
      manifest: { ...active.manifest, candidateHandle: active.state.candidateHandle, candidateHash: active.state.candidateHash },
      originalData: active.originalData,
      candidateData,
    }
  }

  async command(draftId: string, command: ArtifactReviewCommand): Promise<ArtifactReviewState> {
    const active = this.requireDraft(draftId)
    const previous = active.controller.getState()
    let result: ArtifactReviewState
    switch (command.type) {
      case 'accept': result = await active.controller.accept(command.operationId); break
      case 'reject': result = await active.controller.reject(command.operationId); break
      case 'accept-all': result = await active.controller.acceptAll(); break
      case 'reject-all': result = await active.controller.rejectAll(); break
      case 'previous': active.controller.previous(); result = active.controller.getState(); break
      case 'next': active.controller.next(); result = active.controller.getState(); break
      case 'locate': await active.controller.locate(command.operationId); result = active.controller.getState(); break
      case 'pause': active.controller.pause(); result = active.controller.getState(); break
      case 'resume': active.controller.resume(); result = active.controller.getState(); break
      case 'undo': result = await active.controller.undo(); break
      case 'redo': result = await active.controller.redo(); break
      case 'save': result = await active.controller.save(); break
      case 'discard': result = await active.controller.discard(); break
    }
    const newlyRejected = command.type === 'discard'
      ? active.manifest.operations.map(({ id }) => id)
      : active.manifest.operations
        .map(({ id }) => id)
        .filter((id) => result.decisions[id]?.decision === 'rejected'
          && previous.decisions[id]?.decision !== 'rejected')
    if (newlyRejected.length > 0) {
      await this.cascadeCrossFileRejections(active.manifest, newlyRejected)
    }
    if (!['saved', 'discarded'].includes(result.phase)) await this.persistDraftState(active)
    else {
      this.drafts.delete(draftId)
      await this.deleteSessionArtifacts(draftId)
    }
    return result
  }

  listHistory(documentId: string): Promise<ArtifactRevisionRecord[]> {
    return this.history.list(normalizePath(documentId))
  }

  readHistory(documentId: string, revisionId: string): Promise<ArtifactRevisionRecord | null> {
    return this.history.read(normalizePath(documentId), revisionId)
  }

  async reopenHistory(documentId: string, revisionId: string): Promise<ArtifactDraftSummary> {
    await this.restorePersistedDrafts()
    const sourcePath = normalizePath(documentId)
    const existing = [...this.drafts.values()].find((draft) => (
      draft.sourcePath === sourcePath && !['saved', 'discarded'].includes(draft.state.phase)
    ))
    if (existing) throw new Error(`ARTIFACT_DRAFT_ALREADY_OPEN:${existing.manifest.draftId}`)
    const record = await this.history.read(sourcePath, revisionId)
    if (!record) throw new Error('ARTIFACT_HISTORY_REVISION_NOT_FOUND')
    const adapter = this.adapters.get(this.adapterKey(record.producer))
    if (!adapter?.capabilities.canRebase || !adapter.capabilities.canRebuild) {
      throw new Error('ARTIFACT_HISTORY_PRODUCER_UNAVAILABLE')
    }
    const operations = record.operations.filter((operation) => record.enabledOperationIds.includes(operation.id))
    if (operations.length === 0) throw new Error('ARTIFACT_HISTORY_HAS_NO_APPLIED_OPERATIONS')
    const [currentData, replayBaseData, recordedFinalData] = await Promise.all([
      fs.readFile(sourcePath),
      this.history.readBlob(record.sourceBlobHash),
      this.history.readBlob(record.finalBlobHash),
    ])
    if (hashArtifact(replayBaseData) !== record.sourceHash || hashArtifact(recordedFinalData) !== record.finalHash) {
      throw new Error('ARTIFACT_HISTORY_BLOB_INVALID')
    }
    const currentHash = hashArtifact(currentData)
    const conflictIds = new Set(await findHistoryOperationConflicts(
      record.kind,
      recordedFinalData,
      currentData,
      operations,
    ))
    const pendingCount = operations.length - conflictIds.size
    const staged = await this.stageCandidate({
      data: currentData,
      kind: record.kind,
      producer: record.producer,
      adapterReceipt: `history-reopen:${record.revisionId}:${crypto.randomUUID()}`,
    })
    const now = Date.now()
    const draftId = crypto.randomUUID()
    const manifest: ArtifactDraftManifest = {
      protocolVersion: 1,
      draftId,
      documentId: sourcePath,
      sourceRevision: 0,
      sourceHash: currentHash,
      sourceName: record.sourceName,
      kind: record.kind,
      candidateHandle: staged.candidateHandle,
      candidateHash: staged.candidateHash,
      producer: record.producer,
      operations,
      createdAt: now,
      reviewMode: 'history-withdrawal',
      historyRevisionId: record.revisionId,
      replayBaseHash: record.sourceHash,
      historyFinalHash: record.finalHash,
    }
    validateArtifactDraftManifest(manifest)
    const decisions = Object.fromEntries(operations.map((operation) => [operation.id, !conflictIds.has(operation.id)
      ? { decision: 'pending' as const }
      : {
          decision: 'conflict' as const,
          decidedAt: now,
          reason: 'conflict' as const,
          message: 'ARTIFACT_HISTORY_SOURCE_CHANGED',
        }]))
    const initialState: ArtifactReviewState = {
      draftId,
      documentId: sourcePath,
      sourceName: record.sourceName,
      kind: record.kind,
      phase: pendingCount > 0 ? 'reviewing' : 'conflicted',
      currentOperationId: operations[0]?.id,
      currentIndex: 0,
      decided: conflictIds.size,
      total: operations.length,
      accepted: 0,
      rejected: 0,
      conflicts: conflictIds.size,
      decisions,
      enabledOperationIds: operations.map((operation) => operation.id),
      candidateHandle: staged.candidateHandle,
      candidateHash: staged.candidateHash,
      paused: false,
      followAgent: true,
      canUndo: false,
      canRedo: false,
      canSave: false,
      message: conflictIds.size > 0 ? 'ARTIFACT_HISTORY_TARGET_CONFLICT' : undefined,
    }
    await adapter.openDraft(manifest)
    await Promise.all([
      this.persistOriginalSnapshot(draftId, currentData),
      this.persistReplayBaseSnapshot(draftId, replayBaseData),
      this.persistHistoryFinalSnapshot(draftId, recordedFinalData),
    ])
    const active = this.activateDraft({
      sourcePath,
      originalData: currentData,
      replayBaseData,
      historyFinalData: recordedFinalData,
      manifest,
      adapter,
      adapterReceipt: staged.adapterReceipt,
      candidateHandles: new Set([staged.candidateHandle]),
      initialState,
    })
    this.drafts.set(draftId, active)
    await this.persistDraftState(active)
    this.emit('draft-opened', draftId, { manifest, state: active.state })
    return { manifest, reviewState: active.state }
  }

  private activateDraft(input: {
    sourcePath: string
    originalData: Buffer
    manifest: ArtifactDraftManifest
    adapter: ArtifactProducerAdapter
    adapterReceipt: string
    candidateHandles: Set<string>
    initialState?: ArtifactReviewState
    replayBaseData?: Buffer
    historyFinalData?: Buffer
  }): ActiveDraft {
    let active!: ActiveDraft
    const controller = new ArtifactReviewController(input.manifest, {
      rebuildCandidate: async (_draft, enabledOperationIds) => {
        const result = await input.adapter.rebuildCandidate(input.manifest, enabledOperationIds, {
          replayBaseData: input.replayBaseData ?? input.originalData,
          replayBaseHash: input.manifest.replayBaseHash ?? input.manifest.sourceHash,
        })
        const rebuilt = await this.resolveCandidate(result.candidateHandle)
        if (rebuilt.hash !== result.candidateHash) throw new Error('ARTIFACT_REBUILD_HASH_MISMATCH')
        if (this.adapterKey(rebuilt.producer) !== this.adapterKey(input.manifest.producer)) {
          throw new Error('ARTIFACT_REBUILD_PRODUCER_MISMATCH')
        }
        const rebuiltData = await fs.readFile(rebuilt.filePath)
        const enabled = input.manifest.operations.filter((operation) => enabledOperationIds.includes(operation.id))
        const replayBase = input.replayBaseData ?? input.originalData
        if (enabled.length === 0) {
          if (!rebuiltData.equals(replayBase)) throw new Error('ARTIFACT_EMPTY_REBUILD_CHANGED_SOURCE')
        } else {
          await compareArtifactCandidate(input.manifest.kind, replayBase, rebuiltData, enabled)
        }
        let effectiveResult = result
        let effectiveData: Buffer = rebuiltData
        if (
          input.manifest.reviewMode === 'history-withdrawal'
          && input.historyFinalData
          && !input.historyFinalData.equals(input.originalData)
        ) {
          effectiveData = await rebaseHistoryCandidate(
            input.manifest.kind,
            input.historyFinalData,
            input.originalData,
            rebuiltData,
          )
          effectiveResult = await this.stageCandidate({
            data: effectiveData,
            kind: input.manifest.kind,
            producer: input.manifest.producer,
            adapterReceipt: `${result.adapterReceipt}:rebased:${crypto.randomUUID()}`,
          })
          active.candidateHandles.add(effectiveResult.candidateHandle)
        }
        if (input.manifest.reviewMode === 'history-withdrawal') {
          const withdrawn = input.manifest.operations.filter((operation) => !enabledOperationIds.includes(operation.id))
          if (withdrawn.length === 0) {
            if (hashArtifact(effectiveData) !== hashArtifact(input.originalData)) {
              throw new Error('ARTIFACT_HISTORY_KEEP_ALL_CHANGED_SOURCE')
            }
          } else {
            await compareArtifactCandidate(input.manifest.kind, input.originalData, effectiveData, withdrawn)
          }
        }
        active.candidateHandles.add(result.candidateHandle)
        active.adapterReceipt = effectiveResult.adapterReceipt
        this.emit('candidate-rebuilt', input.manifest.draftId, { state: active.state })
        return effectiveResult
      },
      saveDraft: async (_draft, state) => this.commitDraft(input.manifest.draftId, state),
      discardDraft: async () => this.closeDraft(input.manifest.draftId, true),
      onState: (state) => {
        if (!active) return
        active.state = state
        this.emit('state-changed', input.manifest.draftId, { state })
      },
    }, input.initialState)
    active = {
      sourcePath: input.sourcePath,
      originalData: input.originalData,
      manifest: input.manifest,
      adapter: input.adapter,
      adapterReceipt: input.adapterReceipt,
      controller,
      state: controller.getState(),
      candidateHandles: input.candidateHandles,
      replayBaseData: input.replayBaseData,
      historyFinalData: input.historyFinalData,
    }
    return active
  }

  private async restorePersistedDrafts(): Promise<void> {
    this.restorePromise ??= this.restorePersistedDraftsOnce()
    await this.restorePromise
  }

  private async restorePersistedDraftsOnce(): Promise<void> {
    const directory = path.join(this.root, 'sessions')
    const files = await fs.readdir(directory).catch(() => [])
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      let draftId = file.slice(0, -5)
      try {
        const stored = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8')) as {
          manifest: ArtifactDraftManifest
          state: ArtifactReviewState
          adapterReceipt?: string
        }
        const manifest = validateArtifactDraftManifest(stored.manifest)
        draftId = manifest.draftId
        if (this.drafts.has(draftId) || ['saved', 'discarded'].includes(stored.state.phase)) continue
        const adapter = this.adapters.get(this.adapterKey(manifest.producer))
        if (!adapter) continue
        const sourcePath = normalizePath(manifest.documentId)
        const originalData = await fs.readFile(this.originalSnapshotPath(draftId))
        if (hashArtifact(originalData) !== manifest.sourceHash) throw new Error('ARTIFACT_SESSION_SOURCE_SNAPSHOT_INVALID')
        const handles = new Set([manifest.candidateHandle, stored.state.candidateHandle])
        for (const handle of handles) {
          if (!HANDLE_PATTERN.test(handle)) throw new Error('ARTIFACT_CANDIDATE_HANDLE_INVALID')
          const filePath = path.join(this.root, 'candidates', `${handle}.bin`)
          const data = await fs.readFile(filePath)
          const expectedHash = handle === stored.state.candidateHandle
            ? stored.state.candidateHash
            : manifest.candidateHash
          if (hashArtifact(data) !== expectedHash) throw new Error('ARTIFACT_SESSION_CANDIDATE_INVALID')
          this.candidates.set(handle, {
            handle,
            filePath,
            kind: manifest.kind,
            producer: manifest.producer,
            hash: expectedHash,
            size: data.length,
            adapterReceipt: stored.adapterReceipt || `restored:${expectedHash}`,
            createdAt: manifest.createdAt,
          })
        }
        let initialState = stored.state
        const currentData = await fs.readFile(sourcePath)
        if (hashArtifact(currentData) !== (manifest.sourceDiskHash ?? manifest.sourceHash)) {
          initialState = {
            ...stored.state,
            phase: 'conflicted',
            message: 'ARTIFACT_SOURCE_EXTERNALLY_MODIFIED',
            decisions: Object.fromEntries(manifest.operations.map((operation) => [operation.id, {
              decision: 'conflict' as const,
              decidedAt: Date.now(),
              reason: 'conflict' as const,
              message: 'ARTIFACT_SOURCE_EXTERNALLY_MODIFIED',
            }])),
          }
        }
        await adapter.openDraft(manifest)
        const replayBaseData = manifest.reviewMode === 'history-withdrawal'
          ? await fs.readFile(this.replayBaseSnapshotPath(draftId))
          : undefined
        const historyFinalData = manifest.reviewMode === 'history-withdrawal'
          ? await fs.readFile(this.historyFinalSnapshotPath(draftId))
          : undefined
        if (replayBaseData && hashArtifact(replayBaseData) !== manifest.replayBaseHash) {
          throw new Error('ARTIFACT_SESSION_REPLAY_BASE_INVALID')
        }
        if (historyFinalData && hashArtifact(historyFinalData) !== manifest.historyFinalHash) {
          throw new Error('ARTIFACT_SESSION_HISTORY_FINAL_INVALID')
        }
        const active = this.activateDraft({
          sourcePath,
          originalData,
          manifest,
          adapter,
          adapterReceipt: stored.adapterReceipt || `restored:${stored.state.candidateHash}`,
          candidateHandles: handles,
          initialState,
          replayBaseData,
          historyFinalData,
        })
        this.drafts.set(draftId, active)
      } catch (error) {
        this.emit('error', draftId, { error: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  private requireDraft(draftId: string): ActiveDraft {
    const active = this.drafts.get(draftId)
    if (!active) throw new Error('ARTIFACT_DRAFT_NOT_FOUND')
    return active
  }

  private validateCrossFileDependencyTargets(manifest: ArtifactDraftManifest): void {
    if (!manifest.crossFileDependencies?.length) return
    for (const dependency of manifest.crossFileDependencies) {
      const prerequisites = [...this.drafts.values()].filter((draft) => (
        draft.manifest.batchId === manifest.batchId
        && draft.manifest.relativePath === dependency.dependsOnRelativePath
      ))
      if (prerequisites.length !== 1) {
        throw new Error(`ARTIFACT_CODE_CROSS_FILE_TARGET_UNKNOWN:${dependency.dependsOnRelativePath}`)
      }
      if (!prerequisites[0].manifest.operations.some(({ id }) => id === dependency.dependsOnOperationId)) {
        throw new Error(`ARTIFACT_CODE_CROSS_FILE_TARGET_OPERATION_UNKNOWN:${dependency.dependsOnOperationId}`)
      }
    }
  }

  private async rollbackBatchDraft(draftId: string): Promise<void> {
    const active = this.drafts.get(draftId)
    if (!active) return
    try {
      await this.command(draftId, { type: 'discard' })
      return
    } catch {
      await active.adapter.closeDraft(draftId).catch(() => {})
      await this.cleanupCandidatesForDraft(active).catch(() => {})
      this.drafts.delete(draftId)
      await this.deleteSessionArtifacts(draftId).catch(() => {})
    }
  }

  private async cleanupStagedBatchInputs(requests: ArtifactDraftCreateRequest[]): Promise<void> {
    for (const request of requests) {
      if (request.sourceSnapshotHandle) this.sourceSnapshots.delete(request.sourceSnapshotHandle)
      const inUse = [...this.drafts.values()].some((draft) => draft.candidateHandles.has(request.candidateHandle))
      if (inUse) continue
      const candidate = this.candidates.get(request.candidateHandle)
      if (!candidate) continue
      this.candidates.delete(request.candidateHandle)
      await fs.rm(candidate.filePath, { force: true }).catch(() => {})
    }
  }

  private async cascadeCrossFileRejections(
    sourceManifest: ArtifactDraftManifest,
    operationIds: string[],
  ): Promise<void> {
    if (!sourceManifest.batchId || !sourceManifest.relativePath || operationIds.length === 0) return
    const queue: Array<{ relativePath: string; operationIds: string[] }> = [{
      relativePath: sourceManifest.relativePath,
      operationIds,
    }]
    const processed = new Set<string>()
    while (queue.length > 0) {
      const source = queue.shift()!
      const rejected = new Set(source.operationIds)
      const sourceKey = `${source.relativePath}\u0000${[...rejected].sort().join('\u0000')}`
      if (processed.has(sourceKey)) continue
      processed.add(sourceKey)
      for (const target of [...this.drafts.values()]) {
        if (target.manifest.batchId !== sourceManifest.batchId
          || !target.manifest.relativePath
          || ['saved', 'discarded'].includes(target.state.phase)) continue
        const matching = (target.manifest.crossFileDependencies ?? []).filter((dependency) => (
          dependency.dependsOnRelativePath === source.relativePath
          && rejected.has(dependency.dependsOnOperationId)
        ))
        const causesByOperation = new Map<string, string>()
        for (const dependency of matching) {
          causesByOperation.set(
            dependency.operationId,
            `${source.relativePath}#${dependency.dependsOnOperationId}`,
          )
        }
        for (const [operationId, causedBy] of causesByOperation) {
          const before = target.controller.getState()
          if (['rejected', 'conflict'].includes(before.decisions[operationId]?.decision ?? '')) continue
          let after: ArtifactReviewState
          try {
            after = await target.controller.reject(operationId, { causedBy })
          } catch (error) {
            after = target.controller.getState()
            this.emit('error', target.manifest.draftId, {
              error: error instanceof Error ? error.message : String(error),
            })
          }
          await this.persistDraftState(target)
          const cascaded = target.manifest.operations
            .map(({ id }) => id)
            .filter((id) => after.decisions[id]?.decision === 'rejected'
              && before.decisions[id]?.decision !== 'rejected')
          if (cascaded.length > 0) {
            queue.push({ relativePath: target.manifest.relativePath, operationIds: cascaded })
          }
        }
      }
    }
  }

  private adapterKey(identity: ArtifactProducerIdentity): string {
    return `${identity.id}\u0000${identity.version}\u0000${identity.platform}`
  }

  private async resolveCandidate(handle: string): Promise<CandidateEntry> {
    if (!HANDLE_PATTERN.test(handle)) throw new Error('ARTIFACT_CANDIDATE_HANDLE_INVALID')
    const entry = this.candidates.get(handle)
    if (!entry) throw new Error('ARTIFACT_CANDIDATE_HANDLE_UNKNOWN')
    const stat = await fs.stat(entry.filePath).catch(() => null)
    if (!stat?.isFile() || stat.size !== entry.size) throw new Error('ARTIFACT_CANDIDATE_MISSING')
    const actualHash = hashArtifact(await fs.readFile(entry.filePath))
    if (actualHash !== entry.hash) throw new Error('ARTIFACT_CANDIDATE_TAMPERED')
    return entry
  }

  private async commitDraft(
    draftId: string,
    state: ArtifactReviewState,
  ): Promise<{ candidateHandle: string; candidateHash: string }> {
    const active = this.requireDraft(draftId)
    const confirmation = await active.adapter.buildCandidate({
      ...active.manifest,
      candidateHandle: state.candidateHandle,
      candidateHash: state.candidateHash,
    })
    const adapterMatchesCandidate = confirmation.candidateHandle === state.candidateHandle
      && confirmation.candidateHash === state.candidateHash
    const hostRebasedHistoryCandidate = active.manifest.reviewMode === 'history-withdrawal'
      && active.adapterReceipt.includes(':rebased:')
    if (!adapterMatchesCandidate && !hostRebasedHistoryCandidate) {
      throw new Error('ARTIFACT_SAVE_ADAPTER_CONFIRMATION_MISMATCH')
    }
    if (!confirmation.adapterReceipt?.trim()) throw new Error('ARTIFACT_ADAPTER_RECEIPT_REQUIRED')
    if (adapterMatchesCandidate) active.adapterReceipt = confirmation.adapterReceipt
    const [currentSource, candidate] = await Promise.all([
      fs.readFile(active.sourcePath),
      this.resolveCandidate(state.candidateHandle),
    ])
    if (hashArtifact(currentSource) !== (active.manifest.sourceDiskHash ?? active.manifest.sourceHash)) {
      throw new Error('ARTIFACT_SOURCE_EXTERNALLY_MODIFIED')
    }
    const candidateData = await fs.readFile(candidate.filePath)
    if (hashArtifact(candidateData) !== state.candidateHash) throw new Error('ARTIFACT_SAVE_CANDIDATE_HASH_MISMATCH')
    const enabled = active.manifest.operations.filter((operation) => state.enabledOperationIds.includes(operation.id))
    const comparisonBase = active.replayBaseData ?? active.originalData
    const rebasedHistory = active.manifest.reviewMode === 'history-withdrawal'
      && active.historyFinalData
      && !active.historyFinalData.equals(currentSource)
    if (!rebasedHistory) {
      if (enabled.length === 0) {
        if (!candidateData.equals(comparisonBase)) throw new Error('ARTIFACT_EMPTY_SAVE_CHANGED_SOURCE')
      } else {
        await compareArtifactCandidate(active.manifest.kind, comparisonBase, candidateData, enabled)
      }
    }
    if (active.manifest.reviewMode === 'history-withdrawal') {
      const withdrawn = active.manifest.operations.filter((operation) => !state.enabledOperationIds.includes(operation.id))
      if (withdrawn.length === 0) {
        if (!candidateData.equals(currentSource)) throw new Error('ARTIFACT_HISTORY_KEEP_ALL_CHANGED_SOURCE')
      } else {
        await compareArtifactCandidate(active.manifest.kind, currentSource, candidateData, withdrawn)
      }
    }

    let revision: ArtifactRevisionRecord | null = null
    try {
      revision = await this.history.writeRevision({
        manifest: active.manifest,
        state,
        sourceData: active.originalData,
        finalData: candidateData,
        adapterReceipt: active.adapterReceipt,
      })
      await atomicReplace(active.sourcePath, candidateData)
      const persisted = await fs.readFile(active.sourcePath)
      if (hashArtifact(persisted) !== state.candidateHash) throw new Error('ARTIFACT_ATOMIC_SAVE_VERIFY_FAILED')
    } catch (error) {
      if (revision) await this.history.deleteRevision(revision.documentId, revision.revisionId).catch(() => {})
      throw error
    }
    this.emit('draft-saved', draftId, { state, revision })
    await active.adapter.closeDraft(draftId)
    await this.cleanupCandidatesForDraft(active)
    return { candidateHandle: state.candidateHandle, candidateHash: state.candidateHash }
  }

  private async closeDraft(draftId: string, discard: boolean): Promise<void> {
    const active = this.requireDraft(draftId)
    await active.adapter.closeDraft(draftId)
    if (discard) this.emit('draft-discarded', draftId, { state: active.state })
    await this.cleanupCandidatesForDraft(active)
  }

  private async cleanupCandidatesForDraft(active: ActiveDraft): Promise<void> {
    for (const handle of active.candidateHandles) {
      const entry = this.candidates.get(handle)
      if (!entry) continue
      this.candidates.delete(handle)
      await fs.rm(entry.filePath, { force: true }).catch(() => {})
    }
  }

  private async persistDraftState(active: ActiveDraft): Promise<void> {
    const directory = path.join(this.root, 'sessions')
    await fs.mkdir(directory, { recursive: true })
    const destination = path.join(directory, `${active.manifest.draftId}.json`)
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`
    await fs.writeFile(temporary, JSON.stringify({
      manifest: active.manifest,
      state: active.state,
      adapterReceipt: active.adapterReceipt,
    }, null, 2), 'utf8')
    await fs.rename(temporary, destination)
  }

  private originalSnapshotPath(draftId: string): string {
    return path.join(this.root, 'sources', `${draftId}.bin`)
  }

  private replayBaseSnapshotPath(draftId: string): string {
    return path.join(this.root, 'sources', `${draftId}.replay.bin`)
  }

  private historyFinalSnapshotPath(draftId: string): string {
    return path.join(this.root, 'sources', `${draftId}.history-final.bin`)
  }

  private async persistOriginalSnapshot(draftId: string, data: Buffer): Promise<void> {
    const destination = this.originalSnapshotPath(draftId)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, data, { flag: 'wx' })
  }

  private async persistReplayBaseSnapshot(draftId: string, data: Buffer): Promise<void> {
    const destination = this.replayBaseSnapshotPath(draftId)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, data, { flag: 'wx' })
  }

  private async persistHistoryFinalSnapshot(draftId: string, data: Buffer): Promise<void> {
    const destination = this.historyFinalSnapshotPath(draftId)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, data, { flag: 'wx' })
  }

  private async deleteSessionArtifacts(draftId: string): Promise<void> {
    await Promise.all([
      fs.rm(path.join(this.root, 'sessions', `${draftId}.json`), { force: true }),
      fs.rm(this.originalSnapshotPath(draftId), { force: true }),
      fs.rm(this.replayBaseSnapshotPath(draftId), { force: true }),
      fs.rm(this.historyFinalSnapshotPath(draftId), { force: true }),
    ])
  }

  private emit(
    type: ArtifactReviewEvent['type'],
    draftId: string,
    extra: Partial<Omit<ArtifactReviewEvent, 'eventId' | 'type' | 'draftId' | 'timestamp'>>,
  ): void {
    if (this.eventSuppressionDepth > 0) return
    this.eventSink?.({
      eventId: `${draftId}:${type}:${Date.now()}:${crypto.randomUUID()}`,
      type,
      draftId,
      timestamp: Date.now(),
      ...extra,
    })
  }
}

let artifactDraftService: ArtifactDraftService | null = null

export function getArtifactDraftService(): ArtifactDraftService {
  artifactDraftService ??= new ArtifactDraftService()
  return artifactDraftService
}

/** Producer integration point. Renderer/model callers never receive raw paths. */
export function stageArtifactCandidate(request: StageArtifactCandidateRequest): Promise<ArtifactCandidateBuildResult> {
  return getArtifactDraftService().stageCandidate(request)
}

export function registerArtifactProducerAdapter(adapter: ArtifactProducerAdapter): () => void {
  return getArtifactDraftService().registerAdapter(adapter)
}
