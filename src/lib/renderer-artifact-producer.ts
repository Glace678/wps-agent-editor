import type { WordEditPlanStep } from '../types/document'
import type {
  ArtifactCandidateBuildResult,
  ArtifactKind,
  ArtifactOperation,
  ArtifactProducerIdentity,
} from '../types/artifact-review'

export const RENDERER_ARTIFACT_PRODUCER: ArtifactProducerIdentity = {
  id: 'wps-renderer-office',
  version: '1.0.0',
  platform: 'renderer',
}

export type RendererArtifactRecipe =
  | { kind: 'word-step'; step: WordEditPlanStep }
  | { kind: 'excel-cell'; sheet?: string; target: string; value: string }
  | { kind: 'excel-formula'; sheet?: string; target: string; formula: string }
  | {
      kind: 'code-edit'
      startOffset: number
      endOffset: number
      beforeText: string
      afterText: string
      beforeDigest: string
      afterDigest: string
    }

export interface RendererArtifactRecipeEntry {
  executionRef: string
  recipe: RendererArtifactRecipe
}

export interface RendererArtifactStageRequest {
  data: Uint8Array | ArrayBuffer
  kind: Extract<ArtifactKind, 'word' | 'excel' | 'code'>
  recipes: RendererArtifactRecipeEntry[]
}

export interface RendererArtifactRebuildRequest {
  requestId: string
  draftId: string
  kind: Extract<ArtifactKind, 'word' | 'excel' | 'code'>
  sourceData: Uint8Array | ArrayBuffer
  sourceName: string
  operations: ArtifactOperation[]
  recipes: RendererArtifactRecipeEntry[]
}

export interface RendererArtifactProducerResult {
  requestId: string
  success: boolean
  data?: Uint8Array | ArrayBuffer
  error?: string
}

export type RendererArtifactStageResult = ArtifactCandidateBuildResult
