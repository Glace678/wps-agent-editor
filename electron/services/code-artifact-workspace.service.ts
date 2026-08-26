import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getCodeLanguage } from '../../src/lib/code-languages'
import type {
  ArtifactTextMetadata,
  CodeArtifactReadRequest,
  CodeArtifactReadResult,
  CodeArtifactResolveRequest,
  CodeArtifactResolvedSnapshot,
  CodeWorkspaceArtifact,
  CodeWorkspaceInspectRequest,
  CodeWorkspaceInspectResult,
} from '../../src/types/artifact-review'

const MAX_FILES = 1_000
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_READ_CHARS = 128 * 1024
const IGNORED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.idea', '.vscode', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache',
  '.aws', '.azure', '.docker', '.gnupg', '.kube', '.ssh', '.terraform', '.vault',
  '.agents', '.claude', '.oo-cache', 'artifact-drafts', 'artifact-review-history',
  'artifact-producer-recipes', 'secrets',
])
const EXCLUDED_EXTENSIONS = new Set(['.md', '.txt', '.log'])
const SENSITIVE_EXTENSIONS = new Set([
  '.cer', '.crt', '.der', '.jks', '.key', '.kdbx', '.p12', '.pfx', '.pem',
])
const SENSITIVE_FILENAMES = new Set([
  '.netrc', '.npmrc', '.pypirc', '_netrc',
  'auth.json', 'credentials', 'credentials.json', 'custom-providers.json',
  'id_dsa', 'id_ecdsa', 'id_ed25519', 'id_rsa',
  'provider-base-urls.json', 'recent-files.json', 'secrets.json',
  'service-account.json', 'service_account.json',
])

interface RegistryEntry {
  workspaceId: string
  workspaceRoot: string
  sourcePath: string
  relativePath: string
  artifactId: string
  languageId: string
  revision: number
  sourceHash: string
  sourceDiskHash: string
  dirty: boolean
  metadata: ArtifactTextMetadata
  data?: Buffer
  size: number
}

