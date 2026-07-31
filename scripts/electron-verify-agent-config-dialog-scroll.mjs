/**
 * Behavioral: clicking the assistant panel's plus (new agent) button opens the
 * agent config dialog; in a short window its form must scroll vertically.
 * Regressions guarded: a flex-1 body without min-h-0 pushed the footer off
 * screen, and a Radix ScrollArea viewport (h-full) could not resolve its
 * percentage height inside the max-h-only flex column, so it never scrolled.
 */
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const root = process.cwd()
const artifactDir = path.join(root, '.cache')
const screenshotPath = path.join(artifactDir, 'electron-verify-agent-config-dialog-scroll.png')
const profilePath = path.join(
  os.tmpdir(),
  `wps-agent-dialog-scroll-profile-${process.pid}`,
)
const port = Number(process.env.WPS_DIALOG_VERIFY_PORT || 9367)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const expectedBuildFiles = [
  path.join(root, 'out', 'main', 'main.js'),
  path.join(root, 'out', 'renderer', 'index.html'),
]
for (const buildFile of expectedBuildFiles) {
  if (!fs.existsSync(buildFile)) {
    throw new Error(`Built Electron output is missing: ${buildFile}. Run npm run build first.`)
  }
}

fs.mkdirSync(artifactDir, { recursive: true })
fs.mkdirSync(profilePath, { recursive: true })

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1

    const send = (method, params = {}) => new Promise((resolveSend, rejectSend) => {
      const id = nextId++
      pending.set(id, { resolve: resolveSend, reject: rejectSend })
      socket.send(JSON.stringify({ id, method, params }))
    })

    socket.addEventListener('open', () => resolve({ send, socket }))
    socket.addEventListener('error', reject)
    socket.addEventListener('close', () => {
      for (const { reject: rejectSend } of pending.values()) {
        rejectSend(new Error('DevTools connection closed'))
      }
      pending.clear()
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id || !pending.has(message.id)) return
      const request = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message)
    })
  })
}

async function findRendererTarget() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const target = targets.find((item) => String(item.url).includes('out/renderer'))
      if (target) return target
    } catch {}
    await sleep(250)
  }
  throw new Error('Electron renderer target did not appear')
}

async function evaluate(send, expression, awaitPromise = false) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  })
  if (response.result.exceptionDetails) {
    throw new Error(
      response.result.exceptionDetails.exception?.description
        || response.result.exceptionDetails.text,
    )
  }
  return response.result.result.value
}

async function waitFor(send, expression, timeout = 20_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      if (await evaluate(send, expression)) return
    } catch {}
    await sleep(200)
  }
  throw new Error(`Timed out waiting for: ${expression}`)
}

function check(name, condition, detail = '') {
  const marker = condition ? 'PASS' : 'FAIL'
  console.log(`[${marker}] ${name}${detail ? `: ${detail}` : ''}`)
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
}

async function forceShortViewport(send) {
  try {
    const response = await send('Browser.getWindowForTarget')
    await send('Browser.setWindowBounds', {
      windowId: response.result.windowId,
      bounds: { width: 1100, height: 600 },
    })
    await sleep(350)
  } catch (error) {
    console.warn(`[WARN] Could not resize Electron window: ${error.message}`)
  }
  const innerHeight = await evaluate(send, 'innerHeight')
  if (innerHeight > 640) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1100,
      height: 600,
      deviceScaleFactor: 0,
      mobile: false,
    })
    await sleep(350)
  }
  return evaluate(send, 'innerHeight')
}

