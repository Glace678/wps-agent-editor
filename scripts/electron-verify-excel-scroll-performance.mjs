import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const ExcelJS = require('exceljs')
const electronPath = require('electron')
const root = process.cwd()
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-excel-scroll-profile-'))
const samplePath = path.join(os.tmpdir(), `wps-excel-scroll-${process.pid}.xlsx`)
const screenshotPath = path.join(root, '.cache', 'electron-verify-excel-scroll-performance.png')
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

function connectCdp(url) {
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
    throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text)
  }
  return response.result.result.value
}

async function waitFor(send, expression, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await evaluate(send, expression)
    if (value) return value
    await sleep(80)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function mouse(send, type, x, y, dragging = false) {
  const startedAt = performance.now()
  await send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'left',
    buttons: type === 'mousePressed' || dragging ? 1 : 0,
    clickCount: type === 'mousePressed' || type === 'mouseReleased' ? 1 : 0,
  })
  return performance.now() - startedAt
}

function check(name, condition, detail = '') {
  console.log(`[${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? `: ${detail}` : ''}`)
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
}

const workbook = new ExcelJS.Workbook()
const worksheet = workbook.addWorksheet('scroll performance')
for (let row = 1; row <= 2500; row += 1) {
  const values = []
  for (let column = 1; column <= 24; column += 1) {
    values[column] = `R${row}C${column}`
  }
  worksheet.addRow(values)
}
await workbook.xlsx.writeFile(samplePath)

const canvasChecksum = `(() => {
  const canvas = document.querySelector('.fortune-sheet-canvas');
  const context = canvas?.getContext('2d');
  if (!canvas || !context || canvas.width === 0 || canvas.height === 0) return null;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 2166136261;
  for (let index = 0; index < pixels.length; index += 97) {
    hash = Math.imul(hash ^ pixels[index], 16777619);
  }
  return hash >>> 0;
})()`

