import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const JSZip = require('jszip')
const ExcelJS = require('exceljs')
const PptxGenJS = require('pptxgenjs')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronViteCli = path.join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const editorStoreUrl = `/@fs/${path.join(root, 'src', 'stores', 'editor.store.ts').replaceAll('\\', '/')}`
const agentStoreUrl = `/@fs/${path.join(root, 'src', 'stores', 'agent.store.ts').replaceAll('\\', '/')}`
const artifactDir = path.join(root, '.cache', 'artifact-review-e2e')
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
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

async function waitForRenderer(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = targets.find((target) => target.type === 'page' && /^https?:/.test(String(target.url)))
      if (page?.webSocketDebuggerUrl) return page
    } catch {}
    await sleep(200)
  }
  throw new Error('Electron renderer did not expose a CDP target')
}

function connectCdp(url, eventLog) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const pending = new Map()
    let nextId = 1
    const send = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        rejectCall(new Error(`CDP timeout: ${method}`))
      }, 45_000)
      pending.set(id, { resolveCall, rejectCall, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
    socket.addEventListener('open', () => resolve({ socket, send }))
    socket.addEventListener('error', reject)
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id && (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled')) {
        eventLog.push(JSON.stringify(message.params))
        if (eventLog.length > 200) eventLog.shift()
      }
      const call = pending.get(message.id)
      if (!call) return
      pending.delete(message.id)
      clearTimeout(call.timer)
      if (message.error) call.rejectCall(new Error(message.error.message))
      else call.resolveCall(message)
    })
  })
}

async function evaluate(send, expression) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response
    try {
      response = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      })
    } catch (error) {
      if (/Promise was collected|Execution context was destroyed/i.test(String(error)) && attempt < 2) {
        await sleep(250)
        continue
      }
      throw error
    }
    if (!response.result.exceptionDetails) return response.result.result?.value
    const message = response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text
    if (/Promise was collected|Execution context was destroyed/i.test(message) && attempt < 2) {
      await sleep(250)
      continue
    }
    throw new Error(message)
  }
  return undefined
}

async function waitFor(send, expression, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await evaluate(send, expression)
    if (last) return last
    await sleep(120)
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)}`)
}

async function capture(send, name) {
  const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const bytes = Buffer.from(result.result.data, 'base64')
  await fs.promises.writeFile(path.join(artifactDir, name), bytes)
  check(bytes.length > 12_000, `${name} is nonblank`, `${bytes.length} bytes`)
}

async function wordFixture(filePath, text) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`)
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>
</Relationships>`)
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Quarterly review</w:t></w:r></w:p>
    <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Stable closing paragraph</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`)
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
</w:styles>`)
  zip.file('word/settings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/></w:settings>')
  zip.file('word/fontTable.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:font w:name="Arial"><w:family w:val="swiss"/></w:font></w:fonts>')
  zip.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Artifact review fixture</dc:title></cp:coreProperties>')
  zip.file('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>WPS Agent Editor</Application></Properties>')
  await fs.promises.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

async function excelFixture(filePath, value) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Sheet1')
  sheet.getCell('A1').value = value
  sheet.getCell('B1').value = 'Stable'
  sheet.columns = [{ width: 24 }, { width: 18 }]
  await workbook.xlsx.writeFile(filePath)
}

function pdfBuffer(text) {
  const stream = `BT /F1 18 Tf 40 120 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 480 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'ascii')
}

async function pptFixture(filePath, text) {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'WPS Agent Editor E2E'
  const slide = pptx.addSlide()
  slide.background = { color: 'F6F7F9' }
  slide.addText('Quarterly review', { x: 0.7, y: 0.6, w: 6, h: 0.6, fontSize: 28, bold: true, color: '20242A' })
  slide.addText(text, { x: 0.7, y: 1.7, w: 9.8, h: 1.2, fontSize: 22, color: '176A46', margin: 0.08 })
  slide.addShape(pptx.ShapeType.rect, { x: 0.7, y: 3.4, w: 4.2, h: 1.2, fill: { color: 'E6F4ED' }, line: { color: '80B89C' } })
  await pptx.writeFile({ fileName: filePath })
}

async function codeFixture(filePath, text) {
  await fs.promises.writeFile(filePath, text, 'utf8')
}