let child
let socket
try {
  child = spawn(
    electronPath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profilePath}`,
      root,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        WPS_BRIDGE_PORT: process.env.WPS_BRIDGE_PORT || String(port + 4000),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  child.stdout.on('data', (buffer) => process.stdout.write(buffer))
  child.stderr.on('data', (buffer) => process.stdout.write(buffer))

  const target = await findRendererTarget()
  let send
  ;({ send, socket } = await connect(target.webSocketDebuggerUrl))
  await send('Runtime.enable')
  await send('Page.enable')

  const innerHeight = await forceShortViewport(send)
  check('viewport is short enough to force overflow', innerHeight <= 640, `${innerHeight}px`)

  await waitFor(
    send,
    `Boolean([...document.querySelectorAll('aside button')]
      .find((button) => button.querySelector('svg.lucide-plus')))`,
  )

  const plusClicked = await evaluate(send, `(() => {
    const plus = [...document.querySelectorAll('aside button')]
      .find((button) => button.querySelector('svg.lucide-plus'))
    plus?.click()
    return Boolean(plus)
  })()`)
  check('assistant panel plus button clicked', plusClicked)

  await waitFor(
    send,
    `Boolean(document.querySelector(
      'div[role="dialog"][aria-modal="true"] [data-testid="agent-config-dialog-body"]',
    ))`,
  )

  const layout = await evaluate(send, `(() => {
    const dialog = document.querySelector('div[role="dialog"][aria-modal="true"]')
    const viewport = dialog.querySelector('[data-testid="agent-config-dialog-body"]')
    const buttons = [...dialog.querySelectorAll('button')]
    const footerButton = buttons[buttons.length - 1]
    const dialogRect = dialog.getBoundingClientRect()
    const footerRect = footerButton.getBoundingClientRect()
    return {
      dialogHeight: dialogRect.height,
      dialogBottom: dialogRect.bottom,
      maxAllowed: innerHeight * 0.9,
      viewportClientHeight: viewport.clientHeight,
      viewportScrollHeight: viewport.scrollHeight,
      footerBottom: footerRect.bottom,
      footerVisible: footerRect.bottom <= innerHeight && footerRect.top >= 0,
      innerHeight,
    }
  })()`)
  check(
    'dialog stays within its 90vh cap',
    layout.dialogHeight <= layout.maxAllowed + 1,
    JSON.stringify(layout),
  )
  check(
    'footer buttons remain on screen',
    layout.footerVisible,
    JSON.stringify(layout),
  )
  check(
    'form content overflows the scroll viewport (scrolling is possible)',
    layout.viewportScrollHeight > layout.viewportClientHeight + 1,
    JSON.stringify(layout),
  )

  const wheelPoint = await evaluate(send, `(() => {
    const viewport = document.querySelector(
      'div[role="dialog"][aria-modal="true"] [data-testid="agent-config-dialog-body"]',
    )
    const rect = viewport.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: wheelPoint.x,
    y: wheelPoint.y,
    deltaX: 0,
    deltaY: 240,
  })
  await sleep(400)

  const afterWheel = await evaluate(send, `document.querySelector(
    'div[role="dialog"][aria-modal="true"] [data-testid="agent-config-dialog-body"]',
  ).scrollTop`)
  check('real mouse wheel scrolls the dialog form', afterWheel > 0, `scrollTop=${afterWheel}`)

  const afterProgrammatic = await evaluate(send, `(() => {
    const viewport = document.querySelector(
      'div[role="dialog"][aria-modal="true"] [data-testid="agent-config-dialog-body"]',
    )
    viewport.scrollTop = viewport.scrollHeight
    return {
      scrollTop: viewport.scrollTop,
      reachedBottom:
        viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1,
    }
  })()`)
  check(
    'dialog form scrolls to the bottom',
    afterProgrammatic.reachedBottom && afterProgrammatic.scrollTop > 0,
    JSON.stringify(afterProgrammatic),
  )

  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  })
  const buffer = Buffer.from(screenshot.result.data, 'base64')
  fs.writeFileSync(screenshotPath, buffer)
  check('visual-check PNG is nonempty', buffer.length > 10_000, `${buffer.length} bytes`)
  console.log(`[PASS] screenshot saved: ${screenshotPath}`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  socket?.close()
  child?.kill()
  await sleep(500)
  try { fs.rmSync(profilePath, { recursive: true, force: true }) } catch {}
}
