/**
 * Verify the file manager "主目录" (home directory) switcher end to end:
 *  V1  right-click the home button opens a dropdown with default/recent/choose-folder items
 *  V2  the current main directory is marked with a check mark
 *  V3  selecting a recent folder switches the main directory (localStorage + navigation)
 *  V4  left-clicking the home button navigates to the chosen main directory
 *  V5  the main directory survives a renderer restart
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
const artifactDir = path.join(root, '.cache', 'verify-home-directory')
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
async function rightClick(send, expression, label) {
  const p = await centerOf(send, expression, label)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', buttons: 0, clickCount: 1 })
}

const homeButtonExpr = `document.querySelector('[data-testid="file-manager-home-button"]')`
const menuExpr = `document.querySelector('[data-testid="home-directory-menu"]')`
const menuItemByText = (text) => `[...(${menuExpr}).querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.trim().includes(${JSON.stringify(text)}))`
const currentDirText = `document.querySelector('[data-testid="file-manager-home-button"]') ? document.querySelector('.text-primary.truncate')?.textContent : ''`

const results = []
function record(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---------- fixtures ----------
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-home-dir-'))
const dirA = path.join(fixtureDir, 'folder-A')
const dirB = path.join(fixtureDir, 'folder-B')
fs.mkdirSync(dirA)
fs.mkdirSync(dirB)
fs.writeFileSync(path.join(dirA, 'a.txt'), 'A\n', 'utf8')
fs.writeFileSync(path.join(dirB, 'b.txt'), 'B\n', 'utf8')

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-home-dir-profile-'))

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

async function restartRenderer(send) {
  const previousTimeOrigin = await evaluate(send, 'performance.timeOrigin')
  await evaluate(send, 'location.reload(); true')
  await waitFor(send, `performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin)}`, 'renderer reload', 20000)
  await waitFor(send, `document.readyState === 'complete' && Boolean(document.getElementById('root')?.childElementCount)`, 'reloaded app', 20000)
}

try {
  const page = await findPage(debugPort, 30000)
  if (!page) throw new Error(`no renderer; log tail: ${log.join('').slice(-500)}`)
  const cdp = await connectCdp(page.webSocketDebuggerUrl)
  const { send } = cdp
  await send('Runtime.enable')
  await send('Page.enable')
  await waitFor(send, `document.readyState === 'complete' && Boolean(document.getElementById('root')?.childElementCount)`, 'boot', 30000)
  await sleep(1200)

  // start the browser inside dirA so it becomes the first recent directory
  const previousTimeOrigin = await evaluate(send, 'performance.timeOrigin')
  await evaluate(send, `(() => {
    localStorage.setItem('last-browse-dir', ${JSON.stringify(dirA)});
    localStorage.removeItem('wps-main-directory');
    localStorage.removeItem('wps-recent-directories');
    location.reload();
    return true;
  })()`)
  await waitFor(send, `performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin)}`, 'initial reload', 20000)
  await waitFor(send, `document.querySelector('.text-primary.truncate')?.textContent === ${JSON.stringify(dirA)}`, 'browse dir A', 20000)
  await waitFor(send, `Boolean(${homeButtonExpr})`, 'home button', 10000)

  // ---------- V1: right-click opens the switcher dropdown ----------
  await rightClick(send, homeButtonExpr, 'home button right-click')
  await waitFor(send, `Boolean(${menuExpr})`, 'home directory menu open', 8000)
  const menuText = await evaluate(send, `(${menuExpr}).textContent`)
  const hasTitle = menuText.includes('切换主目录')
  const hasDefault = await evaluate(send, `Boolean(${menuItemByText('系统默认主目录')})`)
  const hasChooseFolder = await evaluate(send, `Boolean(${menuItemByText('选择文件夹...'))}`)
  const recentItems = await evaluate(send, `[...(${menuExpr}).querySelectorAll('[data-testid^="home-menu-recent-"]')].map((el) => el.textContent.trim())`)
  await screenshot(send, 'v1-home-menu.png')
  record('V1 right-click opens home switcher with all sections',
    hasTitle && hasDefault && hasChooseFolder && recentItems.some((text) => text.includes(dirA)),
    `title=${hasTitle} default=${hasDefault} chooseFolder=${hasChooseFolder} recent=${JSON.stringify(recentItems)}`)

  // ---------- V2: default system home is the initial main directory ----------
  const defaultChecked = await evaluate(send, `Boolean(${menuItemByText('系统默认主目录')}?.querySelector('svg'))`)
  const systemHome = await evaluate(send, `window.api.file.getHome()`)
  record('V2 system home checked while no custom main directory', defaultChecked, `systemHome=${systemHome}`)

  // close with Escape
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor(send, `!(${menuExpr})`, 'menu closed by Escape', 5000)

  // ---------- V3: left-click navigates to the (default) system home ----------
  await leftClick(send, homeButtonExpr, 'home button left-click')
  await waitFor(send, `document.querySelector('.text-primary.truncate')?.textContent === ${JSON.stringify(systemHome)}`, 'navigated to system home', 15000)
  record('V3 left-click goes to the system home by default', true, systemHome)

  // ---------- V4: choose a recent folder as the new main directory ----------
  await rightClick(send, homeButtonExpr, 'home button right-click 2')
  await waitFor(send, `Boolean(${menuExpr})`, 'menu open again', 8000)
  await leftClick(send, menuItemByText(dirA), 'recent folder A item')
  await waitFor(send, `document.querySelector('.text-primary.truncate')?.textContent === ${JSON.stringify(dirA)}`, 'switched to main dir A', 15000)
  const storedMain = await evaluate(send, `localStorage.getItem('wps-main-directory')`)
  await waitFor(send, `!(${menuExpr})`, 'menu closed after selection', 5000)
  record('V4 recent folder selection switches the main directory',
    storedMain === dirA,
    `stored=${storedMain}`)

  // reopen: check mark moved to folder A
  await rightClick(send, homeButtonExpr, 'home button right-click 3')
  await waitFor(send, `Boolean(${menuExpr})`, 'menu open 3', 8000)
  const aChecked = await evaluate(send, `Boolean(${menuItemByText(dirA)}?.querySelector('svg'))`)
  const defaultUnchecked = await evaluate(send, `!(${menuItemByText('系统默认主目录')}?.querySelector('svg'))`)
  await screenshot(send, 'v4-check-moved.png')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor(send, `!(${menuExpr})`, 'menu closed 3', 5000)
  record('V4b check mark follows the selected main directory', aChecked && defaultUnchecked, `a=${aChecked} default=${defaultUnchecked}`)

  // ---------- V5: left-click returns to the chosen main directory ----------
  // move away first (one level up from A to the fixture dir)
  await leftClick(send, `document.querySelector('.text-primary.truncate')`, 'go up path button')
  await waitFor(send, `document.querySelector('.text-primary.truncate')?.textContent === ${JSON.stringify(fixtureDir)}`, 'moved up to fixture dir', 15000)
  await leftClick(send, homeButtonExpr, 'home button left-click 2')
  await waitFor(send, `document.querySelector('.text-primary.truncate')?.textContent === ${JSON.stringify(dirA)}`, 'back to main dir A', 15000)
  record('V5 left-click navigates to the chosen main directory', true, dirA)

  // ---------- V6: main directory survives a renderer restart ----------
  await restartRenderer(send)
  await waitFor(send, `Boolean(${homeButtonExpr})`, 'home button after reload', 10000)
  await waitFor(send, `document.querySelector('.text-primary.truncate')?.textContent === ${JSON.stringify(dirA)}`, 'browse dir A after reload', 20000)
  await leftClick(send, homeButtonExpr, 'home button left-click after reload')
  await waitFor(send, `document.querySelector('.text-primary.truncate')?.textContent === ${JSON.stringify(dirA)}`, 'main dir A kept after reload', 15000)
  const storedAfterReload = await evaluate(send, `localStorage.getItem('wps-main-directory')`)
  record('V6 main directory persists across restart', storedAfterReload === dirA, `stored=${storedAfterReload}`)

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
