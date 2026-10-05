import type { AgentCollaborationEvent, AgentTaskResult } from '@/types/agent'
import type {
  AgentsApi,
  AppApi,
  DesktopApi,
  DesktopPlatform,
  DocumentsApi,
  FileClipboardResult,
  FileMutationResult,
  FileRevealResult,
  FileSessionState,
  FileStatInfo,
  FileVersion,
  FilesApi,
  GrantedPath,
  InvokeBody,
  OpenedFile,
  PreparedPresentationDocument,
  PreparedWordDocument,
  ProcessApi,
  ProvidersApi,
  SystemFontFace,
} from '@/types/desktop-api'
import type { AgentConfig } from '@/types/agent'
import type {
  CustomProviderConnectionTestResult,
} from '@/types/provider'
import type {
  CodexImportResult,
  ConversationRecord,
  ConversationSummary,
  PresentationEditMetadata,
  PresentationEditResponseMetadata,
} from '@/types/generated'
import { AppError } from './app-error'
import { base64ToBytes, decodeWae1, encodeWae1, toUint8Array } from './binary'
import { DESKTOP_COMMANDS } from './commands'
import {
  fromCustomProviderWire,
  fromProviderDefinitionWire,
  toCustomProviderSaveArgs,
  type CustomProviderWire,
  type ProviderDefinitionWire,
} from './provider-contract'
import {
  forgetFileGrant,
  getFileGrantId,
  registerFileGrant,
} from './grants'
import { subscribeDesktopEvent } from './subscription'
import { desktopTransport } from './transport'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

// Mirrors MAX_IMAGE_BYTES in lightweight-office/pdf/worker/wae-limits and the
// MAX_PNG_BYTES ceiling in commands/documents.rs; kept local because platform
// must not import the lightweight-office layer.
const MAX_PNG_DATA_URL_BYTES = 25 * 1024 * 1024

async function invokeDesktop<T>(
  command: string,
  args: InvokeBody | undefined,
): Promise<T> {
  return desktopTransport.invoke<T>(command, args)
}

function accessArgs(path: string): { path: string; grantId: string } {
  const grantId = getFileGrantId(path)
  if (!grantId) {
    throw new AppError({
      code: 'access-denied',
      message: 'This path has no opaque grant for the current window',
      details: { path },
    })
  }
  return { path, grantId }
}

function grantedPath(value: unknown, capability: string): GrantedPath {
  if (isRecord(value) && typeof value.path === 'string') {
    const grantId = typeof value.grantId === 'string' ? value.grantId : undefined
    if (!grantId) {
      throw new AppError({
        code: 'invalid-response',
        message: `${capability} returned a path without an opaque grant`,
        details: value,
      })
    }
    const grant: GrantedPath = { path: value.path, grantId }
    registerFileGrant(grant)
    return grant
  }
  throw new AppError({
    code: 'invalid-response',
    message: `${capability} returned an invalid path`,
    details: value,
  })
}

function optionalGrantedPath(value: unknown, capability: string): GrantedPath | null {
  return value === null || value === undefined ? null : grantedPath(value, capability)
}

function grantedItems<T extends GrantedPath>(value: unknown, capability: string): T[] {
  if (!Array.isArray(value)) {
    throw new AppError({ code: 'invalid-response', message: `${capability} returned invalid data` })
  }
  return value.map((entry) => ({ ...entry as T, ...grantedPath(entry, capability) }))
}

function openedFile(value: unknown, capability: string): OpenedFile {
  const grant = grantedPath(value, capability)
  const recent = isRecord(value) && Array.isArray(value.recent) ? value.recent : []
  return {
    ...grant,
    recent: grantedItems<OpenedFile['recent'][number]>(recent, `${capability}.recent`),
  }
}

function fileMutationResult(value: FileMutationResult, capability: string): FileMutationResult {
  if (value.path !== undefined || value.grantId !== undefined) {
    grantedPath(value, capability)
  }
  if (value.recent !== undefined) {
    value.recent = grantedItems(value.recent, `${capability}.recent`)
  }
  return value
}

