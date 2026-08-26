/**
 * Offline Office orchestration for the local Document Server and loopback bridge.
 */
import type { OnlyOfficeConfig } from './onlyoffice.service'
import {
  allowOpenedDocument,
  getBridgeUrl,
  registerOpenedDocument,
  revokeOpenedDocument,
  startLocalBridge,
  type RegisteredBridgeDocument,
} from './local-bridge.service'
import { assertStrongOnlyOfficeSecret } from '../../server/onlyoffice-bridge/bridge'
import {
  getOfficeServerState,
  checkDocumentServerHealth,
  type OfficeServerState,
} from './document-server.service'

const DOCUMENT_SERVER_URL = 'http://127.0.0.1:8080'

let initialized = false

function getOnlyOfficeJwtSecret(): string {
  return assertStrongOnlyOfficeSecret(process.env.OO_JWT_SECRET ?? '')
}

async function ensureBridgeStarted(): Promise<void> {
  await startLocalBridge({
    documentServerUrl: DOCUMENT_SERVER_URL,
    onlyOfficeJwtSecret: getOnlyOfficeJwtSecret(),
  })
}

export async function initOfflineOffice(): Promise<OfficeServerState> {
  if (!initialized) {
    await ensureBridgeStarted()
    initialized = true
  }
  return getOfficeServerState()
}

export function getOfflineOnlyOfficeConfig(): OnlyOfficeConfig {
  return {
    documentServerUrl: DOCUMENT_SERVER_URL,
    bridgeUrl: getBridgeUrl(),
    jwtSecret: getOnlyOfficeJwtSecret(),
  }
}

export async function isOfflineEditorReady(): Promise<boolean> {
  await ensureBridgeStarted()
  return checkDocumentServerHealth()
}

export async function allowOpenedDocumentInBridge(filePath: string): Promise<boolean> {
  try {
    await allowOpenedDocument(filePath)
    return true
  } catch {
    // Lightweight Office supports more file types and larger files than the
    // legacy Document Server bridge. Opening those files must still work.
    return false
  }
}

export async function bindDocumentToBridge(filePath: string): Promise<RegisteredBridgeDocument> {
  return registerOpenedDocument(filePath)
}

export async function revokeOpenedDocumentInBridge(filePath: string): Promise<void> {
  await revokeOpenedDocument(filePath)
}

export async function getOfflineStatus(): Promise<OfficeServerState & { bridgeUrl: string }> {
  const state = await initOfflineOffice()
  return { ...state, bridgeUrl: getBridgeUrl() }
}