function codePoint(value, offset) {
  const lines = value.slice(0, offset).split('\n')
  return { offset, line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

const codeBefore = 'export function status() {\n  return "before"\n}\n'
const codeAfter = 'export function status() {\n  return "after"\n}\n'
const codeBeforeStart = codeBefore.indexOf('before')
const codeAfterStart = codeAfter.indexOf('after')
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex')

const fixtureRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wps-artifact-review-e2e-'))
const profileRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wps-artifact-review-profile-'))
await fs.promises.mkdir(artifactDir, { recursive: true })
const fixtures = [
  {
    kind: 'word', ext: 'docx', before: 'Original wording', after: 'Agent revised wording',
    operation: { id: 'word-change', type: 'replace', label: 'Update wording', location: { kind: 'word', search: 'Original wording' }, before: { text: 'Original wording' }, after: { text: 'Agent revised wording' }, visual: 'replacement', executionRef: 'fixture-word' },
    build: wordFixture,
  },
  {
    kind: 'excel', ext: 'xlsx', before: 'Original value', after: 'Agent value',
    operation: { id: 'excel-change', type: 'cell', label: 'Sheet1!A1', location: { kind: 'excel', sheetName: 'Sheet1', range: 'A1' }, before: { text: 'Original value' }, after: { text: 'Agent value' }, visual: 'replacement', executionRef: 'fixture-excel' },
    build: excelFixture,
  },
  {
    kind: 'pdf', ext: 'pdf', before: 'Original PDF text', after: 'Agent PDF text',
    operation: { id: 'pdf-change', type: 'replace', label: 'Page 1 text', location: { kind: 'pdf', pageNumber: 1, rect: { x: 0.08, y: 0.25, width: 0.55, height: 0.22 } }, before: { text: 'Original PDF text' }, after: { text: 'Agent PDF text' }, visual: 'replacement', executionRef: 'fixture-pdf' },
    build: async (filePath, text) => fs.promises.writeFile(filePath, pdfBuffer(text)),
  },
  {
    kind: 'presentation', ext: 'pptx', before: 'Original slide message', after: 'Agent slide message',
    operation: { id: 'ppt-change', type: 'replace', label: 'Slide 1 message', location: { kind: 'presentation', slideIndex: 0, nodeId: 'message', rect: { x: 0.05, y: 0.2, width: 0.78, height: 0.2 } }, before: { text: 'Original slide message' }, after: { text: 'Agent slide message' }, visual: 'replacement', executionRef: 'fixture-ppt' },
    build: pptFixture,
  },
  {
    kind: 'code', ext: 'ts', before: codeBefore, after: codeAfter,
    operation: {
      id: 'code-change', type: 'replace', label: 'Update status return value',
      location: {
        kind: 'code',
        originalRange: { start: codePoint(codeBefore, codeBeforeStart), end: codePoint(codeBefore, codeBeforeStart + 6) },
        candidateRange: { start: codePoint(codeAfter, codeAfterStart), end: codePoint(codeAfter, codeAfterStart + 5) },
        beforeDigest: digest('before'), afterDigest: digest('after'),
        contextBeforeDigest: digest(codeBefore.slice(Math.max(0, codeBeforeStart - 96), codeBeforeStart)),
        contextAfterDigest: digest(codeBefore.slice(codeBeforeStart + 6, codeBeforeStart + 6 + 96)),
      },
      before: { text: 'before', digest: digest('before') },
      after: { text: 'after', digest: digest('after') },
      visual: 'replacement', executionRef: 'fixture-code',
    },
    textMetadata: { encoding: 'utf-8', hasBom: false, eol: 'lf', languageId: 'typescript', dirty: false },
    build: codeFixture,
  },
]

for (const fixture of fixtures) {
  fixture.sourcePath = path.join(fixtureRoot, `${fixture.kind}-source.${fixture.ext}`)
  fixture.candidatePath = path.join(fixtureRoot, `${fixture.kind}-candidate.${fixture.ext}`)
  await fixture.build(fixture.sourcePath, fixture.before)
  await fixture.build(fixture.candidatePath, fixture.after)
  fixture.originalBytes = await fs.promises.readFile(fixture.sourcePath)
}

let child
let socket
const logs = []
const rendererEvents = []
try {
  const cdpPort = await freePort()
  const bridgePort = await freePort()
  child = spawn(process.execPath, [electronViteCli, root, '--remoteDebuggingPort', String(cdpPort)], {
    cwd: root,
    env: {
      ...process.env,
      WPS_ALLOW_MULTI_INSTANCE: '1',
      WPS_TEST_USER_DATA_DIR: profileRoot,
      WPS_ARTIFACT_REVIEW_E2E: '1',
      WPS_BRIDGE_PORT: String(bridgePort),
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => logs.push(String(chunk)))
  child.stderr.on('data', (chunk) => logs.push(String(chunk)))
  const target = await waitForRenderer(cdpPort)
  let send
  ;({ socket, send } = await connectCdp(target.webSocketDebuggerUrl, rendererEvents))
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 920, deviceScaleFactor: 1, mobile: false })
  await waitFor(send, `document.getElementById('root')?.childElementCount > 0`, 'React application')

  for (const fixture of fixtures) {
    await evaluate(send, `(async () => {
      const sourcePath = ${JSON.stringify(fixture.sourcePath)}
      await window.api.file.open(sourcePath)
      const module = await import(${JSON.stringify(editorStoreUrl)})
      module.useEditorStore.getState().setCurrentFile(sourcePath)
      return true
    })()`)
    await waitFor(send, `!document.querySelector('[data-testid="artifact-review-workspace"]')`, `${fixture.kind} source editor`)
    await sleep(fixture.kind === 'word' || fixture.kind === 'presentation' ? 1600 : 700)
    const draft = await evaluate(send, `(async () => {
      const candidate = await window.api.lw.readFile(${JSON.stringify(fixture.candidatePath)})
      const result = await window.api.artifact.createFixtureDraft({
        sourcePath: ${JSON.stringify(fixture.sourcePath)},
        kind: ${JSON.stringify(fixture.kind)},
        candidateData: candidate.data,
        operations: [${JSON.stringify(fixture.operation)}],
        textMetadata: ${JSON.stringify(fixture.textMetadata ?? null)} || undefined
      })
      const store = await import(${JSON.stringify(agentStoreUrl)})
      store.useAgentStore.getState().setArtifactReview(result.manifest, result.reviewState)
      globalThis.__artifactDraftId = result.manifest.draftId
      return { draftId: result.manifest.draftId, total: result.reviewState.total }
    })()`)
    check(draft.total === 1, `${fixture.kind} draft opened with one modular operation`)
    await waitFor(send, `document.querySelector('[data-testid="artifact-review-workspace"]')?.dataset.kind === ${JSON.stringify(fixture.kind)}`, `${fixture.kind} review workspace`)
    const markerSelector = fixture.kind === 'code'
      ? '.artifact-code-added-line, .artifact-code-removed-line, .artifact-code-deletion-anchor'
      : '.artifact-change-marker, .artifact-ppt-node-highlight'
    if (fixture.kind === 'code') {
      await waitFor(send, `document.querySelector('[data-testid="code-artifact-diff"]') && document.querySelector('.monaco-diff-editor') && document.querySelectorAll(${JSON.stringify(markerSelector)}).length >= 2`, 'code Monaco comparison and red/green markers')
    } else {
      await waitFor(send, `document.querySelectorAll('.artifact-review-pane').length === 2 && document.querySelectorAll(${JSON.stringify(markerSelector)}).length >= 1`, `${fixture.kind} dual comparison and marker`)
    }
    if (fixture.kind === 'word') {
      await waitFor(send, `document.body.innerText.includes('Quarterly review') && document.body.innerText.includes('Stable closing paragraph')`, 'Word document content')
    }
    if (fixture.kind === 'pdf') {
      await waitFor(send, `(() => {
        const canvases = [...document.querySelectorAll('.artifact-pdf-page canvas')]
        return canvases.length === 2 && canvases.every((canvas) => canvas.width > 0 && canvas.height > 0)
      })()`, 'PDF canvases')
      const canvasPixels = await evaluate(send, `(() => [...document.querySelectorAll('.artifact-pdf-page canvas')].every((canvas) => {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        let dark = 0
        for (let index = 0; index < data.length; index += 16) if (data[index] < 220 || data[index + 1] < 220 || data[index + 2] < 220) dark += 1
        return dark > 20
      }))()`)
      check(canvasPixels, 'PDF canvases contain rendered pixels')
    }
    await sleep(fixture.kind === 'word' || fixture.kind === 'presentation' ? 1800 : 800)
    const geometry = await evaluate(send, `(() => {
      const root = document.querySelector('[data-testid="artifact-review-workspace"]')
      if (root.dataset.kind === 'code') {
        const diff = root.querySelector('[data-testid="code-artifact-diff"]').getBoundingClientRect()
        const cursorRect = root.querySelector('.artifact-agent-cursor').getBoundingClientRect()
        return {
          panesVisible: diff.width > 400 && diff.height > 200,
          cursorContained: cursorRect.left >= diff.left && cursorRect.right <= diff.right && cursorRect.top >= diff.top && cursorRect.bottom <= diff.bottom,
          cursorPointerEvents: getComputedStyle(root.querySelector('.artifact-agent-cursor')).pointerEvents,
          footerOverflow: root.querySelector('.artifact-review-bar').scrollWidth - root.querySelector('.artifact-review-bar').clientWidth,
        }
      }
      const panes = [...root.querySelectorAll('.artifact-review-pane')].map((pane) => pane.getBoundingClientRect())
      const cursor = root.querySelector('.artifact-agent-cursor')
      const cursorRect = cursor.getBoundingClientRect()
      const candidate = root.querySelector('.artifact-review-pane.is-candidate').getBoundingClientRect()
      return {
        panesVisible: panes.length === 2 && panes.every((rect) => rect.width > 200 && rect.height > 200),
        cursorContained: cursorRect.left >= candidate.left && cursorRect.right <= candidate.right && cursorRect.top >= candidate.top && cursorRect.bottom <= candidate.bottom,
        cursorPointerEvents: getComputedStyle(cursor).pointerEvents,
        footerOverflow: root.querySelector('.artifact-review-bar').scrollWidth - root.querySelector('.artifact-review-bar').clientWidth,
      }
    })()`)
    check(geometry.panesVisible && geometry.cursorContained && geometry.cursorPointerEvents === 'none' && geometry.footerOverflow <= 1, `${fixture.kind} review geometry is contained`, JSON.stringify(geometry))
    await capture(send, `${fixture.kind}-review-light.png`)

    if (fixture.kind === 'code') {
      await evaluate(send, `(() => {
        const root = document.querySelector('[data-testid="artifact-review-workspace"]')
        root.style.width = '360px'; root.style.maxWidth = '360px'; root.style.flex = '0 0 360px'; root.style.alignSelf = 'center'
        return true
      })()`)
      await waitFor(send, `document.querySelector('[data-testid="code-artifact-diff"]')?.dataset.inline === 'true'`, 'code 360px inline diff')
      const codeNarrow = await evaluate(send, `(() => {
        const root = document.querySelector('[data-testid="artifact-review-workspace"]')
        return { width: root.getBoundingClientRect().width, overflow: root.scrollWidth - root.clientWidth }
      })()`)
      check(codeNarrow.width === 360 && codeNarrow.overflow <= 1, 'code 360px inline review is contained', JSON.stringify(codeNarrow))
      await capture(send, 'code-review-360.png')
      await evaluate(send, `(() => {
        const root = document.querySelector('[data-testid="artifact-review-workspace"]')
        for (const property of ['width', 'max-width', 'flex', 'align-self']) root.style.removeProperty(property)
        return true
      })()`)
      await waitFor(send, `document.querySelector('[data-testid="code-artifact-diff"]')?.dataset.inline === 'false'`, 'code wide side-by-side diff restored')
    }

    if (fixture.kind === 'word') {
      const narrow = await evaluate(send, `(() => {
        const root = document.querySelector('[data-testid="artifact-review-workspace"]')
        root.style.width = '360px'; root.style.maxWidth = '360px'; root.style.flex = '0 0 360px'; root.style.alignSelf = 'center'
        return true
      })()`)
      check(narrow, 'Word review switched to a 360px middle pane')
      await sleep(350)
      const narrowGeometry = await evaluate(send, `(() => {
        const root = document.querySelector('[data-testid="artifact-review-workspace"]')
        const visiblePanes = [...root.querySelectorAll('.artifact-review-pane')].filter((pane) => getComputedStyle(pane).display !== 'none')
        return { width: root.getBoundingClientRect().width, visiblePanes: visiblePanes.length, overflow: root.scrollWidth - root.clientWidth }
      })()`)
      check(narrowGeometry.width === 360 && narrowGeometry.visiblePanes === 1 && narrowGeometry.overflow <= 1, '360px segmented review is contained', JSON.stringify(narrowGeometry))
      await capture(send, 'word-review-360.png')
      await evaluate(send, `(() => {
        const root = document.querySelector('[data-testid="artifact-review-workspace"]')
        for (const property of ['width', 'max-width', 'flex', 'align-self']) root.style.removeProperty(property)
        return true
      })()`)
      await waitFor(send, `document.querySelectorAll('.artifact-review-pane').length === 2 && [...document.querySelectorAll('.artifact-review-pane')].every((pane) => getComputedStyle(pane).display !== 'none')`, 'Word wide review restored')
    }
    if (fixture.kind === 'pdf') {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      const transition = await evaluate(send, `getComputedStyle(document.querySelector('.artifact-agent-cursor')).transitionDuration`)
      check(transition === '0s', 'reduced motion disables Agent cursor flight', transition)
      await capture(send, 'pdf-review-reduced-motion.png')
      await send('Emulation.setEmulatedMedia', { features: [] })
    }
    if (fixture.kind === 'presentation') {
      await evaluate(send, `document.documentElement.classList.add('dark')`)
      await sleep(200)
      await capture(send, 'presentation-review-dark.png')
      await evaluate(send, `document.documentElement.classList.remove('dark')`)
    }

    await evaluate(send, `document.querySelector('[data-testid="artifact-review-reject"]')?.click()`)
    await waitFor(send, `document.querySelectorAll(${JSON.stringify(markerSelector)}).length === 0 && !document.querySelector('[data-testid="artifact-review-save"]')?.disabled`, `${fixture.kind} reject rebuild`)
    check((await fs.promises.readFile(fixture.sourcePath)).equals(fixture.originalBytes), `${fixture.kind} source stays unchanged before save`)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 2, windowsVirtualKeyCode: 90 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 2, windowsVirtualKeyCode: 90 })
    await waitFor(send, `document.querySelectorAll(${JSON.stringify(markerSelector)}).length >= 1`, `${fixture.kind} review undo`)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'y', code: 'KeyY', modifiers: 2, windowsVirtualKeyCode: 89 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'y', code: 'KeyY', modifiers: 2, windowsVirtualKeyCode: 89 })
    await waitFor(send, `document.querySelectorAll(${JSON.stringify(markerSelector)}).length === 0`, `${fixture.kind} review redo`)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 2, windowsVirtualKeyCode: 90 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 2, windowsVirtualKeyCode: 90 })
    await waitFor(send, `document.querySelectorAll(${JSON.stringify(markerSelector)}).length >= 1`, `${fixture.kind} pending decision restored`)
    await evaluate(send, `document.querySelector('[data-testid="artifact-review-accept"]')?.click()`)
    await waitFor(send, `!document.querySelector('[data-testid="artifact-review-save"]')?.disabled`, `${fixture.kind} accepted and ready to save`)
    await evaluate(send, `document.querySelector('[data-testid="artifact-review-save"]')?.click()`)
    await waitFor(send, `!document.querySelector('[data-testid="artifact-review-workspace"]')`, `${fixture.kind} draft saved`)
    check((await fs.promises.readFile(fixture.sourcePath)).equals(await fs.promises.readFile(fixture.candidatePath)), `${fixture.kind} atomically saved candidate`)
    const historyCount = await evaluate(send, `window.api.artifact.listHistory(${JSON.stringify(fixture.sourcePath)}).then((records) => records.length)`)
    check(historyCount >= 1, `${fixture.kind} persisted review history`)

    if (fixture.kind === 'word') {
      const reopened = await evaluate(send, `(async () => {
        const records = await window.api.artifact.listHistory(${JSON.stringify(fixture.sourcePath)})
        const result = await window.api.artifact.reopenHistory(${JSON.stringify(fixture.sourcePath)}, records[0].revisionId)
        const store = await import(${JSON.stringify(agentStoreUrl)})
        store.useAgentStore.getState().setArtifactReview(result.manifest, result.reviewState)
        return result.manifest.reviewMode
      })()`)
      check(reopened === 'history-withdrawal', 'Word history reopened in withdrawal mode')
      await waitFor(send, `document.querySelector('[data-testid="artifact-review-workspace"]') && document.querySelector('[data-testid="artifact-review-reject"]')?.innerText.includes('撤回')`, 'Word history withdrawal review')
      await evaluate(send, `document.querySelector('[data-testid="artifact-review-reject"]')?.click()`)
      await waitFor(send, `!document.querySelector('[data-testid="artifact-review-save"]')?.disabled`, 'Word history withdrawal ready')
      await evaluate(send, `document.querySelector('[data-testid="artifact-review-save"]')?.click()`)
      await waitFor(send, `!document.querySelector('[data-testid="artifact-review-workspace"]')`, 'Word history withdrawal saved')
      check((await fs.promises.readFile(fixture.sourcePath)).equals(fixture.originalBytes), 'Word history withdrawal created a new original-content version')
    }
  }
} catch (error) {
  console.error(error)
  console.error(rendererEvents.slice(-40).join('\n'))
  console.error(logs.join('').slice(-18_000))
  process.exitCode = 1
} finally {
  try { socket?.close() } catch {}
  if (child && !child.killed) {
    child.kill()
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(2_000),
    ])
  }
  await fs.promises.rm(fixtureRoot, { recursive: true, force: true }).catch(() => {})
  await fs.promises.rm(profileRoot, { recursive: true, force: true }).catch(() => {})
}