function sessionState(value: unknown): FileSessionState {
  if (!isRecord(value)) {
    throw new AppError({ code: 'invalid-response', message: 'files.loadSession returned invalid data' })
  }
  const optionalPath = (candidate: unknown, capability: string): string | null => (
    candidate === null || candidate === undefined
      ? null
      : grantedPath(candidate, capability).path
  )
  const grantedPaths = (candidate: unknown, capability: string): string[] => {
    if (!Array.isArray(candidate)) {
      throw new AppError({ code: 'invalid-response', message: `${capability} returned invalid data` })
    }
    return candidate.map((entry) => grantedPath(entry, capability).path)
  }
  const activeFile = value.activeFile
  if (activeFile !== null && activeFile !== undefined && typeof activeFile !== 'string') {
    throw new AppError({ code: 'invalid-response', message: 'files.loadSession returned an invalid active file' })
  }
  return {
    mainDirectory: optionalPath(value.mainDirectory, 'files.loadSession.mainDirectory'),
    currentDirectory: optionalPath(value.currentDirectory, 'files.loadSession.currentDirectory'),
    recentDirectories: grantedPaths(
      value.recentDirectories,
      'files.loadSession.recentDirectories',
    ),
    openFiles: grantedPaths(value.openFiles, 'files.loadSession.openFiles'),
    activeFile: typeof activeFile === 'string' ? activeFile : null,
  }
}

function successResult(value: unknown): { success: boolean } {
  // Review E3: tightened from the old `value !== false` rule, which reported
  // undefined / null / strings as success whenever the backend forgot to return.
  // Accepted wire shapes (verified against the Rust command signatures):
  //  - `{ success: boolean, ... }` envelope — providers_set_base_url →
  //    ProviderBaseUrlResult
  //  - bare `true` boolean — providers_auth_set / providers_auth_remove →
  //    AppResult<bool>
  // Anything else (including a command that forgot to return) is now failure.
  if (isRecord(value)) return { success: value.success === true }
  return { success: value === true }
}

/**
 * Build a streaming channel that forwards only events matching `predicate`
 * (review R3). The chat / runTask / debugStart / terminalStart channel blocks
 * used to repeat this filter + cast shape; the predicate keeps the per-call
 * correlation key inline and removes the per-site `as unknown` (D7).
 */
function filteredChannel<T>(
  predicate: (event: unknown) => boolean,
  onEvent: (event: T) => void,
) {
  return desktopTransport.channel<T>((event: unknown) => {
    if (predicate(event)) onEvent(event as T)
  })
}

/** Minimal guard for the { summary, messages } conversation record shape. */
function assertConversationRecord(value: unknown, capability: string): asserts value is ConversationRecord {
  if (!isRecord(value) || !isRecord(value.summary) || !Array.isArray(value.messages)) {
    throw new AppError({
      code: 'invalid-response',
      message: `${capability} returned an invalid conversation record`,
      details: value,
    })
  }
}

function detectPlatform(): DesktopPlatform {
  if (typeof navigator === 'undefined') return 'unknown'
  const hint = `${navigator.platform} ${navigator.userAgent}`.toLowerCase()
  if (hint.includes('win')) return 'win32'
  if (hint.includes('mac') || hint.includes('iphone') || hint.includes('ipad')) return 'darwin'
  if (hint.includes('android')) return 'android'
  if (hint.includes('linux')) return 'linux'
  return 'unknown'
}

const platform = detectPlatform()

