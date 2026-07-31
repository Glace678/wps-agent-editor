import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronPath = require('electron')
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-app-menu-verify-'))
const screenshotPath = path.join(root, '.cache', 'electron-verify-app-menu-light.png')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => error
        ? reject(error)
        : resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

async function waitForPage(port) {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = pages.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // Electron has not enabled the inspector endpoint yet.
    }
    await sleep(100)
  }
  throw new Error('Timed out waiting for Electron renderer')
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const pending = new Map()
    let nextId = 1
    socket.addEventListener('open', () => resolve({
      send(method, params = {}) {
        return new Promise((resolveCall, rejectCall) => {
          const id = nextId++
          pending.set(id, { resolve: resolveCall, reject: rejectCall })
          socket.send(JSON.stringify({ id, method, params }))
        })
      },
      close() { socket.close() },
    }))
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      const call = pending.get(message.id)
      if (!call) return
      pending.delete(message.id)
      if (message.error) call.reject(new Error(message.error.message))
      else call.resolve(message)
    })
    socket.addEventListener('error', reject)
  })
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (response.result.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text)
  }
  return response.result.result.value
}

async function waitFor(cdp, expression, label) {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return
    await sleep(20)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function pointFor(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!(element instanceof HTMLElement)) return null
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
  })()`)
  assert.ok(point, `${selector} must be visible`)
  return point
}

async function click(cdp, selector) {
  const point = await pointFor(cdp, selector)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 })
}

async function move(cdp, selector) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...(await pointFor(cdp, selector)) })
}

async function stopElectron(process) {
  if (!process || process.exitCode !== null) return
  const exited = new Promise((resolve) => process.once('exit', resolve))
  process.kill()
  await Promise.race([exited, sleep(5_000)])
}

let child
let cdp
try {
  const port = await getFreePort()
  child = spawn(electronPath, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`], {
    cwd: root,
    env: { ...process.env, WPS_ALLOW_MULTI_INSTANCE: '1' },
    stdio: 'ignore',
  })
  const page = await waitForPage(port)
  cdp = await connectCdp(page.webSocketDebuggerUrl)

  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=app-menu-file]'))", 'renderer menu')
  assert.equal(await evaluate(cdp, `(() => {
    localStorage.setItem('app-theme', 'light')
    window.dispatchEvent(new CustomEvent('app-theme-change', { detail: 'light' }))
    return window.api.theme.setPreference('light').then((result) => result.success)
  })()`), true, 'native theme bridge must accept the light preference')
  await waitFor(cdp, "!document.documentElement.classList.contains('dark')", 'light theme')

  await click(cdp, '[data-testid=app-menu-file]')
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=app-menu-content-file]'))", 'File menu')
  assert.equal(
    await evaluate(cdp, "getComputedStyle(document.querySelector('[data-testid=app-menu-content-file]')).backgroundColor"),
    'rgb(255, 255, 255)',
    'light File menu must be white',
  )

  const startedAt = Date.now()
  await move(cdp, '[data-testid=app-menu-edit]')
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=app-menu-content-edit]'))", 'Edit menu after hover')
  assert.ok(Date.now() - startedAt < 250, 'File to Edit hover switch should be immediate')

  await move(cdp, '[data-testid=app-menu-view]')
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=app-menu-content-view]'))", 'View menu after hover')
  assert.equal(
    await evaluate(cdp, "getComputedStyle(document.querySelector('[data-testid=app-menu-content-view]')).animationName"),
    'none',
    'top-level menu switching must not replay an opening animation',
  )

  for (const top of ['agent', 'help']) {
    await move(cdp, `[data-testid=app-menu-${top}]`)
    await waitFor(cdp, `Boolean(document.querySelector('[data-testid=app-menu-content-${top}]'))`, `${top} menu after hover`)
    assert.equal(
      await evaluate(cdp, `getComputedStyle(document.querySelector('[data-testid=app-menu-content-${top}]')).backgroundColor`),
      'rgb(255, 255, 255)',
      `light ${top} menu must be white`,
    )
  }

  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
  fs.writeFileSync(screenshotPath, screenshot.result.data, 'base64')
  console.log(`PASS app menu light theme, hover switching, and no opening animation\n${screenshotPath}`)
} finally {
  cdp?.close()
  await stopElectron(child)
  try {
    fs.rmSync(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // Windows can release the Electron profile a moment after the main process exits.
  }
}
