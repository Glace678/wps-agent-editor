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
const searchScreenshotPath = path.join(
  artifactDir,
  'electron-verify-excel-search-close.png',
)
const previewScreenshotPath = path.join(
  artifactDir,
  'electron-verify-excel-screenshot-close.png',
)
const samplePath = path.join(
  os.tmpdir(),
  `wps-excel-dialog-close-${process.pid}.xlsx`,
)
const profilePath = path.join(
  os.tmpdir(),
  `wps-excel-dialog-close-profile-${process.pid}`,
)
const port = Number(process.env.WPS_DIALOG_VERIFY_PORT || 9351)
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
const sheet = workbook.addWorksheet('Dialog close check')
sheet.getColumn(1).width = 24
sheet.getColumn(2).width = 22
sheet.getRow(1).height = 26
sheet.getCell('A1').value = 'Screenshot preview'
sheet.getCell('A1').font = { bold: true, color: { argb: 'FFFFFFFF' } }
sheet.getCell('A1').fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1677FF' },
}
sheet.getCell('B1').value = 'Find dialog'
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

async function setVerificationWindowSize(send) {
  try {
    const response = await send('Browser.getWindowForTarget')
    await send('Browser.setWindowBounds', {
      windowId: response.result.windowId,
      bounds: { width: 1120, height: 820 },
    })
    await sleep(350)
  } catch (error) {
    console.warn(`[WARN] Could not resize Electron window: ${error.message}`)
  }
}

async function closeMoreMenu(send) {
  return evaluate(send, `(() => {
    const menu = document.querySelector('.fortune-toolbar-more-container')
    if (!menu) return false
    const iconName = (button) => {
      const use = button.querySelector('use')
      return use?.getAttribute('href')
        || use?.getAttribute('xlink:href')
        || use?.href?.baseVal
        || ''
    }
    const moreButton = [...document.querySelectorAll(
      '.fortune-toolbar > .fortune-toolbar-button',
    )].find((button) => iconName(button).endsWith('#more'))
    moreButton?.click()
    return Boolean(moreButton)
  })()`)
}

