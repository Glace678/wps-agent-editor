import crypto from 'node:crypto'
import fs, { type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import type { Express, NextFunction, Request, Response as ExpressResponse } from 'express'
import express from 'express'
import jwt, { type JwtPayload } from 'jsonwebtoken'

const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/
const DEFAULT_MAX_CALLBACK_BYTES = 100 * 1024 * 1024
const DEFAULT_CALLBACK_TIMEOUT_MS = 30_000

const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  csv: 'text/csv; charset=utf-8',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown; charset=utf-8',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odt: 'application/vnd.oasis.opendocument.text',
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain; charset=utf-8',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
})

interface BridgeAuthContext {
  kind: 'session' | 'onlyoffice'
  claims?: JwtPayload
}

export interface BridgeDocument {
  documentId: string
  fileName: string
}

interface BridgeDocumentEntry extends BridgeDocument {
  sourcePath: string
}

export interface OnlyOfficeBridgeOptions {
  expectedDownloadOrigins: readonly string[]
  onlyOfficeJwtSecret: string
  sessionToken?: string
  maxCallbackBytes?: number
  callbackTimeoutMs?: number
  fetchImpl?: typeof fetch
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
}

export interface OnlyOfficeBridge {
  app: Express
  documents: OpenDocumentRegistry
  sessionToken: string
}

function pathKey(filePath: string): string {
  const normalized = path.normalize(filePath)
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
}

async function canonicalRegularFile(filePath: string): Promise<string> {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error('BRIDGE_DOCUMENT_PATH_INVALID')
  }
  const canonical = await fs.realpath(path.resolve(filePath))
  const stat = await fs.stat(canonical)
  if (!stat.isFile()) throw new Error('BRIDGE_DOCUMENT_NOT_REGULAR_FILE')
  const extension = path.extname(canonical).slice(1).toLocaleLowerCase()
  if (!MIME_TYPES[extension]) throw new Error('BRIDGE_DOCUMENT_TYPE_UNSUPPORTED')
  if (stat.size > DEFAULT_MAX_CALLBACK_BYTES) throw new Error('BRIDGE_DOCUMENT_TOO_LARGE')
  return canonical
}

export class OpenDocumentRegistry {
  private readonly allowedPaths = new Map<string, string>()
  private readonly canonicalKeysByInput = new Map<string, string>()
  private readonly documentsById = new Map<string, BridgeDocumentEntry>()
  private readonly idsByPath = new Map<string, string>()

  async allowOpenedDocument(filePath: string): Promise<void> {
    const canonical = await canonicalRegularFile(filePath)
    const canonicalKey = pathKey(canonical)
    this.allowedPaths.set(canonicalKey, canonical)
    this.canonicalKeysByInput.set(pathKey(path.resolve(filePath)), canonicalKey)
    this.canonicalKeysByInput.set(canonicalKey, canonicalKey)
  }

  async registerDocument(filePath: string): Promise<BridgeDocument> {
    const canonical = await canonicalRegularFile(filePath)
    const key = pathKey(canonical)
    if (this.allowedPaths.get(key) !== canonical) {
      throw new Error('BRIDGE_DOCUMENT_NOT_OPEN')
    }

    const existingId = this.idsByPath.get(key)
    if (existingId) {
      const existing = this.documentsById.get(existingId)
      if (existing) return { documentId: existing.documentId, fileName: existing.fileName }
    }

    const documentId = crypto.randomBytes(32).toString('base64url')
    const entry: BridgeDocumentEntry = {
      documentId,
      fileName: path.basename(canonical),
      sourcePath: canonical,
    }
    this.documentsById.set(documentId, entry)
    this.idsByPath.set(key, documentId)
    return { documentId, fileName: entry.fileName }
  }

