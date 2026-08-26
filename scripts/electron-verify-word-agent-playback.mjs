import { createRequire } from 'node:module'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const JSZip = require('jszip')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronViteCli = path.join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const artifactDir = path.join(root, '.cache', 'word-agent-playback')
const bridgeModuleUrl = `/@fs/${path.join(root, 'src', 'lightweight-office', 'agent', 'document-bridge.ts').replaceAll('\\', '/')}`
const agentStoreModuleUrl = `/@fs/${path.join(root, 'src', 'stores', 'agent.store.ts').replaceAll('\\', '/')}`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function check(condition, message, detail = '') {
  if (!condition) throw new Error(`${message}${detail ? `: ${detail}` : ''}`)
  console.log(`PASS ${message}${detail ? `: ${detail}` : ''}`)
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => {
        if (error) reject(error)
        else if (typeof address === 'object' && address) resolve(address.port)
        else reject(new Error('Could not allocate a port'))
      })
    })
  })
}

async function waitForRenderer(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = targets.find((target) => target.type === 'page' && /^https?:\/\//.test(String(target.url)))
      if (page?.webSocketDebuggerUrl) return page
    } catch {}
    await sleep(200)
  }
  throw new Error('Electron renderer did not expose a CDP target')
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const pending = new Map()
    let nextId = 1
    const send = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        rejectCall(new Error(`CDP timeout: ${method}`))
      }, 30_000)
      pending.set(id, { resolveCall, rejectCall, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
    socket.addEventListener('open', () => resolve({ socket, send }))
    socket.addEventListener('error', reject)
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      clearTimeout(request.timer)
      if (message.error) request.rejectCall(new Error(message.error.message))
      else request.resolveCall(message)
    })
    socket.addEventListener('close', () => {
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.rejectCall(new Error('CDP socket closed'))
      }
      pending.clear()
    })
  })
}

async function evaluate(send, expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (response.result.exceptionDetails) {
    throw new Error(
      response.result.exceptionDetails.exception?.description
      || response.result.exceptionDetails.text,
    )
  }
  return response.result.result?.value
}

async function waitFor(send, expression, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let lastValue
  while (Date.now() < deadline) {
    lastValue = await evaluate(send, expression)
    if (lastValue) return lastValue
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(lastValue)}`)
}

async function capture(send, name, clip) {
  const result = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  })
  const outputPath = path.join(artifactDir, name)
  const bytes = Buffer.from(result.result.data, 'base64')
  await fs.promises.writeFile(outputPath, bytes)
  check(bytes.length > 10_000, `${name} is nonblank`, `${bytes.length} bytes`)
  return outputPath
}

async function buildFixture(filePath) {
  const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const drawing = [
    '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">',
    '<wp:extent cx="1524000" cy="914400"/><wp:docPr id="1" name="Playback fixture image"/>',
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="fixture.png"/><pic:cNvPicPr/></pic:nvPicPr>',
    '<pic:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>',
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1524000" cy="914400"/></a:xfrm>',
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>',
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
  ].join('')
  const table = [
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>',
    '<w:top w:val="single" w:sz="4" w:color="64748B"/><w:left w:val="single" w:sz="4" w:color="64748B"/>',
    '<w:bottom w:val="single" w:sz="4" w:color="64748B"/><w:right w:val="single" w:sz="4" w:color="64748B"/>',
    '<w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/>',
    '</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="3600"/><w:gridCol w:w="3600"/></w:tblGrid>',
    '<w:tr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Status</w:t></w:r></w:p></w:tc></w:tr>',
    '<w:tr><w:tc><w:p><w:r><w:t>Playback</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>TABLE OLD VALUE</w:t></w:r></w:p></w:tc></w:tr>',
    '</w:tbl>',
  ].join('')
  const body = [
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>AGENT PLAYBACK REVIEW</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>REMOVE THIS SENTENCE BEFORE DELIVERY.</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>The draft still contains OLD WORDING for the introduction.</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>ZOOM FIFTY TARGET</w:t></w:r></w:p>',
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
    '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Review Details</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>COMMENT ANCHOR requires a reviewer note.</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>FORMAT THIS PHRASE as an approved emphasis.</w:t></w:r></w:p>',
    table,
    '<w:p><w:r><w:t>ZOOM TWO HUNDRED TARGET</w:t></w:r></w:p>',
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
    '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Objects and Layout</w:t></w:r></w:p>',
    drawing,
    '<w:p><w:r><w:t>INTERRUPT FIRST TARGET</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>INTERRUPT SECOND TARGET</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>FINAL SECTION TARGET</w:t></w:r></w:p>',
    '<w:sectPr><w:headerReference w:type="default" r:id="rId3"/><w:footerReference w:type="default" r:id="rId4"/>',
    '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>',
    '</w:sectPr>',
  ].join('')

  const zip = new JSZip()
  zip.file('[Content_Types].xml', `${header}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`)
  zip.file('_rels/.rels', `${header}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file('word/_rels/document.xml.rels', `${header}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/fixture.png"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`)
  zip.file('word/styles.xml', `${header}<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`)
  zip.file('word/header1.xml', `${header}<w:hdr xmlns:w="${w}"><w:p><w:r><w:t>Agent Playback Fixture Header</w:t></w:r></w:p></w:hdr>`)
  zip.file('word/footer1.xml', `${header}<w:ftr xmlns:w="${w}"><w:p><w:r><w:t>Verified Footer</w:t></w:r></w:p></w:ftr>`)
  zip.file('word/media/fixture.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nUwAAAAASUVORK5CYII=', 'base64'))
  zip.file('word/document.xml', `${header}<w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}</w:body></w:document>`)
  await fs.promises.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
}

