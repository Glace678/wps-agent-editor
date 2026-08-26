// Reproduce / verify the Excel border dropdown submenu behaviors:
//   1. Border color palette must open on CLICK only (not hover) and expand LEFT of the dropdown.
//   2. Border style (表格样式/边框样式) flyout must expand LEFT of the dropdown and stay clickable.
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
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-border-menu-profile-'))
const samplePath = path.join(os.tmpdir(), `wps-border-menu-${process.pid}.xlsx`)
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
      if (message.error) call.reject(new Error(message.error.message))
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
    throw new Error(response.result.exceptionDetails.exception?.description
      ?? response.result.exceptionDetails.text)
  }
  return response.result.result.value
}

async function waitFor(send, expression, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await evaluate(send, expression)
    if (value) return value
    await sleep(120)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function mouse(send, type, x, y, button = 'none', opts = {}) {
  await send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: opts.clickCount ?? 0, ...opts })
}

async function hover(send, x, y) {
  await mouse(send, 'mouseMoved', x, y)
  await sleep(260)
}

async function click(send, x, y) {
  await mouse(send, 'mouseMoved', x, y)
  await mouse(send, 'mousePressed', x, y, 'left', { clickCount: 1 })
  await mouse(send, 'mouseReleased', x, y, 'left', { clickCount: 1 })
  await sleep(300)
}

async function screenshot(send, name) {
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  fs.mkdirSync(path.join(root, '.cache'), { recursive: true })
  fs.writeFileSync(path.join(root, '.cache', name), Buffer.from(shot.result.data, 'base64'))
}

const rectOf = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)})
  if (!el) return null
  const style = getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden' || !el.getClientRects().length) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
})()`

async function measureSubmenus(send) {
  return evaluate(send, `(() => {
    const out = { popup: null, color: null, style: null }
    const popup = [...document.querySelectorAll('.fortune-toolbar-combo-popup')]
      .find((p) => p.querySelector('.fortune-border-select-option'))
    if (popup) {
      const r = popup.getBoundingClientRect()
      const s = getComputedStyle(popup)
      out.popup = s.display === 'none' ? null : { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }
    for (const menu of document.querySelectorAll('.fortune-border-select-menu')) {
      const s = getComputedStyle(menu)
      const visible = s.display !== 'none' && s.visibility !== 'hidden' && menu.getClientRects().length > 0
      const r = menu.getBoundingClientRect()
      const option = menu.closest('.fortune-border-select-option')
      const isColor = !!(option?.querySelector('.fortune-border-color-preview'))
      out[isColor ? 'color' : 'style'] = visible
        ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
            active: menu.dataset.excelBorderSubmenuActive ?? null }
        : { visible: false, active: menu.dataset.excelBorderSubmenuActive ?? null }
    }
    return out
  })()`)
}

const overlaps = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1

let child
let cdp
const results = []
const check = (label, pass, detail) => {
  results.push({ label, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + JSON.stringify(detail) : ''}`)
}