  async resolveDocument(documentId: string): Promise<BridgeDocumentEntry | null> {
    if (!DOCUMENT_ID_PATTERN.test(documentId)) return null
    const entry = this.documentsById.get(documentId)
    if (!entry) return null
    try {
      const canonical = await canonicalRegularFile(entry.sourcePath)
      if (pathKey(canonical) !== pathKey(entry.sourcePath)) return null
      return entry
    } catch {
      return null
    }
  }

  async revokeOpenedDocument(filePath: string): Promise<void> {
    const inputKey = pathKey(path.resolve(filePath))
    let key = this.canonicalKeysByInput.get(inputKey)
    if (!key) {
      try {
        key = pathKey(await fs.realpath(path.resolve(filePath)))
      } catch {
        key = inputKey
      }
    }
    this.allowedPaths.delete(key)
    for (const [alias, canonicalKey] of this.canonicalKeysByInput) {
      if (canonicalKey === key) this.canonicalKeysByInput.delete(alias)
    }
    const documentId = this.idsByPath.get(key)
    if (documentId) this.releaseDocument(documentId)
  }

  releaseDocument(documentId: string): void {
    const entry = this.documentsById.get(documentId)
    if (!entry) return
    this.documentsById.delete(documentId)
    this.idsByPath.delete(pathKey(entry.sourcePath))
  }

  clear(): void {
    this.allowedPaths.clear()
    this.canonicalKeysByInput.clear()
    this.documentsById.clear()
    this.idsByPath.clear()
  }
}

export function createBridgeSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function assertStrongOnlyOfficeSecret(secret: string): string {
  if (secret.trim().length === 0 || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('ONLYOFFICE_JWT_SECRET_REQUIRED')
  }
  return secret
}

function safeTokenEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes)
}

function bearerToken(request: Request): string | null {
  const authorization = request.get('authorization')
  if (!authorization) return null
  const match = /^Bearer\s+(\S+)$/i.exec(authorization)
  return match?.[1] ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function tokenPayload(claims: JwtPayload | undefined): Record<string, unknown> | null {
  if (!claims) return null
  return isRecord(claims.payload) ? claims.payload : claims
}

function requestURL(request: Request): URL | null {
  const host = request.get('host')
  if (!host) return null
  try {
    return new URL(request.originalUrl, `${request.protocol}://${host}`)
  } catch {
    return null
  }
}

function documentClaimsMatch(request: Request, auth: BridgeAuthContext): boolean {
  if (auth.kind === 'session') return true
  const payload = tokenPayload(auth.claims)
  const claimedURL = typeof payload?.url === 'string' ? payload.url : ''
  const actualURL = requestURL(request)
  if (!claimedURL || !actualURL) return false
  try {
    const parsedClaim = new URL(claimedURL)
    return parsedClaim.protocol === actualURL.protocol
      && parsedClaim.host === actualURL.host
      && `${parsedClaim.pathname}${parsedClaim.search}` === `${actualURL.pathname}${actualURL.search}`
  } catch {
    return false
  }
}

function callbackClaimsMatch(body: Record<string, unknown>, auth: BridgeAuthContext): boolean {
  if (auth.kind === 'session') return true
  const payload = tokenPayload(auth.claims)
  if (!payload || payload.key !== body.key || payload.status !== body.status) return false
  return body.url === undefined || payload.url === body.url
}

function normalizeAllowedOrigins(origins: readonly string[]): ReadonlySet<string> {
  const normalized = new Set<string>()
  for (const value of origins) {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('BRIDGE_DOWNLOAD_ORIGIN_INVALID')
    }
    normalized.add(url.origin)
  }
  if (normalized.size === 0) throw new Error('BRIDGE_DOWNLOAD_ORIGIN_REQUIRED')
  return normalized
}

export function validateOnlyOfficeDownloadURL(
  input: string,
  allowedOrigins: ReadonlySet<string>,
): URL {
  const url = new URL(input)
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.hash
    || !allowedOrigins.has(url.origin)) {
    throw new Error('BRIDGE_DOWNLOAD_URL_REJECTED')
  }
  return url
}