async function openFile(send, filePath) {
  const result = await evaluate(send, `(async () => {
    const filePath = ${JSON.stringify(filePath)}
    await window.api.file.open(filePath)
    const root = document.getElementById('root')
    const rootKey = Object.keys(root || {}).find((key) => key.startsWith('__reactContainer') || key.startsWith('__reactFiber'))
    const seed = rootKey ? root[rootKey] : null
    const queue = [seed?.current, seed].filter(Boolean)
    const seen = new Set()
    while (queue.length) {
      const fiber = queue.shift()
      if (!fiber || seen.has(fiber)) continue
      seen.add(fiber)
      if (typeof fiber.memoizedProps?.onOpenFile === 'function') {
        await fiber.memoizedProps.onOpenFile(filePath)
        return { opened: true, visited: seen.size }
      }
      if (fiber.child) queue.push(fiber.child)
      if (fiber.sibling) queue.push(fiber.sibling)
    }
    return { opened: false, visited: seen.size }
  })()`)
  check(result?.opened, 'fixture opened through the application', JSON.stringify(result))
}

async function setZoom(send, percent) {
  await evaluate(send, `document.querySelector('[data-testid="word-zoom-trigger"]')?.click()`)
  await waitFor(send, `Boolean(document.querySelector('[data-testid="word-zoom-custom-input"]'))`, 'zoom popup')
  await evaluate(send, `(() => {
    const input = document.querySelector('[data-testid="word-zoom-custom-input"]')
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(percent))})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(50)
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
  await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === ${JSON.stringify(String(percent / 100))}`,
    `${percent}% zoom`,
  )
}

function startSingleStepExpression(planId, search, replacement, page) {
  return `(async () => {
    const bridge = globalThis.__wordAgentBridge
    const doc = bridge.getState().superdoc.activeEditor.doc
    globalThis.__wordAgentRun = bridge.execute({
      action: 'applyWordPlan', runId: ${JSON.stringify(`run-${planId}`)}, operationId: ${JSON.stringify(`op-${planId}`)},
      agentId: 'visual-agent', agentName: 'Draft Agent', baseRevision: bridge.getState().revision,
      plan: {
        planId: ${JSON.stringify(planId)}, version: 1,
        documentRevision: bridge.getState().revision,
        documentApiRevision: doc.info({}).revision,
        steps: [{
          id: ${JSON.stringify(`${planId}-step`)}, operationId: 'replace', input: { text: ${JSON.stringify(replacement)} },
          anchor: { search: ${JSON.stringify(search)}, occurrence: 0, page: ${page} }, visual: 'text-replace', label: 'Update wording'
        }]
      }
    })
    return true
  })()`
}

const fixtureDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wps-word-agent-playback-'))
const profileDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wps-word-agent-profile-'))
const fixturePath = path.join(fixtureDir, 'word-agent-playback.docx')
const dummyPath = path.join(fixtureDir, 'between-documents.txt')
await fs.promises.mkdir(artifactDir, { recursive: true })
await fs.promises.writeFile(dummyPath, 'Switch document before reopening the Word fixture.')
await buildFixture(fixturePath)
const originalFixtureBytes = await fs.promises.readFile(fixturePath)

let child
let socket
const logs = []
try {
  const cdpPort = await freePort()
  const bridgePort = await freePort()
  child = spawn(process.execPath, [electronViteCli, root, '--remoteDebuggingPort', String(cdpPort)], {
    cwd: root,
    env: {
      ...process.env,
      WPS_ALLOW_MULTI_INSTANCE: '1',
      WPS_TEST_USER_DATA_DIR: profileDir,
      WPS_BRIDGE_PORT: String(bridgePort),
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => logs.push(String(chunk)))
  child.stderr.on('data', (chunk) => logs.push(String(chunk)))

  const target = await waitForRenderer(cdpPort)
  let send
  ;({ socket, send } = await connectCdp(target.webSocketDebuggerUrl))
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
  await waitFor(send, `document.getElementById('root')?.childElementCount > 0`, 'React application')
  await openFile(send, fixturePath)
  await waitFor(send, `document.querySelectorAll('.superdoc-page').length >= 3`, 'three rendered Word pages', 40_000)
  await evaluate(send, `(async () => {
    const module = await import(${JSON.stringify(bridgeModuleUrl)})
    globalThis.__wordAgentBridge = module.documentBridge
    return true
  })()`)
  await waitFor(send, `globalThis.__wordAgentBridge?.getState().kind === 'word'`, 'Word document bridge')

  const planInfo = await evaluate(send, `(async () => {
    const bridge = globalThis.__wordAgentBridge
    const state = bridge.getState()
    const doc = state.superdoc.activeEditor.doc
    const available = (id) => doc.capabilities().operations[id]?.available === true
    const steps = [
      { id: 'delete-copy', operationId: 'replace', input: { text: '' }, anchor: { search: 'REMOVE THIS SENTENCE BEFORE DELIVERY.', occurrence: 0, page: 1 }, visual: 'text-delete', label: 'Remove obsolete sentence' },
      { id: 'replace-copy', operationId: 'replace', input: { text: 'CURRENT WORDING' }, anchor: { search: 'OLD WORDING', occurrence: 0, page: 1 }, visual: 'text-replace', label: 'Refresh introduction' },
      { id: 'format-copy', operationId: 'format.bold', input: { value: true }, anchor: { search: 'FORMAT THIS PHRASE', occurrence: 0, page: 2 }, visual: 'format', label: 'Apply bold' },
    ]
    if (available('comments.create')) {
      steps.push({ id: 'create-comment', operationId: 'comments.create', input: { text: 'Review confirmed by Agent.' }, anchor: { search: 'COMMENT ANCHOR', occurrence: 0, page: 2 }, visual: 'object-anchor', label: 'Add reviewer comment' })
      if (available('comments.patch')) {
        steps.push({ id: 'patch-comment', operationId: 'comments.patch', input: { commentId: { $step: 'create-comment', path: 'id' }, text: 'Review confirmed and recorded.' }, dependsOn: ['create-comment'], anchor: { page: 2, region: 'page' }, visual: 'object-anchor', label: 'Finalize reviewer comment' })
      }
    }
    try {
      const table = doc.find({ select: { type: 'node', nodeType: 'table' }, includeNodes: true, limit: 1 }).items[0]
      if (table && available('tables.setCellText')) {
        steps.push({ id: 'table-cell', operationId: 'tables.setCellText', input: { target: table.address, rowIndex: 1, columnIndex: 1, text: 'VERIFIED' }, anchor: { page: 2, blockId: table.address.nodeId, region: 'page' }, visual: 'table-cell', label: 'Verify table cell' })
      }
    } catch {}
    try {
      const image = doc.images.list({}).items[0]
      if (image && available('images.setAltText')) {
        steps.push({ id: 'image-alt', operationId: 'images.setAltText', input: { imageId: image.sdImageId, description: 'Agent playback verification image' }, anchor: { page: 3, region: 'page' }, visual: 'image', label: 'Set image description' })
      }
    } catch {}
    try {
      const section = doc.sections.list({ limit: 1 }).items[0]
      if (section && available('sections.setPageMargins')) {
        steps.push({ id: 'page-margins', operationId: 'sections.setPageMargins', input: { target: section.address, top: 0.9, right: 0.9, bottom: 0.9, left: 0.9 }, anchor: { page: 3, region: 'margin' }, visual: 'page-region', label: 'Adjust page margins' })
      }
    } catch {}
    if (available('create.paragraph')) {
      steps.push({ id: 'append-summary', operationId: 'create.paragraph', input: { at: { kind: 'documentEnd' }, text: 'Agent review complete.' }, anchor: { page: 3, region: 'page' }, visual: 'text-insert', label: 'Append review summary' })
    }
    const plan = { planId: 'visual-plan', version: 1, documentRevision: state.revision, documentApiRevision: doc.info({}).revision, steps }
    globalThis.__wordAgentRun = bridge.execute({ action: 'applyWordPlan', plan, runId: 'visual-run', operationId: 'visual-operation', agentId: 'visual-agent', agentName: 'Draft Agent', baseRevision: state.revision })
    globalThis.__wordAgentRun.then((value) => { globalThis.__wordAgentInitialResult = value })
    return { stepCount: steps.length, operations: steps.map((step) => step.operationId) }
  })()`)
  check(planInfo.stepCount >= 4, 'runtime plan contains several real Word operations', planInfo.operations.join(', '))
  const playbackMode = await waitFor(send, `(() => {
    if (document.querySelector('[data-testid="artifact-review-workspace"][data-kind="word"]')) return 'review'
    if (document.querySelector('[data-testid="agent-live-word-cursor"]')) return 'live'
    if (globalThis.__wordAgentInitialResult?.draft) return 'review'
    return ''
  })()`, 'Word review or legacy playback mode', 45_000)
  if (playbackMode === 'review') {
    const draftResult = await waitFor(send, `globalThis.__wordAgentInitialResult`, 'transactional Word draft')
    check(draftResult.success && draftResult.draft && draftResult.operationCount === planInfo.stepCount, 'Word plan opened one modular transactional draft', JSON.stringify(draftResult))
    await waitFor(send, `Boolean(document.querySelector('[data-testid="artifact-review-workspace"][data-kind="word"]') && document.querySelectorAll('.artifact-review-pane').length === 2 && document.querySelector('.artifact-change-marker'))`, 'Word dual review and change marker', 40_000)
    const sourceUnchanged = Buffer.compare(await fs.promises.readFile(fixturePath), originalFixtureBytes) === 0
    check(sourceUnchanged, 'transactional Word review leaves the source file unchanged before save')
    const reviewGeometry = await evaluate(send, `(() => {
      const root = document.querySelector('[data-testid="artifact-review-workspace"]')
      const panes = [...root.querySelectorAll('.artifact-review-pane')].map((pane) => pane.getBoundingClientRect())
      const cursor = root.querySelector('.artifact-agent-cursor')?.getBoundingClientRect()
      const bounds = root.getBoundingClientRect()
      return { panes: panes.length, cursorContained: Boolean(cursor && cursor.left >= bounds.left && cursor.right <= bounds.right), overflow: root.scrollWidth - root.clientWidth }
    })()`)
    check(reviewGeometry.panes === 2 && reviewGeometry.cursorContained && reviewGeometry.overflow <= 1, 'transactional Word review geometry is contained', JSON.stringify(reviewGeometry))
    await capture(send, 'word-agent-transactional-review.png')
    await evaluate(send, `(async () => {
      const draftId = globalThis.__wordAgentInitialResult.draftId
      await window.api.artifact.command(draftId, { type: 'accept-all' })
      await window.api.artifact.command(draftId, { type: 'save' })
      return true
    })()`)
    await waitFor(send, `!document.querySelector('[data-testid="artifact-review-workspace"]')`, 'saved Word review closes')
    await openFile(send, dummyPath)
    await waitFor(send, `globalThis.__wordAgentBridge.getState().kind === 'text'`, 'temporary text document')
    await openFile(send, fixturePath)
    await waitFor(send, `globalThis.__wordAgentBridge.getState().kind === 'word' && globalThis.__wordAgentBridge.getState().superdoc?.activeEditor?.doc?.getText({}).includes('CURRENT WORDING')`, 'saved transactional Word file after reopen', 40_000)
    const reviewedText = await evaluate(send, `globalThis.__wordAgentBridge.getState().superdoc.activeEditor.doc.getText({})`)
    check(reviewedText.includes('CURRENT WORDING') && reviewedText.includes('VERIFIED') && !reviewedText.includes('REMOVE THIS SENTENCE'), 'reviewed Word edits survive reopening')
  } else {
  await waitFor(send, `Boolean(document.querySelector('[data-testid="agent-live-word-cursor"]') && document.querySelector('.word-agent-change-target') && document.querySelector('[data-testid="word-agent-pause"]'))`, 'live Agent cursor, deletion trace, and status controls')
  await evaluate(send, `document.querySelector('[data-testid="word-agent-pause"]')?.click()`)
  await waitFor(send, `document.querySelector('[data-testid="word-agent-status"]')?.dataset.phase === 'paused'`, 'paused playback')
  await evaluate(send, `document.documentElement.classList.remove('dark')`)

  const wideGeometry = await evaluate(send, `(() => {
    const root = document.querySelector('.word-editor-panel')
    const cursor = document.querySelector('[data-testid="agent-live-word-cursor"]')
    const status = document.querySelector('[data-testid="word-agent-status"]')
    const rootRect = root.getBoundingClientRect()
    const cursorRect = cursor.getBoundingClientRect()
    return {
      rootWidth: rootRect.width,
      cursorVisible: cursorRect.width > 0 && cursorRect.height > 0 && cursorRect.left >= rootRect.left && cursorRect.right <= rootRect.right,
      pointerEvents: getComputedStyle(cursor).pointerEvents,
      statusContained: status.scrollWidth <= status.clientWidth + 1,
    }
  })()`)
  check(wideGeometry.cursorVisible && wideGeometry.pointerEvents === 'none', 'virtual cursor is visible and non-interactive', JSON.stringify(wideGeometry))
  await capture(send, 'word-agent-100-light.png')

  await evaluate(send, `globalThis.__wordAgentBridge.reportUserActivity({ eventId: 'e2e-scroll', runId: 'visual-run', documentRevision: globalThis.__wordAgentBridge.getState().revision, timestamp: Date.now(), kind: 'viewport', visiblePages: [1] })`)
  await waitFor(send, `Boolean(document.querySelector('[data-testid="word-agent-locate"]'))`, 'Locate Agent button after user navigation')
  await evaluate(send, `document.querySelector('[data-testid="word-agent-locate"]')?.click()`)
  await waitFor(send, `!document.querySelector('[data-testid="word-agent-locate"]')`, 'follow mode restored')

  const narrowClip = await evaluate(send, `(() => {
    const root = document.querySelector('.word-editor-panel')
    root.style.width = '360px'
    root.style.maxWidth = '360px'
    root.style.flex = '0 0 360px'
    root.style.alignSelf = 'center'
    window.dispatchEvent(new Event('resize'))
    const rect = root.getBoundingClientRect()
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
  })()`)
  await sleep(350)
  await evaluate(send, `globalThis.__wordAgentBridge.reportUserActivity({ eventId: 'e2e-narrow-scroll', runId: 'visual-run', documentRevision: globalThis.__wordAgentBridge.getState().revision, timestamp: Date.now(), kind: 'viewport', visiblePages: [1] })`)
  await waitFor(send, `Boolean(document.querySelector('[data-testid="word-agent-locate"]'))`, 'narrow Locate Agent button')
  await evaluate(send, `document.querySelector('[data-testid="word-agent-locate"]')?.click()`)
  await sleep(250)
  const narrowGeometry = await evaluate(send, `(() => {
    const root = document.querySelector('.word-editor-panel')
    const status = document.querySelector('[data-testid="word-agent-status"]')
    const bar = document.querySelector('[data-testid="word-status-bar"]')
    const buttons = [...status.querySelectorAll('button')].map((button) => button.getBoundingClientRect())
    const overlap = buttons.some((a, index) => buttons.slice(index + 1).some((b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top))
    return { width: root.clientWidth, barOverflow: bar.scrollWidth - bar.clientWidth, statusOverflow: status.scrollWidth - status.clientWidth, overlap }
  })()`)
  check(narrowGeometry.width === 360 && !narrowGeometry.overlap && narrowGeometry.barOverflow <= 1, '360px middle pane keeps Agent controls contained', JSON.stringify(narrowGeometry))
  await capture(send, 'word-agent-360-light.png', narrowClip)
  await evaluate(send, `(() => { const root = document.querySelector('.word-editor-panel'); root.style.width = ''; root.style.maxWidth = ''; root.style.flex = ''; root.style.alignSelf = ''; window.dispatchEvent(new Event('resize')); document.documentElement.classList.add('dark'); globalThis.__wordAgentBridge.reportUserActivity({ eventId: 'e2e-dark-scroll', runId: 'visual-run', documentRevision: globalThis.__wordAgentBridge.getState().revision, timestamp: Date.now(), kind: 'viewport', visiblePages: [1] }) })()`)
  await waitFor(send, `Boolean(document.querySelector('[data-testid="word-agent-locate"]'))`, 'dark-theme Locate Agent button')
  await evaluate(send, `document.querySelector('[data-testid="word-agent-locate"]')?.click()`)
  await sleep(300)
  await capture(send, 'word-agent-100-dark.png')
  await evaluate(send, `document.documentElement.classList.remove('dark'); document.querySelector('[data-testid="word-agent-resume"]')?.click()`)
  const planResult = await waitFor(send, `globalThis.__wordAgentRun?.then((value) => value)`, 'complete Word plan', 45_000)
  check(planResult.success && planResult.completed === planResult.total, 'real Word plan completed in order', JSON.stringify({ completed: planResult.completed, total: planResult.total }))

  await setZoom(send, 50)
  await evaluate(send, startSingleStepExpression('zoom-50', 'ZOOM FIFTY TARGET', 'ZOOM FIFTY UPDATED', 1))
  await waitFor(send, `Boolean(document.querySelector('.word-agent-overlay[data-plan-id="zoom-50"] .word-agent-change-target'))`, '50% Agent cursor and change trace')
  check(!await evaluate(send, `document.body.textContent.includes('Layout engine hit an error')`), '50% layout remains healthy')
  await capture(send, 'word-agent-50.png')
  check((await waitFor(send, `globalThis.__wordAgentRun?.then((value) => value)`, '50% playback')).success, '50% playback completes')

  await setZoom(send, 200)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await evaluate(send, startSingleStepExpression('zoom-200', 'ZOOM TWO HUNDRED TARGET', 'ZOOM TWO HUNDRED UPDATED', 2))
  await waitFor(send, `Boolean(document.querySelector('.word-agent-overlay[data-plan-id="zoom-200"] .word-agent-change-target'))`, '200% Agent cursor and change trace')
  check(!await evaluate(send, `document.body.textContent.includes('Layout engine hit an error')`), '200% layout remains healthy')
  const reducedMotion = await evaluate(send, `getComputedStyle(document.querySelector('[data-testid="agent-live-word-cursor"]')).transitionProperty`)
  check(!reducedMotion.includes('transform'), 'reduced motion disables cursor flight', reducedMotion)
  await capture(send, 'word-agent-200-reduced-motion.png')
  check((await waitFor(send, `globalThis.__wordAgentRun?.then((value) => value)`, '200% playback')).success, '200% playback completes')
  await send('Emulation.setEmulatedMedia', { features: [] })
  await setZoom(send, 100)

  await evaluate(send, `(async () => {
    const bridge = globalThis.__wordAgentBridge
    const doc = bridge.getState().superdoc.activeEditor.doc
    globalThis.__wordAgentRun = bridge.execute({
      action: 'applyWordPlan', runId: 'interrupt-run', operationId: 'interrupt-operation', agentName: 'Draft Agent', baseRevision: bridge.getState().revision,
      plan: { planId: 'interrupt-plan', version: 1, documentRevision: bridge.getState().revision, documentApiRevision: doc.info({}).revision, steps: [
        { id: 'interrupt-1', operationId: 'replace', input: { text: 'INTERRUPT FIRST UPDATED' }, anchor: { search: 'INTERRUPT FIRST TARGET', page: 3, occurrence: 0 }, visual: 'text-replace' },
        { id: 'interrupt-2', operationId: 'replace', input: { text: 'INTERRUPT SECOND UPDATED' }, anchor: { search: 'INTERRUPT SECOND TARGET', page: 3, occurrence: 0 }, visual: 'text-replace' }
      ] }
    })
    return true
  })()`)
  await waitFor(send, `document.querySelector('[data-testid="word-agent-status"]')?.textContent.includes('1/2')`, 'first interrupt-plan step')
  const inputPoint = await evaluate(send, `(() => {
    const run = [...document.querySelectorAll('.superdoc-text-run')].find((node) => node.textContent?.includes('INTERRUPT SECOND TARGET'))
    const rect = run?.getBoundingClientRect()
    return rect ? { x: rect.left + Math.min(24, rect.width / 2), y: rect.top + rect.height / 2 } : null
  })()`)
  check(inputPoint, 'second target is visible for concurrent user input')
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: inputPoint.x, y: inputPoint.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: inputPoint.x, y: inputPoint.y, button: 'left', clickCount: 1 })
  await send('Input.insertText', { text: 'USER ' })
  const interruptResult = await waitFor(send, `globalThis.__wordAgentRun?.then((value) => value)`, 'soft interruption result', 20_000)
  check(interruptResult.requiresReplan && interruptResult.remainingSteps.length > 0, 'user input soft-interrupts only the remaining plan', JSON.stringify({ completed: interruptResult.completed, remaining: interruptResult.remainingSteps.length }))

  await evaluate(send, `(async () => {
    const module = await import(${JSON.stringify(agentStoreModuleUrl)})
    const bridge = globalThis.__wordAgentBridge
    module.useAgentStore.getState().setPendingApproval({ approvalId: 'e2e-approval', runId: 'interrupt-run', planId: 'replanned', planVersion: 2, documentRevision: bridge.getState().revision, agentName: 'Draft Agent', remainingSteps: 2, requestedAt: Date.now(), summary: 'replace:1, format:1', changes: [{ id: 'change-1', operationId: 'replace', label: 'Preserve user text and update the remaining paragraph' }, { id: 'change-2', operationId: 'format.bold', label: 'Apply the remaining emphasis' }] })
    module.useAgentStore.getState().setApprovalStatus('idle')
    return true
  })()`)
  await waitFor(send, `Boolean(document.querySelector('[data-testid="word-agent-approval"]'))`, 'replan approval UI')
  await evaluate(send, `document.querySelector('[data-testid="word-agent-approval"] button')?.click()`)
  check(await evaluate(send, `document.querySelectorAll('[data-testid="word-agent-approval"] button').length >= 3`), 'approval offers view, end, and continue controls')
  const approvalGeometry = await evaluate(send, `(() => {
    const approval = document.querySelector('[data-testid="word-agent-approval"]')
    const bounds = approval.getBoundingClientRect()
    const buttons = [...approval.querySelectorAll('button')]
    const rects = buttons.map((button) => button.getBoundingClientRect())
    return {
      contained: rects.every((rect) => rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom),
      textFits: buttons.every((button) => button.scrollWidth <= button.clientWidth + 1),
      overlap: rects.some((a, index) => rects.slice(index + 1).some((b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)),
    }
  })()`)
  check(approvalGeometry.contained && approvalGeometry.textFits && !approvalGeometry.overlap, 'approval actions fit the narrow Agent sidebar', JSON.stringify(approvalGeometry))
  await capture(send, 'word-agent-approval.png')

  await evaluate(send, `window.api.appMenu.perform('save')`)
  await sleep(3_000)
  await openFile(send, dummyPath)
  await waitFor(send, `globalThis.__wordAgentBridge.getState().kind === 'text'`, 'temporary text document')
  await openFile(send, fixturePath)
  await waitFor(send, `globalThis.__wordAgentBridge.getState().kind === 'word' && globalThis.__wordAgentBridge.getState().superdoc?.activeEditor?.doc?.getText({}).includes('CURRENT WORDING')`, 'saved Word file after reopen', 40_000)
  const reopenedText = await evaluate(send, `globalThis.__wordAgentBridge.getState().superdoc.activeEditor.doc.getText({})`)
  check(reopenedText.includes('CURRENT WORDING') && reopenedText.includes('VERIFIED') && !reopenedText.includes('REMOVE THIS SENTENCE'), 'saved edits survive reopening')
  }

  console.log(`PASS screenshots saved under ${artifactDir}`)
} catch (error) {
  const tail = logs.join('').slice(-8_000)
  if (tail) console.error(tail)
  throw error
} finally {
  socket?.close()
  if (child && !child.killed) child.kill()
}
