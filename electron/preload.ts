import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './ipc/channels'
import type { AppMenuAction } from '../src/types/app-menu'
import type { ThemePreference } from '../src/lib/theme'

const api = {
  file: {
    list: (dirPath: string) => ipcRenderer.invoke(IPC.FILE_LIST, dirPath),
    open: (filePath: string) => ipcRenderer.invoke(IPC.FILE_OPEN, filePath),
    search: (rootPath: string, query: string) => ipcRenderer.invoke(IPC.FILE_SEARCH, rootPath, query),
    getRecent: () => ipcRenderer.invoke(IPC.FILE_GET_RECENT),
    getHome: () => ipcRenderer.invoke(IPC.FILE_GET_HOME),
    selectFolder: () => ipcRenderer.invoke(IPC.FILE_SELECT_FOLDER),
    selectFile: (kind?: 'all' | 'text') => ipcRenderer.invoke(IPC.FILE_SELECT_FILE, kind),
    selectSaveFile: (defaultName?: string) =>
      ipcRenderer.invoke(IPC.FILE_SELECT_SAVE_FILE, defaultName),
    stat: (filePath: string) => ipcRenderer.invoke(IPC.FILE_STAT, filePath),
    rename: (filePath: string, newName: string) =>
      ipcRenderer.invoke(IPC.FILE_RENAME, filePath, newName),
    delete: (filePath: string) => ipcRenderer.invoke(IPC.FILE_DELETE, filePath),
    showInFolder: (filePath: string) => ipcRenderer.invoke(IPC.FILE_SHOW_IN_FOLDER, filePath),
    removeRecent: (filePath: string) => ipcRenderer.invoke(IPC.FILE_REMOVE_RECENT, filePath),
    copyToClipboard: (filePath: string) =>
      ipcRenderer.invoke(IPC.FILE_COPY_TO_CLIPBOARD, filePath),
    historyList: (filePath: string) => ipcRenderer.invoke(IPC.FILE_HISTORY_LIST, filePath),
    historyRestore: (filePath: string, versionId: string) =>
      ipcRenderer.invoke(IPC.FILE_HISTORY_RESTORE, filePath, versionId),
  },
  onlyoffice: {
    getConfig: (filePath: string) => ipcRenderer.invoke(IPC.OO_GET_CONFIG, filePath),
    forceSave: () => ipcRenderer.invoke(IPC.OO_FORCE_SAVE),
    getStatus: () => ipcRenderer.invoke(IPC.OO_GET_STATUS),
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
    chat: (agentId: string, messages: unknown[]) =>
      ipcRenderer.invoke(IPC.AGENT_CHAT, { agentId, messages }),
    runTask: (agentIds: string[], task: string) =>
      ipcRenderer.invoke(IPC.AGENT_RUN_TASK, { agentIds, task }),
  },
  provider: {
    list: (forceRefresh?: boolean) => ipcRenderer.invoke(IPC.PROVIDER_LIST, forceRefresh),
    get: (providerId: string) => ipcRenderer.invoke(IPC.PROVIDER_GET, providerId),
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
    saveFile: (filePath: string, base64: string) => ipcRenderer.invoke(IPC.LW_SAVE_FILE, filePath, base64),
    saveText: (filePath: string, text: string, encoding: string) =>
      ipcRenderer.invoke(IPC.LW_SAVE_TEXT, filePath, text, encoding),
    listFonts: (language?: string) => ipcRenderer.invoke(IPC.LW_LIST_FONTS, language),
    copyImageToClipboard: (dataUrl: string) =>
      ipcRenderer.invoke(IPC.LW_COPY_IMAGE_TO_CLIPBOARD, dataUrl),
    setCurrentFile: (filePath: string | null) => ipcRenderer.invoke(IPC.LW_SET_CURRENT_FILE, filePath),
    sendAgentResult: (requestId: string, result: unknown) =>
      ipcRenderer.invoke(IPC.LW_AGENT_RESULT, { requestId, result }),
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
      'office:download-progress', 'lw:agent-command',
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

contextBridge.exposeInMainWorld('api', api)
