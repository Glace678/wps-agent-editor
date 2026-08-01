export const IPC = {
  // 文件系统
  FILE_LIST: 'file:list',
  FILE_OPEN: 'file:open',
  FILE_SEARCH: 'file:search',
  FILE_GET_RECENT: 'file:get-recent',
  FILE_SELECT_FOLDER: 'file:select-folder',
  FILE_SELECT_FILE: 'file:select-file',
  FILE_SELECT_SAVE_FILE: 'file:select-save-file',
  FILE_GET_HOME: 'file:get-home',
  FILE_STAT: 'file:stat',
  FILE_RENAME: 'file:rename',
  FILE_DELETE: 'file:delete',
  FILE_SHOW_IN_FOLDER: 'file:show-in-folder',
  FILE_REMOVE_RECENT: 'file:remove-recent',
  FILE_COPY_TO_CLIPBOARD: 'file:copy-to-clipboard',
  FILE_HISTORY_LIST: 'file:history-list',
  FILE_HISTORY_RESTORE: 'file:history-restore',

  // OnlyOffice
  OO_GET_CONFIG: 'onlyoffice:get-config',
  OO_FORCE_SAVE: 'onlyoffice:force-save',
  OO_AGENT_EDIT: 'onlyoffice:agent-edit',
  OO_GET_STATUS: 'onlyoffice:get-status',

  // 离线 Office 引擎
  OFFICE_GET_STATUS: 'office:get-status',
  OFFICE_DOWNLOAD: 'office:download',
  OFFICE_INSTALL: 'office:install',
  OFFICE_START: 'office:start',
  OFFICE_OPEN_FOLDER: 'office:open-folder',

  // Agent
  AGENT_LIST: 'agent:list',
  AGENT_SAVE: 'agent:save',
  AGENT_DELETE: 'agent:delete',
  AGENT_CHAT: 'agent:chat',
  AGENT_RUN_TASK: 'agent:run-task',

  // Provider & Auth (OpenCode 风格)
  PROVIDER_LIST: 'provider:list',
  PROVIDER_GET: 'provider:get',
  PROVIDER_DETECT_OLLAMA: 'provider:detect-ollama',
  PROVIDER_SET_BASE_URL: 'provider:set-base-url',
  AUTH_GET_ALL: 'auth:get-all',
  AUTH_SET: 'auth:set',
  AUTH_REMOVE: 'auth:remove',
  CUSTOM_PROVIDER_LIST: 'custom-provider:list',
  CUSTOM_PROVIDER_SAVE: 'custom-provider:save',
  CUSTOM_PROVIDER_DELETE: 'custom-provider:delete',

  // 国际化
  I18N_SET_LANGUAGE: 'i18n:set-language',

  THEME_SET_PREFERENCE: 'theme:set-preference',
  APP_MENU_PERFORM: 'app-menu:perform',

  // 轻量 Office 模块
  LW_READ_FILE: 'lw:read-file',
  LW_SAVE_FILE: 'lw:save-file',
  LW_SAVE_TEXT: 'lw:save-text',
  LW_LIST_FONTS: 'lw:list-fonts',
  LW_COPY_IMAGE_TO_CLIPBOARD: 'lw:copy-image-to-clipboard',
  LW_SET_CURRENT_FILE: 'lw:set-current-file',
  LW_AGENT_RESULT: 'lw:agent-result',
  LW_RUN_CODE: 'lw:run-code',

  // 窗口事件
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_NEW: 'window:new',
  WINDOW_TOGGLE_FULLSCREEN: 'window:toggle-fullscreen',
  WINDOW_CLOSE: 'window:close',
  WINDOW_QUIT: 'window:quit',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
