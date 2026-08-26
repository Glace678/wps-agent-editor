/**
 * Behavioral: dragging an Excel column/row resize handle must reflow the sheet
 * content IN REAL TIME (mid-drag), commit exactly the dragged delta on release
 * (no double apply from the preview), and leave a single undo entry.
 *
 * Observable metrics: the scrollbar filler elements mirror ctx.ch_width /
 * ctx.rh_height, which only change when Fortune re-runs track layout.
 */
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const ExcelJS = require('exceljs')
const electronPath = require('electron')
const root = process.cwd()
const artifactDir = path.join(root, '.cache')
const screenshotPath = path.join(artifactDir, 'electron-verify-excel-live-resize.png')
const profilePath = path.join(os.tmpdir(), `wps-live-resize-profile-${process.pid}`)
const samplePath = path.join(os.tmpdir(), `wps-live-resize-${process.pid}.xlsx`)
const port = Number(process.env.WPS_LIVE_RESIZE_VERIFY_PORT || 9377)
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
const workbook = new ExcelJS.Workbook()
const sheet = workbook.addWorksheet('live resize')
sheet.getCell('A1').value = 'The quick brown fox jumps over the lazy dog'
sheet.getCell('B1').value = 'second column content'
sheet.getCell('A2').value = 'wrap me around while resizing'
await workbook.xlsx.writeFile(samplePath)

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

async function waitFor(send, expression, timeout = 25_000) {
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

async function mouse(send, type, x, y, extra = {}) {
  await send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'left',
    clickCount: type === 'mousePressed' || type === 'mouseReleased' ? 1 : 0,
    buttons: type === 'mouseMoved' && extra.dragging ? 1 : (type === 'mousePressed' ? 1 : 0),
    ...extra.params,
  })
}

const readMetrics = `(() => {
  const x = document.querySelector('.luckysheet-scrollbar-x > div')
  const y = document.querySelector('.luckysheet-scrollbar-y > div')
  const shell = document.querySelector('[data-testid="excel-editor-shell"]')
  return {
    chWidth: x ? x.getBoundingClientRect().width : null,
    rhHeight: y ? y.getBoundingClientRect().height : null,
    liveState: shell?.dataset.excelLiveResize ?? null,
    liveLen: shell?.dataset.excelLiveResizeLen ?? null,
  }
})()`

