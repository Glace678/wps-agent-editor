import { BrowserWindow } from 'electron'
import path from 'node:path'
import {
  buildAgentEditorConfig,
  buildConnectorScript,
  type AgentEditCommand,
  type OnlyOfficeConfig,
} from '../services/onlyoffice.service'

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

  const config = await buildAgentEditorConfig(filePath, agentId, agentName, ooConfig)

  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  })

  const configJson = JSON.stringify(config)
  const serverUrl = ooConfig.documentServerUrl

  const html = `
<!DOCTYPE html>
<html>
<head>
  <script src="${serverUrl}/web-apps/apps/api/documents/api.js"></script>
</head>
<body>
  <div id="editor" style="width:100%;height:100vh"></div>
  <script>
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