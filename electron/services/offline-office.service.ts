/**
 * 离线 Office 编排 — 应用启动时自动初始化本地引擎
 */
import type { OnlyOfficeConfig } from './onlyoffice.service'
import { startLocalBridge, getBridgeUrl, registerDocumentKey } from './local-bridge.service'
import {
  getOfficeServerState,
  checkDocumentServerHealth,
  type OfficeServerState,
} from './document-server.service'

const LOCAL_JWT_SECRET = process.env.OO_JWT_SECRET || ''

let initialized = false

export async function initOfflineOffice(): Promise<OfficeServerState> {
  if (!initialized) {
    await startLocalBridge()
    initialized = true
  }
  return getOfficeServerState()
}

export function getOfflineOnlyOfficeConfig(): OnlyOfficeConfig {
  return {
    documentServerUrl: 'http://127.0.0.1:8080',
    bridgeUrl: getBridgeUrl(),
    jwtSecret: LOCAL_JWT_SECRET,
  }
}

export async function isOfflineEditorReady(): Promise<boolean> {
  await startLocalBridge()
  return checkDocumentServerHealth()
}

export function bindDocumentToBridge(key: string, filePath: string): void {
  registerDocumentKey(key, filePath)
}

export async function getOfflineStatus(): Promise<OfficeServerState & { bridgeUrl: string }> {
  const state = await initOfflineOffice()
  return { ...state, bridgeUrl: getBridgeUrl() }
}