const files: FilesApi = {
  async list(dirPath) {
    const value = await invokeDesktop<unknown>(DESKTOP_COMMANDS.files.list, accessArgs(dirPath))
    return grantedItems(value, 'files.list')
  },
  async open(filePath) {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.files.open,
      accessArgs(filePath),
    )
    return openedFile(value, 'files.open')
  },
  async openExternal(filePath) {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.files.openExternal,
      accessArgs(filePath),
    )
    return openedFile(value, 'files.openExternal')
  },
  async search(rootPath, query) {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.files.search,
      { ...accessArgs(rootPath), query },
    )
    return grantedItems(value, 'files.search')
  },
  async getRecent() {
    const value = await invokeDesktop<unknown>(DESKTOP_COMMANDS.files.getRecent, undefined)
    return grantedItems(value, 'files.getRecent')
  },
  async getHome() {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.files.getHome,
      undefined,
    )
    return grantedPath(value, 'files.getHome')
  },
  async loadSession() {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.files.loadSession,
      undefined,
    )
    return sessionState(value)
  },
  async saveSession(session) {
    const optionalAccessArgs = (path: string | null) => path ? accessArgs(path) : null
    await invokeDesktop<void>(DESKTOP_COMMANDS.files.saveSession, {
      session: {
        mainDirectory: optionalAccessArgs(session.mainDirectory),
        currentDirectory: optionalAccessArgs(session.currentDirectory),
        recentDirectories: session.recentDirectories.map(accessArgs),
        openFiles: session.openFiles.map(accessArgs),
        activeFile: session.activeFile,
      },
    })
  },
  async selectFolder() {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.files.selectFolder,
      undefined,
    )
    return optionalGrantedPath(value, 'files.selectFolder')
  },
  async selectFile(kind) {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.files.selectFile,
      kind ? { kind } : undefined,
    )
    return optionalGrantedPath(value, 'files.selectFile')
  },
  async selectAttachments() {
    const values = await invokeDesktop<unknown[]>(
      DESKTOP_COMMANDS.files.selectAttachments,
      undefined,
    )
    return values.map((value) => grantedPath(value, 'files.selectAttachments'))
  },
  async selectSaveFile(defaultName) {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.files.selectSaveFile,
      defaultName ? { defaultName } : undefined,
    )
    return optionalGrantedPath(value, 'files.selectSaveFile')
  },
  async stat(filePath) {
    const value = await invokeDesktop<unknown>(DESKTOP_COMMANDS.files.stat, accessArgs(filePath))
    if (!isRecord(value)
      || typeof value.exists !== 'boolean'
      || typeof value.size !== 'number'
      || typeof value.modifiedAt !== 'number'
      || typeof value.createdAt !== 'number'
      || typeof value.extension !== 'string') {
      throw new AppError({ code: 'invalid-response', message: 'files.stat returned invalid data', details: value })
    }
    return value as unknown as FileStatInfo
  },
  async rename(filePath, newName) {
    const result = await invokeDesktop<FileMutationResult>(
      DESKTOP_COMMANDS.files.rename,
      { ...accessArgs(filePath), newName },
    )
    if (result.success) forgetFileGrant(filePath)
    return fileMutationResult(result, 'files.rename')
  },
  async delete(filePath) {
    const result = await invokeDesktop<FileMutationResult>(
      DESKTOP_COMMANDS.files.delete,
      accessArgs(filePath),
    )
    if (result.success) forgetFileGrant(filePath)
    return fileMutationResult(result, 'files.delete')
  },
  async showInFolder(filePath) {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.files.showInFolder,
      accessArgs(filePath),
    )
    if (!isRecord(value) || typeof value.success !== 'boolean') {
      throw new AppError({ code: 'invalid-response', message: 'files.showInFolder returned invalid data', details: value })
    }
    return value as unknown as FileRevealResult
  },
  async removeRecent(filePath) {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.files.removeRecent,
      accessArgs(filePath),
    )
    return grantedItems(value, 'files.removeRecent')
  },
  async copyToClipboard(filePaths) {
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.files.copyToClipboard,
      { files: paths.map(accessArgs) },
    )
    if (!isRecord(value) || typeof value.success !== 'boolean') {
      throw new AppError({ code: 'invalid-response', message: 'files.copyToClipboard returned invalid data', details: value })
    }
    return value as unknown as FileClipboardResult
  },
  async historyList(filePath) {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.files.historyList,
      accessArgs(filePath),
    )
    if (!Array.isArray(value)) {
      throw new AppError({ code: 'invalid-response', message: 'files.historyList returned invalid data', details: value })
    }
    for (const entry of value) {
      if (!isRecord(entry)
        || typeof entry.id !== 'string'
        || typeof entry.savedAt !== 'number'
        || typeof entry.size !== 'number') {
        throw new AppError({ code: 'invalid-response', message: 'files.historyList returned an invalid version entry', details: entry })
      }
    }
    return value as FileVersion[]
  },
  async historyRestore(filePath, versionId) {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.files.historyRestore,
      { ...accessArgs(filePath), versionId },
    )
    if (!isRecord(value) || typeof value.success !== 'boolean') {
      throw new AppError({ code: 'invalid-response', message: 'files.historyRestore returned invalid data', details: value })
    }
    return value as unknown as FileRevealResult
  },
  getGrantId: getFileGrantId,
  registerGrant: registerFileGrant,
  forgetGrant: forgetFileGrant,
  onNavigateBack(callback) {
    // Subscription adapter lives in platform/subscription.ts (review R1).
    return subscribeDesktopEvent<unknown>('file:navigate-back', callback)
  },
}

