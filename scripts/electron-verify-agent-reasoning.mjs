import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const root = process.cwd()
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-reasoning-profile-'))
const screenshotPath = path.join(root, '.cache', 'electron-verify-agent-reasoning.png')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const verificationAgent = {
  id: 'reasoning-ui-verification',
  name: 'Reasoning UI',
  role: 'Verification agent',
  systemPrompt: 'Verify reasoning controls.',
  providerId: 'opencode-go',
  model: 'hy3',
  reasoning: { kind: 'auto' },
  color: '#6366f1',
  enabled: true,
}

function check(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

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
  const deadline = Date.now() + 30_000
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

function connectCdp(url, onEvent) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const pending = new Map()
    let nextId = 1
    socket.addEventListener('open', () => resolve({
      send(method, params = {}) {
        return new Promise((resolveCall, rejectCall) => {
          const id = nextId++
          pending.set(id, { resolveCall, rejectCall })
          socket.send(JSON.stringify({ id, method, params }))
        })
      },
      close() { socket.close() },
    }))
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      if (!message.id) {
        onEvent(message)
        return
      }
      const call = pending.get(message.id)
      if (!call) return
      pending.delete(message.id)
      if (message.error) call.rejectCall(new Error(message.error.message))
      else call.resolveCall(message)
    })
    socket.addEventListener('error', reject)
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
    throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text)
  }
  return response.result.result.value
}

async function waitFor(send, expression, label, timeout = 20_000) {
  const deadline = Date.now() + timeout
  let value
  while (Date.now() < deadline) {
    value = await evaluate(send, expression)
    if (value) return value
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}; last value=${JSON.stringify(value)}`)
}

let child
let cdp
const rendererErrors = []
try {
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
  const port = await getFreePort()
  child = spawn(electronPath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profilePath}`,
    root,
  ], {
    cwd: root,
    env: {
      ...process.env,
      WPS_ALLOW_MULTI_INSTANCE: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      WPS_BRIDGE_PORT: String(port + 3_000),
    },
    stdio: 'ignore',
    windowsHide: true,
  })

  const page = await waitForPage(port)
  cdp = await connectCdp(page.webSocketDebuggerUrl, (message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      rendererErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text)
    }
  })
  const { send } = cdp
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1_280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  })

  await waitFor(send, 'Boolean(window.api?.agent?.save)', 'Agent API')
  await evaluate(send, `(async () => {
    await window.api.agent.save(${JSON.stringify(verificationAgent)});
    location.reload();
    return true;
  })()`)
  await waitFor(send, `[
    ...document.querySelectorAll('button')
  ].some((button) => button.textContent.includes('Reasoning UI'))`, 'reasoning Agent row')
  await evaluate(send, `(() => {
    const row = [...document.querySelectorAll('button')]
      .find((button) => button.textContent.includes('Reasoning UI'));
    row.click();
    return true;
  })()`)
  await waitFor(send, 'Boolean(document.querySelector("[data-testid=agent-composer]"))', 'Agent composer')
  await waitFor(send, `document.querySelector('[data-testid=agent-model-picker-trigger]')?.textContent.includes('hy3')`, 'Hy3 model label')
  await waitFor(send, 'document.querySelector("[data-testid=agent-reasoning-trigger]")?.disabled === false', 'reasoning trigger')
  await evaluate(send, `(() => {
    const trigger = document.querySelector('[data-testid=agent-reasoning-trigger]');
    trigger.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true,
    }));
    trigger.click();
    return true;
  })()`)
  await waitFor(send, 'Boolean(document.querySelector("[data-testid=agent-reasoning-menu]"))', 'reasoning menu')

  const state = await evaluate(send, `(() => {
    const expected = [
      'agent-reasoning-auto',
      'agent-reasoning-effort-none',
      'agent-reasoning-effort-low',
      'agent-reasoning-effort-high',
    ];
    const menu = document.querySelector('[data-testid=agent-reasoning-menu]');
    const menuRect = menu.getBoundingClientRect();
    const triggerRect = document.querySelector('[data-testid=agent-reasoning-trigger]').getBoundingClientRect();
    const composerRect = document.querySelector('[data-testid=agent-composer]').getBoundingClientRect();
    return {
      present: expected.map((id) => Boolean(document.querySelector('[data-testid=' + id + ']'))),
      menuText: menu.textContent,
      menuFits: menuRect.left >= 0 && menuRect.right <= innerWidth && menuRect.top >= 0,
      itemsFit: [...menu.querySelectorAll('[role=menuitemradio]')]
        .every((item) => item.scrollWidth <= item.clientWidth),
      triggerFits: triggerRect.left >= composerRect.left && triggerRect.right <= composerRect.right,
    };
  })()`)
  check(state.present.every(Boolean), 'Hy3 exposes Auto, None, Low, and High')
  check(state.menuFits && state.itemsFit && state.triggerFits, 'Reasoning menu and trigger stay inside the composer viewport')

  await evaluate(send, 'document.querySelector("[data-testid=agent-reasoning-effort-high]").click(); true')
  await waitFor(send, `(async () => {
    const agent = (await window.api.agent.list()).find((item) => item.id === 'reasoning-ui-verification');
    return agent?.reasoning?.kind === 'effort' && agent.reasoning.value === 'high';
  })()`, 'saved High reasoning selection')
  check(true, 'High selection persists as a model-specific reasoning value')

  await evaluate(send, `(() => {
    const trigger = document.querySelector('[data-testid=agent-reasoning-trigger]');
    trigger.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, pointerId: 2, isPrimary: true,
    }));
    trigger.click();
    return true;
  })()`)
  await waitFor(send, 'Boolean(document.querySelector("[data-testid=agent-reasoning-menu]"))', 'reopened reasoning menu')
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const image = Buffer.from(screenshot.result.data, 'base64')
  fs.writeFileSync(screenshotPath, image)
  check(image.length > 10_000, `Reasoning UI screenshot is nonempty (${image.length} bytes)`)
  check(rendererErrors.length === 0, `No renderer exceptions were reported (${rendererErrors.length})`)
  console.log(`PASS screenshot saved to ${screenshotPath}`)
} finally {
  if (cdp) {
    try {
      await evaluate(cdp.send, `window.api?.agent?.delete('reasoning-ui-verification')`)
    } catch {}
  }
  cdp?.close()
  child?.kill()
  await sleep(300)
  fs.rmSync(profilePath, { recursive: true, force: true })
}