try {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Sheet1')
  sheet.getCell('B2').value = 'border test'
  sheet.getCell('B2').border = { top: { style: 'thin', color: { argb: 'FF000000' } } }
  await workbook.xlsx.writeFile(samplePath)

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
    localStorage.setItem('wps-agent-language', 'zh-CN')
    localStorage.setItem('notepad-last-file', ${JSON.stringify(samplePath)})
    localStorage.removeItem('notepad-startup-behavior')
    location.reload()
    return true
  })()`)
  await waitFor(send, `Boolean(document.querySelector('[data-testid="excel-editor-shell"] .fortune-sheet-canvas'))`, 'Excel editor shell')

  // Select a cell so border commands have a target range.
  await evaluate(send, `(() => {
    const el = document.querySelector('.fortune-cell-input') || document.querySelector('[data-testid="excel-editor-shell"]')
    if (el) { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })) }
    return true
  })()`)

  // Open the border dropdown (the combo whose popup contains border options).
  // The main button applies "all borders" directly; the arrow opens the dropdown.
  const containers = await evaluate(send, `(() => {
    const containers = [...document.querySelectorAll('.fortune-toolbar .fortune-toobar-combo-container')]
    return containers.map((container) => {
      const arrow = container.querySelector('.fortune-toolbar-combo-arrow')
      if (!arrow) return null
      const r = arrow.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }).filter(Boolean)
  })()`)
  let opened = null
  for (const point of containers) {
    await click(send, point.x, point.y)
    const state = await measureSubmenus(send)
    if (state.popup) {
      opened = point
      break
    }
    await click(send, point.x, point.y) // toggle closed, try next
  }
  check('border dropdown opened', !!opened, opened)
  await sleep(400)

  // The popup list scrolls; scroll it to the bottom so the color/style rows are visible.
  await evaluate(send, `(() => {
    const popup = [...document.querySelectorAll('.fortune-toolbar-combo-popup')]
      .find((p) => p.querySelector('.fortune-border-select-option'))
    if (!popup) return false
    const scrollers = [popup, ...popup.querySelectorAll('*')].filter((el) => {
      const s = getComputedStyle(el)
      return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight
    })
    for (const el of scrollers) el.scrollTop = el.scrollHeight
    return scrollers.length
  })()`)
  await sleep(200)

  const anchors = await evaluate(send, `(() => {
    const rows = [...document.querySelectorAll('.fortune-toolbar-combo-popup .fortune-border-select-option')]
    const colorRow = rows.find((row) => row.querySelector('.fortune-border-color-preview'))
    const styleRow = rows.find((row) => row.querySelector('.fortune-border-style-preview'))
    const point = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
    return { color: colorRow ? point(colorRow) : null, style: styleRow ? point(styleRow) : null }
  })()`)
  check('found color & style rows', !!anchors.color && !!anchors.style, anchors)

  // ---- Test 1: hovering 边框颜色 must NOT open the palette ----
  await hover(send, anchors.color.x, anchors.color.y)
  let m = await measureSubmenus(send)
  check('hover on 边框颜色 keeps palette closed', !m.color || m.color.visible === false, m.color)
  await screenshot(send, 'verify-border-1-hover-color.png')

  // ---- Test 2: hovering 边框样式 opens the style flyout to the LEFT ----
  await hover(send, anchors.style.x, anchors.style.y)
  m = await measureSubmenus(send)
  check('hover on 边框样式 opens style flyout', !!m.style && m.style.visible !== false, m.style)
  check('style flyout sits LEFT of dropdown without covering it',
    !!m.style && m.style.visible !== false && !overlaps(m.style, m.popup), { style: m.style, popup: m.popup })
  await screenshot(send, 'verify-border-2-hover-style.png')

  // ---- Test 3: clicking 边框样式 entry applies a line style ----
  if (m.style && m.style.visible !== false) {
    const before = await evaluate(send, `(() => {
      const g = document.querySelector('.fortune-border-style-preview svg g')
      return g ? g.getAttribute('stroke-width') : null
    })()`)
    const entry = await evaluate(send, `(() => {
      const entries = [...document.querySelectorAll('.fortune-border-select-menu .fortune-border-style-picker-menu')]
        .filter((el) => el.getClientRects().length > 0)
      const target = entries[entries.length - 1]
      if (!target) return null
      const r = target.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    if (entry) {
      await click(send, entry.x, entry.y)
      const after = await evaluate(send, `(() => {
        const g = document.querySelector('.fortune-border-style-preview svg g')
        return g ? g.getAttribute('stroke-width') : null
      })()`)
      check('clicking a line style entry applies it', before !== after, { before, after })
    } else {
      check('clicking a line style entry applies it', false, { reason: 'no visible entries found' })
    }
    await screenshot(send, 'verify-border-3-style-clicked.png')
  }

  // ---- Test 4: clicking 边框颜色 opens the palette on the LEFT ----
  await click(send, anchors.color.x, anchors.color.y)
  m = await measureSubmenus(send)
  check('click on 边框颜色 opens palette', !!m.color && m.color.visible !== false, m.color)
  check('palette sits LEFT of dropdown without covering it',
    !!m.color && m.color.visible !== false && !overlaps(m.color, m.popup), { color: m.color, popup: m.popup })
  await screenshot(send, 'verify-border-4-click-color.png')

  // ---- Test 5: moving from 边框颜色 row onto a regular option closes the palette ----
  const regular = await evaluate(send, `(() => {
    const popup = [...document.querySelectorAll('.fortune-toolbar-combo-popup')]
      .find((p) => p.querySelector('.fortune-border-select-option'))
    if (!popup) return null
    const rows = [...popup.querySelectorAll('.fortune-toolbar-select-option')]
      .filter((row) => !row.closest('.fortune-border-select-option'))
      .filter((row) => {
        const r = row.getBoundingClientRect()
        if (r.height <= 0) return false
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return !!hit && hit.closest('.fortune-toolbar-select-option') === row
      })
    const row = rows[0]
    if (!row) return null
    const r = row.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (regular) {
    await hover(send, regular.x, regular.y)
    m = await measureSubmenus(send)
    check('hovering a regular border option closes the palette', !m.color || m.color.visible === false, m.color)
  }

  const failed = results.filter((r) => !r.pass)
  console.log(failed.length ? `\n${failed.length} check(s) FAILED` : '\nAll checks passed')
} finally {
  try { cdp?.close() } catch {}
  child?.kill()
}

process.exit(results.some((r) => !r.pass) ? 1 : 0)
