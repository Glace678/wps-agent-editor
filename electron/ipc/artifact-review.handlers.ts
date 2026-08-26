import type { BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import { IPC } from './channels'
import { handleTrustedIpc } from './trusted-ipc'
import type {
  ArtifactDraftBatchCreateRequest,
  ArtifactDraftCreateRequest,
  ArtifactKind,
  ArtifactOperation,
  ArtifactProducerAdapter,
  ArtifactReviewCommand,
  ArtifactSourceSnapshotStageRequest,
  ArtifactStagedInputReleaseRequest,
  CodeArtifactReadRequest,
  CodeArtifactResolveRequest,
  CodeWorkspaceInspectRequest,
} from '../../src/types/artifact-review'
import { getArtifactDraftService } from '../services/artifact-draft.service'
import { CodeArtifactWorkspaceService } from '../services/code-artifact-workspace.service'
import { RendererArtifactProducerAdapter } from '../services/renderer-artifact-producer.service'
import type {
  RendererArtifactProducerResult,
  RendererArtifactStageRequest,
} from '../../src/lib/renderer-artifact-producer'

export function registerArtifactReviewHandlers(getMainWindow: () => BrowserWindow | null): void {
  const service = getArtifactDraftService()
  const codeWorkspace = new CodeArtifactWorkspaceService()
  const rendererAdapter = new RendererArtifactProducerAdapter(service, getMainWindow)
  service.registerAdapter(rendererAdapter)
  const fixtureIdentity = { id: 'artifact-e2e-fixture', version: '1.0.0', platform: 'test' }
  const fixtureFullCandidates = new Map<string, { candidateHandle: string; candidateHash: string; adapterReceipt: string }>()
  const fixtureCandidates = new Map<string, { candidateHandle: string; candidateHash: string; adapterReceipt: string }>()
  const fixtureAdapter: ArtifactProducerAdapter = {
    identity: fixtureIdentity,
    capabilities: {
      kinds: ['word', 'excel', 'pdf', 'presentation', 'code'],
      operationTypes: [
        'insert', 'delete', 'replace', 'cell', 'formula', 'format', 'style', 'merge',
        'move', 'resize', 'reorder', 'structure', 'object', 'metadata', 'comment',
      ],
      canRebuild: true,
      canRebase: true,
      canPersistExecutionRefs: true,
      maxOperations: 500,
      protocolVersion: 1,
    },
    openDraft: async (manifest) => {
      const candidate = {
        candidateHandle: manifest.candidateHandle,
        candidateHash: manifest.candidateHash,
        adapterReceipt: `fixture-open:${manifest.draftId}`,
      }
      fixtureFullCandidates.set(manifest.draftId, candidate)
      fixtureCandidates.set(manifest.draftId, candidate)
    },
    buildCandidate: async (manifest) => fixtureCandidates.get(manifest.draftId) ?? {
      candidateHandle: manifest.candidateHandle,
      candidateHash: manifest.candidateHash,
      adapterReceipt: `fixture-build:${manifest.draftId}`,
    },
    rebuildCandidate: async (manifest, enabledOperationIds, context) => {
      if (enabledOperationIds.length === manifest.operations.length) {
        const candidate = fixtureFullCandidates.get(manifest.draftId)
        if (!candidate) throw new Error('ARTIFACT_E2E_CANDIDATE_MISSING')
        fixtureCandidates.set(manifest.draftId, candidate)
        return candidate
      }
      if (enabledOperationIds.length !== 0) throw new Error('ARTIFACT_E2E_PARTIAL_REBUILD_UNSUPPORTED')
      const replayBase = context?.replayBaseData
      const baseData = replayBase instanceof ArrayBuffer
        ? Buffer.from(replayBase)
        : replayBase
          ? Buffer.from(replayBase.buffer, replayBase.byteOffset, replayBase.byteLength)
          : await fs.readFile(manifest.documentId)
      const rebuilt = await service.stageCandidate({
        data: baseData,
        kind: manifest.kind,
        producer: fixtureIdentity,
        adapterReceipt: `fixture-empty:${manifest.draftId}`,
      })
      fixtureCandidates.set(manifest.draftId, rebuilt)
      return rebuilt
    },
    rebaseOperations: async (manifest, currentSourceHash) => ({
      operations: manifest.operations,
      conflicts: currentSourceHash === manifest.sourceHash ? [] : manifest.operations.map(({ id }) => id),
    }),
    closeDraft: async (draftId) => {
      fixtureFullCandidates.delete(draftId)
      fixtureCandidates.delete(draftId)
    },
  }
  if (process.env.WPS_ARTIFACT_REVIEW_E2E === '1') service.registerAdapter(fixtureAdapter)
  const requireTrustedRenderer = (senderId: number): void => {
    const window = getMainWindow()
    if (!window || window.isDestroyed() || window.webContents.id !== senderId) {
      throw new Error('ARTIFACT_RENDERER_UNTRUSTED')
    }
  }
  service.setEventSink((event) => {
    const window = getMainWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(IPC.ARTIFACT_REVIEW_EVENT, event)
  })

  handleTrustedIpc(IPC.ARTIFACT_DRAFT_CREATE, async (_event, request: ArtifactDraftCreateRequest) => {
    return service.createDraft(request)
  })
  handleTrustedIpc(IPC.ARTIFACT_DRAFT_CREATE_BATCH, async (event, request: ArtifactDraftBatchCreateRequest) => {
    requireTrustedRenderer(event.sender.id)
    return service.createDraftBatch(request)
  })
  handleTrustedIpc(IPC.ARTIFACT_DRAFT_GET, async (_event, draftId: string) => {
    return service.getDraft(draftId)
  })
  handleTrustedIpc(IPC.ARTIFACT_DRAFT_FIND, async (_event, documentId: string) => {
    return service.findDraftByDocument(documentId)
  })
  handleTrustedIpc(IPC.ARTIFACT_DRAFT_PAYLOAD, async (_event, draftId: string) => {
    return service.getPayload(draftId)
  })
  handleTrustedIpc(
    IPC.ARTIFACT_REVIEW_COMMAND,
    async (_event, draftId: string, command: ArtifactReviewCommand) => service.command(draftId, command),
  )
  handleTrustedIpc(IPC.ARTIFACT_HISTORY_LIST, async (_event, documentId: string) => {
    return service.listHistory(documentId)
  })
  handleTrustedIpc(IPC.ARTIFACT_HISTORY_READ, async (_event, documentId: string, revisionId: string) => {
    return service.readHistory(documentId, revisionId)
  })
  handleTrustedIpc(IPC.ARTIFACT_HISTORY_REOPEN, async (_event, documentId: string, revisionId: string) => {
    return service.reopenHistory(documentId, revisionId)
  })
  handleTrustedIpc(IPC.ARTIFACT_PRODUCER_CAPABILITIES, async (_event, kind?: ArtifactDraftCreateRequest['kind']) => {
    return service.getProducerCapabilities(kind)
  })
  handleTrustedIpc(IPC.ARTIFACT_PRODUCER_STAGE, async (event, request: RendererArtifactStageRequest) => {
    requireTrustedRenderer(event.sender.id)
    return rendererAdapter.stage(request)
  })
  handleTrustedIpc(IPC.ARTIFACT_SOURCE_STAGE, async (event, request: ArtifactSourceSnapshotStageRequest) => {
    requireTrustedRenderer(event.sender.id)
    return service.stageSourceSnapshot(request)
  })
  handleTrustedIpc(IPC.ARTIFACT_STAGE_RELEASE, async (event, request: ArtifactStagedInputReleaseRequest) => {
    requireTrustedRenderer(event.sender.id)
    await service.releaseStagedInputs(request)
    return { success: true as const }
  })
  handleTrustedIpc(IPC.ARTIFACT_PRODUCER_RESULT, async (event, result: RendererArtifactProducerResult) => {
    requireTrustedRenderer(event.sender.id)
    rendererAdapter.handleResult(result)
    return { success: true }
  })
  handleTrustedIpc(IPC.CODE_WORKSPACE_INSPECT, async (event, request: CodeWorkspaceInspectRequest) => {
    requireTrustedRenderer(event.sender.id)
    return codeWorkspace.inspectWorkspace(request)
  })
  handleTrustedIpc(IPC.CODE_ARTIFACT_READ, async (event, request: CodeArtifactReadRequest) => {
    requireTrustedRenderer(event.sender.id)
    return codeWorkspace.readArtifact(request)
  })
  handleTrustedIpc(IPC.CODE_ARTIFACT_RESOLVE, async (event, request: CodeArtifactResolveRequest) => {
    requireTrustedRenderer(event.sender.id)
    return codeWorkspace.resolveArtifact(request)
  })
  handleTrustedIpc(IPC.ARTIFACT_E2E_CREATE, async (
    event,
    request: {
      sourcePath: string
      kind: ArtifactKind
      candidateData: Uint8Array | ArrayBuffer
      operations: ArtifactOperation[]
      textMetadata?: ArtifactDraftCreateRequest['textMetadata']
    },
  ) => {
    requireTrustedRenderer(event.sender.id)
    if (process.env.WPS_ARTIFACT_REVIEW_E2E !== '1') throw new Error('ARTIFACT_E2E_DISABLED')
    const candidateData = request.candidateData instanceof ArrayBuffer
      ? Buffer.from(request.candidateData)
      : Buffer.from(request.candidateData.buffer, request.candidateData.byteOffset, request.candidateData.byteLength)
    const staged = await service.stageCandidate({
      data: candidateData,
      kind: request.kind,
      producer: fixtureIdentity,
      adapterReceipt: `fixture-initial:${Date.now()}`,
    })
    return service.createDraft({
      sourcePath: request.sourcePath,
      kind: request.kind,
      candidateHandle: staged.candidateHandle,
      sourceRevision: 0,
      producer: fixtureIdentity,
      operations: request.operations,
      textMetadata: request.textMetadata,
      agentName: 'Fixture Agent',
    })
  })
}
