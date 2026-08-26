import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type {
  ArtifactDraftManifest,
  ArtifactReviewState,
  ArtifactRevisionRecord,
} from '../../src/types/artifact-review'
import { hashArtifact } from './artifact-diff.service'

const DEFAULT_MAX_TASKS_PER_FILE = 10
const DEFAULT_GLOBAL_BUDGET = 2 * 1024 * 1024 * 1024

interface DocumentHistoryIndex {
  documentId: string
  revisionIds: string[]
}

export interface ArtifactRevisionWrite {
  manifest: ArtifactDraftManifest
  state: ArtifactReviewState
  sourceData: Buffer
  finalData: Buffer
  adapterReceipt: string
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function atomicJsonWrite(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
  await fs.rename(temporary, filePath)
}

export class ArtifactReviewHistoryService {
  private readonly root: string
  private readonly maxTasksPerFile: number
  private readonly globalBudget: number
  private transaction: Promise<unknown> = Promise.resolve()

  constructor(options: { root?: string; maxTasksPerFile?: number; globalBudget?: number } = {}) {
    this.root = options.root ?? path.join(app.getPath('userData'), 'artifact-review-history')
    this.maxTasksPerFile = options.maxTasksPerFile ?? DEFAULT_MAX_TASKS_PER_FILE
    this.globalBudget = options.globalBudget ?? DEFAULT_GLOBAL_BUDGET
  }

  writeRevision(input: ArtifactRevisionWrite): Promise<ArtifactRevisionRecord> {
    return this.serialize(async () => {
      const sourceBlobHash = hashArtifact(input.sourceData)
      const finalBlobHash = hashArtifact(input.finalData)
      if (sourceBlobHash !== input.manifest.sourceHash) throw new Error('ARTIFACT_HISTORY_SOURCE_HASH_MISMATCH')
      if (finalBlobHash !== input.state.candidateHash) throw new Error('ARTIFACT_HISTORY_FINAL_HASH_MISMATCH')
      await Promise.all([
        this.putBlob(sourceBlobHash, input.sourceData),
        this.putBlob(finalBlobHash, input.finalData),
      ])

      const now = Date.now()
      const revisionId = `${now}-${crypto.randomUUID()}`
      const record: ArtifactRevisionRecord = {
        revisionId,
        draftId: input.manifest.draftId,
        documentId: input.manifest.documentId,
        sourceName: input.manifest.sourceName,
        kind: input.manifest.kind,
        sourceHash: input.manifest.sourceHash,
        finalHash: input.state.candidateHash,
        sourceBlobHash,
        finalBlobHash,
        producer: input.manifest.producer,
        operations: input.manifest.operations,
        decisions: input.state.decisions,
        enabledOperationIds: input.state.enabledOperationIds,
        adapterReceipt: input.adapterReceipt,
        createdAt: now,
        lastAccessedAt: now,
      }
      await atomicJsonWrite(this.recordPath(record), record)

      const index = await this.readDocumentIndex(record.documentId)
      index.revisionIds = [revisionId, ...index.revisionIds.filter((id) => id !== revisionId)]
      const removed = index.revisionIds.splice(this.maxTasksPerFile)
      await atomicJsonWrite(this.documentIndexPath(record.documentId), index)
      for (const id of removed) await this.removeRecordFile(record.documentId, id)
      await this.enforceGlobalBudget()
      return record
    })
  }

  list(documentId: string): Promise<ArtifactRevisionRecord[]> {
    return this.serialize(async () => {
      const index = await this.readDocumentIndex(documentId)
      const records: ArtifactRevisionRecord[] = []
      for (const revisionId of index.revisionIds) {
        const record = await this.readRecordFile(documentId, revisionId)
        if (record) records.push(record)
      }
      return records
    })
  }

  read(documentId: string, revisionId: string): Promise<ArtifactRevisionRecord | null> {
    return this.serialize(async () => {
      const record = await this.readRecordFile(documentId, revisionId)
      if (!record) return null
      record.lastAccessedAt = Date.now()
      await atomicJsonWrite(this.recordPath(record), record)
      return record
    })
  }

  readBlob(hash: string): Promise<Buffer> {
    if (!/^[a-f\d]{64}$/i.test(hash)) return Promise.reject(new Error('ARTIFACT_BLOB_HASH_INVALID'))
    return fs.readFile(this.blobPath(hash))
  }

  deleteRevision(documentId: string, revisionId: string): Promise<void> {
    return this.serialize(async () => {
      const index = await this.readDocumentIndex(documentId)
      index.revisionIds = index.revisionIds.filter((id) => id !== revisionId)
      await atomicJsonWrite(this.documentIndexPath(documentId), index)
      await this.removeRecordFile(documentId, revisionId)
      await this.deleteUnreferencedBlobs()
    })
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.transaction.then(work, work)
    this.transaction = next.then(() => undefined, () => undefined)
    return next
  }

