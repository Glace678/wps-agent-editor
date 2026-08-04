/**
 * Reproduce real-usage checkbox multi-select in the "最近" tab:
 *  - hover a row, WAIT for the hover info card to open, then click the checkbox
 *  - check whether selection toggles correctly
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
async function centerOf(send, expression, label) {
  const point = await evaluate(send, `(() => {
    const el = ${expression}
    if (!(el instanceof HTMLElement)) return null
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
  if (!point) throw new Error(`${label}: element not found/visible`)
  return point
}
async function leftClick(send, expression, label) {
  const p = await centerOf(send, expression, label)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 })
}
async function screenshot(send, name, dir) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(dir, name), Buffer.from(shot.result.data, 'base64'))
}

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-cb-repro-'))
const names = ['A文档.txt', 'B文档.txt', 'C文档.txt']
const paths = names.map((n) => path.join(fixtureDir, n))
for (const p of paths) fs.writeFileSync(p, 'hello\n', 'utf8')

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-cb-repro-profile-'))
fs.writeFileSync(path.join(profile, 'recent-files.json'), JSON.stringify(
  paths.map((p, i) => ({ path: p, name: names[i], openedAt: Date.now() - i * 60_000 })), null, 2))

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

const rowExpr = (name) => `[...document.querySelectorAll('button')].find((b) => b.textContent.includes(${JSON.stringify(name)}) && b.querySelector('p'))`
const selectExpr = (name) => `(${rowExpr(name)}).querySelector('[data-recent-file-select]')`

const results = []
const record = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`) }

try {
  const page = await findPage(debugPort, 30000)
  if (!page) throw new Error(`no renderer; log tail: ${log.join('').slice(-500)}`)
  const cdp = await connectCdp(page.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await waitFor(cdp.send, `document.readyState === 'complete' && Boolean(document.getElementById('root')?.childElementCount)`, 'boot', 30000)
  await sleep(1500)

  await leftClick(cdp.send, `[...document.querySelectorAll('[role="tab"]')].find((el) => /最近|Recent/i.test(el.textContent))`, 'recent tab')
  await waitFor(cdp.send, `Boolean(${rowExpr('A文档.txt')})`, 'recent rows', 15000)

  // Scenario 1: hover row -> wait for hover card to open -> click checkbox
  const cardShown = `Boolean(document.querySelector('[role="tooltip"]'))`
  await evaluate(cdp.send, `(() => { const el = ${rowExpr('A文档.txt')}; const r = el.getBoundingClientRect(); window.__hover = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  const h = await evaluate(cdp.send, `window.__hover`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x, y: h.y })
  const cardOpened = await waitFor(cdp.send, cardShown, 'hover card opened', 5000)
  const cardOverCheckbox = await evaluate(cdp.send, `(() => {
    const card = document.querySelector('[role="tooltip"]')
    const cb = ${selectExpr('A文档.txt')}
    if (!card || !cb) return null
    const a = card.getBoundingClientRect()
    const b = cb.getBoundingClientRect()
    const overlap = !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)
    return { overlap, cardRect: { l: a.left, r: a.right, t: a.top, b: a.bottom }, cbRect: { l: b.left, r: b.right, t: b.top, b: b.bottom } }
  })()`)
  await screenshot(cdp.send, 'repro1-card-open.png', fixtureDir)
  console.log('card opened:', cardOpened, 'card vs checkbox:', JSON.stringify(cardOverCheckbox))
  await leftClick(cdp.send, selectExpr('A文档.txt'), 'click checkbox A while card open')
  await sleep(400)
  const selA = await evaluate(cdp.send, `(${rowExpr('A文档.txt')}).getAttribute('aria-selected')`)
  record('click checkbox while hover card open selects A', selA === 'true', `cardOverlap=${cardOverCheckbox?.overlap} selected=${selA}`)

  // Scenario 2: hover -> wait card -> click checkbox on ANOTHER row (multi-select)
  await evaluate(cdp.send, `(() => { const el = ${rowExpr('B文档.txt')}; const r = el.getBoundingClientRect(); window.__hover = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  const h2 = await evaluate(cdp.send, `window.__hover`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h2.x, y: h2.y })
  await waitFor(cdp.send, cardShown, 'hover card opened again', 5000)
  await leftClick(cdp.send, selectExpr('B文档.txt'), 'click checkbox B while card open')
  await sleep(400)
  const counts = await evaluate(cdp.send, `[...document.querySelectorAll('[data-recent-file-index][aria-selected="true"]')].length`)
  record('multi-select via checkboxes (A+B)', counts === 2, `selected=${counts}`)

  // Scenario 3: quick hover + click (card not yet open) — old behavior
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
  await sleep(500)
  await leftClick(cdp.send, selectExpr('C文档.txt'), 'click checkbox C fast (no card)')
  await sleep(400)
  const counts2 = await evaluate(cdp.send, `[...document.querySelectorAll('[data-recent-file-index][aria-selected="true"]')].length`)
  record('multi-select fast clicks (A+B+C)', counts2 === 3, `selected=${counts2}`)

  // Scenario 4: narrow window — hover card may flip left and cover the checkbox
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
  await sleep(400)
  await leftClick(cdp.send, rowExpr('C文档.txt'), 'reset selection via row click')
  await sleep(300)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 520, height: 560, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  await evaluate(cdp.send, `(() => { const el = ${rowExpr('A文档.txt')}; const r = el.getBoundingClientRect(); window.__hover = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  const h4 = await evaluate(cdp.send, `window.__hover`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h4.x, y: h4.y })
  await waitFor(cdp.send, cardShown, 'hover card opened (narrow)', 5000)
  const narrowOverlap = await evaluate(cdp.send, `(() => {
    const card = document.querySelector('[role="tooltip"]')
    const cb = ${selectExpr('A文档.txt')}
    if (!card || !cb) return null
    const a = card.getBoundingClientRect()
    const b = cb.getBoundingClientRect()
    const overlap = !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)
    return { overlap, cardRect: { l: Math.round(a.left), r: Math.round(a.right), t: Math.round(a.top), b: Math.round(a.bottom) }, cbRect: { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) } }
  })()`)
  await screenshot(cdp.send, 'repro4-narrow-card.png', fixtureDir)
  console.log('narrow window card vs checkbox:', JSON.stringify(narrowOverlap))
  await leftClick(cdp.send, selectExpr('A文档.txt'), 'click checkbox A (narrow)')
  await sleep(400)
  const selA2 = await evaluate(cdp.send, `(${rowExpr('A文档.txt')}).getAttribute('aria-selected')`)
  record('narrow window: checkbox click still works', selA2 === 'true', `overlap=${narrowOverlap?.overlap} selected=${selA2}`)
  // and multi-select in narrow window
  await leftClick(cdp.send, selectExpr('B文档.txt'), 'click checkbox B (narrow)')
  await sleep(400)
  const counts3 = await evaluate(cdp.send, `[...document.querySelectorAll('[data-recent-file-index][aria-selected="true"]')].length`)
  const perRow = await evaluate(cdp.send, `(() => {
    const rows = [...document.querySelectorAll('[data-recent-file-index]')]
    const hit = ${selectExpr('B文档.txt')}
    const r = hit.getBoundingClientRect()
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return {
      rows: rows.map((el) => ({ name: el.querySelector('p')?.textContent, sel: el.getAttribute('aria-selected') })),
      elementAtCheckbox: at ? at.tagName + '.' + (at.getAttribute('data-recent-file-select') ?? at.getAttribute('role') ?? at.className) : 'none',
    }
  })()`)
  console.log('narrow B-click detail:', JSON.stringify(perRow))
  record('narrow window multi-select works', counts3 === 3, `selected=${counts3}`)

  cdp.close()
} catch (e) {
  record('harness', false, String(e))
} finally {
  try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
  await sleep(1200)
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch {}
  try { fs.rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch {}
}

const failed = results.filter((r) => !r.pass)
console.log(`\nREPRO DONE: ${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exitCode = 2
