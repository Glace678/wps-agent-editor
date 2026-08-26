import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createAppMenu, executeAppMenuAction } from './menu/menu'
import { registerFileHandlers } from './ipc/file.handlers'
import { registerOnlyOfficeHandlers } from './ipc/onlyoffice.handlers'
import { registerAgentHandlers, setAgentMainWindowGetter } from './ipc/agent.handlers'
import { registerLightweightOfficeHandlers } from './lightweight-office/handlers'
import { registerProviderHandlers } from './ipc/provider.handlers'
import { registerOfficeHandlers } from './ipc/office.handlers'
import { registerArtifactReviewHandlers } from './ipc/artifact-review.handlers'
import { initOfflineOffice } from './services/offline-office.service'
import { stopLocalBridge } from './services/local-bridge.service'
import { closeAllAgentWindows } from './windows/agent-editor.window'
import { IPC } from './ipc/channels'
import { handleTrustedIpc, registerTrustedRenderer } from './ipc/trusted-ipc'
import { languages, setLanguage, type LanguageCode } from './i18n/types'
import { isAppMenuAction } from '../src/types/app-menu'
import {
  createTrustedRendererArgument,
  externalHttpUrl,
  isTrustedRendererDocument,
} from './security/renderer-boundary'

let mainWindow: BrowserWindow | null = null

const isMac = process.platform === 'darwin'
type ThemePreference = 'system' | 'light' | 'dark'

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

function updateWindowBackgroundColors(): void {
  const color = nativeTheme.shouldUseDarkColors ? '#161a1f' : '#ffffff'
  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(color)
  }
}

// Windows 的原生遮挡检测会误判（虚拟机窗口、录屏层等场景），把可见窗口当作
// 被完全遮挡 → 渲染进程停止出帧，用户看到定格的白/黑窗口。禁用该检测。
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

// Destructive Electron verifiers must never read or write the real user profile.
const testUserDataDir = process.env.WPS_TEST_USER_DATA_DIR?.trim()
if (process.env.WPS_ALLOW_MULTI_INSTANCE === '1' && testUserDataDir) {
  app.setPath('userData', path.resolve(testUserDataDir))
}

// 第二个实例的 Bridge 端口必然冲突（EADDRINUSE），旧行为是静默变成无窗口的
// 僵尸进程。改为单实例：把文件参数转交给已运行的实例。
// WPS_ALLOW_MULTI_INSTANCE=1 供自动化测试并行拉起多实例。
if (process.env.WPS_ALLOW_MULTI_INSTANCE !== '1') {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
  } else {
    app.on('second-instance', (_event, argv) => {
      const fileArg = argv
        .slice(1)
        .find((arg) => !arg.startsWith('-') && path.extname(arg) !== '' && fs.existsSync(arg))
      if (fileArg) {
        createWindow(path.resolve(fileArg))
        return
      }
      const target = mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed()) ?? null
      if (target) {
        if (target.isMinimized()) target.restore()
        target.focus()
      }
    })
  }
}

function logRendererIncident(kind: string, details: unknown): void {
  try {
    const line = `${new Date().toISOString()} ${kind} ${JSON.stringify(details)}\n`
    fs.appendFileSync(path.join(app.getPath('userData'), 'renderer-incidents.log'), line)
  } catch {
    // 日志失败不能影响主流程。
  }
}

const crashReloadHistory = new WeakMap<BrowserWindow, number[]>()

/** 渲染进程死亡后窗口只剩一块白/黑面。有限次自动重载，避免崩溃循环。 */
function attachRendererRecovery(window: BrowserWindow): void {
  window.webContents.on('render-process-gone', (_event, details) => {
    logRendererIncident('render-process-gone', details)
    if (window.isDestroyed() || details.reason === 'clean-exit' || details.reason === 'killed') return
    const now = Date.now()
    const history = (crashReloadHistory.get(window) ?? []).filter((at) => now - at < 120_000)
    if (history.length >= 3) return
    history.push(now)
    crashReloadHistory.set(window, history)
    window.webContents.reloadIgnoringCache()
  })
  window.webContents.on('unresponsive', () => {
    logRendererIncident('unresponsive', { title: window.getTitle() })
  })
}

function getRendererUrl(initialFile?: string): URL {
  const developmentRendererUrl = app.isPackaged
    ? undefined
    : process.env.ELECTRON_RENDERER_URL
  const rendererUrl = developmentRendererUrl
    ? new URL(developmentRendererUrl)
    : pathToFileURL(path.join(__dirname, '../renderer/index.html'))
  if (initialFile) rendererUrl.searchParams.set('openFile', initialFile)
  return rendererUrl
}

function openExternalHttpUrl(rawUrl: string): void {
  const url = externalHttpUrl(rawUrl)
  if (url) void shell.openExternal(url).catch(() => {})
}

function protectRendererNavigation(window: BrowserWindow, rendererUrl: string): void {
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedRendererDocument(url, rendererUrl)) return
    event.preventDefault()
    openExternalHttpUrl(url)
  })
  window.webContents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
    if (!isMainFrame || isTrustedRendererDocument(url, rendererUrl)) return
    event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttpUrl(url)
    return { action: 'deny' }
  })
}

