import { BrowserWindow } from 'electron'
import { randomBytes } from 'node:crypto'
import {
  buildAgentEditorConfig,
  buildConnectorScript,
  type AgentEditCommand,
  type OnlyOfficeConfig,
} from '../services/onlyoffice.service'
import { loopbackHttpUrl } from '../security/renderer-boundary'
import { bindDocumentToBridge } from '../services/offline-office.service'

const agentWindows = new Map<string, BrowserWindow>()

export async function getOrCreateAgentWindow(
  agentId: string,
  agentName: string,
  filePath: string,
  ooConfig: OnlyOfficeConfig,
): Promise<BrowserWindow> {
  const existing = agentWindows.get(agentId)
  if (existing && !existing.isDestroyed()) {
    return existing
  }

  const registration = await bindDocumentToBridge(filePath)
  const config = await buildAgentEditorConfig(filePath, agentId, agentName, ooConfig, registration)

  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: true,
      webviewTag: false,
      nodeIntegrationInSubFrames: false,
      navigateOnDragDrop: false,
    },
  })

  const configJson = JSON.stringify(config).replaceAll('<', '\\u003c')
  const serverUrl = loopbackHttpUrl(ooConfig.documentServerUrl)
  if (!serverUrl) throw new Error('INVALID_ONLYOFFICE_SERVER_URL')
  const serverOrigin = new URL(serverUrl).origin
  const documentsApiUrl = new URL('/web-apps/apps/api/documents/api.js', serverUrl).toString()
  const scriptNonce = randomBytes(18).toString('base64')
  const contentSecurityPolicy = [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src 'nonce-${scriptNonce}' ${serverOrigin}`,
    `connect-src ${serverOrigin}`,
    `frame-src ${serverOrigin}`,
    `img-src ${serverOrigin} data: blob:`,
    "style-src 'unsafe-inline'",
    "form-action 'none'",
  ].join('; ')

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
  <script nonce="${scriptNonce}" src="${documentsApiUrl}"></script>
</head>
<body>
  <div id="editor" style="width:100%;height:100vh"></div>
  <script nonce="${scriptNonce}">
    var config = ${configJson};
    var docEditor = new DocsAPI.DocEditor("editor", config);

    window.addEventListener('load', function() {
      setTimeout(function() {
        if (typeof DocsAPI !== 'undefined') {
          window.connectorReady = true;
        }
      }, 3000);
    });
  </script>
</body>
</html>`

  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  agentWindows.set(agentId, win)

  win.on('closed', () => {
    agentWindows.delete(agentId)
  })

  return win
}

export async function executeAgentEdit(
  agentId: string,
  agentName: string,
  filePath: string,
  command: AgentEditCommand,
  ooConfig: OnlyOfficeConfig,
): Promise<unknown> {
  const win = await getOrCreateAgentWindow(agentId, agentName, filePath, ooConfig)

  // 等待编辑器就绪
  await new Promise((r) => setTimeout(r, 2000))

  const script = buildConnectorScript(command)
  try {
    const result = await win.webContents.executeJavaScript(script)
    return result
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export function closeAgentWindow(agentId: string): void {
  const win = agentWindows.get(agentId)
  if (win && !win.isDestroyed()) {
    win.close()
  }
  agentWindows.delete(agentId)
}

export function closeAllAgentWindows(): void {
  for (const [id] of agentWindows) {
    closeAgentWindow(id)
  }
}
