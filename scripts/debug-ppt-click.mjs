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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pptxgen = (await import('pptxgenjs')).default

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close((e) => (e ? reject(e) : resolve(p))) })
  })
}
function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1
    const send = (method, params = {}) => new Promise((res, rej) => {
      const id = nextId++
      pending.set(id, { resolve: res, reject: rej })
      socket.send(JSON.stringify({ id, method, params }))
    })
    socket.addEventListener('open', () => resolve({ send, close: () => socket.close() }))
    socket.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (!m.id || !pending.has(m.id)) return
      const p = pending.get(m.id); pending.delete(m.id)
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m)
    })
    socket.addEventListener('error', (ev) => reject(new Error(`ws error ${ev.message ?? ev}`)))
  })
}
async function findPage(port) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && String(t.url).includes('out/renderer'))
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
  while (Date.now() < deadline) {
    try { const v = await evaluate(send, expression); if (v) return v } catch {}
    await sleep(150)
  }
  throw new Error(`timeout: ${label}`)
}

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-ppt-dbg-'))
const pptxPath = path.join(fixtureDir, 'editable.pptx')
const pptx = new pptxgen()
pptx.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 })
pptx.layout = 'WIDE'
const slide = pptx.addSlide()
slide.addText('Editable Title', { x: 0.5, y: 0.4, w: 12, h: 1.2, fontSize: 44, bold: true, fontFace: 'Arial' })
slide.addText('Editable Body Line', { x: 0.5, y: 2.2, w: 8, h: 1.0, fontSize: 28, fontFace: 'Arial' })
await pptx.writeFile({ fileName: pptxPath })

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-ppt-dbg-profile-'))
const debugPort = await getFreePort()
const bridgePort = await getFreePort()
const child = spawn(electronPath, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, root], {
  cwd: root,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1', WPS_ALLOW_MULTI_INSTANCE: '1', WPS_BRIDGE_PORT: String(bridgePort) },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
const log = []
child.stdout.on('data', (c) => log.push(String(c)))
child.stderr.on('data', (c) => log.push(String(c)))

try {
  const page = await findPage(debugPort)
  if (!page) throw new Error(`no renderer: ${log.join('').slice(-300)}`)
  const cdp = await connectCdp(page.webSocketDebuggerUrl)
  const { send } = cdp
  await send('Runtime.enable')
  await waitFor(send, `document.readyState === 'complete' && Boolean(document.getElementById('root')?.childElementCount)`, 'boot')
  await sleep(1000)
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
  await waitFor(send, `document.querySelector('[data-testid="presentation-viewer"]')?.dataset.presentationState === 'ready' && document.querySelector('.presentation-slide-host')?.textContent.includes('Editable Title')`, 'presentation ready')
  await sleep(500)

  const info = await evaluate(send, `(() => {
    const host = document.querySelector('.presentation-slide-host')
    const hr = host.getBoundingClientRect()
    const textEls = [...host.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && el.textContent.trim())
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { text: el.textContent.slice(0, 30), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
      })
    window.__md = []
    host.addEventListener('mousedown', (e) => {
      window.__md.push({ x: e.clientX, y: e.clientY, target: e.target.tagName + '.' + String(e.target.className).slice(0, 40) })
    }, true)
    return { host: { x: Math.round(hr.left), y: Math.round(hr.top), w: Math.round(hr.width), h: Math.round(hr.height) }, textEls }
  })()`)
  console.log('INFO:', JSON.stringify(info, null, 1))

  const titleEl = info.textEls.find((el) => el.text.includes('Editable Title'))
  if (titleEl) {
    const cx = titleEl.x + titleEl.w / 2
    const cy = titleEl.y + titleEl.h / 2
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(800)
  }
  const after = await evaluate(send, `(() => ({
    mousedowns: window.__md,
    box: Boolean(document.querySelector('[data-testid="presentation-inline-edit"]')),
  }))()`)
  console.log('AFTER:', JSON.stringify(after))
  cdp.close()
} catch (e) {
  console.error('FAILED:', String(e))
  console.error('LOG:', log.join('').slice(-500))
} finally {
  try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
  await sleep(1000)
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch {}
  try { fs.rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch {}
}
