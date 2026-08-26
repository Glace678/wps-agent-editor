/**
 * Standalone development entry point for the hardened OnlyOffice bridge.
 * Production Electron builds use electron/services/local-bridge.service.ts.
 */
import { createOnlyOfficeBridge, assertStrongOnlyOfficeSecret } from './bridge'

const BRIDGE_HOST = '127.0.0.1'
const configuredPort = Number.parseInt(process.env.BRIDGE_PORT ?? '', 10)
const BRIDGE_PORT = Number.isInteger(configuredPort)
  && configuredPort > 0
  && configuredPort <= 65535
  ? configuredPort
  : 3001
const DOCUMENT_SERVER_URL = process.env.OO_SERVER_URL?.trim() || 'http://127.0.0.1:8080'
const JWT_SECRET = assertStrongOnlyOfficeSecret(process.env.OO_JWT_SECRET ?? '')

function configuredDocumentPaths(): string[] {
  const raw = process.env.OO_ALLOWED_DOCUMENTS?.trim()
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
    throw new Error('OO_ALLOWED_DOCUMENTS must be a JSON array of absolute file paths')
  }
  return [...new Set(parsed)]
}

async function main(): Promise<void> {
  const bridge = createOnlyOfficeBridge({
    expectedDownloadOrigins: [DOCUMENT_SERVER_URL],
    onlyOfficeJwtSecret: JWT_SECRET,
  })

  const registrations: Array<{
    documentId: string
    documentUrl: string
    callbackUrl: string
  }> = []
  for (const filePath of configuredDocumentPaths()) {
    await bridge.documents.allowOpenedDocument(filePath)
    const document = await bridge.documents.registerDocument(filePath)
    registrations.push({
      documentId: document.documentId,
      documentUrl: `http://${BRIDGE_HOST}:${BRIDGE_PORT}/documents/${document.documentId}`,
      callbackUrl: `http://${BRIDGE_HOST}:${BRIDGE_PORT}/callback/${document.documentId}`,
    })
  }

  const server = bridge.app.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
    console.info(`[Bridge] Listening on http://${BRIDGE_HOST}:${BRIDGE_PORT}`)
    if (registrations.length > 0) {
      console.info('[Bridge] Server-approved document registrations:', registrations)
    }
  })

  function shutdown(): void {
    bridge.documents.clear()
    server.close(() => process.exit(0))
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

void main().catch((error) => {
  console.error('[Bridge] Startup failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