async function readBinaryEnvelope(
  command: string,
  filePath: string,
  expectsWae1 = false,
): Promise<{ bytes: Uint8Array; envelope: UnknownRecord }> {
  const value = await desktopTransport.invoke<unknown>(command, accessArgs(filePath))
  const bytes = toUint8Array(value)
  if (!expectsWae1) return { bytes, envelope: {} }
  const decoded = decodeWae1<unknown>(bytes)
  if (!isRecord(decoded.metadata)) {
    throw new AppError({ code: 'invalid-response', message: `${command} returned invalid WAE1 metadata` })
  }
  return { bytes: decoded.payload, envelope: decoded.metadata }
}

function preparedWord(bytes: Uint8Array, envelope: UnknownRecord): PreparedWordDocument {
  const converter = envelope.converter
  return {
    data: bytes,
    encoding: 'binary',
    convertedFromLegacy: envelope.convertedFromLegacy === true,
    converter: converter === 'libreoffice' || converter === 'word' || converter === 'wps'
      ? converter
      : null,
    nativeConversionFailed: envelope.nativeConversionFailed === true,
    normalizedLegacyImageCount: typeof envelope.normalizedLegacyImageCount === 'number'
      ? envelope.normalizedLegacyImageCount
      : 0,
    normalizedTableCount: typeof envelope.normalizedTableCount === 'number'
      ? envelope.normalizedTableCount
      : 0,
    removedUnderlineRunCount: typeof envelope.removedUnderlineRunCount === 'number'
      ? envelope.removedUnderlineRunCount
      : 0,
  }
}

function preparedPresentation(
  bytes: Uint8Array,
  envelope: UnknownRecord,
): PreparedPresentationDocument {
  const converter = envelope.converter
  return {
    data: bytes,
    encoding: 'binary',
    convertedFromLegacy: envelope.convertedFromLegacy === true,
    converter: converter === 'libreoffice' || converter === 'powerpoint' || converter === 'wps'
      ? converter
      : null,
    normalizedWmfCount: typeof envelope.normalizedWmfCount === 'number'
      ? envelope.normalizedWmfCount
      : 0,
  }
}

async function saveBinary(filePath: string, data: Parameters<DocumentsApi['saveBinary']>[1]) {
  const bytes = toUint8Array(data)
  const grantId = getFileGrantId(filePath)
  if (!grantId) {
    throw new AppError({
      code: 'access-denied',
      message: 'Binary writes require an opaque grant for the current window',
      details: { path: filePath },
    })
  }
  const headers: Record<string, string> = { 'x-wae-grant-id': grantId }
  await desktopTransport.invoke<void>(DESKTOP_COMMANDS.documents.saveBinary, bytes, { headers })
  return { success: true }
}

function pngDataUrlBytes(dataUrl: string): Uint8Array {
  const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl)
  if (!match) {
    throw new AppError({ code: 'invalid-argument', message: 'Expected a base64 PNG data URL' })
  }
  return base64ToBytes(match[1], MAX_PNG_DATA_URL_BYTES)
}

