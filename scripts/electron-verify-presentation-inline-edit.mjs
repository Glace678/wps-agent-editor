/**
 * Verify the PPT in-place text edit (WPS-style click-to-edit box) end to end:
 *  V1  clicking a text region on the slide opens a bordered edit box over it
 *  V2  the box shows the current text of that region
 *  V3  editing + Ctrl+Enter applies the change and re-renders the slide
 *  V4  clicking empty slide space cancels the edit without changes
 *  V5  Escape cancels the edit without changes
 *  V6  clicking another text region switches the edit target
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
const artifactDir = path.join(root, '.cache', 'verify-presentation-inline-edit')
fs.mkdirSync(artifactDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close((e) => (e ? reject(e) : resolve(p))) })
  })
}
function connectCdp(wsUrl, onEvent = () => {}) {
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
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails?.exception?.description || r.result.exceptionDetails?.text || 'evaluate failed')
  return r.result.result?.value
}
async function waitFor(send, expression, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let lastValue, lastError
  while (Date.now() < deadline) {
    try { lastValue = await evaluate(send, expression); if (lastValue) return lastValue; lastError = null }
    catch (e) { lastError = e }
    await sleep(150)
  }
  throw new Error(`timeout: ${label}; last=${JSON.stringify(lastValue)}${lastError ? `; err=${lastError.message}` : ''}`)
}
async function screenshot(send, name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(artifactDir, name), Buffer.from(shot.result.data, 'base64'))
}
async function clickAt(send, x, y, button = 'left') {
  const mouseButton = button === 'right' ? 'right' : 'left'
  const buttons = button === 'right' ? 2 : 1
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: mouseButton, buttons, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: mouseButton, buttons: 0, clickCount: 1 })
}
async function centerOfText(send, text) {
  const point = await evaluate(send, `(() => {
    const nodes = [...document.querySelectorAll('.presentation-slide-host *, .presentation-slide-host')]
      .filter((el) => el.children.length === 0 && el.textContent.includes(${JSON.stringify(text)}))
    const el = nodes[nodes.length - 1]
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
  if (!point) throw new Error(`text "${text}" not found on slide`)
  return point
}
async function pressCtrlEnter(send) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 2 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 2 })
}

const results = []
function record(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---------- fixtures: generate a real .pptx with pptxgenjs ----------
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-ppt-inline-'))
const pptxPath = path.join(fixtureDir, 'editable.pptx')
{
  const pptxgen = (await import('pptxgenjs')).default
  const pptx = new pptxgen()
  pptx.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 })
  pptx.layout = 'WIDE'
  const slide = pptx.addSlide()
  slide.addText('Editable Title', { x: 0.5, y: 0.4, w: 12, h: 1.2, fontSize: 44, bold: true, fontFace: 'Arial', color: '1F2328' })
  slide.addText('Editable Body Line', { x: 0.5, y: 2.2, w: 8, h: 1.0, fontSize: 28, fontFace: 'Arial', color: '333333' })
  slide.addText('Secondary Text', { x: 0.5, y: 3.8, w: 6, h: 0.8, fontSize: 20, fontFace: 'Arial', color: '555555' })
  await pptx.writeFile({ fileName: pptxPath })
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-ppt-inline-profile-'))

// ---------- launch ----------
const debugPort = await getFreePort()
const bridgePort = await getFreePort()
const child = spawn(electronPath, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, root], {
  cwd: root,
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    WPS_ALLOW_MULTI_INSTANCE: '1',
    WPS_BRIDGE_PORT: String(bridgePort),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
const log = []
child.stdout.on('data', (c) => log.push(String(c)))
child.stderr.on('data', (c) => log.push(String(c)))

let converterAvailable = true

try {
  const page = await findPage(debugPort, 30000)
  if (!page) throw new Error(`no renderer; log tail: ${log.join('').slice(-500)}`)
  const cdp = await connectCdp(page.webSocketDebuggerUrl)
  const { send } = cdp
  await send('Runtime.enable')
  await send('Page.enable')
  await waitFor(send, `document.readyState === 'complete' && Boolean(document.getElementById('root')?.childElementCount)`, 'boot', 30000)
  await sleep(1200)

  // open the generated presentation through the app
  await evaluate(send, `(async () => {
    await window.api.file.open(${JSON.stringify(pptxPath)});
    const root = document.getElementById('root');
    const rootKey = Object.keys(root || {}).find((name) =>
      name.startsWith('__reactContainer') || name.startsWith('__reactFiber'));
    const container = rootKey ? root[rootKey] : null;
    const queue = [container?.current, container?.stateNode?.current,
      container?._internalRoot?.current, container].filter(Boolean);
    const seen = new Set();
    while (queue.length) {
      const fiber = queue.shift();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      if (typeof fiber.memoizedProps?.onOpenFile === 'function') {
        await fiber.memoizedProps.onOpenFile(${JSON.stringify(pptxPath)});
        return true;
      }
      if (fiber.child) queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }
    return false;
  })()`)
  await waitFor(
    send,
    `document.querySelector('[data-testid="presentation-viewer"]')?.dataset.presentationState === 'ready'
      && document.querySelector('.presentation-slide-host')?.textContent.includes('Editable Title')`,
    'presentation ready',
    30000,
  )
  await sleep(600)

  // ---------- V1: click the title text -> edit box appears over it ----------
  const titlePoint = await centerOfText(send, 'Editable Title')
  await clickAt(send, titlePoint.x, titlePoint.y)
  await waitFor(send, `Boolean(document.querySelector('[data-testid="presentation-inline-edit"]'))`, 'inline edit box', 8000)
  const boxInfo = await evaluate(send, `(() => {
    const box = document.querySelector('[data-testid="presentation-inline-edit"]')
    const textarea = box.querySelector('textarea')
    const slide = document.querySelector('.presentation-slide-host')
    const br = box.getBoundingClientRect()
    const sr = slide.getBoundingClientRect()
    return {
      value: textarea.value,
      insideSlide: br.left >= sr.left - 1 && br.top >= sr.top - 1 && br.right <= sr.right + 1 && br.bottom <= sr.bottom + 1,
      width: Math.round(br.width),
      height: Math.round(br.height),
      bordered: getComputedStyle(box).borderWidth !== '0px',
    }
  })()`)
  await screenshot(send, 'v1-inline-edit-box.png')
  record('V1 clicking a text region opens an edit box over it',
    boxInfo?.insideSlide && boxInfo?.bordered && boxInfo?.width > 40 && boxInfo?.height > 10,
    JSON.stringify(boxInfo))
  record('V2 the box shows the clicked region text', boxInfo?.value === 'Editable Title', `value=${JSON.stringify(boxInfo?.value)}`)

  // ---------- V3: edit + Ctrl+Enter applies the change ----------
  await evaluate(send, `(() => {
    const textarea = document.querySelector('[data-testid="presentation-inline-edit"] textarea')
    textarea.focus()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(textarea, 'Changed Title Now')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(200)
  await pressCtrlEnter(send)
  await sleep(4000)
  const afterCommit = await evaluate(send, `(() => ({
    error: document.querySelector('[data-testid="presentation-edit-error"]')?.textContent ?? null,
    box: Boolean(document.querySelector('[data-testid="presentation-inline-edit"]')),
    state: document.querySelector('[data-testid="presentation-viewer"]')?.dataset.presentationState,
    slideText: document.querySelector('.presentation-slide-host')?.textContent?.slice(0, 80),
  }))()`)
  console.log('AFTER COMMIT:', JSON.stringify(afterCommit))
  const changed = await waitFor(
    send,
    `document.querySelector('.presentation-slide-host')?.textContent.includes('Changed Title Now')`,
    're-render with changed text',
    60000,
  )
  await screenshot(send, 'v3-after-edit.png')
  record('V3 edited text is applied and re-rendered', Boolean(changed))

  // ---------- V4: click empty slide space cancels without changes ----------
  const bodyPoint = await centerOfText(send, 'Editable Body Line')
  await clickAt(send, bodyPoint.x, bodyPoint.y)
  await waitFor(send, `Boolean(document.querySelector('[data-testid="presentation-inline-edit"]'))`, 'edit box on body', 8000)
  await evaluate(send, `(() => {
    const textarea = document.querySelector('[data-testid="presentation-inline-edit"] textarea')
    textarea.focus()
    textarea.value = 'DO NOT APPLY'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(200)
  // click far corner of the slide (empty area, below the shapes)
  const corner = await evaluate(send, `(() => {
    const r = document.querySelector('.presentation-slide-host').getBoundingClientRect()
    return { x: Math.round(r.left + r.width - 12), y: Math.round(r.top + r.height - 12) }
  })()`)
  await clickAt(send, corner.x, corner.y)
  await waitFor(send, `!document.querySelector('[data-testid="presentation-inline-edit"]')`, 'box closed by empty click', 8000)
  await sleep(600)
  const bodyStillOriginal = await evaluate(
    send,
    `document.querySelector('.presentation-slide-host')?.textContent.includes('Editable Body Line')`,
  )
  record('V4 clicking empty slide space cancels the edit', Boolean(bodyStillOriginal))

  // ---------- V5: Escape cancels without changes ----------
  const bodyPoint2 = await centerOfText(send, 'Editable Body Line')
  await clickAt(send, bodyPoint2.x, bodyPoint2.y)
  await waitFor(send, `Boolean(document.querySelector('[data-testid="presentation-inline-edit"]'))`, 'edit box again', 8000)
  await evaluate(send, `(() => {
    const textarea = document.querySelector('[data-testid="presentation-inline-edit"] textarea')
    textarea.focus()
    textarea.value = 'NOPE'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(200)
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await waitFor(send, `!document.querySelector('[data-testid="presentation-inline-edit"]')`, 'box closed by Escape', 8000)
  await sleep(600)
  const bodyStillOriginal2 = await evaluate(
    send,
    `document.querySelector('.presentation-slide-host')?.textContent.includes('Editable Body Line')`,
  )
  record('V5 Escape cancels the edit', Boolean(bodyStillOriginal2))

  // ---------- V6: clicking another text region switches the target ----------
  const titlePoint2 = await centerOfText(send, 'Changed Title Now')
  const secondaryPoint = await centerOfText(send, 'Secondary Text')
  await clickAt(send, titlePoint2.x, titlePoint2.y)
  await waitFor(send, `document.querySelector('[data-testid="presentation-inline-edit"] textarea')?.value === 'Changed Title Now'`, 'box on title again', 8000)
  await clickAt(send, secondaryPoint.x, secondaryPoint.y)
  await waitFor(
    send,
    `document.querySelector('[data-testid="presentation-inline-edit"] textarea')?.value === 'Secondary Text'`,
    'box switches to secondary text',
    8000,
  )
  await screenshot(send, 'v6-switched-target.png')
  record('V6 clicking another text region switches the edit target', true)

  cdp.close()
} catch (e) {
  record('harness', false, String(e))
} finally {
  try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
  await sleep(1200)
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch {}
  try { fs.rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch {}
}

fs.writeFileSync(path.join(artifactDir, 'results.json'), JSON.stringify(results, null, 2))
const failed = results.filter((r) => !r.pass)
console.log(`\nVERIFY DONE: ${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exitCode = 2
