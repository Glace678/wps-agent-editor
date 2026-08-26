import type { FileEntry } from './services/file.service'
import type { EditorConfig } from './services/onlyoffice.service'
import type { AgentConfig } from './services/agent-store.service'
import type { AgentTaskResult, ChatMessage } from './services/agent-orchestrator'
import type { RecentFile } from './services/recent-files.service'
import type { FileStatInfo, FileOpErrorCode } from './services/file-ops.service'
import type { FileVersion } from './services/file-history.service'
import type {
  ProviderDefinition,
  CustomProviderConfig,
  CustomProviderConnectionTestResult,
  AuthStatus,
} from '../src/types/provider'
import type { LanguageCode } from '../src/lib/i18n/types'
import type { AppMenuAction } from '../src/types/app-menu'
import type { ThemePreference } from '../src/lib/theme'
import type { CodeRunResult, DebugBreakpoint, DebugCommand, DebugStartResult } from '../src/types/code'
import type { PresentationEditRequest, PresentationEditResult } from '../src/types/presentation'
import type { AgentCollaborationEvent } from '../src/types/agent'
import type {
  AgentApprovalResponse,
  AgentUserDocumentActivity,
  WordPlaybackControl,
} from '../src/types/document'
import type {
  ArtifactDraftBatchCreateRequest,
  ArtifactDraftCreateRequest,
  ArtifactDraftPayload,
  ArtifactDraftSummary,
  ArtifactReviewCommand,
  ArtifactReviewEvent,
  ArtifactReviewState,
  ArtifactRevisionRecord,
  ArtifactSourceSnapshotStageRequest,
  ArtifactSourceSnapshotStageResult,
  ArtifactStagedInputReleaseRequest,
  ArtifactProducerCapabilities,
  ArtifactProducerIdentity,
  ArtifactKind,
  ArtifactOperation,
  CodeArtifactReadRequest,
  CodeArtifactReadResult,
  CodeArtifactResolveRequest,
  CodeArtifactResolvedSnapshot,
  CodeWorkspaceInspectRequest,
  CodeWorkspaceInspectResult,
} from '../src/types/artifact-review'
import type {
  RendererArtifactProducerResult,
  RendererArtifactRebuildRequest,
  RendererArtifactStageRequest,
  RendererArtifactStageResult,
} from '../src/lib/renderer-artifact-producer'