const documents: DocumentsApi = {
  async readFile(filePath) {
    return (await readBinaryEnvelope(DESKTOP_COMMANDS.documents.readFile, filePath)).bytes
  },
  async prepareWord(filePath) {
    const result = await readBinaryEnvelope(
      DESKTOP_COMMANDS.documents.prepareWord,
      filePath,
      true,
    )
    return preparedWord(result.bytes, result.envelope)
  },
  async preparePresentation(filePath) {
    const result = await readBinaryEnvelope(
      DESKTOP_COMMANDS.documents.preparePresentation,
      filePath,
      true,
    )
    return preparedPresentation(result.bytes, result.envelope)
  },
  async prepareSpreadsheet(filePath) {
    return (await readBinaryEnvelope(
      DESKTOP_COMMANDS.documents.prepareSpreadsheet,
      filePath,
    )).bytes
  },
  saveBinary,
  async editPresentation(request) {
    const operation = request.operation
    const reuseGrantId = operation.type === 'reuseSlides'
      ? getFileGrantId(operation.sourcePath)
      : undefined
    const editMetadata: PresentationEditMetadata = { operation, reuseGrantId }
    const response = await desktopTransport.invoke<unknown>(
      DESKTOP_COMMANDS.documents.editPresentation,
      encodeWae1(editMetadata, request.data),
    )
    const { metadata, payload } = decodeWae1<PresentationEditResponseMetadata>(response)
    if (!isRecord(metadata)) {
      throw new AppError({ code: 'invalid-response', message: 'Invalid presentation edit result' })
    }
    const slideCount = metadata.slideCount
    const currentSlideIndex = metadata.currentSlideIndex
    if (!Number.isInteger(slideCount) || !Number.isInteger(currentSlideIndex)) {
      throw new AppError({ code: 'invalid-response', message: 'Presentation edit result has invalid indices' })
    }
    return {
      slideCount,
      currentSlideIndex,
      slide: metadata.slide,
      converter: metadata.converter,
      normalizedWmfCount: metadata.normalizedWmfCount,
      data: metadata.hasData === true ? payload : undefined,
    } as Awaited<ReturnType<DocumentsApi['editPresentation']>>
  },
  async saveText(filePath, text, encoding) {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.documents.saveText,
      { ...accessArgs(filePath), text, encoding },
    )
    // Backend resolves to `{ success: true }` (commands/documents.rs).
    if (!isRecord(value) || typeof value.success !== 'boolean') {
      throw new AppError({ code: 'invalid-response', message: 'documents.saveText returned invalid data', details: value })
    }
    return { success: value.success }
  },
  async listFonts(language) {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.documents.listFonts,
      language ? { language } : undefined,
    )
    if (!Array.isArray(value)) {
      throw new AppError({ code: 'invalid-response', message: 'documents.listFonts returned invalid data', details: value })
    }
    for (const entry of value) {
      if (!isRecord(entry)
        || typeof entry.fontId !== 'string'
        || typeof entry.familyName !== 'string'
        || typeof entry.weight !== 'number') {
        throw new AppError({ code: 'invalid-response', message: 'documents.listFonts returned an invalid font entry', details: entry })
      }
    }
    return value as SystemFontFace[]
  },
  async readFont(fontId) {
    const value = await desktopTransport.invoke<unknown>(
      DESKTOP_COMMANDS.documents.readFont,
      { fontId },
    )
    return toUint8Array(value)
  },
  async copyImageToClipboard(dataUrl) {
    return desktopTransport.invoke(
      DESKTOP_COMMANDS.documents.copyImageToClipboard,
      pngDataUrlBytes(dataUrl),
    )
  },
  async setCurrentFile(filePath) {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.documents.setCurrentFile,
      filePath ? accessArgs(filePath) : { path: null },
    )
    if (!isRecord(value) || typeof value.success !== 'boolean') {
      throw new AppError({ code: 'invalid-response', message: 'documents.setCurrentFile returned invalid data', details: value })
    }
    return { success: value.success }
  },
}

