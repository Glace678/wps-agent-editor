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
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-provider-delete-verify-'))
const screenshotContextMenuPath = path.join(root, '.cache', 'electron-verify-provider-context-menu.png')
const screenshotConfirmDialogPath = path.join(root, '.cache', 'electron-verify-provider-delete-confirm.png')
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
    } catch {}
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
      if (message.method === 'Runtime.consoleAPICalled') {
        console.log('[BROWSER CONSOLE]', ...message.params.args.map((a) => a.value || a.description || JSON.stringify(a)))
      }
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

async function waitFor(cdp, expression, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return
    await sleep(40)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function rightClick(cdp, selector) {
  await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)})
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const evt = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cx,
      clientY: cy,
      button: 2,
      buttons: 2,
    })
    el.dispatchEvent(evt)
    return true
  })()`)
}

let child
let cdp

async function run() {
  const port = await getFreePort()
  child = spawn(electronPath, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`], {
    cwd: root,
    env: { ...process.env, WPS_ALLOW_MULTI_INSTANCE: '1' },
    stdio: 'ignore',
  })
  const page = await waitForPage(port)
  cdp = await connectCdp(page.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await evaluate(cdp, "console.log('hello from test'); true")

  // 1. Open Provider Settings
  await waitFor(cdp, "Boolean(document.querySelector('button[aria-label] .lucide-key'))", 'provider settings button')
  await evaluate(cdp, "document.querySelector('button[aria-label] .lucide-key')?.closest('button')?.click(); true")
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid^=provider-option-]'))", 'provider list loaded')

  // 2. Add a custom provider to test right-click deletion
  await evaluate(cdp, "document.querySelector('[data-testid=add-custom-provider]').click(); true")
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=custom-provider-base-url]'))", 'custom form')
  await evaluate(cdp, `(() => {
    const setValue = (selector, val) => {
      const el = document.querySelector(selector)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setValue('input[placeholder="名称"]', 'Test Provider To Delete')
    setValue('[data-testid=custom-provider-base-url]', 'https://delete-test.api.com/v1')
    setValue('[data-testid=custom-provider-default-model]', 'test-model')
    document.querySelector('[data-testid=custom-provider-create]').click()
    return true
  })()`)
  await waitFor(cdp, "!document.querySelector('[data-testid=custom-provider-base-url]')", 'custom provider created')

  const customOptionSelector = "[data-testid^='provider-option-custom-']"
  await waitFor(cdp, `Boolean(document.querySelector("${customOptionSelector}"))`, 'custom provider option in list')

  // 3. Right-click on the custom provider
  await rightClick(cdp, customOptionSelector)
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=provider-context-menu]'))", 'provider context menu')
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=provider-context-menu-delete]'))", 'delete option in context menu')

  // Screenshot of context menu
  const ss1 = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.mkdirSync(path.dirname(screenshotContextMenuPath), { recursive: true })
  fs.writeFileSync(screenshotContextMenuPath, ss1.result.data, 'base64')

  // 4. Click 'Delete' in context menu -> should pop up confirmation dialog
  await evaluate(cdp, "document.querySelector('[data-testid=provider-context-menu-delete]').click(); true")
  await waitFor(cdp, "!document.querySelector('[data-testid=provider-context-menu]')", 'context menu closed')
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=provider-delete-confirm-dialog]'))", 'confirm dialog opened')

  const dialogText = await evaluate(cdp, "document.querySelector('[data-testid=provider-delete-confirm-dialog]').textContent")
  assert.ok(dialogText.includes('Test Provider To Delete'), `Confirm message must contain provider name: ${dialogText}`)

  // Screenshot of confirmation dialog
  const ss2 = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(screenshotConfirmDialogPath, ss2.result.data, 'base64')

  // 5. Test Cancel button in confirmation dialog
  await evaluate(cdp, "document.querySelector('[data-testid=provider-delete-confirm-dialog] button:not([data-testid=provider-confirm-delete-button])')?.click(); true")
  await waitFor(cdp, "!document.querySelector('[data-testid=provider-delete-confirm-dialog]')", 'confirm dialog dismissed on cancel')
  assert.equal(
    await evaluate(cdp, `Boolean(document.querySelector("${customOptionSelector}"))`),
    true,
    'provider must not be deleted when cancel is clicked'
  )

  // 6. Right-click again and Confirm delete
  await rightClick(cdp, customOptionSelector)
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=provider-context-menu-delete]'))", 'delete option reopened')
  await evaluate(cdp, "document.querySelector('[data-testid=provider-context-menu-delete]').click(); true")
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=provider-confirm-delete-button]'))", 'confirm delete button')
  await evaluate(cdp, "document.querySelector('[data-testid=provider-confirm-delete-button]').click(); true")

  await waitFor(cdp, "!document.querySelector('[data-testid=provider-delete-confirm-dialog]')", 'confirm dialog closed after delete')
  await waitFor(cdp, `!document.querySelector("${customOptionSelector}")`, 'provider removed from list')

  // 7. Right-click on a built-in provider (e.g. zhipuai) and delete it
  await rightClick(cdp, '[data-testid=provider-option-zhipuai]')
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=provider-context-menu]'))", 'built-in context menu')
  await evaluate(cdp, "document.querySelector('[data-testid=provider-context-menu-delete]').click(); true")
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=provider-delete-confirm-dialog]'))", 'built-in delete dialog')
  await evaluate(cdp, "document.querySelector('[data-testid=provider-confirm-delete-button]').click(); true")
  await waitFor(cdp, "!document.querySelector('[data-testid=provider-delete-confirm-dialog]')", 'built-in dialog closed')
  await waitFor(cdp, "!document.querySelector('[data-testid=provider-option-zhipuai]')", 'built-in provider removed from list')

  console.log('PASS: Provider right-click context menu and secondary deletion confirmation verified successfully for both custom and built-in providers!')
}

try {
  await run()
} finally {
  cdp?.close()
  if (child && child.exitCode === null) {
    child.kill()
  }
  try {
    fs.rmSync(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {}
}
