/**
 * Behavioral: with the Agent sidebar dragged to its maximum (center column at
 * MIN_CENTER_WIDTH = 360), the notepad's File/Edit/View menubar must stay
 * fully visible and clickable — the centered formatting toolbar must not cover
 * the View menu — and the settings button must stay reachable.
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
const screenshotPath = path.join(artifactDir, 'electron-verify-notepad-menubar-narrow.png')
const profilePath = path.join(os.tmpdir(), `wps-menubar-narrow-profile-${process.pid}`)
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-menubar-narrow-'))
const fixturePath = path.join(fixtureDir, 'menubar-narrow.txt')
const port = Number(process.env.WPS_MENUBAR_VERIFY_PORT || 9371)
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
fs.writeFileSync(fixturePath, 'menubar narrow check\nsecond line\n')

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

  // Simulate "Agent sidebar dragged to max": the drag clamp allows
  // right = width - left(256) - MIN_CENTER(360) - handles(12), which bottoms
  // the center column out at exactly MIN_CENTER_WIDTH.
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
  check('fixture opened through the production FileManager path', opened?.opened, JSON.stringify(opened))

  await waitFor(send, `Boolean(document.querySelector('[data-testid="notepad-commandbar"]'))`)
  await sleep(400)

  const layout = await evaluate(send, `(() => {
    const bar = document.querySelector('[data-testid="notepad-commandbar"]')
    const barRect = bar.getBoundingClientRect()
    const measure = (testId) => {
      const el = document.querySelector('[data-testid="' + testId + '"]')
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      )
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        insideBar: rect.left >= barRect.left - 0.5 && rect.right <= barRect.right + 0.5,
        hittable: Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el))),
      }
    }
    const toolbar = bar.querySelector('[role="toolbar"]')
    return {
      barWidth: barRect.width,
      tier: bar.getAttribute('data-formatting-tier'),
      file: measure('notepad-menu-file'),
      edit: measure('notepad-menu-edit'),
      view: measure('notepad-menu-view'),
      overflow: measure('notepad-format-overflow'),
      settings: measure('notepad-settings-button'),
      toolbarLeft: toolbar ? toolbar.getBoundingClientRect().left : null,
    }
  })()`)

  check('command bar is in the narrow regime (Agent panel at max)', layout.barWidth <= 420, `width=${layout.barWidth}`)
  check('narrowest bar collapses formatting to tier 0', layout.tier === '0', `tier=${layout.tier}`)
  for (const name of ['file', 'edit', 'view']) {
    const m = layout[name]
    check(`${name} menu is fully visible inside the bar`, Boolean(m) && m.insideBar, JSON.stringify(m))
    check(`${name} menu receives pointer events (not covered)`, Boolean(m) && m.hittable, JSON.stringify(m))
  }
  check(
    'view menu does not collide with the formatting toolbar',
    layout.toolbarLeft === null || layout.view.right <= layout.toolbarLeft + 0.5,
    JSON.stringify({ viewRight: layout.view.right, toolbarLeft: layout.toolbarLeft }),
  )
  check('settings button stays visible', Boolean(layout.settings) && layout.settings.insideBar, JSON.stringify(layout.settings))
  check('settings button stays clickable', layout.settings.hittable, JSON.stringify(layout.settings))

  const viewOpens = await evaluate(send, `(() => {
    const view = document.querySelector('[data-testid="notepad-menu-view"]')
    view?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 }))
    view?.click()
    return Boolean(view)
  })()`)
  check('view menu trigger clicked', viewOpens)
  await waitFor(send, `Boolean(document.querySelector('.notepad-menubar-content'))`, 5_000)
  check('view menu opens its dropdown', true)

  const menuCenters = await evaluate(send, `(() => {
    const center = (testId) => {
      const rect = document.querySelector('[data-testid="' + testId + '"]').getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }
    return {
      file: center('notepad-menu-file'),
      edit: center('notepad-menu-edit'),
      view: center('notepad-menu-view'),
    }
  })()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...menuCenters.view })
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...menuCenters.edit })
  const editSwitch = await evaluate(send, `(() => {
    const trigger = document.querySelector('[data-testid="notepad-menu-edit"]')
    const content = document.querySelector('[data-testid="notepad-menu-content-edit"]')
    const style = content ? getComputedStyle(content) : null
    return {
      open: trigger?.getAttribute('data-state') === 'open' && Boolean(content),
      animationName: style?.animationName || '',
      animationDuration: style?.animationDuration || '',
    }
  })()`)
  check('hovering Edit immediately switches the open dropdown', editSwitch.open, JSON.stringify(editSwitch))
  check(
    'Edit dropdown has no opening animation',
    editSwitch.animationName === 'none' && editSwitch.animationDuration === '0s',
    JSON.stringify(editSwitch),
  )

  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...menuCenters.file })
  const fileSwitch = await evaluate(send, `(() => ({
    open: document.querySelector('[data-testid="notepad-menu-file"]')?.getAttribute('data-state') === 'open'
      && Boolean(document.querySelector('[data-testid="notepad-menu-content-file"]')),
    editClosed: document.querySelector('[data-testid="notepad-menu-edit"]')?.getAttribute('data-state') !== 'open',
  }))()`)
  check('hovering File immediately switches the open dropdown', fileSwitch.open && fileSwitch.editClosed, JSON.stringify(fileSwitch))

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