const agents: AgentsApi = {
  list: async () => {
    const value = await invokeDesktop<unknown>(DESKTOP_COMMANDS.agents.list, undefined)
    if (!Array.isArray(value)) {
      throw new AppError({ code: 'invalid-response', message: 'agents.list returned invalid data', details: value })
    }
    for (const entry of value) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') {
        throw new AppError({ code: 'invalid-response', message: 'agents.list returned an invalid agent entry', details: entry })
      }
    }
    return value as AgentConfig[]
  },
  async save(agent) {
    await desktopTransport.invoke<AgentConfig>(DESKTOP_COMMANDS.agents.save, { config: agent })
    return agents.list()
  },
  async delete(agentId) {
    await desktopTransport.invoke<boolean>(DESKTOP_COMMANDS.agents.delete, { id: agentId })
    return agents.list()
  },
  conversations: {
    list: async () => {
      const value = await invokeDesktop<unknown>(
        DESKTOP_COMMANDS.agents.conversationsList,
        undefined,
      )
      if (!Array.isArray(value)) {
        throw new AppError({ code: 'invalid-response', message: 'agents.conversations.list returned invalid data', details: value })
      }
      return value as ConversationSummary[]
    },
    get: async (conversationId) => {
      const value = await invokeDesktop<unknown>(
        DESKTOP_COMMANDS.agents.conversationsGet,
        { id: conversationId },
      )
      assertConversationRecord(value, 'agents.conversations.get')
      return value
    },
    save: async (request) => {
      const value = await invokeDesktop<unknown>(
        DESKTOP_COMMANDS.agents.conversationsSave,
        { request },
      )
      assertConversationRecord(value, 'agents.conversations.save')
      return value
    },
    delete: async (conversationId) => {
      const value = await invokeDesktop<unknown>(
        DESKTOP_COMMANDS.agents.conversationsDelete,
        { id: conversationId },
      )
      if (typeof value !== 'boolean') {
        throw new AppError({ code: 'invalid-response', message: 'agents.conversations.delete returned invalid data', details: value })
      }
      return value
    },
    importCodex: async () => {
      const value = await invokeDesktop<unknown>(
        DESKTOP_COMMANDS.agents.conversationsImportCodex,
        undefined,
      )
      if (!isRecord(value)
        || typeof value.discovered !== 'number'
        || typeof value.imported !== 'number'
        || typeof value.messages !== 'number') {
        throw new AppError({ code: 'invalid-response', message: 'agents.conversations.importCodex returned invalid data', details: value })
      }
      return value as CodexImportResult
    },
  },
  async chat({ agentId, messages, conversationId, runId, onEvent }) {
    const result = await desktopTransport.invoke<AgentTaskResult | { error: string }>(DESKTOP_COMMANDS.agents.chat, {
      request: { agentId, messages, conversationId, runId },
      onEvent: filteredChannel<AgentCollaborationEvent>(
        (event) => isRecord(event) && event.runId === runId,
        onEvent,
      ),
    })
    return { runId, result }
  },
  async runTask({ agentIds, task, runId, rootAgentId, mode, onEvent }) {
    const result = await desktopTransport.invoke<AgentTaskResult[] | { error: string }>(DESKTOP_COMMANDS.agents.runTask, {
      request: { agentIds, task, runId, rootAgentId, mode },
      onEvent: filteredChannel<AgentCollaborationEvent>(
        (event) => isRecord(event) && event.runId === runId,
        onEvent,
      ),
    })
    return { runId, result }
  },
  async cancel(runId) {
    const result = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.agents.cancel,
      { runId },
    )
    return isRecord(result) ? result as Awaited<ReturnType<AgentsApi['cancel']>> : { success: result === true }
  },
  sendDocumentResult(requestId, result) {
    return invokeDesktop(
      DESKTOP_COMMANDS.agents.sendDocumentResult,
      { result: { requestId, result } },
    )
  },
  sendDocumentEvent(event) {
    return invokeDesktop(
      DESKTOP_COMMANDS.agents.sendDocumentEvent,
      { event },
    )
  },
}

const providerCore: Omit<ProvidersApi, 'auth' | 'custom'> = {
  async list(forceRefresh) {
    const values = await invokeDesktop<ProviderDefinitionWire[]>(
      DESKTOP_COMMANDS.providers.list,
      forceRefresh === undefined ? undefined : { forceRefresh },
    )
    return values.map(fromProviderDefinitionWire)
  },
  async get(providerId) {
    const value = await invokeDesktop<ProviderDefinitionWire | null>(
      DESKTOP_COMMANDS.providers.get,
      { providerId },
    )
    return value ? fromProviderDefinitionWire(value) : null
  },
  async detectOllama(baseURL) {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.providers.detectOllama,
      baseURL ? { baseUrl: baseURL } : undefined,
    )
    if (isRecord(value) && typeof value.available === 'boolean') {
      return value as Awaited<ReturnType<ProvidersApi['detectOllama']>>
    }
    const definition = fromProviderDefinitionWire(value as ProviderDefinitionWire)
    return {
      available: true,
      models: Array.isArray(definition.models) ? definition.models.map((model) => model.id) : [],
      baseURL: definition.api ?? baseURL ?? 'http://127.0.0.1:11434/v1',
    }
  },
  async setBaseURL(providerId, baseURL) {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.providers.setBaseURL,
      { input: { providerId, baseUrl: baseURL } },
    )
    return successResult(value)
  },
}

