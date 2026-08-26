import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import http, { type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import jwt, { type JwtPayload } from 'jsonwebtoken'
import {
  assertStrongOnlyOfficeSecret,
  createBridgeSessionToken,
  createOnlyOfficeBridge,
} from '../server/onlyoffice-bridge/bridge'
import { buildEditorConfig } from '../electron/services/onlyoffice.service'

const JWT_SECRET = 'onlyoffice-bridge-test-secret-32-bytes-minimum'

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

async function main(): Promise<void> {
  assert.throws(() => assertStrongOnlyOfficeSecret('public-default'), /ONLYOFFICE_JWT_SECRET_REQUIRED/)
  assert.equal(assertStrongOnlyOfficeSecret(JWT_SECRET), JWT_SECRET)
  assert.match(createBridgeSessionToken(), /^[A-Za-z0-9_-]{43}$/)

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wps-onlyoffice-bridge-'))
  const documentPath = path.join(tempDir, 'document.docx')
  const unapprovedPath = path.join(tempDir, 'unapproved.docx')
  const sensitivePath = path.join(tempDir, '.env')
  await fs.writeFile(documentPath, 'original')
  await fs.writeFile(unapprovedPath, 'private')
  await fs.writeFile(sensitivePath, 'API_KEY=never-serve-this')

  const downloadServer = http.createServer((request, response) => {
    if (request.url === '/saved') {
      response.end('saved-version')
      return
    }
    if (request.url === '/oversized') {
      response.write(Buffer.alloc(24, 'a'))
      response.end(Buffer.alloc(24, 'b'))
      return
    }
    if (request.url === '/declared-too-large') {
      response.setHeader('Content-Length', '1000')
      response.end('x')
      return
    }
    if (request.url === '/redirect') {
      response.statusCode = 302
      response.setHeader('Location', '/saved')
      response.end()
      return
    }
    response.statusCode = 404
    response.end()
  })

  let bridgeServer: Server | null = null
  try {
    const downloadOrigin = await listen(downloadServer)
    const bridge = createOnlyOfficeBridge({
      expectedDownloadOrigins: [downloadOrigin],
      onlyOfficeJwtSecret: JWT_SECRET,
      maxCallbackBytes: 32,
      callbackTimeoutMs: 2_000,
      logger: { info() {}, warn() {}, error() {} },
    })
    bridgeServer = http.createServer(bridge.app)
    const bridgeOrigin = await listen(bridgeServer)
    const sessionAuthorization = { Authorization: `Bearer ${bridge.sessionToken}` }

    await assert.rejects(
      bridge.documents.registerDocument(unapprovedPath),
      /BRIDGE_DOCUMENT_NOT_OPEN/,
    )
    await assert.rejects(
      bridge.documents.allowOpenedDocument(tempDir),
      /BRIDGE_DOCUMENT_NOT_REGULAR_FILE/,
    )
    await assert.rejects(
      bridge.documents.allowOpenedDocument(sensitivePath),
      /BRIDGE_DOCUMENT_TYPE_UNSUPPORTED/,
    )

    await bridge.documents.allowOpenedDocument(documentPath)
    const registration = await bridge.documents.registerDocument(documentPath)
    const duplicate = await bridge.documents.registerDocument(documentPath)
    assert.deepEqual(duplicate, registration)
    assert.match(registration.documentId, /^[A-Za-z0-9_-]{43}$/)

    const documentUrl = `${bridgeOrigin}/documents/${registration.documentId}`
    const callbackUrl = `${bridgeOrigin}/callback/${registration.documentId}`
    const documentToken = jwt.sign(
      { payload: { url: documentUrl } },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '5m' },
    )

    let response = await fetch(`${bridgeOrigin}/health`)
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('access-control-allow-origin'), null)

    response = await fetch(`${bridgeOrigin}/health`, { headers: sessionAuthorization })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok', offline: true })
    assert.equal(response.headers.get('access-control-allow-origin'), null)

    response = await fetch(`${bridgeOrigin}/health`, {
      headers: { ...sessionAuthorization, Origin: 'https://attacker.invalid' },
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('access-control-allow-origin'), null)

    response = await fetch(`${bridgeOrigin}/register`, {
      method: 'POST',
      headers: sessionAuthorization,
    })
    assert.equal(response.status, 404)
    response = await fetch(`${bridgeOrigin}/token`, {
      method: 'POST',
      headers: sessionAuthorization,
    })
    assert.equal(response.status, 404)

    response = await fetch(documentUrl)
    assert.equal(response.status, 401)
    response = await fetch(`${documentUrl}?path=${encodeURIComponent(unapprovedPath)}`, {
      headers: sessionAuthorization,
    })
    assert.equal(response.status, 400)

    const wrongDocumentToken = jwt.sign(
      { payload: { url: `${bridgeOrigin}/documents/${'A'.repeat(43)}` } },
      JWT_SECRET,
      { algorithm: 'HS256' },
    )
    response = await fetch(documentUrl, {
      headers: { Authorization: `Bearer ${wrongDocumentToken}` },
    })
    assert.equal(response.status, 401)

    response = await fetch(documentUrl, {
      headers: { Authorization: `Bearer ${documentToken}` },
    })
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'original')

    const editorConfig = await buildEditorConfig(
      documentPath,
      'test-user',
      'Test User',
      { documentServerUrl: downloadOrigin, bridgeUrl: bridgeOrigin, jwtSecret: JWT_SECRET },
      { documentId: registration.documentId, documentUrl, callbackUrl },
    )
    assert.equal(editorConfig.document.url, documentUrl)
    assert.equal(editorConfig.editorConfig.callbackUrl, callbackUrl)
    assert(!editorConfig.document.url.includes('?'))
    assert(!JSON.stringify(editorConfig).includes(path.dirname(documentPath)))
    const signedConfig = jwt.verify(editorConfig.token!, JWT_SECRET, {
      algorithms: ['HS256'],
    }) as JwtPayload
    assert.equal(
      (signedConfig.editorConfig as Record<string, unknown>).callbackUrl,
      callbackUrl,
    )

    const postCallback = async (body: Record<string, unknown>, tokenBody = body) => fetch(callbackUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt.sign({ payload: tokenBody }, JWT_SECRET, { algorithm: 'HS256' })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const savedBody = {
      key: registration.documentId,
      status: 6,
      url: `${downloadOrigin}/saved`,
    }
    response = await postCallback(savedBody, { ...savedBody, status: 2 })
    assert.equal(response.status, 401)
    assert.equal(await fs.readFile(documentPath, 'utf8'), 'original')

    const ssrfBody = {
      key: registration.documentId,
      status: 6,
      url: 'http://127.0.0.1:1/private',
    }
    response = await postCallback(ssrfBody)
    assert.equal(response.status, 502)
    assert.equal(await fs.readFile(documentPath, 'utf8'), 'original')

    for (const route of ['redirect', 'declared-too-large', 'oversized']) {
      const body = {
        key: registration.documentId,
        status: 6,
        url: `${downloadOrigin}/${route}`,
      }
      response = await postCallback(body)
      assert.equal(response.status, 502, route)
      assert.equal(await fs.readFile(documentPath, 'utf8'), 'original', route)
    }
    const tempFiles = await fs.readdir(tempDir)
    assert(!tempFiles.some((name) => name.endsWith('.tmp')))

    response = await postCallback(savedBody)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { error: 0 })
    assert.equal(await fs.readFile(documentPath, 'utf8'), 'saved-version')

    response = await postCallback({ ...savedBody, status: 2 })
    assert.equal(response.status, 200)
    response = await fetch(documentUrl, { headers: sessionAuthorization })
    assert.equal(response.status, 404)

    const reopened = await bridge.documents.registerDocument(documentPath)
    assert.notEqual(reopened.documentId, registration.documentId)
    const reopenedCallbackUrl = `${bridgeOrigin}/callback/${reopened.documentId}`
    const closeBody = { key: reopened.documentId, status: 4 }
    response = await fetch(reopenedCallbackUrl, {
      method: 'POST',
      headers: {
        ...sessionAuthorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(closeBody),
    })
    assert.equal(response.status, 200)
    assert.equal(await bridge.documents.resolveDocument(reopened.documentId), null)

    const renamedPath = path.join(tempDir, 'renamed.docx')
    await fs.rename(documentPath, renamedPath)
    await bridge.documents.revokeOpenedDocument(documentPath)
    await assert.rejects(
      bridge.documents.registerDocument(renamedPath),
      /BRIDGE_DOCUMENT_NOT_OPEN/,
    )
  } finally {
    if (bridgeServer) await close(bridgeServer)
    await close(downloadServer)
    await fs.rm(tempDir, { recursive: true, force: true })
  }

  console.info('OnlyOffice bridge security tests passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