async function dragHandle(send, axis, startX, startY, delta) {
  await mouse(send, 'mousePressed', startX, startY)
  await sleep(120)
  const steps = 5
  for (let i = 1; i <= steps; i += 1) {
    const x = axis === 'col' ? startX + (delta * i) / steps : startX
    const y = axis === 'row' ? startY + (delta * i) / steps : startY
    await mouse(send, 'mouseMoved', x, y, { dragging: true })
    await sleep(60)
  }
  await sleep(250)
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

  await evaluate(send, `(() => {
    localStorage.setItem('wps-agent-language', 'zh-CN')
    localStorage.setItem('notepad-last-file', ${JSON.stringify(samplePath)})
    localStorage.removeItem('notepad-startup-behavior')
    location.reload()
    return true
  })()`)
  await waitFor(send, `Boolean(
    document.querySelector('[data-testid="excel-editor-shell"] .fortune-col-header')
    && document.querySelector('.luckysheet-scrollbar-x > div')
  )`)
  await sleep(1200)

  // ---------- Baseline: drain any load-time undo entries ----------
  // Fortune's mount-time normalization can already leave history entries;
  // start the exactly-one-entry experiment from a provably empty stack.
  const drainProbe = `(() => {
    const iconName = (button) => {
      const use = button.querySelector('use')
      return use?.getAttribute('href')
        || use?.getAttribute('xlink:href')
        || use?.href?.baseVal
        || ''
    }
    const button = [...document.querySelectorAll('.fortune-toolbar .fortune-toolbar-button')]
      .find((candidate) => iconName(candidate).endsWith('#undo'))
    if (!button) return null
    const svg = button.querySelector('svg')
    const empty = svg ? getComputedStyle(svg).opacity === '0.3' : null
    if (!empty) button.click()
    return { empty }
  })()`
  let drained = false
  for (let i = 0; i < 10 && !drained; i += 1) {
    const state = await evaluate(send, drainProbe)
    drained = state?.empty === true
    if (!drained) await sleep(300)
  }
  check('undo stack drained to empty before the drag', drained)

  // ---------- Column drag ----------
  const colStart = await evaluate(send, `(() => {
    const header = document.querySelector('.fortune-col-header')
    const rect = header.getBoundingClientRect()
    return { x: rect.left + 74 - header.scrollLeft, y: rect.top + rect.height / 2 }
  })()`)
  await mouse(send, 'mouseMoved', colStart.x, colStart.y)
  await sleep(200)
  const handleReady = await evaluate(send, `(() => {
    const handle = document.querySelector('.fortune-cols-change-size')
    if (!handle) return null
    const rect = handle.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width }
  })()`)
  check('column resize handle appears on hover', Boolean(handleReady), JSON.stringify(handleReady))

  const before = await evaluate(send, readMetrics)
  check('sheet width metric readable', Number.isFinite(before.chWidth), JSON.stringify(before))

  const DELTA = 80
  await dragHandle(send, 'col', handleReady.x, colStart.y, DELTA)

  const mid = await evaluate(send, readMetrics)
  check(
    'MID-DRAG: content reflows in real time (sheet width already grew)',
    mid.chWidth >= before.chWidth + DELTA - 20,
    `before=${before.chWidth} mid=${JSON.stringify(mid)}`,
  )
  const guide = await evaluate(send, `(() => {
    const line = document.querySelector('.fortune-change-size-line')
    return line ? { left: line.style.left, height: line.style.height } : null
  })()`)
  check('native guide line still tracks the drag', Boolean(guide && guide.left), JSON.stringify(guide))
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, 'base64'))
  console.log(`[PASS] mid-drag screenshot saved: ${screenshotPath}`)

  await mouse(send, 'mouseReleased', handleReady.x + DELTA, colStart.y)
  await sleep(500)

  const after = await evaluate(send, readMetrics)
  check(
    'release commits exactly the dragged delta (no preview double-apply)',
    Math.abs(after.chWidth - (before.chWidth + DELTA)) <= 15,
    `before=${before.chWidth} after=${after.chWidth} expected≈${before.chWidth + DELTA}`,
  )

  // ---------- Single undo entry ----------
  // Fortune renders the undo toolbar button "disabled" purely as svg opacity
  // 0.3 when the undo stack is empty. The resize must leave EXACTLY ONE entry:
  // available after the drag, and empty again after a single undo click. If
  // the live preview leaked per-frame entries, one click could not drain it.
  // (Note: fortune-sheet's undo of a resize updates the sheet file config but
  // not the rendered ctx.config mirror — an upstream visual quirk that exists
  // with or without the live preview, so pixel revert is not asserted here.)
  const undoProbe = `(() => {
    const iconName = (button) => {
      const use = button.querySelector('use')
      return use?.getAttribute('href')
        || use?.getAttribute('xlink:href')
        || use?.href?.baseVal
        || ''
    }
    const button = [...document.querySelectorAll('.fortune-toolbar .fortune-toolbar-button')]
      .find((candidate) => iconName(candidate).endsWith('#undo'))
    if (!button) return null
    const svg = button.querySelector('svg')
    return {
      empty: svg ? getComputedStyle(svg).opacity === '0.3' : null,
      click: () => button.click(),
    }
  })()`
  const undoAfterDrag = await evaluate(send, `(() => {
    const probe = ${undoProbe}
    return probe ? { empty: probe.empty } : null
  })()`)
  check(
    'resize recorded an undo entry (undo button enabled)',
    undoAfterDrag && undoAfterDrag.empty === false,
    JSON.stringify(undoAfterDrag),
  )
  const undoDrained = await evaluate(send, `(() => {
    const probe = ${undoProbe}
    if (!probe) return null
    probe.click()
    return true
  })()`)
  check('toolbar undo clicked once', undoDrained === true)
  await sleep(600)
  const undoAfterOneClick = await evaluate(send, `(() => {
    const probe = ${undoProbe}
    return probe ? { empty: probe.empty } : null
  })()`)
  check(
    'a single undo drains the stack (live preview left no extra entries)',
    undoAfterOneClick && undoAfterOneClick.empty === true,
    JSON.stringify(undoAfterOneClick),
  )

  // ---------- Row drag ----------
  const rowStart = await evaluate(send, `(() => {
    const header = document.querySelector('.fortune-row-header')
    const rect = header.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + 20 - header.scrollTop }
  })()`)
  await mouse(send, 'mouseMoved', rowStart.x, rowStart.y)
  await sleep(200)
  const rowHandle = await evaluate(send, `(() => {
    const handle = document.querySelector('.fortune-rows-change-size')
    if (!handle) return null
    const rect = handle.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  check('row resize handle appears on hover', Boolean(rowHandle), JSON.stringify(rowHandle))

  const beforeRow = await evaluate(send, readMetrics)
  const ROW_DELTA = 50
  await dragHandle(send, 'row', rowStart.x, rowHandle.y, ROW_DELTA)
  const midRow = await evaluate(send, readMetrics)
  check(
    'MID-DRAG: row resize also reflows in real time',
    midRow.rhHeight >= beforeRow.rhHeight + ROW_DELTA - 15,
    `before=${beforeRow.rhHeight} mid=${midRow.rhHeight}`,
  )
  await mouse(send, 'mouseReleased', rowStart.x, rowHandle.y + ROW_DELTA)
  await sleep(500)
  const afterRow = await evaluate(send, readMetrics)
  check(
    'row release commits exactly the dragged delta',
    Math.abs(afterRow.rhHeight - (beforeRow.rhHeight + ROW_DELTA)) <= 12,
    `before=${beforeRow.rhHeight} after=${afterRow.rhHeight} expected≈${beforeRow.rhHeight + ROW_DELTA}`,
  )
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  socket?.close()
  child?.kill()
  await sleep(500)
  try { fs.rmSync(samplePath, { force: true }) } catch {}
  try { fs.rmSync(profilePath, { recursive: true, force: true }) } catch {}
}