function createWindow(initialFile?: string): BrowserWindow {
  const rendererUrl = getRendererUrl(initialFile)
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'WPS Agent Editor',
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }
      : { frame: true }),
    // 渲染树尚未挂载或已崩溃时窗口显示这块底色；跟随系统主题，
    // 避免暗色环境闪白 / 亮色环境闪黑。
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161a1f' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      additionalArguments: [createTrustedRendererArgument(rendererUrl.toString())],
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: true,
      webviewTag: false,
      nodeIntegrationInSubFrames: false,
      navigateOnDragDrop: false,
      // 文档编辑器被遮挡/最小化时也不能停帧：恢复可见时若无新帧，
      // 窗口会一直显示空白面（本机实测的白/黑屏形态之一）。
      backgroundThrottling: false,
    },
  })

  if (!isMac) window.setMenuBarVisibility(false)

  registerTrustedRenderer(window.webContents, rendererUrl.toString())
  attachRendererRecovery(window)
  protectRendererNavigation(window, rendererUrl.toString())

  void window.loadURL(rendererUrl.toString())

  // On Windows/Linux, Chromium reports a mouse Back side-button as an app
  // command instead of reliably dispatching a DOM mouse event.
  window.on('app-command', (event, command) => {
    if (command !== 'browser-backward' || window.webContents.isDestroyed()) return
    event.preventDefault()
    window.webContents.send(IPC.FILE_NAVIGATE_BACK)
  })

  // 限制触控板捏合整页缩放；Ctrl+/- 文档区缩放由渲染进程 CSS zoom 处理
  // 注意：不要在 before-input-event 里 preventDefault，否则渲染进程收不到按键
  window.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {})
  const lockPageZoom = () => {
    if (window.isDestroyed()) return
    if (Math.abs(window.webContents.getZoomFactor() - 1) > 0.001) {
      window.webContents.setZoomFactor(1)
    }
  }
  window.webContents.on('did-finish-load', lockPageZoom)
  window.webContents.on('zoom-changed', lockPageZoom)

  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = window
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed()) ?? null
    }
  })
  return window
}

app.whenReady().then(async () => {
  nativeTheme.on('updated', updateWindowBackgroundColors)

  // Lightweight Office is the default editor. The legacy Document Server
  // bridge is opt-in and must never start with a public/default JWT secret.
  if (process.env.OO_JWT_SECRET?.trim()) {
    try {
      await initOfflineOffice()
    } catch (error) {
      // Bridge initialization must never prevent the primary editor window.
      console.error('[main] offline office init failed; continuing without bridge:', error)
      logRendererIncident('bridge-init-failed', String(error))
    }
  }

  registerFileHandlers()
  registerOnlyOfficeHandlers()
  registerAgentHandlers()
  registerProviderHandlers()
  registerOfficeHandlers()
  registerArtifactReviewHandlers(() => mainWindow)

  // 轻量 IPC：PDF/文本回退预览需要 read/save 文件
  registerLightweightOfficeHandlers(() => mainWindow)
  setAgentMainWindowGetter(() => mainWindow)

  handleTrustedIpc(IPC.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  handleTrustedIpc(IPC.WINDOW_MAXIMIZE, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window?.isMaximized()) window.unmaximize()
    else window?.maximize()
  })
  handleTrustedIpc(IPC.WINDOW_NEW, (_event, filePath?: string) => {
    createWindow(filePath)
  })
  handleTrustedIpc(IPC.WINDOW_TOGGLE_FULLSCREEN, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    window?.setFullScreen(!window.isFullScreen())
  })
  handleTrustedIpc(IPC.WINDOW_CLOSE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  handleTrustedIpc(IPC.WINDOW_QUIT, () => {
    app.quit()
  })
  handleTrustedIpc(IPC.THEME_SET_PREFERENCE, (_event, preference: unknown) => {
    if (!isThemePreference(preference)) {
      throw new Error(`Unsupported theme preference: ${String(preference)}`)
    }
    nativeTheme.themeSource = preference
    updateWindowBackgroundColors()
    return { success: true as const }
  })
  handleTrustedIpc(IPC.APP_MENU_PERFORM, (event, action: unknown) => {
    if (!isAppMenuAction(action)) {
      throw new Error(`Unsupported application menu action: ${String(action)}`)
    }
    executeAppMenuAction(action, BrowserWindow.fromWebContents(event.sender))
    return { success: true as const }
  })
  handleTrustedIpc(IPC.I18N_SET_LANGUAGE, (_event, language: LanguageCode) => {
    if (!languages.some(({ code }) => code === language)) {
      throw new Error(`Unsupported language: ${language}`)
    }
    setLanguage(language)
    createAppMenu(() => BrowserWindow.getFocusedWindow() ?? mainWindow)
    return { success: true as const }
  })

  createWindow()
  createAppMenu(() => BrowserWindow.getFocusedWindow() ?? mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeAllAgentWindows()
  if (!isMac) app.quit()
})

app.on('before-quit', () => {
  closeAllAgentWindows()
  stopLocalBridge()
})
