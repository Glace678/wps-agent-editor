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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function checkSourceWiring() {
  const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8')
  const fileManager = fs.readFileSync(
    path.join(root, 'src/components/file-manager/FileManager.tsx'),
    'utf8',
  )

  if (!/window\.on\('app-command',[\s\S]*browser-backward[\s\S]*FILE_NAVIGATE_BACK/.test(main)) {
    throw new Error('main process does not forward browser-backward')
  }
  if (!/onNavigateBack:[\s\S]*ipcRenderer\.on\(IPC\.FILE_NAVIGATE_BACK/.test(preload)) {
    throw new Error('preload does not expose the back-navigation event')
  }
  if (!/activeTab !== 'browse'[\s\S]*onNavigateBack\(\(\) => goBackToPreviousDir\('native'\)\)/.test(fileManager)) {
    throw new Error('Browse tab does not subscribe to back navigation')
  }
  if (/goBackFromRecent|handleRecentTabAuxClick/.test(fileManager)) {
    throw new Error('Recent tab still handles mouse Back')
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1

    const send = (method, params = {}) => new Promise((resolveCommand, rejectCommand) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        rejectCommand(new Error(`CDP timeout: ${method}`))
      }, 20_000)
      pending.set(id, { resolveCommand, rejectCommand, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })

    socket.addEventListener('open', () => resolve({ send, close: () => socket.close() }))
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const request = pending.get(message.id)
      if (!request) return
      clearTimeout(request.timer)
      pending.delete(message.id)
      if (message.error) request.rejectCommand(new Error(message.error.message))
      else request.resolveCommand(message)
    })
    socket.addEventListener('error', reject)
  })
}

async function findRenderer(debugPort) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => (
        target.type === 'page'
        && (String(target.url).includes('out/renderer') || String(target.url).includes('index.html'))
      ))
      if (page?.webSocketDebuggerUrl) return page
    } catch {}
    await sleep(200)
  }
  throw new Error('Electron renderer did not become available')
}

async function evaluate(send, expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (response.result.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description || 'evaluation failed')
  }
  return response.result.result?.value
}

async function waitFor(send, expression, label) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (await evaluate(send, expression)) return
    await sleep(100)
  }
  throw new Error(`timeout waiting for ${label}`)
}

async function centerOf(send, expression) {
  const point = await evaluate(send, `(() => {
    const element = ${expression}
    if (!(element instanceof HTMLElement)) return null
    const rect = element.getBoundingClientRect()
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  })()`)
  if (!point) throw new Error('target element is not visible')
  return point
}

async function click(send, expression) {
  const point = await centerOf(send, expression)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 })
}

async function mouseBack(send) {
  const point = await centerOf(send, `document.querySelector('[role=tabpanel][data-state=active]')`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'back', buttons: 8, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'back', buttons: 0, clickCount: 1 })
}

checkSourceWiring()

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-browse-back-fixture-'))
const childDir = path.join(fixtureRoot, 'opened-child')
fs.mkdirSync(childDir)
fs.writeFileSync(path.join(childDir, 'inside.txt'), 'fixture\n', 'utf8')

const debugPort = await getFreePort()
const bridgePort = await getFreePort()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-browse-back-profile-'))
const child = spawn(electronPath, [
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  root,
], {
  cwd: root,
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    WPS_ALLOW_MULTI_INSTANCE: '1',
    WPS_BRIDGE_PORT: String(bridgePort),
  },
  stdio: 'ignore',
  windowsHide: true,
})

let cdp
try {
  const page = await findRenderer(debugPort)
  cdp = await connectCdp(page.webSocketDebuggerUrl)
  const { send } = cdp
  await send('Runtime.enable')
  await waitFor(send, "document.querySelectorAll('[role=tab]').length === 2", 'file tabs')

  const oldTimeOrigin = await evaluate(send, 'performance.timeOrigin')
  await evaluate(send, `localStorage.setItem('last-browse-dir', ${JSON.stringify(fixtureRoot)}); location.reload(); true`)
  await waitFor(send, `performance.timeOrigin !== ${oldTimeOrigin}`, 'renderer reload')

  const buttonWithText = (text) => (
    `[...document.querySelectorAll('[role=tabpanel][data-state=active] button')]`
    + `.find((button) => button.textContent.trim() === ${JSON.stringify(text)})`
  )
  const recentTab = `[...document.querySelectorAll('[role=tab]')].find((tab) => /最近|Recent/i.test(tab.textContent))`
  const browseTab = `[...document.querySelectorAll('[role=tab]')].find((tab) => /浏览|Browse/i.test(tab.textContent))`

  await waitFor(send, `Boolean(${buttonWithText(fixtureRoot)})`, 'fixture root')
  await click(send, buttonWithText('opened-child'))
  await waitFor(send, `Boolean(${buttonWithText(childDir)})`, 'opened child folder')

  await mouseBack(send)
  await waitFor(send, `Boolean(${buttonWithText(fixtureRoot)})`, 'previous folder')
  console.log('PASS  mouse Back returns Browse to the previously opened folder')

  await click(send, recentTab)
  await waitFor(send, `(${recentTab})?.getAttribute('data-state') === 'active'`, 'Recent tab activation')
  await mouseBack(send)
  await sleep(300)
  const recentStayedActive = await evaluate(
    send,
    `(${recentTab})?.getAttribute('data-state') === 'active' && (${browseTab})?.getAttribute('data-state') !== 'active'`,
  )
  if (!recentStayedActive) throw new Error('mouse Back still changes the Recent tab')
  console.log('PASS  mouse Back does nothing in Recent')
} finally {
  cdp?.close()
  child.kill()
  await sleep(300)
  fs.rmSync(profile, { recursive: true, force: true })
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}
