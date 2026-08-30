import type { AgentCollaborationEvent } from '@/types/agent'
import type {
  AgentsApi,
  AppApi,
  DesktopApi,
  DesktopChannel,
  DesktopPlatform,
  DocumentsApi,
  FileMutationResult,
  FileSessionState,
  FilesApi,
  GrantedPath,
  InvokeBody,
  OpenedFile,
  PreparedPresentationDocument,
  PreparedWordDocument,
  ProcessApi,
  ProvidersApi,
} from '@/types/desktop-api'
import type { AgentConfig } from '@/types/agent'
import type {
  CustomProviderConnectionTestResult,
} from '@/types/provider'
import type {
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
  captureFileGrants,
  forgetFileGrant,
  getFileGrantId,
  registerFileGrant,
} from './grants'
import { desktopTransport } from './transport'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

async function invokeDesktop<T>(
  command: string,
  args: InvokeBody | undefined,
): Promise<T> {
  const result = await desktopTransport.invoke<T>(command, args)
  captureFileGrants(result)
  return result
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

function openedFile(value: unknown, capability: string): OpenedFile {
  const grant = grantedPath(value, capability)
  const recent = isRecord(value) && Array.isArray(value.recent) ? value.recent : []
  captureFileGrants(recent)
  return { ...grant, recent: recent as OpenedFile['recent'] }
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
  if (isRecord(value) && typeof value.success === 'boolean') return { success: value.success }
  return { success: value !== false }
}

function eventSubscription(
  channel: string,
  callback: (...args: unknown[]) => void,
): () => void {
  if (HIGH_FREQUENCY_CHANNELS.has(channel)) {
    return subscribeHighFrequency(channel, callback)
  }

  let disposed = false
  let unlisten: (() => void) | undefined
  void desktopTransport.listen<unknown>(channel, (payload) => callback(payload)).then((dispose) => {
    if (disposed) dispose()
    else unlisten = dispose
  }).catch((error: unknown) => {
    console.error(`[desktop-api] Failed to listen to ${channel}`, AppError.from(error))
  })
  return () => {
    disposed = true
    unlisten?.()
  }
}

const HIGH_FREQUENCY_CHANNELS = new Set([
  'agent:event',
  'lw:terminal-event',
  'lw:debug-event',
])
const highFrequencySubscribers = new Map<string, Set<(...args: unknown[]) => void>>()

function subscribeHighFrequency(
  name: string,
  callback: (...args: unknown[]) => void,
): () => void {
  let subscribers = highFrequencySubscribers.get(name)
  if (!subscribers) {
    subscribers = new Set()
    highFrequencySubscribers.set(name, subscribers)
  }
  subscribers.add(callback)
  return () => {
    subscribers?.delete(callback)
    if (subscribers?.size === 0) highFrequencySubscribers.delete(name)
  }
}

function highFrequencyChannel<T>(name: string): DesktopChannel<T> {
  const channel = desktopTransport.channel<unknown>((payload) => {
    for (const subscriber of highFrequencySubscribers.get(name) ?? []) {
      subscriber(payload)
    }
  })
  return channel as DesktopChannel<T>
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
    return invokeDesktop(DESKTOP_COMMANDS.files.list, accessArgs(dirPath))
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
    return invokeDesktop(
      DESKTOP_COMMANDS.files.search,
      { ...accessArgs(rootPath), query },
    )
  },
  async getRecent() {
    return invokeDesktop(DESKTOP_COMMANDS.files.getRecent, undefined)
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
  stat(filePath) {
    return invokeDesktop(DESKTOP_COMMANDS.files.stat, accessArgs(filePath))
  },
  async rename(filePath, newName) {
    const result = await invokeDesktop<FileMutationResult>(
      DESKTOP_COMMANDS.files.rename,
      { ...accessArgs(filePath), newName },
    )
    if (result.success) forgetFileGrant(filePath)
    captureFileGrants(result)
    return result
  },
  async delete(filePath) {
    const result = await invokeDesktop<FileMutationResult>(
      DESKTOP_COMMANDS.files.delete,
      accessArgs(filePath),
    )
    if (result.success) forgetFileGrant(filePath)
    return result
  },
  showInFolder(filePath) {
    return invokeDesktop(
      DESKTOP_COMMANDS.files.showInFolder,
      accessArgs(filePath),
    )
  },
  removeRecent(filePath) {
    return invokeDesktop(
      DESKTOP_COMMANDS.files.removeRecent,
      accessArgs(filePath),
    )
  },
  copyToClipboard(filePaths) {
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
    return invokeDesktop(
      DESKTOP_COMMANDS.files.copyToClipboard,
      { files: paths.map(accessArgs) },
    )
  },
  historyList(filePath) {
    return invokeDesktop(
      DESKTOP_COMMANDS.files.historyList,
      accessArgs(filePath),
    )
  },
  historyRestore(filePath, versionId) {
    return invokeDesktop(
      DESKTOP_COMMANDS.files.historyRestore,
      { ...accessArgs(filePath), versionId },
    )
  },
  getGrantId: getFileGrantId,
  registerGrant: registerFileGrant,
  forgetGrant: forgetFileGrant,
  onNavigateBack(callback) {
    return eventSubscription('file:navigate-back', callback)
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
  const maxPngBytes = 25 * 1024 * 1024
  const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl)
  if (!match) {
    throw new AppError({ code: 'invalid-argument', message: 'Expected a base64 PNG data URL' })
  }
  return base64ToBytes(match[1], maxPngBytes)
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
  saveText(filePath, text, encoding) {
    return invokeDesktop(
      DESKTOP_COMMANDS.documents.saveText,
      { ...accessArgs(filePath), text, encoding },
    )
  },
  listFonts(language) {
    return invokeDesktop(
      DESKTOP_COMMANDS.documents.listFonts,
      language ? { language } : undefined,
    )
  },
  async copyImageToClipboard(dataUrl) {
    return desktopTransport.invoke(
      DESKTOP_COMMANDS.documents.copyImageToClipboard,
      pngDataUrlBytes(dataUrl),
    )
  },
  setCurrentFile(filePath) {
    return invokeDesktop(
      DESKTOP_COMMANDS.documents.setCurrentFile,
      filePath ? accessArgs(filePath) : { path: null },
    )
  },
}

const agents: AgentsApi = {
  list: () => invokeDesktop(DESKTOP_COMMANDS.agents.list, undefined),
  async save(agent) {
    await desktopTransport.invoke<AgentConfig>(DESKTOP_COMMANDS.agents.save, { config: agent })
    return agents.list()
  },
  async delete(agentId) {
    await desktopTransport.invoke<boolean>(DESKTOP_COMMANDS.agents.delete, { id: agentId })
    return agents.list()
  },
  conversations: {
    list: () => invokeDesktop(DESKTOP_COMMANDS.agents.conversationsList, undefined),
    get: (conversationId) => invokeDesktop(
      DESKTOP_COMMANDS.agents.conversationsGet,
      { id: conversationId },
    ),
    save: (request) => invokeDesktop(
      DESKTOP_COMMANDS.agents.conversationsSave,
      { request },
    ),
    delete: (conversationId) => invokeDesktop(
      DESKTOP_COMMANDS.agents.conversationsDelete,
      { id: conversationId },
    ),
    importCodex: () => invokeDesktop(
      DESKTOP_COMMANDS.agents.conversationsImportCodex,
      undefined,
    ),
  },
  chat(agentId, messages, conversationId, runId) {
    return desktopTransport.invoke(DESKTOP_COMMANDS.agents.chat, {
      request: { agentId, messages, conversationId, runId },
      onEvent: highFrequencyChannel<AgentCollaborationEvent>('agent:event') as unknown,
    })
  },
  runTask(agentIds, task, runId, rootAgentId) {
    return desktopTransport.invoke(DESKTOP_COMMANDS.agents.runTask, {
      request: { agentIds, task, runId, rootAgentId },
      onEvent: highFrequencyChannel<AgentCollaborationEvent>('agent:event') as unknown,
    })
  },
  async cancel(runId) {
    const result = await invokeDesktop<unknown>(
      DESKTOP_COMMANDS.agents.cancel,
      { runId },
    )
    return isRecord(result) ? result as Awaited<ReturnType<AgentsApi['cancel']>> : { success: result === true }
  },
  onEvent(callback) {
    return subscribeHighFrequency('agent:event', callback as (event: unknown) => void)
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
  debugStart(filePath, breakpoints) {
    return desktopTransport.invoke(DESKTOP_COMMANDS.process.debugStart, {
      request: { ...accessArgs(filePath), breakpoints },
      onEvent: highFrequencyChannel('lw:debug-event') as unknown,
    })
  },
  debugStop: () => invokeDesktop(
    DESKTOP_COMMANDS.process.debugStop,
    undefined,
  ),
  debugCommand: (command) => invokeDesktop(
    DESKTOP_COMMANDS.process.debugCommand,
    { request: { command } },
  ),
  debugEvaluate: (expression, id) => invokeDesktop(
    DESKTOP_COMMANDS.process.debugEvaluate,
    { request: { expression, id } },
  ),
  onDebugEvent: (callback) =>
    subscribeHighFrequency('lw:debug-event', callback as (event: unknown) => void),
  terminalExec(input) {
    return desktopTransport.invoke(DESKTOP_COMMANDS.process.terminalExec, {
      input,
      onEvent: highFrequencyChannel('lw:terminal-event') as unknown,
    })
  },
  terminalKill: () => invokeDesktop(
    DESKTOP_COMMANDS.process.terminalKill,
    undefined,
  ),
  onTerminalEvent: (callback) =>
    subscribeHighFrequency('lw:terminal-event', callback as (event: unknown) => void),
}

async function appVoid(
  command: string,
  args?: InvokeBody,
): Promise<void> {
  await desktopTransport.invoke(command, args)
}

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
  toggleFullscreen: () => appVoid(DESKTOP_COMMANDS.app.toggleFullscreen),
  close: () => appVoid(DESKTOP_COMMANDS.app.close),
  quit: () => appVoid(DESKTOP_COMMANDS.app.quit),
  checkForUpdate: () => desktopTransport.invoke(DESKTOP_COMMANDS.app.checkForUpdate),
  installUpdate: () => desktopTransport.invoke(DESKTOP_COMMANDS.app.installUpdate),
  markStartupHealthy: () => desktopTransport.invoke(DESKTOP_COMMANDS.app.markStartupHealthy),
  async takeStartupFiles() {
    const values = await desktopTransport.invoke<unknown[]>(DESKTOP_COMMANDS.app.takeStartupFiles)
    return values.map((value) => grantedPath(value, 'app.takeStartupFiles'))
  },
  listen(channel, callback) {
    if (HIGH_FREQUENCY_CHANNELS.has(channel)) {
      return Promise.resolve(subscribeHighFrequency(channel, callback as (...args: unknown[]) => void))
    }
    return desktopTransport.listen(channel, callback)
  },
}

export const desktopApi: DesktopApi = {
  files,
  documents,
  agents,
  providers,
  process: processApi,
  app,
}
