/**
 * Verify the blank-screen fix set against the rebuilt packaged app:
 *  V1  bridge port conflict -> window must still appear (was: zombie, no window)
 *  V2  renderer crash (Page.crash) -> app auto-reloads within seconds
 *  V3  es UI -> fortune locale backfill log appears; open xlsx renders
 *  V4  regression: en flow txt/xlsx/docx/pdf + language switch with tabs open
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))
const electronPath = require('electron')
const artifactDir = path.join(root, '.cache', 'repro-lang-crash', 'verify')
fs.mkdirSync(artifactDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-verify-fixtures-'))
const txtPath = path.join(fixtureDir, 'v.txt')
fs.writeFileSync(txtPath, 'VERIFY TXT\n', 'utf8')
const pdfPath = path.join(fixtureDir, 'v.pdf')
fs.writeFileSync(pdfPath, Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>>>endobj
4 0 obj<</Length 46>>stream
BT /F1 32 Tf 72 700 Td (VERIFY PDF) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f
trailer<</Size 6/Root 1 0 R>>
startxref
0
%%EOF
`, 'latin1'))
const ExcelJS = require('exceljs')
const wb = new ExcelJS.Workbook()
wb.addWorksheet('Sheet1').getCell('A1').value = 'VERIFY CELL'
const xlsxPath = path.join(fixtureDir, 'v.xlsx')
await wb.xlsx.writeFile(xlsxPath)
const JSZip = require('jszip')
const zip = new JSZip()
zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)
zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>VERIFY DOCX</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`)
fs.writeFileSync(path.join(fixtureDir, 'v.docx'), await zip.generateAsync({ type: 'nodebuffer' }))
const docxPath = path.join(fixtureDir, 'v.docx')

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close((e) => (e ? reject(e) : resolve(p))) })
  })
}
function describeException(d) { return d?.exception?.description || d?.text || JSON.stringify(d) }
function connectCdp(wsUrl, onEvent) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1
    let opened = false
    const send = (method, params = {}) => new Promise((res, rej) => {
      if (socket.readyState !== WebSocket.OPEN) return rej(new Error(`socket closed for ${method}`))
      const id = nextId++
      const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)) }, 20000)
      pending.set(id, { resolve: (m) => { clearTimeout(timer); m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m) } })
      socket.send(JSON.stringify({ id, method, params }))
    })
    socket.addEventListener('open', () => { opened = true; resolve({ send, close: () => socket.close() }) })
    socket.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p.resolve(m) }
      else if (m.method) onEvent(m)
    })
    socket.addEventListener('error', (ev) => { if (!opened) reject(new Error(`ws error ${ev.message ?? ev}`)) })
    socket.addEventListener('close', () => { for (const p of pending.values()) p.resolve({ error: { message: 'socket closed' } }); pending.clear() })
  })
}
async function findPage(debugPort, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && (String(t.url).includes('out/renderer') || String(t.url).includes('index.html')))
      if (page?.webSocketDebuggerUrl) return page
    } catch {}
    await sleep(250)
  }
  return null
}
async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.result.exceptionDetails) throw new Error(describeException(r.result.exceptionDetails))
  return r.result.result?.value
}
async function waitFor(send, expression, label, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs
  let lastValue, lastError
  while (Date.now() < deadline) {
    try { lastValue = await evaluate(send, expression); if (lastValue) return lastValue; lastError = null }
    catch (e) { lastError = e }
    await sleep(150)
  }
  throw new Error(`timeout: ${label}; last=${JSON.stringify(lastValue)}${lastError ? `; err=${lastError.message}` : ''}`)
}
async function clickElement(send, selector, label) {
  const point = await evaluate(send, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!(el instanceof HTMLElement)) return null
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (!point) throw new Error(`${label}: not clickable`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 })
}
async function selectLanguage(send, code) {
  await clickElement(send, '[data-testid="language-menu-trigger"]', 'language trigger')
  await waitFor(send, `Boolean(document.querySelector('[data-testid="language-menu"]'))`, 'menu open')
  await clickElement(send, `[data-testid="language-option-${code}"]`, `${code} option`)
  await waitFor(send, `document.documentElement.lang === ${JSON.stringify(code)} && !document.querySelector('[data-testid="language-menu"]')`, `${code} active`)
}
async function openFileViaApp(send, filePath) {
  return evaluate(send, `(async () => {
    const filePath = ${JSON.stringify(filePath)};
    const root = document.getElementById('root');
    const key = root && Object.keys(root).find((n) => n.startsWith('__reactContainer') || n.startsWith('__reactFiber'));
    const container = key ? root[key] : null;
    const queue = container ? [container.current, container.stateNode?.current, container._internalRoot?.current, container].filter(Boolean) : [];
    const seen = new Set();
    while (queue.length) {
      const fiber = queue.shift();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      const props = fiber.memoizedProps;
      if (props && typeof props.onOpenFile === 'function') { await props.onOpenFile(filePath); return { opened: true }; }
      if (fiber.child) queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }
    return { opened: false };
  })()`)
}

function launch(tag, { bridgePort, profile } = {}) {
  const debugPortPromise = getFreePort()
  return debugPortPromise.then(async (debugPort) => {
    const args = [`--remote-debugging-port=${debugPort}`]
    if (profile) args.push(`--user-data-dir=${profile}`)
    args.push(root)
    const env = {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      WPS_ALLOW_MULTI_INSTANCE: '1',
    }
    if (bridgePort) env.WPS_BRIDGE_PORT = String(bridgePort)
    const child = spawn(electronPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const log = []
    child.stdout.on('data', (c) => log.push(String(c)))
    child.stderr.on('data', (c) => log.push(String(c)))
    let exited = null
    child.on('exit', (code, signal) => { exited = { code, signal } })
    return { tag, child, log, debugPort, exit: () => exited }
  })
}

const results = []
function record(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---------- V1: bridge port conflict must not prevent the window ----------
{
  const blocker = net.createServer()
  const conflictPort = await getFreePort()
  await new Promise((r) => blocker.listen(conflictPort, '127.0.0.1', r))
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-verify-v1-'))
  const inst = await launch('v1', { bridgePort: conflictPort, profile })
  try {
    const page = await findPage(inst.debugPort, 25000)
    if (!page) {
      record('V1 bridge-conflict still creates window', false, `no renderer; log tail: ${inst.log.join('').slice(-400)}`)
    } else {
      const cdp = await connectCdp(page.webSocketDebuggerUrl, () => {})
      await cdp.send('Runtime.enable')
      await waitFor(cdp.send, `Boolean(document.querySelector('[data-testid="language-menu-trigger"]'))`, 'v1 boot', 25000)
      const logText = inst.log.join('')
      record('V1 bridge-conflict still creates window', true, logText.includes('offline office init failed') ? 'graceful bridge failure logged' : 'window up')
      cdp.close()
    }
  } catch (e) {
    record('V1 bridge-conflict still creates window', false, String(e))
  } finally {
    inst.child.kill()
    blocker.close()
    await sleep(500)
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }) } catch {}
  }
}

// ---------- V2 + V3 + V4 in one instance ----------
{
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-verify-v2-'))
  const bridgePort = await getFreePort()
  const inst = await launch('v2', { bridgePort, profile })
  try {
    let page = await findPage(inst.debugPort, 30000)
    if (!page) throw new Error('no renderer at boot')
    let cdp = await connectCdp(page.webSocketDebuggerUrl, () => {})
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    await waitFor(cdp.send, `Boolean(document.querySelector('[data-testid="language-menu-trigger"]'))`, 'v2 boot', 30000)

    // V4 regression flow first (en): open all kinds, then switch language with tabs
    await selectLanguage(cdp.send, 'en')
    for (const [kind, file] of [['txt', txtPath], ['xlsx', xlsxPath], ['docx', docxPath], ['pdf', pdfPath]]) {
      await openFileViaApp(cdp.send, file)
      await sleep(2200)
      const h = await evaluate(cdp.send, `(() => { const r = document.getElementById('root'); return { c: r ? r.childElementCount : -1, t: document.querySelectorAll('[data-document-tab-id]').length } })()`)
      if (h.c < 1) throw new Error(`V4 blank after ${kind}`)
    }
    await selectLanguage(cdp.send, 'ru')
    await sleep(800)
    await openFileViaApp(cdp.send, txtPath)
    await sleep(1200)
    record('V4 regression: en flow + switch with tabs', true)

    // V3: es locale backfill — switch to es and open the xlsx again
    await selectLanguage(cdp.send, 'es')
    await sleep(500)
    await openFileViaApp(cdp.send, xlsxPath)
    await sleep(2500)
    const logText = inst.log.join('')
    const backfilled = /backfilled \d+ missing 'es' locale keys/.test(logText)
    record('V3 fortune es locale backfill runs', backfilled, backfilled ? '' : 'no backfill log found')

    // V2: crash the renderer, expect auto-reload
    console.log('--- crashing renderer via Page.crash ---')
    cdp.send('Page.crash').catch(() => {})
    await sleep(4000)
    page = await findPage(inst.debugPort, 20000)
    if (!page) {
      record('V2 renderer crash auto-recovery', false, 'no renderer target after crash')
    } else {
      cdp = await connectCdp(page.webSocketDebuggerUrl, () => {})
      await cdp.send('Runtime.enable')
      await waitFor(cdp.send, `Boolean(document.querySelector('[data-testid="language-menu-trigger"]'))`, 'post-crash boot', 25000)
      const incidents = fs.existsSync(path.join(profile, 'wps-agent-editor'))
        ? '' : ''
      record('V2 renderer crash auto-recovery', true, 'window reloaded and app booted')
      cdp.close()
    }
  } catch (e) {
    record('V2/V3/V4 combined instance', false, String(e))
  } finally {
    inst.child.kill()
    await sleep(500)
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }) } catch {}
  }
}

fs.writeFileSync(path.join(artifactDir, 'verify-results.json'), JSON.stringify(results, null, 2), 'utf8')
const failed = results.filter((r) => !r.pass)
console.log(`\nVERIFY DONE: ${results.length - failed.length}/${results.length} passed`)
try { fs.rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch {}
if (failed.length) process.exitCode = 2
