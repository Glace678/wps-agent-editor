import type { ArtifactTextMetadata } from '@/types/artifact-review'

export interface CodeBufferSnapshot {
  text: string
  metadata: ArtifactTextMetadata
}

const metadataByModelUri = new Map<string, ArtifactTextMetadata>()
const pendingByFilePath = new Map<string, CodeBufferSnapshot>()

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLocaleLowerCase()
}

export function getCodeModelMetadata(modelUri: string): ArtifactTextMetadata | undefined {
  return metadataByModelUri.get(modelUri)
}

export function setCodeModelMetadata(modelUri: string, metadata: ArtifactTextMetadata): void {
  metadataByModelUri.set(modelUri, { ...metadata })
}

export function stageCodeBufferSnapshot(filePath: string, snapshot: CodeBufferSnapshot): void {
  pendingByFilePath.set(normalizeFilePath(filePath), {
    text: snapshot.text,
    metadata: { ...snapshot.metadata },
  })
}

export function consumeCodeBufferSnapshot(filePath: string): CodeBufferSnapshot | undefined {
  const key = normalizeFilePath(filePath)
  const snapshot = pendingByFilePath.get(key)
  if (!snapshot) return undefined
  pendingByFilePath.delete(key)
  return {
    text: snapshot.text,
    metadata: { ...snapshot.metadata },
  }
}