const auth: ProvidersApi['auth'] = {
  getAll: () => invokeDesktop(
    DESKTOP_COMMANDS.providers.authGetAll,
    undefined,
  ),
  async set(providerId, apiKey) {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.providers.authSet,
      { input: { providerId, apiKey } },
    )
    return successResult(value)
  },
  async remove(providerId) {
    const value = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.providers.authRemove,
      { providerId },
    )
    return successResult(value)
  },
}

const custom: ProvidersApi['custom'] = {
  async list() {
    const values = await invokeDesktop<CustomProviderWire[]>(
      DESKTOP_COMMANDS.providers.customList,
      undefined,
    )
    return values.map(fromCustomProviderWire)
  },
  async save(provider) {
    await desktopTransport.invoke<CustomProviderWire>(
      DESKTOP_COMMANDS.providers.customSave,
      toCustomProviderSaveArgs(provider),
    )
    return custom.list()
  },
  testConnection(baseURL, apiKey) {
    return invokeDesktop<CustomProviderConnectionTestResult>(
      DESKTOP_COMMANDS.providers.customTestConnection,
      { input: { baseUrl: baseURL, apiKey } },
    )
  },
  async delete(id) {
    await desktopTransport.invoke<boolean>(DESKTOP_COMMANDS.providers.customDelete, { id })
    return custom.list()
  },
}

const providers: ProvidersApi = { ...providerCore, auth, custom }

const processApi: ProcessApi = {
  probeDependencies: () => desktopTransport.invoke(DESKTOP_COMMANDS.process.probeDependencies),
  runCode: (filePath) => invokeDesktop(
    DESKTOP_COMMANDS.process.runCode,
    accessArgs(filePath),
  ),
  debugStart(sessionId, filePath, breakpoints, onEvent) {
    return desktopTransport.invoke(DESKTOP_COMMANDS.process.debugStart, {
      request: { sessionId, ...accessArgs(filePath), breakpoints },
      onEvent: filteredChannel(
        (event) => isRecord(event) && event.sessionId === sessionId,
        onEvent,
      ),
    })
  },
  debugStop: (sessionId) => invokeDesktop(
    DESKTOP_COMMANDS.process.debugStop,
    { sessionId },
  ),
  debugCommand: (sessionId, command) => invokeDesktop(
    DESKTOP_COMMANDS.process.debugCommand,
    { request: { sessionId, command } },
  ),
  debugEvaluate: (sessionId, expression, id) => invokeDesktop(
    DESKTOP_COMMANDS.process.debugEvaluate,
    { request: { sessionId, expression, id } },
  ),
  terminalStart(sessionId, options, onEvent) {
    const cwd = options?.cwd ? accessArgs(options.cwd) : undefined
    return desktopTransport.invoke(DESKTOP_COMMANDS.process.terminalStart, {
      request: {
        sessionId,
        cols: options?.cols,
        rows: options?.rows,
        ...(cwd ? { cwd: cwd.path, grantId: cwd.grantId } : {}),
      },
      onEvent: filteredChannel(
        (event) => isRecord(event) && event.sessionId === sessionId,
        onEvent,
      ),
    })
  },
  terminalWrite: (sessionId, data) => invokeDesktop(
    DESKTOP_COMMANDS.process.terminalWrite,
    { request: { sessionId, data } },
  ),
  terminalResize: (sessionId, cols, rows) => invokeDesktop(
    DESKTOP_COMMANDS.process.terminalResize,
    { request: { sessionId, cols, rows } },
  ),
  terminalKill: (sessionId) => invokeDesktop(
    DESKTOP_COMMANDS.process.terminalKill,
    { sessionId },
  ),
}

