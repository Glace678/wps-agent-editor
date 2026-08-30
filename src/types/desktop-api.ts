import type { AgentCollaborationEvent, AgentConfig, AgentTaskResult, ChatMessage } from './agent'
import type { AppMenuAction } from './app-menu'
import type {
  CodeRunResult,
  DebugBreakpoint,
  DebugCommand,
  DebugStartResult,
  RoutedDebugEvent,
} from './code'
import type { FileEntry, FileStatInfo, FileVersion, RecentFile } from './file'
import type { PresentationEditRequest, PresentationEditResult } from './presentation'
import type {
  AuthStatus,
  CustomProviderConfig,
  CustomProviderConnectionTestResult,
  ProviderDefinition,
} from './provider'
import type { LanguageCode } from '@/lib/i18n/types'
import type { ThemePreference } from '@/lib/theme'
import type { AppError as RustAppError } from './generated/AppError'
import type { GrantedPath as RustGrantedPath } from './generated/GrantedPath'
import type { DependencyStatus } from './generated/DependencyStatus'
import type {
  CodexImportResult,
  ConversationRecord,
  ConversationSaveRequest,
  ConversationSummary,
} from './generated'

export type DesktopRuntime = 'tauri' | 'web'

export type DesktopPlatform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd'
  | 'unknown'

export type AppErrorCode =
  | 'access-denied'
  | 'cancelled'
  | 'dependency-missing'
  | 'desktop-api-unavailable'
  | 'internal'
  | 'invalid-argument'
  | 'invalid-binary'
  | 'invalid-response'
  | 'invoke-failed'
  | 'io-error'
  | 'not-found'
  | 'permission-denied'
  | 'unsupported'
  | (string & {})

export type AppErrorData = Omit<RustAppError, 'code' | 'details' | 'messageKey' | 'retryable'> & {
  code: AppErrorCode
  messageKey?: string
  details?: unknown
  retryable?: boolean
  command?: string
}

export type InvokeBody = Record<string, unknown> | ArrayBuffer | Uint8Array

export interface InvokeOptions {
  headers?: Record<string, string>
}

export interface DesktopChannel<T> {
  readonly id: number
  onmessage: ((message: T) => void) | null
  toJSON: () => string
}

export interface DesktopTransport {
  readonly runtime: DesktopRuntime
  invoke: <T>(command: string, args?: InvokeBody, options?: InvokeOptions) => Promise<T>
  listen: <T>(event: string, handler: (payload: T) => void) => Promise<() => void>
  channel: <T>(handler?: (message: T) => void) => DesktopChannel<T>
}

export type GrantedPath = RustGrantedPath

export type GrantedFileEntry = FileEntry & { grantId: string }
export type GrantedRecentFile = RecentFile & { grantId: string }

export interface OpenedFile extends GrantedPath {
  recent: GrantedRecentFile[]
}

export type FileOperationErrorCode =
  | 'failed'
  | 'invalid-name'
  | 'name-exists'
  | 'not-found'

export interface FileMutationResult {
  success: boolean
  path?: string
  grantId?: string
  newPath?: string
  recent?: GrantedRecentFile[]
  errorCode?: FileOperationErrorCode
}

export interface FileRevealResult {
  success: boolean
  errorCode?: FileOperationErrorCode
}

export interface FileClipboardResult extends FileRevealResult {
  method?: 'file' | 'path'
}

export interface FilesApi {
  list: (dirPath: string) => Promise<GrantedFileEntry[]>
  open: (filePath: string) => Promise<OpenedFile>
  openExternal: (filePath: string) => Promise<OpenedFile>
  search: (rootPath: string, query: string) => Promise<GrantedFileEntry[]>
  getRecent: () => Promise<GrantedRecentFile[]>
  getHome: () => Promise<GrantedPath>
  selectFolder: () => Promise<GrantedPath | null>
  selectFile: (kind?: 'all' | 'text' | 'presentation') => Promise<GrantedPath | null>
  selectAttachments: () => Promise<GrantedPath[]>
  selectSaveFile: (defaultName?: string) => Promise<GrantedPath | null>
  stat: (filePath: string) => Promise<FileStatInfo>
  rename: (filePath: string, newName: string) => Promise<FileMutationResult>
  delete: (filePath: string) => Promise<FileMutationResult>
  showInFolder: (filePath: string) => Promise<FileRevealResult>
  removeRecent: (filePath: string) => Promise<GrantedRecentFile[]>
  copyToClipboard: (filePaths: string | string[]) => Promise<FileClipboardResult>
  historyList: (filePath: string) => Promise<FileVersion[]>
  historyRestore: (filePath: string, versionId: string) => Promise<FileRevealResult>
  getGrantId: (filePath: string) => string | undefined
  registerGrant: (grant: GrantedPath) => void
  forgetGrant: (filePath: string) => void
  onNavigateBack: (callback: () => void) => () => void
}

export type BinaryLike =
  | Uint8Array
  | ArrayBuffer
  | ArrayBufferView

export interface PreparedWordDocument {
  data: Uint8Array
  encoding: 'binary'
  convertedFromLegacy: boolean
  converter: 'libreoffice' | 'word' | 'wps' | null
  nativeConversionFailed: boolean
  normalizedLegacyImageCount: number
  normalizedTableCount: number
  removedUnderlineRunCount: number
}

export interface PreparedPresentationDocument {
  data: Uint8Array
  encoding: 'binary'
  convertedFromLegacy: boolean
  converter: 'libreoffice' | 'powerpoint' | 'wps' | null
  normalizedWmfCount: number
}