async function activateToolbarItem(send, iconId) {
  const direct = await evaluate(send, `(() => {
    const iconName = (button) => {
      const use = button.querySelector('use')
      return use?.getAttribute('href')
        || use?.getAttribute('xlink:href')
        || use?.href?.baseVal
        || ''
    }
    const buttons = [...document.querySelectorAll(
      '.fortune-toolbar > .fortune-toolbar-button',
    )]
    const target = buttons.find((button) => iconName(button).endsWith(
      ${JSON.stringify(`#${iconId}`)},
    ))
    if (target) {
      target.click()
      return { activated: true, location: 'toolbar' }
    }
    const more = buttons.find((button) => iconName(button).endsWith('#more'))
    if (!more) {
      return {
        activated: false,
        location: 'missing',
        icons: buttons.map(iconName),
      }
    }
    more.click()
    return { activated: false, location: 'opening-more' }
  })()`)

  if (direct.activated) return direct
  check(
    `${iconId} can fall back to the More menu`,
    direct.location === 'opening-more',
    JSON.stringify(direct),
  )
  await waitFor(send, `Boolean(document.querySelector('.fortune-toolbar-more-container'))`)

  const fromMore = await evaluate(send, `(() => {
    const iconName = (button) => {
      const use = button.querySelector('use')
      return use?.getAttribute('href')
        || use?.getAttribute('xlink:href')
        || use?.href?.baseVal
        || ''
    }
    const menu = document.querySelector('.fortune-toolbar-more-container')
    const buttons = [...(menu?.querySelectorAll('.fortune-toolbar-button') || [])]
    const target = buttons.find((button) => iconName(button).endsWith(
      ${JSON.stringify(`#${iconId}`)},
    ))
    if (!target) {
      return {
        activated: false,
        location: 'missing',
        icons: buttons.map(iconName),
      }
    }
    target.click()
    return { activated: true, location: 'more' }
  })()`)
  check(
    `${iconId} found and activated in the More menu`,
    fromMore.activated,
    JSON.stringify(fromMore),
  )
  return fromMore
}

async function inspectCloseControl(send, dialogSelector, controlSelector) {
  return evaluate(send, `(() => {
    const dialog = document.querySelector(${JSON.stringify(dialogSelector)})
    const control = dialog?.querySelector(${JSON.stringify(controlSelector)})
    if (!dialog || !control) return null
    const rect = control.getBoundingClientRect()
    const dialogRect = dialog.getBoundingClientRect()
    const style = getComputedStyle(control)
    const iconUse = control.querySelector('use')
    const iconHref = iconUse?.getAttribute('href')
      || iconUse?.getAttribute('xlink:href')
      || iconUse?.href?.baseVal
      || ''
    const sourceSymbol = iconHref.startsWith('#')
      ? document.getElementById(iconHref.slice(1))
      : null
    const iconPart = control.querySelector('path, line, polyline')
      || sourceSymbol?.querySelector('path, line, polyline')
      || iconUse
    const iconStyle = iconPart ? getComputedStyle(iconPart) : null
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    )
    return {
      width: rect.width,
      height: rect.height,
      opacity: Number.parseFloat(style.opacity),
      display: style.display,
      visibility: style.visibility,
      role: control.getAttribute('role'),
      ariaLabel: control.getAttribute('aria-label'),
      title: control.getAttribute('title'),
      stroke: iconStyle?.stroke || null,
      inViewport: rect.left >= 0
        && rect.top >= 0
        && rect.right <= innerWidth
        && rect.bottom <= innerHeight,
      inDialog: rect.left >= dialogRect.left - 1
        && rect.top >= dialogRect.top - 1
        && rect.right <= dialogRect.right + 1
        && rect.bottom <= dialogRect.bottom + 1,
      receivesPointer: Boolean(hit && (hit === control || control.contains(hit))),
    }
  })()`)
}

function checkCloseControl(label, metrics) {
  check(`${label} close control exists`, Boolean(metrics), JSON.stringify(metrics))
  check(
    `${label} close control is at least 36px`,
    metrics.width >= 35.5 && metrics.height >= 35.5,
    JSON.stringify(metrics),
  )
  check(
    `${label} close control is fully visible`,
    metrics.opacity === 1
      && metrics.display !== 'none'
      && metrics.visibility !== 'hidden'
      && metrics.inViewport
      && metrics.inDialog
      && metrics.receivesPointer,
    JSON.stringify(metrics),
  )
  check(
    `${label} close control is accessible`,
    metrics.role === 'button' && Boolean(metrics.ariaLabel),
    JSON.stringify(metrics),
  )
  check(
    `${label} close icon has a visible stroke`,
    Boolean(metrics.stroke)
      && metrics.stroke !== 'none'
      && metrics.stroke !== 'rgba(0, 0, 0, 0)',
    JSON.stringify(metrics),
  )
}

async function captureViewport(send, destination) {
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  })
  const buffer = Buffer.from(screenshot.result.data, 'base64')
  fs.writeFileSync(destination, buffer)
  check('visual-check PNG is nonempty', buffer.length > 10_000, `${buffer.length} bytes`)
  console.log(`[PASS] screenshot saved: ${destination}`)
}

async function dispatchEscape(send, targetSelector) {
  return evaluate(send, `(() => {
    const target = document.querySelector(${JSON.stringify(targetSelector)})
    if (!target) return { dispatched: false }
    target.focus?.({ preventScroll: true })
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    target.dispatchEvent(event)
    return { dispatched: true, defaultPrevented: event.defaultPrevented }
  })()`)
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
  await setVerificationWindowSize(send)

  await evaluate(send, `(() => {
    localStorage.setItem('app-theme', 'dark')
    localStorage.setItem('notepad-last-file', ${JSON.stringify(samplePath)})
    localStorage.removeItem('notepad-startup-behavior')
    location.reload()
    return true
  })()`)

  await waitFor(
    send,
    `Boolean(
      document.documentElement.classList.contains('dark')
      && document.querySelector('[data-testid="excel-editor-shell"] .fortune-container')
      && document.querySelector('.fortune-sheet-overlay')
      && document.querySelector('.fortune-sheet-canvas')
    )`,
  )
  await sleep(1000)

  const editorWidth = await evaluate(
    send,
    `document.querySelector('[data-testid="excel-editor-shell"]').getBoundingClientRect().width`,
  )
  check('Excel editor has a usable narrow viewport', editorWidth >= 600, `${editorWidth}px`)

  const searchActivation = await activateToolbarItem(send, 'search')
  check('Find toolbar action activated', searchActivation.activated, JSON.stringify(searchActivation))
  await waitFor(send, `Boolean(document.querySelector('#fortune-search-replace'))`)
  await waitFor(
    send,
    `document.querySelector(
      '#fortune-search-replace .icon-close.fortune-modal-dialog-icon-close',
    )?.getAttribute('aria-label')`,
  )

  const searchClose = await inspectCloseControl(
    send,
    '#fortune-search-replace',
    '.icon-close.fortune-modal-dialog-icon-close',
  )
  checkCloseControl('Find panel', searchClose)
  await captureViewport(send, searchScreenshotPath)

  const searchCloseClicked = await evaluate(send, `(() => {
    const close = document.querySelector(
      '#fortune-search-replace .icon-close.fortune-modal-dialog-icon-close',
    )
    close?.click()
    return Boolean(close)
  })()`)
  check('Find panel top-right close clicked', searchCloseClicked)
  await waitFor(send, `!document.querySelector('#fortune-search-replace')`)
  check('Top-right close closes the Find panel', true)
  await closeMoreMenu(send)

  const searchEscapeActivation = await activateToolbarItem(send, 'search')
  check(
    'Find panel reopened for Escape check',
    searchEscapeActivation.activated,
    JSON.stringify(searchEscapeActivation),
  )
  await waitFor(send, `Boolean(document.querySelector('#fortune-search-replace'))`)

  const searchEscape = await dispatchEscape(
    send,
    '#fortune-search-replace input, #fortune-search-replace',
  )
  check(
    'Escape dispatched from inside the Find panel',
    searchEscape.dispatched && searchEscape.defaultPrevented,
    JSON.stringify(searchEscape),
  )
  await waitFor(send, `!document.querySelector('#fortune-search-replace')`)
  check('Escape closes the Find panel', true)
  await closeMoreMenu(send)

  const cellSelected = await evaluate(send, `(() => {
    const cellArea = document.querySelector('.fortune-cell-area')
    if (!cellArea) return false
    const rect = cellArea.getBoundingClientRect()
    const clientX = rect.left + Math.min(80, rect.width / 3)
    const clientY = rect.top + Math.min(32, rect.height / 3)
    cellArea.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX,
      clientY,
    }))
    document.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 0,
      clientX,
      clientY,
    }))
    return true
  })()`)
  check('Worksheet cell selected for Screenshot', cellSelected)
  await sleep(300)

  const screenshotActivation = await activateToolbarItem(send, 'screenshot')
  check(
    'Screenshot toolbar action activated',
    screenshotActivation.activated,
    JSON.stringify(screenshotActivation),
  )
  await waitFor(
    send,
    `Boolean(document.querySelector(
      '.fortune-modal-container .fortune-dialog img[src^="data:image/"]',
    ))`,
  )
  await waitFor(
    send,
    `document.querySelector(
      '.fortune-modal-container .fortune-dialog .fortune-modal-dialog-icon-close',
    )?.getAttribute('aria-label')`,
  )
  await waitFor(
    send,
    `document.querySelector(
      '.fortune-modal-container .fortune-dialog',
    )?.dataset.fortuneClipboardStatus === 'copied'`,
  )

  const clipboardCopy = await evaluate(send, `(() => {
    const dialog = document.querySelector('.fortune-modal-container .fortune-dialog')
    const image = dialog?.querySelector('.fortune-dialog-box-content img')
    const status = dialog?.querySelector('.excel-screenshot-clipboard-status')
    return {
      state: dialog?.dataset.fortuneClipboardStatus || '',
      imageState: image?.dataset.fortuneClipboardState || '',
      width: Number(dialog?.dataset.clipboardImageWidth || 0),
      height: Number(dialog?.dataset.clipboardImageHeight || 0),
      naturalWidth: image?.naturalWidth || 0,
      naturalHeight: image?.naturalHeight || 0,
      statusText: status?.textContent?.trim() || '',
    }
  })()`)
  check(
    'Screenshot was written to the system image clipboard',
    clipboardCopy.state === 'copied'
      && clipboardCopy.imageState === 'copied'
      && clipboardCopy.width > 0
      && clipboardCopy.height > 0,
    JSON.stringify(clipboardCopy),
  )
  check(
    'Screenshot preview confirms clipboard copy',
    clipboardCopy.statusText.includes('已复制到剪贴板'),
    JSON.stringify(clipboardCopy),
  )

  const previewClose = await inspectCloseControl(
    send,
    '.fortune-modal-container .fortune-dialog',
    '.fortune-modal-dialog-icon-close',
  )
  checkCloseControl('Screenshot preview', previewClose)
  await captureViewport(send, previewScreenshotPath)

  const previewCloseClicked = await evaluate(send, `(() => {
    const close = document.querySelector(
      '.fortune-modal-container .fortune-modal-dialog-icon-close',
    )
    close?.click()
    return Boolean(close)
  })()`)
  check('Screenshot preview top-right close clicked', previewCloseClicked)
  await waitFor(send, `!document.querySelector('.fortune-modal-container')`)
  check('Top-right close closes the Screenshot preview', true)
  await closeMoreMenu(send)

  const previewEscapeActivation = await activateToolbarItem(send, 'screenshot')
  check(
    'Screenshot reopened for Escape check',
    previewEscapeActivation.activated,
    JSON.stringify(previewEscapeActivation),
  )
  await waitFor(
    send,
    `document.querySelector(
      '.fortune-modal-container .fortune-dialog img',
    )?.src.startsWith('data:image/')`,
  )

  const previewEscape = await dispatchEscape(
    send,
    '.fortune-modal-container .fortune-modal-dialog-icon-close',
  )
  check(
    'Escape dispatched from inside the Screenshot preview',
    previewEscape.dispatched && previewEscape.defaultPrevented,
    JSON.stringify(previewEscape),
  )
  await waitFor(send, `!document.querySelector('.fortune-modal-container')`)
  check('Escape closes the Screenshot preview', true)
  await closeMoreMenu(send)

  const backdropActivation = await activateToolbarItem(send, 'screenshot')
  check(
    'Screenshot reopened for backdrop check',
    backdropActivation.activated,
    JSON.stringify(backdropActivation),
  )
  await waitFor(
    send,
    `Boolean(document.querySelector(
      '.fortune-modal-container .fortune-dialog img[src^="data:image/"]',
    ))`,
  )
  const backdropClicked = await evaluate(send, `(() => {
    const backdrop = document.querySelector('.fortune-modal-container')
    if (!backdrop) return false
    backdrop.click()
    return true
  })()`)
  check('Screenshot backdrop clicked', backdropClicked)
  await waitFor(send, `!document.querySelector('.fortune-modal-container')`)
  check('Clicking the backdrop closes the Screenshot preview', true)
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