async function appVoid(
  command: string,
  args?: InvokeBody,
): Promise<void> {
  await desktopTransport.invoke(command, args)
}

// Defense-in-depth for opening external URLs. The Rust `app_open_url` command
// already restricts the scheme to http/https (src-tauri/src/commands/app.rs),
// but we re-validate on the frontend wrapper so a malformed / non-web URL never
// reaches the system opener. This hardening negates the original openUrl finding
// (the backend check made the candidate non-triggerable).
function assertSafeExternalUrl(url: string): void {
  if (typeof url !== 'string' || url.length === 0) {
    throw new AppError({ code: 'invalid-argument', message: 'openUrl requires a non-empty URL' })
  }
  // Reject embedded control characters before any URL parsing.
  if (/[\u0000-\u001f\u007f]/.test(url)) {
    throw new AppError({ code: 'invalid-argument', message: 'openUrl rejected: URL contains control characters' })
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new AppError({ code: 'invalid-argument', message: 'openUrl rejected: malformed URL' })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError({ code: 'invalid-argument', message: `openUrl rejected: unsupported scheme "${parsed.protocol}"` })
  }
}

// setLanguage / setTheme / performMenuAction / openUrl resolve here as a
// constant `{ success: true }`: these fire-and-forget mutating commands reject
// on the Rust side (AppError transport), so a resolved call already means the
// native action was acknowledged. Deliberately not routed through successResult
// (review D2 tracks surfacing backend SuccessResult envelopes for these).
const app: AppApi = {
  platform,
  async setLanguage(language) {
    await invokeDesktop(
      DESKTOP_COMMANDS.app.setLanguage,
      { language },
    )
    return { success: true }
  },
  async setTheme(preference) {
    await invokeDesktop(
      DESKTOP_COMMANDS.app.setTheme,
      { preference },
    )
    return { success: true }
  },
  async performMenuAction(action) {
    await invokeDesktop(
      DESKTOP_COMMANDS.app.performMenuAction,
      { action },
    )
    return { success: true }
  },
  minimize: () => appVoid(DESKTOP_COMMANDS.app.minimize),
  maximize: () => appVoid(DESKTOP_COMMANDS.app.maximize),
  newWindow: (filePath) => appVoid(
    DESKTOP_COMMANDS.app.newWindow,
    filePath ? accessArgs(filePath) : undefined,
  ),
  async openUrl(url) {
    assertSafeExternalUrl(url)
    await invokeDesktop(
      DESKTOP_COMMANDS.app.openUrl,
      { url },
    )
    return { success: true }
  },
  toggleFullscreen: () => appVoid(DESKTOP_COMMANDS.app.toggleFullscreen),
  close: () => appVoid(DESKTOP_COMMANDS.app.close),
  quit: () => appVoid(DESKTOP_COMMANDS.app.quit),
  checkForUpdate: async () => {
    const value = await desktopTransport.invoke<unknown>(DESKTOP_COMMANDS.app.checkForUpdate)
    if (!isRecord(value)
      || typeof value.available !== 'boolean'
      || typeof value.currentVersion !== 'string') {
      throw new AppError({ code: 'invalid-response', message: 'app.checkForUpdate returned invalid data', details: value })
    }
    return value as Awaited<ReturnType<AppApi['checkForUpdate']>>
  },
  installUpdate: () => desktopTransport.invoke(DESKTOP_COMMANDS.app.installUpdate),
  markStartupHealthy: () => desktopTransport.invoke(DESKTOP_COMMANDS.app.markStartupHealthy),
  async takeStartupFiles() {
    const values = await desktopTransport.invoke<unknown[]>(DESKTOP_COMMANDS.app.takeStartupFiles)
    return values.map((value) => grantedPath(value, 'app.takeStartupFiles'))
  },
  takeRecoveryNotices: () => desktopTransport.invoke(DESKTOP_COMMANDS.app.takeRecoveryNotices),
  listen: (channel, callback) => desktopTransport.listen(channel, callback),
}

export const desktopApi: DesktopApi = {
  files,
  documents,
  agents,
  providers,
  process: processApi,
  app,
}
