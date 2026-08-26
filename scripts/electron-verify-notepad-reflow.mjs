import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const root = process.cwd()
const rendererEntry = path.join(root, 'out', 'renderer', 'index.html')
const artifactDir = path.join(root, '.cache')
const screenshotPath = path.join(artifactDir, 'electron-verify-notepad-reflow.png')
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-notepad-reflow-'))
const fixturePath = path.join(fixtureDir, 'responsive-reflow.txt')
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-notepad-reflow-profile-'))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const largeFixtureSectionCount = 16_000

if (!fs.existsSync(rendererEntry)) {
  throw new Error('Built renderer is missing. Run `npm run build` before this verifier.')
}

fs.writeFileSync(
  fixturePath,
  Array.from(
    { length: largeFixtureSectionCount },
    (_, index) => `section-${index + 1} keeps the text flowing with the available editor width`,
  ).join(' '),
)

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => {
        if (error) reject(error)
        else if (typeof address === 'object' && address?.port) resolve(address.port)
        else reject(new Error('Could not allocate a CDP port'))
      })
    })
  })
}

async function waitForRenderer(port, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = targets.find(
        (target) => target.type === 'page' && String(target.url).includes('out/renderer'),
      )
      if (page?.webSocketDebuggerUrl) return page
    } catch {}
    await sleep(200)
  }
  throw new Error('Electron renderer target did not appear')
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1

    const send = (method, params = {}) => new Promise((resolveSend, rejectSend) => {
      const id = nextId++
      pending.set(id, { resolve: resolveSend, reject: rejectSend })
      socket.send(JSON.stringify({ id, method, params }))
    })

    socket.addEventListener('open', () => resolve({ send, close: () => socket.close() }))
    socket.addEventListener('error', reject)
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

async function evaluate(send, expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (response.result.exceptionDetails) {
    throw new Error(
      response.result.exceptionDetails.exception?.description
      || response.result.exceptionDetails.text,
    )
  }
  return response.result.result?.value
}

async function waitFor(send, expression, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let lastValue
  while (Date.now() < deadline) {
    lastValue = await evaluate(send, expression)
    if (lastValue) return lastValue
    await sleep(120)
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`)
}

const checks = []
function check(name, pass, detail = '') {
  checks.push({ name, pass: Boolean(pass) })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? `: ${detail}` : ''}`)
}

function metricsExpression() {
  return `(() => {
    const editor = document.querySelector('[data-testid="text-editor-input"]')
    const root = document.querySelector('[data-testid="text-editor"]')
    if (!(editor instanceof HTMLTextAreaElement) || !(root instanceof HTMLElement)) return null
    const clone = editor.cloneNode()
    clone.value = editor.value
    Object.assign(clone.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: editor.getBoundingClientRect().width + 'px',
      height: '0px',
      minHeight: '0px',
      flex: 'none',
      visibility: 'hidden',
    })
    document.body.append(clone)
    const style = getComputedStyle(editor)
    const rect = editor.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    const result = {
      editorWidth: rect.width,
      rootWidth: rootRect.width,
      editorLeft: rect.left,
      rootLeft: rootRect.left,
      editorRight: rect.right,
      rootRight: rootRect.right,
      clientWidth: editor.clientWidth,
      scrollWidth: editor.scrollWidth,
      wrappedContentHeight: clone.scrollHeight,
      fontSize: Number.parseFloat(style.fontSize),
      wrap: editor.wrap,
      overflowX: style.overflowX,
      whiteSpace: style.whiteSpace,
      zoom: root.dataset.zoom,
      settledZoom: root.dataset.zoomSettled,
      previewZoom: root.dataset.zoomPreview || null,
      transform: style.transform,
    }
    clone.remove()
    return result
  })()`
}