export interface ElectronAPI {
  file: {
    list: (dirPath: string) => Promise<FileEntry[]>
    open: (filePath: string) => Promise<{ path: string; recent: RecentFile[] }>
    search: (rootPath: string, query: string) => Promise<FileEntry[]>
    getRecent: () => Promise<RecentFile[]>
    getHome: () => Promise<string>
    selectFolder: () => Promise<string | null>
    selectFile: (kind?: 'all' | 'text' | 'presentation') => Promise<string | null>
    selectAttachments: () => Promise<string[]>
    selectSaveFile: (defaultName?: string) => Promise<string | null>
    stat: (filePath: string) => Promise<FileStatInfo>
    rename: (filePath: string, newName: string) => Promise<{
      success: boolean
      newPath?: string
      recent?: RecentFile[]
      errorCode?: FileOpErrorCode
    }>
    delete: (filePath: string) => Promise<{
      success: boolean
      recent?: RecentFile[]
      errorCode?: FileOpErrorCode
    }>
    showInFolder: (filePath: string) => Promise<{ success: boolean; errorCode?: FileOpErrorCode }>
    removeRecent: (filePath: string) => Promise<RecentFile[]>
    copyToClipboard: (filePaths: string | string[]) => Promise<{
      success: boolean
      method?: 'file' | 'path'
      errorCode?: FileOpErrorCode
    }>
    historyList: (filePath: string) => Promise<FileVersion[]>
    historyRestore: (filePath: string, versionId: string) => Promise<{
      success: boolean
      errorCode?: 'not-found' | 'failed'
    }>
    onNavigateBack: (callback: () => void) => () => void
  }
  onlyoffice: {
    getConfig: (filePath: string) => Promise<{ config: EditorConfig; documentServerUrl: string }>
    forceSave: () => Promise<{ success: boolean; message: string }>
    getStatus: () => Promise<{
      serverUrl: string
      bridgeUrl: string
      connected: boolean
      offlineReady: boolean
      officeStatus: string
      message: string
      currentFile: string | null
    }>
    sendAgentResult: (requestId: string, result: unknown) => Promise<{ success: boolean }>
  }
  office: {
    getStatus: () => Promise<{
      status: string
      offlineReady: boolean
      message: string
      installPath: string | null
      bridgeUrl: string
      documentServerUrl: string
    }>
    download: () => Promise<{ success: boolean; path: string }>
    install: () => Promise<{ success: boolean }>
    start: () => Promise<{ started: boolean; state: unknown }>
    openFolder: () => Promise<{ success: boolean }>
  }
  agent: {
    list: () => Promise<AgentConfig[]>
    save: (agent: AgentConfig) => Promise<AgentConfig[]>
    delete: (agentId: string) => Promise<AgentConfig[]>
    chat: (
      agentId: string,
      messages: ChatMessage[],
      conversationId?: string,
      runId?: string,
    ) => Promise<AgentTaskResult | { error: string }>
    runTask: (agentIds: string[], task: string, runId?: string, rootAgentId?: string) => Promise<AgentTaskResult[] | { error: string }>
    cancel: (runId: string) => Promise<{ success: boolean; alreadyFinished?: boolean }>
    reportDocumentActivity: (activity: AgentUserDocumentActivity) => Promise<{ success: boolean }>
    respondApproval: (response: AgentApprovalResponse) => Promise<{ success: boolean; stale?: boolean }>
    controlWordPlayback: (runId: string, control: WordPlaybackControl) => Promise<{ success: boolean }>
    onEvent: (callback: (event: AgentCollaborationEvent) => void) => () => void
  }
  artifact: {
    createDraft: (request: ArtifactDraftCreateRequest) => Promise<ArtifactDraftSummary>
    createDraftBatch: (request: ArtifactDraftBatchCreateRequest) => Promise<ArtifactDraftSummary[]>
    getDraft: (draftId: string) => Promise<ArtifactDraftSummary | null>
    findDraft: (documentId: string) => Promise<ArtifactDraftSummary | null>
    getPayload: (draftId: string) => Promise<ArtifactDraftPayload>
    command: (draftId: string, command: ArtifactReviewCommand) => Promise<ArtifactReviewState>
    listHistory: (documentId: string) => Promise<ArtifactRevisionRecord[]>
    readHistory: (documentId: string, revisionId: string) => Promise<ArtifactRevisionRecord | null>
    reopenHistory: (documentId: string, revisionId: string) => Promise<ArtifactDraftSummary>
    getProducerCapabilities: (kind?: ArtifactKind) => Promise<Array<{
      producer: ArtifactProducerIdentity
      capabilities: ArtifactProducerCapabilities
    }>>
    stageProducedCandidate: (request: RendererArtifactStageRequest) => Promise<RendererArtifactStageResult>
    stageSourceSnapshot: (request: ArtifactSourceSnapshotStageRequest) => Promise<ArtifactSourceSnapshotStageResult>
    releaseStagedInputs: (request: ArtifactStagedInputReleaseRequest) => Promise<{ success: true }>
    submitProducerResult: (result: RendererArtifactProducerResult) => Promise<{ success: boolean }>
    onProducerRebuild: (callback: (request: RendererArtifactRebuildRequest) => void) => () => void
    /** Available only in isolated Electron verifier profiles. */
    createFixtureDraft: (request: {
      sourcePath: string
      kind: ArtifactKind
      candidateData: Uint8Array | ArrayBuffer
      operations: ArtifactOperation[]
      textMetadata?: ArtifactDraftCreateRequest['textMetadata']
    }) => Promise<ArtifactDraftSummary>
    onEvent: (callback: (event: ArtifactReviewEvent) => void) => () => void
  }
  codeArtifact: {
    inspectWorkspace: (request: CodeWorkspaceInspectRequest) => Promise<CodeWorkspaceInspectResult>
    read: (request: CodeArtifactReadRequest) => Promise<CodeArtifactReadResult>
    /** Trusted renderer bridge. Never forward sourcePath or raw bytes to an Agent. */
    resolve: (request: CodeArtifactResolveRequest) => Promise<CodeArtifactResolvedSnapshot>
  }
  provider: {
    list: (forceRefresh?: boolean) => Promise<ProviderDefinition[]>
    get: (providerId: string) => Promise<ProviderDefinition | null>
    delete: (providerId: string) => Promise<{ success: boolean }>
    detectOllama: (baseURL?: string) => Promise<{ available: boolean; models: string[]; baseURL: string }>
    setBaseURL: (providerId: string, baseURL: string) => Promise<{ success: boolean }>
  }
  auth: {
    getAll: () => Promise<Record<string, AuthStatus>>
    set: (providerId: string, apiKey: string) => Promise<{ success: boolean }>
    remove: (providerId: string) => Promise<{ success: boolean }>
  }
  customProvider: {
    list: () => Promise<CustomProviderConfig[]>
    save: (provider: CustomProviderConfig) => Promise<CustomProviderConfig[]>
    testConnection: (baseURL: string, apiKey: string) => Promise<CustomProviderConnectionTestResult>
    delete: (id: string) => Promise<CustomProviderConfig[]>
  }
  i18n: {
    setLanguage: (language: LanguageCode) => Promise<{ success: true }>
  }
  theme: {
    setPreference: (preference: ThemePreference) => Promise<{ success: true }>
  }
  appMenu: {
    perform: (action: AppMenuAction) => Promise<{ success: true }>
  }
  officeCli: {
    getStatus: () => Promise<{
      installed: boolean
      ready: boolean
      bundled: boolean
      binaryPath: string | null
      version: string | null
      downloadUrl: string
      installDir: string
      message: string
      estimatedSizeMb: string
    }>
    download: () => Promise<{ success: boolean; path: string }>
    openFolder: () => Promise<{ success: boolean }>
    openPreview: (filePath: string | null) => Promise<{ previewUrl: string | null }>
    stopPreview: () => Promise<{ success: boolean }>
  }
  lw: {
    /** data 优先为二进制 Uint8Array/ArrayBuffer；旧版可能仍是 base64 字符串 */
    readFile: (filePath: string) => Promise<{
      data: Uint8Array | ArrayBuffer | string
      encoding?: 'binary' | 'base64'
    }>
    readWord: (filePath: string) => Promise<{
      data: Uint8Array | ArrayBuffer | string
      encoding: 'binary' | 'base64'
      convertedFromLegacy: boolean
      converter: 'libreoffice' | 'word' | 'wps' | null
      nativeConversionFailed: boolean
      normalizedLegacyImageCount: number
    }>
    readPresentation: (filePath: string) => Promise<{
      data: Uint8Array | ArrayBuffer | string
      encoding: 'binary' | 'base64'
      convertedFromLegacy: boolean
      converter: 'libreoffice' | 'powerpoint' | 'wps' | null
      normalizedWmfCount: number
    }>
    editPresentation: (request: PresentationEditRequest) => Promise<PresentationEditResult>
    saveFile: (filePath: string, base64: string) => Promise<{ success: boolean }>
    saveText: (filePath: string, text: string, encoding: string) => Promise<{ success: boolean }>
    listFonts: (language?: LanguageCode) => Promise<Array<{
      familyName: string
      displayName: string
      faceName: string
      weight: number
      style: 'normal' | 'italic' | 'oblique'
      stretch: number
    }>>
    copyImageToClipboard: (dataUrl: string) => Promise<{
      success: true
      width: number
      height: number
    }>
    setCurrentFile: (filePath: string | null) => Promise<{ success: boolean }>
    sendAgentResult: (requestId: string, result: unknown) => Promise<{ success: boolean }>
    sendAgentEvent: (event: unknown) => Promise<{ success: boolean }>
    runCode: (filePath: string) => Promise<CodeRunResult>
    debugStart: (filePath: string, breakpoints: DebugBreakpoint[]) => Promise<DebugStartResult>
    debugStop: () => Promise<{ success: boolean }>
    debugCommand: (command: DebugCommand) => Promise<{ success: boolean }>
    debugEvaluate: (expression: string, id: string) => Promise<{ success: boolean }>
    terminalExec: (input: string) => Promise<{ started: boolean; cwd: string }>
    terminalKill: () => Promise<{ success: boolean }>
  }
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    newWindow: (filePath?: string) => Promise<void>
    toggleFullscreen: () => Promise<void>
    close: () => Promise<void>
    quit: () => Promise<void>
  }
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
  platform: NodeJS.Platform
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
