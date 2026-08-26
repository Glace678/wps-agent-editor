import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './ipc/channels'
import type { AppMenuAction } from '../src/types/app-menu'
import type { ThemePreference } from '../src/lib/theme'
import type { PresentationEditRequest } from '../src/types/presentation'
import type { AgentCollaborationEvent } from '../src/types/agent'
import type {
  AgentApprovalResponse,
  AgentUserDocumentActivity,
  WordPlaybackControl,
} from '../src/types/document'
import type {
  ArtifactDraftBatchCreateRequest,
  ArtifactDraftCreateRequest,
  ArtifactReviewCommand,
  ArtifactReviewEvent,
  ArtifactSourceSnapshotStageRequest,
  ArtifactStagedInputReleaseRequest,
  CodeArtifactReadRequest,
  CodeArtifactResolveRequest,
  CodeWorkspaceInspectRequest,
} from '../src/types/artifact-review'
import type {
  RendererArtifactProducerResult,
  RendererArtifactRebuildRequest,
  RendererArtifactStageRequest,
} from '../src/lib/renderer-artifact-producer'
import {
  isTrustedRendererDocument,
  readTrustedRendererArgument,
} from './security/renderer-boundary'

const api = {
  file: {
    list: (dirPath: string) => ipcRenderer.invoke(IPC.FILE_LIST, dirPath),
    open: (filePath: string) => ipcRenderer.invoke(IPC.FILE_OPEN, filePath),
    search: (rootPath: string, query: string) => ipcRenderer.invoke(IPC.FILE_SEARCH, rootPath, query),
    getRecent: () => ipcRenderer.invoke(IPC.FILE_GET_RECENT),
    getHome: () => ipcRenderer.invoke(IPC.FILE_GET_HOME),
    selectFolder: () => ipcRenderer.invoke(IPC.FILE_SELECT_FOLDER),
    selectFile: (kind?: 'all' | 'text' | 'presentation') => ipcRenderer.invoke(IPC.FILE_SELECT_FILE, kind),
    selectAttachments: () => ipcRenderer.invoke(IPC.FILE_SELECT_ATTACHMENTS),
    selectSaveFile: (defaultName?: string) =>
      ipcRenderer.invoke(IPC.FILE_SELECT_SAVE_FILE, defaultName),
    stat: (filePath: string) => ipcRenderer.invoke(IPC.FILE_STAT, filePath),
    rename: (filePath: string, newName: string) =>
      ipcRenderer.invoke(IPC.FILE_RENAME, filePath, newName),
    delete: (filePath: string) => ipcRenderer.invoke(IPC.FILE_DELETE, filePath),
    showInFolder: (filePath: string) => ipcRenderer.invoke(IPC.FILE_SHOW_IN_FOLDER, filePath),
    removeRecent: (filePath: string) => ipcRenderer.invoke(IPC.FILE_REMOVE_RECENT, filePath),
    copyToClipboard: (filePaths: string | string[]) =>
      ipcRenderer.invoke(IPC.FILE_COPY_TO_CLIPBOARD, filePaths),
    historyList: (filePath: string) => ipcRenderer.invoke(IPC.FILE_HISTORY_LIST, filePath),
    historyRestore: (filePath: string, versionId: string) =>
      ipcRenderer.invoke(IPC.FILE_HISTORY_RESTORE, filePath, versionId),
    onNavigateBack: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on(IPC.FILE_NAVIGATE_BACK, listener)
      return () => ipcRenderer.removeListener(IPC.FILE_NAVIGATE_BACK, listener)
    },
  },
  onlyoffice: {
    getConfig: (filePath: string) => ipcRenderer.invoke(IPC.OO_GET_CONFIG, filePath),
    forceSave: () => ipcRenderer.invoke(IPC.OO_FORCE_SAVE),
    getStatus: () => ipcRenderer.invoke(IPC.OO_GET_STATUS),
    sendAgentResult: (requestId: string, result: unknown) =>
      ipcRenderer.invoke(IPC.OO_AGENT_RESULT, { requestId, result }),
  },
  office: {
    getStatus: () => ipcRenderer.invoke(IPC.OFFICE_GET_STATUS),
    download: () => ipcRenderer.invoke(IPC.OFFICE_DOWNLOAD),
    install: () => ipcRenderer.invoke(IPC.OFFICE_INSTALL),
    start: () => ipcRenderer.invoke(IPC.OFFICE_START),
    openFolder: () => ipcRenderer.invoke(IPC.OFFICE_OPEN_FOLDER),
  },
  agent: {
    list: () => ipcRenderer.invoke(IPC.AGENT_LIST),
    save: (agent: unknown) => ipcRenderer.invoke(IPC.AGENT_SAVE, agent),
    delete: (agentId: string) => ipcRenderer.invoke(IPC.AGENT_DELETE, agentId),
    chat: (agentId: string, messages: unknown[], conversationId?: string, runId?: string) =>
      ipcRenderer.invoke(IPC.AGENT_CHAT, { agentId, messages, conversationId, runId }),
    runTask: (agentIds: string[], task: string, runId?: string, rootAgentId?: string) =>
      ipcRenderer.invoke(IPC.AGENT_RUN_TASK, { agentIds, task, runId, rootAgentId }),
    cancel: (runId: string) => ipcRenderer.invoke(IPC.AGENT_CANCEL, runId),
    reportDocumentActivity: (activity: AgentUserDocumentActivity) =>
      ipcRenderer.invoke(IPC.AGENT_DOCUMENT_ACTIVITY, activity),
    respondApproval: (response: AgentApprovalResponse) =>
      ipcRenderer.invoke(IPC.AGENT_APPROVAL_RESPONSE, response),
    controlWordPlayback: (runId: string, control: WordPlaybackControl) =>
      ipcRenderer.invoke(IPC.AGENT_PLAYBACK_CONTROL, { runId, control }),
    onEvent: (callback: (event: AgentCollaborationEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AgentCollaborationEvent) => callback(payload)
      ipcRenderer.on(IPC.AGENT_EVENT, listener)
      return () => ipcRenderer.removeListener(IPC.AGENT_EVENT, listener)
    },
  },
  artifact: {
    createDraft: (request: ArtifactDraftCreateRequest) =>
      ipcRenderer.invoke(IPC.ARTIFACT_DRAFT_CREATE, request),
    createDraftBatch: (request: ArtifactDraftBatchCreateRequest) =>
      ipcRenderer.invoke(IPC.ARTIFACT_DRAFT_CREATE_BATCH, request),
    getDraft: (draftId: string) => ipcRenderer.invoke(IPC.ARTIFACT_DRAFT_GET, draftId),
    findDraft: (documentId: string) => ipcRenderer.invoke(IPC.ARTIFACT_DRAFT_FIND, documentId),
    getPayload: (draftId: string) => ipcRenderer.invoke(IPC.ARTIFACT_DRAFT_PAYLOAD, draftId),
    command: (draftId: string, command: ArtifactReviewCommand) =>
      ipcRenderer.invoke(IPC.ARTIFACT_REVIEW_COMMAND, draftId, command),
    listHistory: (documentId: string) => ipcRenderer.invoke(IPC.ARTIFACT_HISTORY_LIST, documentId),
    readHistory: (documentId: string, revisionId: string) =>
      ipcRenderer.invoke(IPC.ARTIFACT_HISTORY_READ, documentId, revisionId),
    reopenHistory: (documentId: string, revisionId: string) =>
      ipcRenderer.invoke(IPC.ARTIFACT_HISTORY_REOPEN, documentId, revisionId),
    getProducerCapabilities: (kind?: ArtifactDraftCreateRequest['kind']) =>
      ipcRenderer.invoke(IPC.ARTIFACT_PRODUCER_CAPABILITIES, kind),
    stageProducedCandidate: (request: RendererArtifactStageRequest) =>
      ipcRenderer.invoke(IPC.ARTIFACT_PRODUCER_STAGE, request),
    stageSourceSnapshot: (request: ArtifactSourceSnapshotStageRequest) =>
      ipcRenderer.invoke(IPC.ARTIFACT_SOURCE_STAGE, request),
    releaseStagedInputs: (request: ArtifactStagedInputReleaseRequest) =>
      ipcRenderer.invoke(IPC.ARTIFACT_STAGE_RELEASE, request),
    submitProducerResult: (result: RendererArtifactProducerResult) =>
      ipcRenderer.invoke(IPC.ARTIFACT_PRODUCER_RESULT, result),
    onProducerRebuild: (callback: (request: RendererArtifactRebuildRequest) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: RendererArtifactRebuildRequest) => callback(request)
      ipcRenderer.on(IPC.ARTIFACT_PRODUCER_REBUILD, listener)
      return () => ipcRenderer.removeListener(IPC.ARTIFACT_PRODUCER_REBUILD, listener)
    },
    createFixtureDraft: (request: {
      sourcePath: string
      kind: ArtifactDraftCreateRequest['kind']
      candidateData: Uint8Array | ArrayBuffer
      operations: ArtifactDraftCreateRequest['operations']
      textMetadata?: ArtifactDraftCreateRequest['textMetadata']
    }) => ipcRenderer.invoke(IPC.ARTIFACT_E2E_CREATE, request),
    onEvent: (callback: (event: ArtifactReviewEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: ArtifactReviewEvent) => callback(payload)
      ipcRenderer.on(IPC.ARTIFACT_REVIEW_EVENT, listener)
      return () => ipcRenderer.removeListener(IPC.ARTIFACT_REVIEW_EVENT, listener)
    },
  },
  codeArtifact: {
    inspectWorkspace: (request: CodeWorkspaceInspectRequest) =>
      ipcRenderer.invoke(IPC.CODE_WORKSPACE_INSPECT, request),
    read: (request: CodeArtifactReadRequest) => ipcRenderer.invoke(IPC.CODE_ARTIFACT_READ, request),
    resolve: (request: CodeArtifactResolveRequest) => ipcRenderer.invoke(IPC.CODE_ARTIFACT_RESOLVE, request),
  },
  provider: {
    list: (forceRefresh?: boolean) => ipcRenderer.invoke(IPC.PROVIDER_LIST, forceRefresh),
    get: (providerId: string) => ipcRenderer.invoke(IPC.PROVIDER_GET, providerId),
    delete: (providerId: string) => ipcRenderer.invoke(IPC.PROVIDER_DELETE, providerId),
    detectOllama: (baseURL?: string) => ipcRenderer.invoke(IPC.PROVIDER_DETECT_OLLAMA, baseURL),
    setBaseURL: (providerId: string, baseURL: string) =>
      ipcRenderer.invoke(IPC.PROVIDER_SET_BASE_URL, { providerId, baseURL }),
  },
  auth: {
    getAll: () => ipcRenderer.invoke(IPC.AUTH_GET_ALL),
    set: (providerId: string, apiKey: string) =>
      ipcRenderer.invoke(IPC.AUTH_SET, { providerId, apiKey }),
    remove: (providerId: string) => ipcRenderer.invoke(IPC.AUTH_REMOVE, providerId),
  },
  customProvider: {
    list: () => ipcRenderer.invoke(IPC.CUSTOM_PROVIDER_LIST),
    save: (provider: unknown) => ipcRenderer.invoke(IPC.CUSTOM_PROVIDER_SAVE, provider),
    testConnection: (baseURL: string, apiKey: string) =>
      ipcRenderer.invoke(IPC.CUSTOM_PROVIDER_TEST_CONNECTION, { baseURL, apiKey }),
    delete: (id: string) => ipcRenderer.invoke(IPC.CUSTOM_PROVIDER_DELETE, id),
  },
  i18n: {
    setLanguage: (language: string) => ipcRenderer.invoke(IPC.I18N_SET_LANGUAGE, language),
  },
  theme: {
    setPreference: (preference: ThemePreference) =>
      ipcRenderer.invoke(IPC.THEME_SET_PREFERENCE, preference),
  },
  appMenu: {
    perform: (action: AppMenuAction) => ipcRenderer.invoke(IPC.APP_MENU_PERFORM, action),
  },
  lw: {
    readFile: (filePath: string) => ipcRenderer.invoke(IPC.LW_READ_FILE, filePath),
    readWord: (filePath: string) => ipcRenderer.invoke(IPC.LW_READ_WORD, filePath),
    readPresentation: (filePath: string) => ipcRenderer.invoke(IPC.LW_READ_PRESENTATION, filePath),
    editPresentation: (request: PresentationEditRequest) =>
      ipcRenderer.invoke(IPC.LW_EDIT_PRESENTATION, request),
    saveFile: (filePath: string, base64: string) => ipcRenderer.invoke(IPC.LW_SAVE_FILE, filePath, base64),
    saveText: (filePath: string, text: string, encoding: string) =>
      ipcRenderer.invoke(IPC.LW_SAVE_TEXT, filePath, text, encoding),
    listFonts: (language?: string) => ipcRenderer.invoke(IPC.LW_LIST_FONTS, language),
    copyImageToClipboard: (dataUrl: string) =>
      ipcRenderer.invoke(IPC.LW_COPY_IMAGE_TO_CLIPBOARD, dataUrl),
    setCurrentFile: (filePath: string | null) => ipcRenderer.invoke(IPC.LW_SET_CURRENT_FILE, filePath),
    sendAgentResult: (requestId: string, result: unknown) =>
      ipcRenderer.invoke(IPC.LW_AGENT_RESULT, { requestId, result }),
    sendAgentEvent: (event: unknown) => ipcRenderer.invoke(IPC.LW_AGENT_EVENT, event),
    runCode: (filePath: string) => ipcRenderer.invoke(IPC.LW_RUN_CODE, filePath),
    debugStart: (filePath: string, breakpoints: unknown[]) =>
      ipcRenderer.invoke(IPC.LW_DEBUG_START, filePath, breakpoints),
    debugStop: () => ipcRenderer.invoke(IPC.LW_DEBUG_STOP),
    debugCommand: (command: string) => ipcRenderer.invoke(IPC.LW_DEBUG_COMMAND, command),
    debugEvaluate: (expression: string, id: string) =>
      ipcRenderer.invoke(IPC.LW_DEBUG_EVALUATE, expression, id),
    terminalExec: (input: string) => ipcRenderer.invoke(IPC.LW_TERMINAL_EXEC, input),
    terminalKill: () => ipcRenderer.invoke(IPC.LW_TERMINAL_KILL),
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE),
    newWindow: (filePath?: string) => ipcRenderer.invoke(IPC.WINDOW_NEW, filePath),
    toggleFullscreen: () => ipcRenderer.invoke(IPC.WINDOW_TOGGLE_FULLSCREEN),
    close: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),
    quit: () => ipcRenderer.invoke(IPC.WINDOW_QUIT),
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = [
      'menu:open-file', 'menu:open-folder', 'menu:save', 'menu:print',
      'menu:new-agent', 'menu:run-multi-agent',
      IPC.AGENT_EVENT,
      'office:download-progress', 'lw:agent-command', 'lw:agent-cancel', IPC.LW_WORD_PLAYBACK_CONTROL, 'oo:agent-command', 'oo:agent-cancel',
      'lw:debug-event', 'lw:terminal-event',
    ]
    if (validChannels.includes(channel)) {
      const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }
    return () => {}
  },
  platform: process.platform,
}

const trustedRendererUrl = readTrustedRendererArgument(process.argv)

// Electron runs a preload in subframes as well. Never expose the privileged API
// unless this is the registered top-level application document.
if (
  process.isMainFrame
  && trustedRendererUrl
  && isTrustedRendererDocument(globalThis.location.href, trustedRendererUrl)
) {
  contextBridge.exposeInMainWorld('api', api)
}