let child
let cdp
try {
  const port = await getFreePort()
  let bridgePort = await getFreePort()
  while (bridgePort === port) bridgePort = await getFreePort()
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
        WPS_ALLOW_MULTI_INSTANCE: '1',
        WPS_BRIDGE_PORT: String(bridgePort),
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  child.stdout.on('data', (chunk) => process.stdout.write(`[electron] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[electron] ${chunk}`))

  const target = await waitForRenderer(port)
  cdp = await connectCdp(target.webSocketDebuggerUrl)
  const { send } = cdp
  await send('Runtime.enable')
  await send('Page.enable')
  await waitFor(send, `document.getElementById('root')?.childElementCount > 0`, 'React app')

  await evaluate(send, `(() => {
    localStorage.setItem('notepad-word-wrap', 'true')
    localStorage.setItem('notepad-zoom', '100')
    localStorage.setItem('wps-panel-collapsed', JSON.stringify({ left: true, right: true }))
    location.reload()
    return true
  })()`)
  await waitFor(send, `document.getElementById('root')?.childElementCount > 0`, 'reloaded app')

  const opened = await evaluate(send, `(async () => {
    const filePath = ${JSON.stringify(fixturePath)}
    await window.api.file.open(filePath)
    const root = document.getElementById('root')
    const key = Object.keys(root || {}).find(
      (name) => name.startsWith('__reactContainer') || name.startsWith('__reactFiber'),
    )
    const container = key ? root[key] : null
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
        return true
      }
      if (fiber.child) queue.push(fiber.child)
      if (fiber.sibling) queue.push(fiber.sibling)
    }
    return false
  })()`)
  check('fixture opened', opened)
  await waitFor(
    send,
    `document.querySelector('[data-testid="text-editor-input"]')?.value.includes('section-${largeFixtureSectionCount}')`,
    'TXT editor content',
  )
  await sleep(250)

  const baseline = await evaluate(send, metricsExpression())
  const scrollbarWidth = 14
  check('TXT surface and fixed scrollbar fill the available editor width',
    Math.abs((baseline.editorWidth + scrollbarWidth) - baseline.rootWidth) < 2
      && Math.abs(baseline.editorLeft - baseline.rootLeft) < 1
      && Math.abs((baseline.editorRight + scrollbarWidth) - baseline.rootRight) < 2,
    JSON.stringify(baseline))
  check('word-wrapped TXT has no horizontal overflow',
    baseline.wrap === 'soft' && baseline.scrollWidth <= baseline.clientWidth + 1,
    JSON.stringify(baseline))

  const subStepWheel = await evaluate(send, `(async () => {
    const editor = document.querySelector('[data-testid="text-editor-input"]')
    for (let index = 0; index < 9; index += 1) {
      editor.dispatchEvent(new WheelEvent('wheel', {
        ctrlKey: true,
        deltaY: -10,
        bubbles: true,
        cancelable: true,
      }))
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const root = document.querySelector('[data-testid="text-editor"]')
    return { zoom: root?.dataset.zoom, settledZoom: root?.dataset.zoomSettled }
  })()`)
  check('high-resolution wheel deltas wait for one complete zoom step',
    subStepWheel.zoom === '1' && subStepWheel.settledZoom === '1',
    JSON.stringify(subStepWheel))

  await evaluate(send, `(() => {
    document.querySelector('[data-testid="text-editor-input"]')?.dispatchEvent(
      new WheelEvent('wheel', {
        ctrlKey: true,
        deltaY: -10,
        bubbles: true,
        cancelable: true,
      }),
    )
    return true
  })()`)
  await waitFor(
    send,
    `(() => {
      const root = document.querySelector('[data-testid="text-editor"]')
      return root?.dataset.zoom === '1.1'
        && root?.dataset.zoomSettled === '1.1'
    })()`,
    'one accumulated precision-wheel zoom step',
  )
  check('ten small wheel deltas produce exactly one 10% zoom step', true)

  await evaluate(send, `(() => {
    const editor = document.querySelector('[data-testid="text-editor-input"]')
    editor.focus()
    editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: '0',
      code: 'Digit0',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }))
    return true
  })()`)
  await waitFor(
    send,
    `(() => {
      const root = document.querySelector('[data-testid="text-editor"]')
      return root?.dataset.zoom === '1'
        && root?.dataset.zoomSettled === '1'
    })()`,
    'cancelled precision-wheel zoom back to 100%',
  )

  const expiredSubStepWheel = await evaluate(send, `(async () => {
    const editor = document.querySelector('[data-testid="text-editor-input"]')
    for (let index = 0; index < 9; index += 1) {
      editor.dispatchEvent(new WheelEvent('wheel', {
        ctrlKey: true,
        deltaY: -10,
        bubbles: true,
        cancelable: true,
      }))
    }
    await new Promise((resolve) => setTimeout(resolve, 340))
    editor.dispatchEvent(new WheelEvent('wheel', {
      ctrlKey: true,
      deltaY: -10,
      bubbles: true,
      cancelable: true,
    }))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const root = document.querySelector('[data-testid="text-editor"]')
    return { zoom: root?.dataset.zoom, settledZoom: root?.dataset.zoomSettled }
  })()`)
  check('an incomplete precision-wheel step expires between gestures',
    expiredSubStepWheel.zoom === '1' && expiredSubStepWheel.settledZoom === '1',
    JSON.stringify(expiredSubStepWheel))

  await evaluate(send, `(() => {
    const editor = document.querySelector('[data-testid="text-editor-input"]')
    editor.focus()
    for (let index = 0; index < 10; index += 1) {
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: '+',
        code: 'Equal',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }))
    }
    return true
  })()`)
  await waitFor(
    send,
    `(() => {
      const root = document.querySelector('[data-testid="text-editor"]')
      return root?.dataset.zoom === '2'
        && root?.dataset.zoomSettled === '2'
    })()`,
    '200% TXT zoom',
  )
  const zoomed = await evaluate(send, metricsExpression())
  check('rapid zoom keeps wrapped TXT base font size constant without expensive full reflow',
    Math.abs(zoomed.fontSize - baseline.fontSize) < 0.05,
    JSON.stringify(zoomed))
  check('200% zoom keeps the TXT surface and fixed scrollbar full width',
    Math.abs((zoomed.editorWidth + scrollbarWidth) - zoomed.rootWidth) < 2
      && Math.abs((zoomed.editorRight + scrollbarWidth) - zoomed.rootRight) < 2,
    JSON.stringify(zoomed))
  check('200% zoom keeps word-wrap intact with no horizontal overflow',
    zoomed.scrollWidth <= zoomed.clientWidth + 1,
    JSON.stringify(zoomed))

  const beforeResize = zoomed
  await evaluate(send, `(() => {
    window.resizeTo(1050, 700)
    return true
  })()`)
  await sleep(500)
  const narrowed = await evaluate(send, metricsExpression())
  check('resizing the window immediately resizes the TXT surface',
    narrowed.editorWidth < beforeResize.editorWidth - 200
      && Math.abs((narrowed.editorWidth + scrollbarWidth) - narrowed.rootWidth) < 2,
    `${beforeResize.editorWidth} -> ${narrowed.editorWidth}; ${JSON.stringify(narrowed)}`)
  check('narrower screens reflow the zoomed text again',
    narrowed.scrollWidth <= narrowed.clientWidth + 1
      && narrowed.wrappedContentHeight > beforeResize.wrappedContentHeight,
    `${beforeResize.wrappedContentHeight} -> ${narrowed.wrappedContentHeight}`)

  fs.mkdirSync(artifactDir, { recursive: true })
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, 'base64'))
  check('reflow screenshot captured', fs.statSync(screenshotPath).size > 10_000, screenshotPath)
} catch (error) {
  check('verifier completed', false, error instanceof Error ? error.stack : String(error))
} finally {
  cdp?.close()
  child?.kill()
  await sleep(400)
  fs.rmSync(fixtureDir, { recursive: true, force: true })
  fs.rmSync(profilePath, { recursive: true, force: true })
}

const failures = checks.filter((entry) => !entry.pass)
console.log(`\nNotepad reflow verification: ${checks.length - failures.length}/${checks.length} passed`)
if (failures.length) process.exitCode = 1