function hash(data: Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function toBuffer(data: Uint8Array | ArrayBuffer): Buffer {
  return data instanceof ArrayBuffer
    ? Buffer.from(data)
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

function decode(data: Buffer): { text: string; hasBom: boolean } {
  const hasBom = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf
  return {
    text: new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? data.subarray(3) : data),
    hasBom,
  }
}

function textMetadata(data: Buffer, languageId: string, dirty: boolean): ArtifactTextMetadata {
  const { text, hasBom } = decode(data)
  const crlf = text.match(/\r\n/g)?.length ?? 0
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf
  return {
    encoding: 'utf-8',
    hasBom,
    eol: crlf > 0 && lf > 0 ? 'mixed' : crlf > 0 ? 'crlf' : 'lf',
    languageId,
    dirty,
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

function isSensitiveFile(filePath: string): boolean {
  const basename = path.basename(filePath).toLocaleLowerCase()
  const extension = path.extname(basename).toLocaleLowerCase()
  return basename === '.env'
    || basename.startsWith('.env.')
    || SENSITIVE_FILENAMES.has(basename)
    || SENSITIVE_EXTENSIONS.has(extension)
    || /^firebase-adminsdk.*\.json$/i.test(basename)
}

function isReviewableCodeFile(filePath: string): boolean {
  const basename = path.basename(filePath).toLocaleLowerCase()
  const extension = path.extname(basename).toLocaleLowerCase()
  if (isSensitiveFile(filePath)) return false
  if (EXCLUDED_EXTENSIONS.has(extension) && basename !== 'cmakelists.txt') return false
  return getCodeLanguage(filePath) !== null
}

function publicArtifact(entry: RegistryEntry): CodeWorkspaceArtifact {
  return {
    artifactId: entry.artifactId,
    relativePath: entry.relativePath,
    languageId: entry.languageId,
    size: entry.size,
    revision: entry.revision,
    sourceHash: entry.sourceHash,
    dirty: entry.dirty,
  }
}

export class CodeArtifactWorkspaceService {
  private readonly entries = new Map<string, RegistryEntry>()
  private readonly idsByPath = new Map<string, string>()

  async inspectWorkspace(request: CodeWorkspaceInspectRequest): Promise<CodeWorkspaceInspectResult> {
    const workspaceRoot = await fs.realpath(request.workspaceRoot)
    const rootStat = await fs.stat(workspaceRoot)
    if (!rootStat.isDirectory()) throw new Error('CODE_WORKSPACE_ROOT_NOT_DIRECTORY')
    const workspaceId = crypto.createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 24)
    let activePath: string | null = null
    let activeData: Buffer | null = null
    if (request.activeSnapshot) {
      activePath = await fs.realpath(request.activeSnapshot.sourcePath)
      if (isSensitiveFile(activePath)) throw new Error('CODE_ACTIVE_ARTIFACT_SENSITIVE')
      if (!isInside(workspaceRoot, activePath) || !isReviewableCodeFile(activePath)) {
        throw new Error('CODE_ACTIVE_ARTIFACT_OUTSIDE_WORKSPACE')
      }
      activeData = toBuffer(request.activeSnapshot.data)
      if (activeData.length > MAX_FILE_BYTES) throw new Error('CODE_ARTIFACT_TOO_LARGE')
      decode(activeData)
    }

    const discovered: RegistryEntry[] = []
    let truncated = false
    const walk = async (directory: string): Promise<void> => {
      if (truncated) return
      const children = await fs.readdir(directory, { withFileTypes: true })
      children.sort((left, right) => left.name.localeCompare(right.name))
      for (const child of children) {
        if (discovered.length >= MAX_FILES) {
          truncated = true
          return
        }
        const childPath = path.join(directory, child.name)
        if (child.isSymbolicLink()) continue
        if (child.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(child.name.toLocaleLowerCase())) await walk(childPath)
          continue
        }
        if (!child.isFile() || !isReviewableCodeFile(childPath)) continue
        const stat = await fs.stat(childPath)
        if (stat.size > MAX_FILE_BYTES) continue
        const canonicalPath = await fs.realpath(childPath)
        if (!isInside(workspaceRoot, canonicalPath)) continue
        const diskData = await fs.readFile(canonicalPath)
        const diskHash = hash(diskData)
        const isActive = activePath === canonicalPath
        const data = isActive && activeData ? activeData : diskData
        const languageId = getCodeLanguage(canonicalPath)?.language ?? 'plaintext'
        decode(data)
        const key = `${workspaceId}\u0000${canonicalPath}`
        const artifactId = this.idsByPath.get(key) ?? crypto.randomUUID()
        this.idsByPath.set(key, artifactId)
        discovered.push({
          workspaceId,
          workspaceRoot,
          sourcePath: canonicalPath,
          relativePath: path.relative(workspaceRoot, canonicalPath).split(path.sep).join('/'),
          artifactId,
          languageId,
          revision: isActive ? request.activeSnapshot!.revision : Math.trunc(stat.mtimeMs),
          sourceHash: hash(data),
          sourceDiskHash: diskHash,
          dirty: isActive ? request.activeSnapshot!.metadata.dirty : false,
          metadata: isActive
            ? { ...request.activeSnapshot!.metadata, languageId }
            : textMetadata(data, languageId, false),
          ...(isActive ? { data: Buffer.from(data) } : {}),
          size: data.length,
        })
      }
    }
    await walk(workspaceRoot)
    // Handles are capabilities for the latest inspected workspace snapshot only.
    // Revoke old-project and stale-scan handles atomically when a scan completes.
    this.entries.clear()
    for (const entry of discovered) this.entries.set(entry.artifactId, entry)
    return {
      workspaceId,
      artifacts: discovered.map(publicArtifact),
      truncated,
    }
  }

  async readArtifact(request: CodeArtifactReadRequest): Promise<CodeArtifactReadResult> {
    if (!request || typeof request !== 'object') throw new Error('CODE_ARTIFACT_READ_INVALID')
    const resolved = await this.resolveArtifact({
      artifactId: request.artifactId,
      workspaceRoot: request.workspaceRoot,
    })
    const data = toBuffer(resolved.data)
    const { text } = decode(data)
    const startOffset = request.startOffset ?? 0
    const requestedEnd = request.endOffset ?? Math.min(text.length, startOffset + MAX_READ_CHARS)
    if (!Number.isInteger(startOffset) || !Number.isInteger(requestedEnd)
      || startOffset < 0 || requestedEnd < startOffset || startOffset > text.length) {
      throw new Error('CODE_ARTIFACT_READ_RANGE_INVALID')
    }
    const endOffset = Math.min(text.length, requestedEnd, startOffset + MAX_READ_CHARS)
    return {
      artifact: resolved.artifact,
      content: text.slice(startOffset, endOffset),
      startOffset,
      endOffset,
      totalLength: text.length,
      truncated: endOffset < text.length,
    }
  }

  async resolveArtifact(request: CodeArtifactResolveRequest): Promise<CodeArtifactResolvedSnapshot> {
    if (!request || typeof request !== 'object') throw new Error('CODE_ARTIFACT_HANDLE_INVALID')
    const { artifactId } = request
    if (typeof artifactId !== 'string' || !/^[0-9a-f-]{36}$/i.test(artifactId)) {
      throw new Error('CODE_ARTIFACT_HANDLE_INVALID')
    }
    if (!request || typeof request.workspaceRoot !== 'string' || !request.workspaceRoot.trim()) {
      throw new Error('CODE_WORKSPACE_ROOT_REQUIRED')
    }
    const entry = this.entries.get(artifactId)
    if (!entry) throw new Error('CODE_ARTIFACT_HANDLE_UNKNOWN')
    const requestedWorkspaceRoot = await fs.realpath(request.workspaceRoot)
    if (requestedWorkspaceRoot !== entry.workspaceRoot) {
      throw new Error('CODE_ARTIFACT_WORKSPACE_MISMATCH')
    }
    const canonicalPath = await fs.realpath(entry.sourcePath)
    if (canonicalPath !== entry.sourcePath || !isInside(entry.workspaceRoot, canonicalPath)) {
      throw new Error('CODE_ARTIFACT_PATH_CHANGED')
    }
    const diskData = await fs.readFile(canonicalPath)
    if (hash(diskData) !== entry.sourceDiskHash) throw new Error('CODE_ARTIFACT_DISK_CHANGED')
    const data = entry.data ? Buffer.from(entry.data) : diskData
    if (hash(data) !== entry.sourceHash) throw new Error('CODE_ARTIFACT_SNAPSHOT_CHANGED')
    return {
      artifact: publicArtifact(entry),
      sourcePath: canonicalPath,
      data,
      metadata: { ...entry.metadata },
      sourceDiskHash: entry.sourceDiskHash,
    }
  }
}
