/**
 * Embedded loopback bridge used by the local OnlyOffice Document Server.
 */
import type { Server } from 'node:http'
import {
  createOnlyOfficeBridge,
  type OnlyOfficeBridge,
} from '../../server/onlyoffice-bridge/bridge'

const BRIDGE_HOST = '127.0.0.1'
const configuredPort = Number.parseInt(process.env.WPS_BRIDGE_PORT ?? '', 10)
const BRIDGE_PORT = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
  ? configuredPort
  : 13001

export interface LocalBridgeOptions {
  documentServerUrl: string
  onlyOfficeJwtSecret: string
}

export interface RegisteredBridgeDocument {
  documentId: string
  fileName: string
  documentUrl: string
  callbackUrl: string
}

let server: Server | null = null
let bridge: OnlyOfficeBridge | null = null
let startup: Promise<void> | null = null

export function getBridgeUrl(): string {
  return `http://${BRIDGE_HOST}:${BRIDGE_PORT}`
}

function requireBridge(): OnlyOfficeBridge {
  if (!bridge || !server) throw new Error('BRIDGE_NOT_RUNNING')
  return bridge
}

export async function allowOpenedDocument(filePath: string): Promise<void> {
  if (!bridge || !server) return
  await bridge.documents.allowOpenedDocument(filePath)
}

export async function registerOpenedDocument(filePath: string): Promise<RegisteredBridgeDocument> {
  const document = await requireBridge().documents.registerDocument(filePath)
  const baseUrl = getBridgeUrl()
  return {
    ...document,
    documentUrl: `${baseUrl}/documents/${document.documentId}`,
    callbackUrl: `${baseUrl}/callback/${document.documentId}`,
  }
}

export async function revokeOpenedDocument(filePath: string): Promise<void> {
  if (!bridge) return
  await bridge.documents.revokeOpenedDocument(filePath)
}

export async function startLocalBridge(options: LocalBridgeOptions): Promise<void> {
  if (server) return
  if (startup) return startup

  const pendingBridge = createOnlyOfficeBridge({
    expectedDownloadOrigins: [options.documentServerUrl],
    onlyOfficeJwtSecret: options.onlyOfficeJwtSecret,
  })
  bridge = pendingBridge
  startup = new Promise<void>((resolve, reject) => {
    const pendingServer = pendingBridge.app.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
      server = pendingServer
      console.info(`[Bridge] Offline document bridge listening at ${getBridgeUrl()}`)
      resolve()
    })
    pendingServer.once('error', (error) => {
      if (bridge === pendingBridge) bridge = null
      reject(error)
    })
  })

  try {
    await startup
  } finally {
    startup = null
  }
}

export async function stopLocalBridge(): Promise<void> {
  const activeServer = server
  const activeBridge = bridge
  server = null
  bridge = null
  activeBridge?.documents.clear()
  if (activeServer) {
    await new Promise<void>((resolve) => activeServer.close(() => resolve()))
  }
}
