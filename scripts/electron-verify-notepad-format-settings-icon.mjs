/**
 * Behavioral verification: when notepad preview window is at minimum width (tier 0),
 * the format button displays the Windows Notepad format icon (A + paintbrush)
 * and hovering over it shows the tooltip "格式设置".
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
const screenshotPath = path.join(artifactDir, 'electron-verify-notepad-format-settings.png')
const profilePath = path.join(os.tmpdir(), `wps-format-icon-profile-${process.pid}`)
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-format-icon-'))
const fixturePath = path.join(fixtureDir, 'format-icon-test.txt')
const port = Number(process.env.WPS_FORMAT_VERIFY_PORT || 9375)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

fs.mkdirSync(artifactDir, { recursive: true })
fs.mkdirSync(profilePath, { recursive: true })
fs.writeFileSync(fixturePath, 'format icon verification content\n')

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

  // Simulate narrow center column (tier 0)
  await evaluate(send, `(() => {
    const right = Math.max(240, window.innerWidth - 256 - 360 - 12)
    localStorage.setItem('wps-panel-sizes', JSON.stringify({ left: 256, right }))
    localStorage.removeItem('wps-panel-collapsed')
    location.reload()
    return true
  })()`)
  await waitFor(send, `document.getElementById('root')?.childElementCount > 0`)
  await sleep(600)

  const opened = await evaluate(send, `(async () => {
    const filePath = ${JSON.stringify(fixturePath)}
    await window.api.file.open(filePath)
    const rootEl = document.getElementById('root')
    const key = Object.keys(rootEl || {}).find(
      (name) => name.startsWith('__reactContainer') || name.startsWith('__reactFiber'),
    )
    const container = key ? rootEl[key] : null
    const queue = container ? [
      container.current,
      container.stateNode?.current,
      container._internalRoot?.current,
      container,
    ].filter(Boolean) : []
    const seen = new Set()
    while (queue.length) {
      const fiber = queue.shift()
      if (!fiber || seen.has(fiber)) continue
      seen.add(fiber)
      const props = fiber.memoizedProps
      if (props && typeof props.onOpenFile === 'function') {
        await props.onOpenFile(filePath)
        return { opened: true }
      }
      if (fiber.child) queue.push(fiber.child)
      if (fiber.sibling) queue.push(fiber.sibling)
    }
    return { opened: false }
  })()`, true)
  check('fixture opened', opened?.opened, JSON.stringify(opened))

  await waitFor(send, `Boolean(document.querySelector('[data-testid="notepad-commandbar"]'))`)
  await sleep(400)

  const buttonInfo = await evaluate(send, `(() => {
    const bar = document.querySelector('[data-testid="notepad-commandbar"]')
    const tier = bar?.getAttribute('data-formatting-tier')
    const button = document.querySelector('[data-testid="notepad-format-brush-button"]')
    const svg = button?.querySelector('svg')
    const ariaLabel = button?.getAttribute('aria-label')
    const r = button?.getBoundingClientRect()
    return {
      tier,
      hasButton: Boolean(button),
      hasSvg: Boolean(svg),
      viewBox: svg?.getAttribute('viewBox'),
      ariaLabel,
      rect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null,
    }
  })()`)

  check('tier is 0 (minimum size)', buttonInfo.tier === '0', JSON.stringify(buttonInfo))
  check('format button exists', buttonInfo.hasButton, JSON.stringify(buttonInfo))
  check('format button aria-label is 格式设置', buttonInfo.ariaLabel === '格式设置', buttonInfo.ariaLabel)
  check('format button has SVG with viewBox 0 0 16 16', buttonInfo.viewBox === '0 0 16 16', buttonInfo.viewBox)

  // Hover over the button to trigger tooltip
  if (buttonInfo.rect) {
    const x = buttonInfo.rect.left + buttonInfo.rect.width / 2
    const y = buttonInfo.rect.top + buttonInfo.rect.height / 2
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await sleep(500)
  }

  const tooltipInfo = await evaluate(send, `(() => {
    const tooltips = Array.from(document.querySelectorAll('[role="tooltip"]'))
    return {
      count: tooltips.length,
      texts: tooltips.map((t) => t.textContent?.trim()),
    }
  })()`)

  console.log('Tooltip info:', JSON.stringify(tooltipInfo))
  check('tooltip appears and contains 格式设置', tooltipInfo.texts.some((t) => t?.includes('格式设置')), JSON.stringify(tooltipInfo))

  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
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
  try { fs.rmSync(fixtureDir, { recursive: true, force: true }) } catch {}
}