async function atomicReplaceFromResponse(
  response: globalThis.Response,
  targetPath: string,
  maxBytes: number,
): Promise<void> {
  if (!('ok' in response) || !response.ok || !response.body) {
    throw new Error('BRIDGE_DOWNLOAD_FAILED')
  }
  const contentLengthHeader = response.headers.get('content-length') ?? ''
  const contentLength = /^\d+$/.test(contentLengthHeader)
    ? Number.parseInt(contentLengthHeader, 10)
    : null
  if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength > maxBytes)) {
    await response.body.cancel().catch(() => {})
    throw new Error('BRIDGE_DOWNLOAD_TOO_LARGE')
  }

  const originalStat = await fs.stat(targetPath)
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${crypto.randomBytes(16).toString('hex')}.tmp`,
  )
  let handle: FileHandle | null = null
  let completed = false
  try {
    handle = await fs.open(tempPath, 'wx', originalStat.mode & 0o777)
    const reader = response.body.getReader()
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) {
        await reader.cancel()
        throw new Error('BRIDGE_DOWNLOAD_TOO_LARGE')
      }
      await handle.write(value)
    }
    await handle.sync()
    await handle.close()
    handle = null

    const currentTarget = await fs.realpath(targetPath)
    if (pathKey(currentTarget) !== pathKey(targetPath)) {
      throw new Error('BRIDGE_DOCUMENT_PATH_CHANGED')
    }
    await fs.rename(tempPath, targetPath)
    completed = true
  } finally {
    await handle?.close().catch(() => {})
    if (!completed) await fs.unlink(tempPath).catch(() => {})
  }
}

export async function downloadOnlyOfficeDocument(options: {
  url: string
  targetPath: string
  allowedOrigins: ReadonlySet<string>
  maxBytes?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<void> {
  const downloadURL = validateOnlyOfficeDownloadURL(options.url, options.allowedOrigins)
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(downloadURL, {
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS),
  })
  await atomicReplaceFromResponse(
    response,
    options.targetPath,
    options.maxBytes ?? DEFAULT_MAX_CALLBACK_BYTES,
  )
}

function sendUnauthorized(response: ExpressResponse): void {
  response.setHeader('WWW-Authenticate', 'Bearer')
  response.status(401).json({ error: 1 })
}

function jsonErrorHandler(
  error: unknown,
  _request: Request,
  response: ExpressResponse,
  _next: NextFunction,
): void {
  if (response.headersSent) return
  const status = isRecord(error) && error.type === 'entity.too.large' ? 413 : 400
  response.status(status).json({ error: 1 })
}

export function createOnlyOfficeBridge(options: OnlyOfficeBridgeOptions): OnlyOfficeBridge {
  const sessionToken = options.sessionToken ?? createBridgeSessionToken()
  if (Buffer.byteLength(sessionToken, 'utf8') < 32) throw new Error('BRIDGE_SESSION_TOKEN_WEAK')
  const onlyOfficeSecret = assertStrongOnlyOfficeSecret(options.onlyOfficeJwtSecret)
  const allowedOrigins = normalizeAllowedOrigins(options.expectedDownloadOrigins)
  const maxCallbackBytes = options.maxCallbackBytes ?? DEFAULT_MAX_CALLBACK_BYTES
  const callbackTimeoutMs = options.callbackTimeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS
  if (!Number.isSafeInteger(maxCallbackBytes) || maxCallbackBytes <= 0) {
    throw new Error('BRIDGE_CALLBACK_LIMIT_INVALID')
  }

  const app = express()
  const documents = new OpenDocumentRegistry()
  const authContexts = new WeakMap<Request, BridgeAuthContext>()
  const writeQueues = new Map<string, Promise<void>>()
  const logger = options.logger ?? console

  app.disable('x-powered-by')
  app.use((request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const token = bearerToken(request)
    if (!token) return sendUnauthorized(response)
    if (safeTokenEqual(token, sessionToken)) {
      authContexts.set(request, { kind: 'session' })
      return next()
    }
    try {
      const claims = jwt.verify(token, onlyOfficeSecret, { algorithms: ['HS256'] })
      if (!isRecord(claims)) return sendUnauthorized(response)
      authContexts.set(request, { kind: 'onlyoffice', claims })
      return next()
    } catch {
      return sendUnauthorized(response)
    }
  })
  app.use((request, response, next) => {
    if (request.headers.origin) return response.status(403).json({ error: 1 })
    return next()
  })
  app.use(express.json({ limit: '256kb', strict: true }))

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', offline: true })
  })

  app.get('/documents/:documentId', async (request, response, next) => {
    const auth = authContexts.get(request)
    if (!auth || !documentClaimsMatch(request, auth)) return sendUnauthorized(response)
    if (Object.keys(request.query).length > 0) return response.status(400).json({ error: 1 })
    const entry = await documents.resolveDocument(request.params.documentId)
    if (!entry) return response.status(404).json({ error: 1 })
    let handle: FileHandle | null = null
    try {
      handle = await fs.open(entry.sourcePath, 'r')
      const stat = await handle.stat()
      const extension = path.extname(entry.fileName).slice(1).toLocaleLowerCase()
      response.setHeader('Content-Type', MIME_TYPES[extension] ?? 'application/octet-stream')
      response.setHeader('Content-Length', String(stat.size))
      response.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(entry.fileName)}`,
      )
      const stream = handle.createReadStream()
      handle = null
      stream.on('error', (error) => {
        if (!response.headersSent) next(error)
        else response.destroy(error)
      })
      stream.pipe(response)
      return undefined
    } catch {
      await handle?.close().catch(() => {})
      return response.status(404).json({ error: 1 })
    }
  })

  app.post('/callback/:documentId', async (request, response) => {
    if (Object.keys(request.query).length > 0) return response.status(400).json({ error: 1 })
    const auth = authContexts.get(request)
    const body = isRecord(request.body) ? request.body : null
    if (!auth || !body || !callbackClaimsMatch(body, auth)) return sendUnauthorized(response)
    const documentId = request.params.documentId
    if (body.key !== documentId || !Number.isInteger(body.status)) {
      return response.status(400).json({ error: 1 })
    }
    const entry = await documents.resolveDocument(documentId)
    if (!entry) return response.status(404).json({ error: 1 })

    const status = body.status as number
    if (status === 4) {
      documents.releaseDocument(documentId)
      return response.json({ error: 0 })
    }
    if (status !== 2 && status !== 6) return response.json({ error: 0 })
    if (typeof body.url !== 'string' || !body.url) {
      return response.status(400).json({ error: 1 })
    }

    const previous = writeQueues.get(documentId) ?? Promise.resolve()
    const write = previous.catch(() => undefined).then(async () => {
      const current = await documents.resolveDocument(documentId)
      if (!current) throw new Error('BRIDGE_DOCUMENT_NOT_FOUND')
      await downloadOnlyOfficeDocument({
        url: body.url as string,
        targetPath: current.sourcePath,
        allowedOrigins,
        maxBytes: maxCallbackBytes,
        timeoutMs: callbackTimeoutMs,
        fetchImpl: options.fetchImpl,
      })
    })
    writeQueues.set(documentId, write)
    try {
      await write
      if (status === 2) documents.releaseDocument(documentId)
      logger.info(`[Bridge] Saved document ${documentId}`)
      return response.json({ error: 0 })
    } catch (error) {
      logger.error(`[Bridge] Save failed for document ${documentId}`, error)
      return response.status(502).json({ error: 1 })
    } finally {
      if (writeQueues.get(documentId) === write) writeQueues.delete(documentId)
    }
  })

  app.use((_request, response) => response.status(404).json({ error: 1 }))
  app.use(jsonErrorHandler)

  return { app, documents, sessionToken }
}