export interface SystemFontFace {
  familyName: string
  displayName: string
  faceName: string
  weight: number
  style: 'normal' | 'italic' | 'oblique'
  stretch: number
}

export interface DocumentsApi {
  readFile: (filePath: string) => Promise<Uint8Array>
  prepareWord: (filePath: string) => Promise<PreparedWordDocument>
  preparePresentation: (filePath: string) => Promise<PreparedPresentationDocument>
  prepareSpreadsheet: (filePath: string) => Promise<Uint8Array>
  saveBinary: (filePath: string, data: BinaryLike) => Promise<{ success: boolean }>
  editPresentation: (request: PresentationEditRequest) => Promise<PresentationEditResult>
  saveText: (filePath: string, text: string, encoding: string) => Promise<{ success: boolean }>
  listFonts: (language?: LanguageCode) => Promise<SystemFontFace[]>
  copyImageToClipboard: (dataUrl: string) => Promise<{
    success: true
    width: number
    height: number
  }>
  setCurrentFile: (filePath: string | null) => Promise<{ success: boolean }>
}

export interface AgentsApi {
  list: () => Promise<AgentConfig[]>
  save: (agent: AgentConfig) => Promise<AgentConfig[]>
  delete: (agentId: string) => Promise<AgentConfig[]>
  conversations: {
    list: () => Promise<ConversationSummary[]>
    get: (conversationId: string) => Promise<ConversationRecord>
    save: (request: ConversationSaveRequest) => Promise<ConversationRecord>
    delete: (conversationId: string) => Promise<boolean>
    importCodex: () => Promise<CodexImportResult>
  }
  chat: (
    agentId: string,
    messages: ChatMessage[],
    conversationId?: string,
    runId?: string,
  ) => Promise<AgentTaskResult | { error: string }>
  runTask: (
    agentIds: string[],
    task: string,
    runId?: string,
    rootAgentId?: string,
  ) => Promise<AgentTaskResult[] | { error: string }>
  cancel: (runId: string) => Promise<{ success: boolean; alreadyFinished?: boolean }>
  onEvent: (callback: (event: AgentCollaborationEvent) => void) => () => void
  sendDocumentResult: (requestId: string, result: unknown) => Promise<{ success: boolean }>
  sendDocumentEvent: (event: unknown) => Promise<{ success: boolean }>
}

export interface ProvidersApi {
  list: (forceRefresh?: boolean) => Promise<ProviderDefinition[]>
  get: (providerId: string) => Promise<ProviderDefinition | null>
  detectOllama: (baseURL?: string) => Promise<{
    available: boolean
    models: string[]
    baseURL: string
  }>
  setBaseURL: (providerId: string, baseURL: string) => Promise<{ success: boolean }>
  auth: {
    getAll: () => Promise<Record<string, AuthStatus>>
    set: (providerId: string, apiKey: string) => Promise<{ success: boolean }>
    remove: (providerId: string) => Promise<{ success: boolean }>
  }
  custom: {
    list: () => Promise<CustomProviderConfig[]>
    save: (provider: CustomProviderConfig) => Promise<CustomProviderConfig[]>
    testConnection: (
      baseURL: string,
      apiKey: string,
    ) => Promise<CustomProviderConnectionTestResult>
    delete: (id: string) => Promise<CustomProviderConfig[]>
  }
}

export interface ProcessApi {
  probeDependencies: () => Promise<DependencyStatus[]>
  runCode: (filePath: string) => Promise<CodeRunResult>
  debugStart: (filePath: string, breakpoints: DebugBreakpoint[]) => Promise<DebugStartResult>
  debugStop: () => Promise<{ success: boolean }>
  debugCommand: (command: DebugCommand) => Promise<{ success: boolean }>
  debugEvaluate: (expression: string, id: string) => Promise<{ success: boolean }>
  onDebugEvent: (callback: (event: RoutedDebugEvent) => void) => () => void
  terminalExec: (input: string) => Promise<{ started: boolean; cwd: string; sessionId: string }>
  terminalKill: () => Promise<{ success: boolean }>
  onTerminalEvent: (callback: (event: TerminalEvent) => void) => () => void
}

export interface TerminalEvent {
  type: 'output' | 'exit'
  text?: string
  code?: number | null
  sessionId: string
  windowLabel: string
}

export interface AppApi {
  readonly platform: DesktopPlatform
  setLanguage: (language: LanguageCode) => Promise<{ success: true }>
  setTheme: (preference: ThemePreference) => Promise<{ success: true }>
  performMenuAction: (action: AppMenuAction) => Promise<{ success: true }>
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  newWindow: (filePath?: string) => Promise<void>
  toggleFullscreen: () => Promise<void>
  close: () => Promise<void>
  quit: () => Promise<void>
  checkForUpdate: () => Promise<{
    available: boolean
    currentVersion: string
    version?: string
    notes?: string
    publishedAt?: string
  }>
  installUpdate: () => Promise<{ success: boolean }>
  markStartupHealthy: () => Promise<{ success: boolean }>
  takeStartupFiles: () => Promise<GrantedPath[]>
  listen: <T>(channel: string, callback: (payload: T) => void) => Promise<() => void>
}

export interface DesktopApi {
  readonly files: FilesApi
  readonly documents: DocumentsApi
  readonly agents: AgentsApi
  readonly providers: ProvidersApi
  readonly process: ProcessApi
  readonly app: AppApi
}
