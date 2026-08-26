import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app, type BrowserWindow } from 'electron'
import type {
  ArtifactCandidateBuildResult,
  ArtifactDraftManifest,
  ArtifactOperation,
  ArtifactProducerAdapter,
  ArtifactProducerCapabilities,
} from '../../src/types/artifact-review'
import {
  RENDERER_ARTIFACT_PRODUCER,
  type RendererArtifactProducerResult,
  type RendererArtifactRebuildRequest,
  type RendererArtifactRecipe,
  type RendererArtifactRecipeEntry,
  type RendererArtifactStageRequest,
} from '../../src/lib/renderer-artifact-producer'
import { IPC } from '../ipc/channels'
import type { ArtifactDraftService } from './artifact-draft.service'
import { hashArtifact } from './artifact-diff.service'

const EXECUTION_REF_PATTERN = /^[a-f\d-]{36}$/i
const REBUILD_TIMEOUT_MS = 120_000

interface PendingRebuild {
  resolve: (value: Buffer) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

function toBuffer(data: Uint8Array | ArrayBuffer): Buffer {
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

function validateRecipe(recipe: RendererArtifactRecipe): void {
  if (recipe.kind === 'word-step') {
    if (!recipe.step?.id?.trim() || !recipe.step.operationId?.trim()) {
      throw new Error('ARTIFACT_WORD_RECIPE_INVALID')
    }
    return
  }
  if (recipe.kind === 'code-edit') {
    if (!Number.isInteger(recipe.startOffset) || !Number.isInteger(recipe.endOffset)
      || recipe.startOffset < 0 || recipe.endOffset < recipe.startOffset) {
      throw new Error('ARTIFACT_CODE_RECIPE_RANGE_INVALID')
    }
    if (!/^[a-f\d]{64}$/i.test(recipe.beforeDigest) || !/^[a-f\d]{64}$/i.test(recipe.afterDigest)) {
      throw new Error('ARTIFACT_CODE_RECIPE_DIGEST_INVALID')
    }
    return
  }
  if (!recipe.target?.trim()) {
    throw new Error('ARTIFACT_EXCEL_RECIPE_INVALID')
  }
  if (recipe.kind === 'excel-formula' && !recipe.formula?.trim()) {
    throw new Error('ARTIFACT_EXCEL_RECIPE_INVALID')
  }
}

/** Trusted bridge for the app's built-in SuperDoc and ExcelJS draft producers. */
export class RendererArtifactProducerAdapter implements ArtifactProducerAdapter {
  readonly identity = RENDERER_ARTIFACT_PRODUCER
  readonly capabilities: ArtifactProducerCapabilities = {
    kinds: ['word', 'excel', 'code'],
    operationTypes: [
      'insert',
      'delete',
      'replace',
      'cell',
      'formula',
      'format',
      'style',
      'merge',
      'move',
      'resize',
      'reorder',
      'structure',
      'object',
      'metadata',
      'comment',
    ],
    canRebuild: true,
    canRebase: true,
    canPersistExecutionRefs: true,
    maxOperations: 500,
    protocolVersion: 1,
  }

  private readonly root: string
  private readonly pending = new Map<string, PendingRebuild>()
  private readonly draftCandidates = new Map<string, ArtifactCandidateBuildResult>()

  constructor(
    private readonly drafts: ArtifactDraftService,
    private readonly getMainWindow: () => BrowserWindow | null,
    root?: string,
  ) {
    this.root = root ?? path.join(app.getPath('userData'), 'artifact-producer-recipes')
  }

  async stage(request: RendererArtifactStageRequest): Promise<ArtifactCandidateBuildResult> {
    const data = toBuffer(request.data)
    if (request.recipes.length === 0) throw new Error('ARTIFACT_RECIPE_REQUIRED')
    for (const entry of request.recipes) {
      if (request.kind === 'word' && entry.recipe.kind !== 'word-step') {
        throw new Error('ARTIFACT_RECIPE_KIND_MISMATCH')
      }
      if (request.kind === 'excel' && entry.recipe.kind !== 'excel-formula' && entry.recipe.kind !== 'excel-cell') {
        throw new Error('ARTIFACT_RECIPE_KIND_MISMATCH')
      }
      if (request.kind === 'code' && entry.recipe.kind !== 'code-edit') {
        throw new Error('ARTIFACT_RECIPE_KIND_MISMATCH')
      }
    }
    await this.persistRecipes(request.recipes)
    const receipt = `renderer:${hashArtifact(data)}:${crypto.randomUUID()}`
    return this.drafts.stageCandidate({
      data,
      kind: request.kind,
      producer: this.identity,
      adapterReceipt: receipt,
    })
  }

  async openDraft(manifest: ArtifactDraftManifest): Promise<void> {
    await Promise.all(manifest.operations.map((operation) => this.readRecipe(operation.executionRef)))
    this.draftCandidates.set(manifest.draftId, {
      candidateHandle: manifest.candidateHandle,
      candidateHash: manifest.candidateHash,
      adapterReceipt: `renderer-open:${manifest.candidateHash}:${crypto.randomUUID()}`,
    })
  }

  async buildCandidate(manifest: ArtifactDraftManifest): Promise<ArtifactCandidateBuildResult> {
    const candidate = this.draftCandidates.get(manifest.draftId)
    if (!candidate) throw new Error('ARTIFACT_RENDERER_DRAFT_NOT_OPEN')
    return { ...candidate }
  }

  async rebuildCandidate(
    manifest: ArtifactDraftManifest,
    enabledOperationIds: string[],
    context?: { replayBaseData?: Uint8Array | ArrayBuffer; replayBaseHash?: string },
  ): Promise<ArtifactCandidateBuildResult> {
    const enabled = new Set(enabledOperationIds)
    const operations = manifest.operations.filter((operation) => enabled.has(operation.id))
    const sourceData = context?.replayBaseData
      ? toBuffer(context.replayBaseData)
      : await fs.readFile(path.resolve(manifest.documentId))
    const expectedBaseHash = context?.replayBaseHash ?? manifest.sourceHash
    if (hashArtifact(sourceData) !== expectedBaseHash) {
      throw new Error('ARTIFACT_SOURCE_EXTERNALLY_MODIFIED')
    }
    if (operations.length === 0) {
      const result = await this.drafts.stageCandidate({
        data: sourceData,
        kind: manifest.kind,
        producer: this.identity,
        adapterReceipt: `renderer-empty:${expectedBaseHash}:${crypto.randomUUID()}`,
      })
      this.draftCandidates.set(manifest.draftId, result)
      return result
    }
    if (manifest.kind !== 'word' && manifest.kind !== 'excel' && manifest.kind !== 'code') {
      throw new Error('ARTIFACT_RENDERER_KIND_UNSUPPORTED')
    }
    const recipes = await Promise.all(operations.map(async (operation) => ({
      executionRef: operation.executionRef,
      recipe: await this.readRecipe(operation.executionRef),
    })))
    const requestId = crypto.randomUUID()
    const request: RendererArtifactRebuildRequest = {
      requestId,
      draftId: manifest.draftId,
      kind: manifest.kind,
      sourceData,
      sourceName: manifest.sourceName,
      operations,
      recipes,
    }
    const candidateData = await this.requestRendererBuild(request)
    const result = await this.drafts.stageCandidate({
      data: candidateData,
      kind: manifest.kind,
      producer: this.identity,
      adapterReceipt: `renderer-rebuild:${hashArtifact(candidateData)}:${crypto.randomUUID()}`,
    })
    this.draftCandidates.set(manifest.draftId, result)
    return result
  }

  async rebaseOperations(
    manifest: ArtifactDraftManifest,
    currentSourceHash: string,
  ): Promise<{ operations: ArtifactOperation[]; conflicts: string[] }> {
    if (currentSourceHash === manifest.sourceHash) {
      return { operations: manifest.operations, conflicts: [] }
    }
    // A changed source needs format-aware anchor validation before replay. The
    // conservative result prevents any producer recipe from overwriting edits.
    return { operations: manifest.operations, conflicts: manifest.operations.map((operation) => operation.id) }
  }

  async closeDraft(draftId: string): Promise<void> {
    this.draftCandidates.delete(draftId)
  }

  handleResult(result: RendererArtifactProducerResult): void {
    const pending = this.pending.get(result.requestId)
    if (!pending) return
    this.pending.delete(result.requestId)
    clearTimeout(pending.timer)
    if (!result.success || !result.data) {
      pending.reject(new Error(result.error || 'ARTIFACT_RENDERER_REBUILD_FAILED'))
      return
    }
    pending.resolve(toBuffer(result.data))
  }

  private async persistRecipes(entries: RendererArtifactRecipeEntry[]): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
    await Promise.all(entries.map(async ({ executionRef, recipe }) => {
      if (!EXECUTION_REF_PATTERN.test(executionRef)) throw new Error('ARTIFACT_EXECUTION_REF_INVALID')
      validateRecipe(recipe)
      const destination = path.join(this.root, `${executionRef}.json`)
      const serialized = JSON.stringify(recipe)
      const existing = await fs.readFile(destination, 'utf8').catch(() => null)
      if (existing !== null) {
        if (existing !== serialized) throw new Error('ARTIFACT_EXECUTION_REF_REUSED')
        return
      }
      const temporary = `${destination}.${crypto.randomUUID()}.tmp`
      await fs.writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx' })
      await fs.rename(temporary, destination)
    }))
  }

  private async readRecipe(executionRef: string): Promise<RendererArtifactRecipe> {
    if (!EXECUTION_REF_PATTERN.test(executionRef)) throw new Error('ARTIFACT_EXECUTION_REF_INVALID')
    const raw = await fs.readFile(path.join(this.root, `${executionRef}.json`), 'utf8')
      .catch(() => { throw new Error('ARTIFACT_EXECUTION_REF_UNKNOWN') })
    const recipe = JSON.parse(raw) as RendererArtifactRecipe
    validateRecipe(recipe)
    return recipe
  }

  private requestRendererBuild(request: RendererArtifactRebuildRequest): Promise<Buffer> {
    const window = this.getMainWindow()
    if (!window || window.isDestroyed()) throw new Error('ARTIFACT_RENDERER_UNAVAILABLE')
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId)
        reject(new Error('ARTIFACT_RENDERER_REBUILD_TIMEOUT'))
      }, REBUILD_TIMEOUT_MS)
      this.pending.set(request.requestId, { resolve, reject, timer })
      window.webContents.send(IPC.ARTIFACT_PRODUCER_REBUILD, request)
    })
  }
}