let child
let cdp
try {
  const port = await getFreePort()
  child = spawn(electronPath, [
    root,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profilePath}`,
  ], {
    cwd: root,
    env: {
      ...process.env,
      WPS_ALLOW_MULTI_INSTANCE: '1',
      WPS_BRIDGE_PORT: String(port + 4000),
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    stdio: 'ignore',
    windowsHide: true,
  })

  const page = await waitForPage(port)
  cdp = await connectCdp(page.webSocketDebuggerUrl)
  const { send } = cdp
  await send('Runtime.enable')
  await send('Page.enable')
  await evaluate(send, `(() => {
    localStorage.setItem('wps-agent-language', 'zh-CN');
    localStorage.setItem('notepad-last-file', ${JSON.stringify(samplePath)});
    localStorage.removeItem('notepad-startup-behavior');
    localStorage.removeItem('wps-smooth-excel-scroll-disabled');
    location.reload();
    return true;
  })()`)
  await waitFor(send, `Boolean(
    document.querySelector('[data-testid="excel-editor-shell"] .luckysheet-scrollbar-x')
    && document.querySelector('.fortune-sheet-canvas')?.width > 0
  )`, 'large Excel workbook')
  await sleep(1500)

  const beforeChecksum = await evaluate(send, canvasChecksum)
  const burst = await evaluate(send, `(() => {
    document.querySelector('[data-testid="excel-editor-shell"]').dataset.excelScrollDiagnostics = 'true';
    const bar = document.querySelector('.luckysheet-scrollbar-x');
    const maximum = bar.scrollWidth - bar.clientWidth;
    const target = Math.min(maximum, 2200);
    for (let step = 1; step <= 180; step += 1) {
      bar.scrollLeft = target * step / 180;
      bar.dispatchEvent(new Event('scroll'));
    }
    return { maximum, target, barLeft: bar.scrollLeft };
  })()`)
  check('horizontal scrollbar has a real draggable range', burst.maximum > 1000, JSON.stringify(burst))

  const metrics = await waitFor(send, `(() => {
    const shell = document.querySelector('[data-testid="excel-editor-shell"]');
    const bar = document.querySelector('.luckysheet-scrollbar-x');
    const cellArea = document.querySelector('.fortune-cell-area');
    const raw = Number(shell?.dataset.excelScrollRawEvents || 0);
    const frames = Number(shell?.dataset.excelScrollFrames || 0);
    if (raw < 180 || Math.abs(cellArea.scrollLeft - bar.scrollLeft) > 2) return null;
    return { raw, frames, lastMs: Number(shell.dataset.excelScrollLastFrameMs),
      maxMs: Number(shell.dataset.excelScrollMaxFrameMs), barLeft: bar.scrollLeft,
      cellLeft: cellArea.scrollLeft };
  })()`, 'frame-coalesced final scroll position')
  check('event burst is coalesced instead of rendering every update',
    metrics.frames * 5 < metrics.raw, JSON.stringify(metrics))
  check('final worksheet position stays aligned with the scrollbar',
    Math.abs(metrics.cellLeft - metrics.barLeft) <= 2, JSON.stringify(metrics))
  check('scroll frame finishes below the visible 100ms lag threshold',
    metrics.maxMs < 100, JSON.stringify(metrics))

  const afterChecksum = await evaluate(send, canvasChecksum)
  check('worksheet canvas repaints at the new horizontal position',
    beforeChecksum !== afterChecksum, `${beforeChecksum} -> ${afterChecksum}`)

  await evaluate(send, `(() => {
    const bar = document.querySelector('.luckysheet-scrollbar-x');
    bar.scrollLeft = 0;
    bar.dispatchEvent(new Event('scroll'));
    return true;
  })()`)
  await waitFor(send, `document.querySelector('.fortune-cell-area')?.scrollLeft === 0`, 'scroll reset')
  const thumb = await evaluate(send, `(() => {
    const bar = document.querySelector('.luckysheet-scrollbar-x');
    const rect = bar.getBoundingClientRect();
    const width = Math.max(28, rect.width * bar.clientWidth / bar.scrollWidth);
    return { x: rect.left + width / 2, y: rect.bottom - 4, width, trackWidth: rect.width };
  })()`)

  const dispatchDurations = []
  dispatchDurations.push(await mouse(send, 'mousePressed', thumb.x, thumb.y))
  for (let step = 1; step <= 24; step += 1) {
    dispatchDurations.push(await mouse(send, 'mouseMoved', thumb.x + step * 12, thumb.y, true))
    await sleep(4)
  }
  dispatchDurations.push(await mouse(send, 'mouseReleased', thumb.x + 288, thumb.y))
  await sleep(250)

  const dragResult = await evaluate(send, `(() => {
    const shell = document.querySelector('[data-testid="excel-editor-shell"]');
    const bar = document.querySelector('.luckysheet-scrollbar-x');
    const cellArea = document.querySelector('.fortune-cell-area');
    return { barLeft: bar.scrollLeft, cellLeft: cellArea.scrollLeft,
      raw: Number(shell.dataset.excelScrollRawEvents),
      frames: Number(shell.dataset.excelScrollFrames),
      maxFrameMs: Number(shell.dataset.excelScrollMaxFrameMs) };
  })()`)
  const maxDispatchMs = Math.max(...dispatchDurations)
  check('real scrollbar-thumb drag moves the worksheet continuously',
    dragResult.barLeft > 100 && Math.abs(dragResult.cellLeft - dragResult.barLeft) <= 2,
    JSON.stringify({ ...dragResult, maxDispatchMs }))
  check('pointer events remain responsive during the real thumb drag',
    maxDispatchMs < 100, `${maxDispatchMs.toFixed(2)}ms max`)

  await evaluate(send, `(() => {
    const bar = document.querySelector('.luckysheet-scrollbar-x');
    bar.scrollLeft = 0;
    bar.dispatchEvent(new Event('scroll'));
    return true;
  })()`)
  await waitFor(send, `document.querySelector('.fortune-cell-area')?.scrollLeft === 0`, 'column-resize scroll reset')
  const columnEdge = await evaluate(send, `(() => {
    const header = document.querySelector('.fortune-col-header');
    const rect = header.getBoundingClientRect();
    return { x: rect.left + 74, y: rect.top + rect.height / 2,
      beforeWidth: document.querySelector('.luckysheet-scrollbar-x > div').getBoundingClientRect().width };
  })()`)
  await mouse(send, 'mouseMoved', columnEdge.x, columnEdge.y)
  await sleep(100)
  const columnHandle = await evaluate(send, `(() => {
    const handle = document.querySelector('.fortune-cols-change-size');
    if (!handle) return null;
    const rect = handle.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`)
  check('large-sheet column resize handle is available', Boolean(columnHandle), JSON.stringify(columnHandle))
  const resizeDurations = []
  resizeDurations.push(await mouse(send, 'mousePressed', columnHandle.x, columnHandle.y))
  for (let step = 1; step <= 12; step += 1) {
    resizeDurations.push(await mouse(send, 'mouseMoved', columnHandle.x + step * 6, columnHandle.y, true))
    await sleep(5)
  }
  const midResizeWidth = await evaluate(send,
    `document.querySelector('.luckysheet-scrollbar-x > div').getBoundingClientRect().width`)
  resizeDurations.push(await mouse(send, 'mouseReleased', columnHandle.x + 72, columnHandle.y))
  const maxResizeDispatchMs = Math.max(...resizeDurations)
  check('large-sheet column content reflows while the handle is still moving',
    midResizeWidth > columnEdge.beforeWidth + 50,
    `${columnEdge.beforeWidth} -> ${midResizeWidth}`)
  check('large-sheet column drag remains below the visible 100ms lag threshold',
    maxResizeDispatchMs < 100, `${maxResizeDispatchMs.toFixed(2)}ms max`)
  await sleep(250)

  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  fs.writeFileSync(screenshotPath, screenshot.result.data, 'base64')
  check('performance verification screenshot captured', fs.statSync(screenshotPath).size > 10_000, screenshotPath)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  cdp?.close()
  child?.kill()
  await sleep(400)
  fs.rmSync(samplePath, { force: true })
  fs.rmSync(profilePath, { recursive: true, force: true })
}