  private documentKey(documentId: string): string {
    return crypto.createHash('sha256').update(path.resolve(documentId).toLowerCase()).digest('hex')
  }

  private documentDir(documentId: string): string {
    return path.join(this.root, 'records', this.documentKey(documentId))
  }

  private documentIndexPath(documentId: string): string {
    return path.join(this.documentDir(documentId), 'index.json')
  }

  private recordPath(record: Pick<ArtifactRevisionRecord, 'documentId' | 'revisionId'>): string {
    return path.join(this.documentDir(record.documentId), `${record.revisionId}.json`)
  }

  private blobPath(hash: string): string {
    return path.join(this.root, 'blobs', hash.slice(0, 2), hash)
  }

  private async putBlob(hash: string, data: Buffer): Promise<void> {
    const destination = this.blobPath(hash)
    if (await exists(destination)) return
    await fs.mkdir(path.dirname(destination), { recursive: true })
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`
    await fs.writeFile(temporary, data)
    try {
      await fs.rename(temporary, destination)
    } catch (error) {
      if (!(await exists(destination))) throw error
      await fs.rm(temporary, { force: true })
    }
  }

  private async readDocumentIndex(documentId: string): Promise<DocumentHistoryIndex> {
    try {
      const value = JSON.parse(await fs.readFile(this.documentIndexPath(documentId), 'utf8')) as DocumentHistoryIndex
      if (value.documentId === documentId && Array.isArray(value.revisionIds)) return value
    } catch {
      // A missing or invalid index starts a fresh history for this file.
    }
    return { documentId, revisionIds: [] }
  }

  private async readRecordFile(documentId: string, revisionId: string): Promise<ArtifactRevisionRecord | null> {
    if (!/^[\w-]+$/.test(revisionId)) return null
    try {
      const value = JSON.parse(await fs.readFile(path.join(this.documentDir(documentId), `${revisionId}.json`), 'utf8')) as ArtifactRevisionRecord
      return value.documentId === documentId && value.revisionId === revisionId ? value : null
    } catch {
      return null
    }
  }

  private async removeRecordFile(documentId: string, revisionId: string): Promise<void> {
    if (!/^[\w-]+$/.test(revisionId)) return
    await fs.rm(path.join(this.documentDir(documentId), `${revisionId}.json`), { force: true })
  }

  private async allRecords(): Promise<ArtifactRevisionRecord[]> {
    const recordsRoot = path.join(this.root, 'records')
    let documentDirs: string[]
    try {
      documentDirs = (await fs.readdir(recordsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(recordsRoot, entry.name))
    } catch {
      return []
    }
    const records: ArtifactRevisionRecord[] = []
    for (const dir of documentDirs) {
      const files = await fs.readdir(dir).catch(() => [])
      for (const file of files) {
        if (file === 'index.json' || !file.endsWith('.json')) continue
        try {
          const record = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')) as ArtifactRevisionRecord
          if (record.revisionId && record.documentId) records.push(record)
        } catch {
          // Invalid records are excluded from the trusted history set.
        }
      }
    }
    return records
  }

  private async enforceGlobalBudget(): Promise<void> {
    let records = await this.allRecords()
    const sizes = new Map<string, number>()
    for (const hash of new Set(records.flatMap((record) => [record.sourceBlobHash, record.finalBlobHash]))) {
      const stat = await fs.stat(this.blobPath(hash)).catch(() => null)
      sizes.set(hash, stat?.size ?? 0)
    }
    const totalFor = (items: ArtifactRevisionRecord[]) => {
      const referenced = new Set(items.flatMap((record) => [record.sourceBlobHash, record.finalBlobHash]))
      return [...referenced].reduce((total, hash) => total + (sizes.get(hash) ?? 0), 0)
    }
    records.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
    while (records.length > 0 && totalFor(records) > this.globalBudget) {
      const oldest = records.shift()!
      const index = await this.readDocumentIndex(oldest.documentId)
      index.revisionIds = index.revisionIds.filter((id) => id !== oldest.revisionId)
      await atomicJsonWrite(this.documentIndexPath(oldest.documentId), index)
      await this.removeRecordFile(oldest.documentId, oldest.revisionId)
    }
    await this.deleteUnreferencedBlobs(records)
  }

  private async deleteUnreferencedBlobs(records?: ArtifactRevisionRecord[]): Promise<void> {
    const current = records ?? await this.allRecords()
    const referenced = new Set(current.flatMap((record) => [record.sourceBlobHash, record.finalBlobHash]))
    const blobsRoot = path.join(this.root, 'blobs')
    const prefixes = await fs.readdir(blobsRoot, { withFileTypes: true }).catch(() => [])
    for (const prefix of prefixes) {
      if (!prefix.isDirectory()) continue
      const dir = path.join(blobsRoot, prefix.name)
      const files = await fs.readdir(dir).catch(() => [])
      for (const file of files) {
        if (!referenced.has(file)) await fs.rm(path.join(dir, file), { force: true })
      }
    }
  }
}
