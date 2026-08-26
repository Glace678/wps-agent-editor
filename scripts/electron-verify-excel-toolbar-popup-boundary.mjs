/**
 * Behavioral regression: Fortune toolbar popups must stay inside the Excel
 * viewport when the Agent sidebar narrows it. This covers the three-dot
 * overflow surface, its color/format/border combos, clickable nested border
 * controls, and an already-open popup while the sidebar width changes.
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
const screenshotPath = path.join(artifactDir, 'electron-verify-excel-toolbar-popup-boundary.png')
const profilePath = path.join(os.tmpdir(), `wps-excel-popup-profile-${process.pid}`)
const samplePath = path.join(os.tmpdir(), `wps-excel-popup-${process.pid}.xlsx`)
const port = Number(process.env.WPS_EXCEL_POPUP_VERIFY_PORT || 9386)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

for (const buildFile of [
  path.join(root, 'out', 'main', 'main.js'),
  path.join(root, 'out', 'renderer', 'index.html'),
]) {
  if (!fs.existsSync(buildFile)) {
    throw new Error(`Built Electron output is missing: ${buildFile}. Run npm run build first.`)
  }
}

fs.mkdirSync(artifactDir, { recursive: true })
fs.mkdirSync(profilePath, { recursive: true })
const workbook = new ExcelJS.Workbook()
workbook.addWorksheet('popup boundary').getCell('A1').value = 'popup boundary'
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
  console.log(`[${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? `: ${detail}` : ''}`)
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

  await evaluate(send, `(() => {
    localStorage.setItem('wps-agent-language', 'zh-CN')
    localStorage.setItem('wps-panel-sizes', JSON.stringify({ left: 200, right: 700 }))
    localStorage.setItem('wps-panel-collapsed', JSON.stringify({ left: false, right: false }))
    localStorage.setItem('notepad-last-file', ${JSON.stringify(samplePath)})
    localStorage.removeItem('notepad-startup-behavior')
    location.reload()
    return true
  })()`)

  await waitFor(send, `Boolean(
    document.querySelector('[data-testid="excel-editor-shell"] .fortune-toolbar')
    && [...document.querySelectorAll('.fortune-toolbar-button use')]
      .some((icon) => (
        icon.getAttribute('href')
        || icon.getAttribute('xlink:href')
        || icon.href?.baseVal
        || ''
      ).endsWith('#more'))
  )`)
  await sleep(900)

  const report = await evaluate(send, `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const waitUntil = async (read, timeout = 2500) => {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const value = read()
        if (value) return value
        await sleep(25)
      }
      return null
    }
    const shell = document.querySelector('[data-testid="excel-editor-shell"]')
    const rightPanel = document.querySelector('[data-panel="agent-assistant"]')
    const iconHref = (element) => element?.getAttribute('href') || element?.getAttribute('xlink:href') || ''
    const rect = (element) => {
      if (!element) return null
      const value = element.getBoundingClientRect()
      return {
        left: Math.round(value.left * 100) / 100,
        right: Math.round(value.right * 100) / 100,
        width: Math.round(value.width * 100) / 100,
      }
    }
    const bounded = (element) => {
      if (!element) return false
      const popupRect = element.getBoundingClientRect()
      const shellRect = shell.getBoundingClientRect()
      return popupRect.left >= shellRect.left + 7
        && popupRect.right <= shellRect.right - 7
        && popupRect.width <= shellRect.width - 14
    }
    const paintedAcrossWidth = (element) => {
      if (!element) return false
      const value = element.getBoundingClientRect()
      const points = [
        [value.left + 8, value.top + Math.min(24, value.height / 2)],
        [value.right - 8, value.top + Math.min(24, value.height / 2)],
        [value.left + value.width / 2, value.top + value.height / 2],
      ]
      return points.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y)
        return hit === element || (hit instanceof Node && element.contains(hit))
      })
    }
    const findMoreButton = () => [...document.querySelectorAll('.fortune-toolbar-button')]
      .find((button) => [...button.querySelectorAll('use')]
        .some((icon) => iconHref(icon).endsWith('#more')))
    const closeToolbarSurfaces = async () => {
      for (const popup of [...document.querySelectorAll('.fortune-toolbar-combo-popup')]) {
        popup.closest('.fortune-toobar-combo-container')
          ?.querySelector('.fortune-toolbar-combo-arrow')
          ?.click()
        await sleep(25)
      }
      if (document.querySelector('.fortune-toolbar-more-container')) {
        findMoreButton()?.click()
      }
      await sleep(80)
    }
    const openMore = async () => {
      await closeToolbarSurfaces()
      findMoreButton()?.click()
      return waitUntil(() => document.querySelector('.fortune-toolbar-more-container'))
    }
    const findComboByIcon = (root, iconName) => [...root.querySelectorAll('.fortune-toobar-combo-container')]
      .find((combo) => [...combo.querySelectorAll('use')]
        .some((icon) => iconHref(icon).endsWith('#' + iconName)))
    const openCombo = async (combo, identify) => {
      combo?.querySelector('.fortune-toolbar-combo-arrow')?.click()
      return waitUntil(() => [...document.querySelectorAll('.fortune-toolbar-combo-popup')]
        .find(identify))
    }
    const openPickerByKind = async (kind) => {
      const combos = [...shell.querySelectorAll('.fortune-toobar-combo-container')]
      for (const combo of combos) {
        const arrow = combo.querySelector('.fortune-toolbar-combo-arrow')
        if (!arrow) continue
        arrow.click()
        const popup = await waitUntil(() => {
          const candidate = combo.querySelector('.fortune-toolbar-combo-popup')
          return candidate?.dataset.excelPickerKind === kind ? candidate : null
        }, 500)
        if (popup) return popup
        if (combo.querySelector('.fortune-toolbar-combo-popup')) arrow.click()
        await sleep(25)
      }
      return null
    }

    const more = await openMore()
    const moreInitial = {
      found: Boolean(more),
      bounded: bounded(more),
      marked: more?.dataset.excelPopupBoundary === 'true',
      rect: rect(more),
      shell: rect(shell),
    }

    const colorCombo = more && (
      findComboByIcon(more, 'font-color') || findComboByIcon(more, 'background')
    )
    const colorPopup = await openCombo(colorCombo, (popup) => popup.querySelector('#fortune-custom-color'))
    const colorBeforeResize = {
      found: Boolean(colorPopup),
      inOverflow: Boolean(colorCombo),
      resetVisible: Boolean(colorPopup?.querySelector('.color-reset')),
      bounded: bounded(colorPopup),
      rect: rect(colorPopup),
      shell: rect(shell),
    }

    const originalRightWidth = rightPanel.getBoundingClientRect().width
    rightPanel.style.setProperty('--panel-drag-width', (originalRightWidth + 100) + 'px')
    await sleep(350)
    const colorAfterResize = {
      stillOpen: colorPopup?.isConnected === true,
      bounded: bounded(colorPopup),
      marked: colorPopup?.dataset.excelPopupBoundary === 'true',
      shift: Number(colorPopup?.dataset.excelPopupShiftX || 0),
      rect: rect(colorPopup),
      shell: rect(shell),
    }
    rightPanel.style.removeProperty('--panel-drag-width')
    await closeToolbarSurfaces()
    await sleep(180)

    await openMore()
    const formatPopup = await openPickerByKind('format')
    const format = {
      found: Boolean(formatPopup),
      bounded: bounded(formatPopup),
      marked: formatPopup?.dataset.excelPopupBoundary === 'true',
      preferredWidth: Number(formatPopup?.dataset.excelPopupPreferredWidth || 0),
      rect: rect(formatPopup),
      shell: rect(shell),
    }
    await closeToolbarSurfaces()

    const moreForBorder = await openMore()
    const borderCombo = findComboByIcon(moreForBorder || shell, 'border-all')
      || findComboByIcon(shell, 'border-all')
    const borderPopup = await openCombo(
      borderCombo,
      (popup) => Boolean(popup.querySelector('.fortune-border-select-option')),
    )
    const border = {
      found: Boolean(borderPopup),
      bounded: bounded(borderPopup),
      marked: borderPopup?.dataset.excelPopupBoundary === 'true',
      rect: rect(borderPopup),
      shell: rect(shell),
    }

    const borderRows = [...(borderPopup?.querySelectorAll('.fortune-border-select-option') || [])]
    const borderColorRow = borderRows[0]
    const borderColorLabel = borderColorRow?.querySelector('.fortune-toolbar-menu-line')
    borderColorLabel?.click()
    const borderColorSubmenu = await waitUntil(() => [...document.querySelectorAll('.fortune-border-select-menu')]
      .find((menu) => getComputedStyle(menu).display !== 'none'
        && menu.dataset.excelPopupBoundary === 'true'))
    const borderColorSubmenuReport = {
      openedByInnerLabelClick: Boolean(borderColorSubmenu),
      bounded: bounded(borderColorSubmenu),
      paintedAcrossWidth: paintedAcrossWidth(borderColorSubmenu),
      marked: borderColorSubmenu?.dataset.excelPopupBoundary === 'true',
      escapedClip: borderColorSubmenu?.dataset.excelPopupEscapedClip === 'true',
      rect: rect(borderColorSubmenu),
      shell: rect(shell),
    }

    const borderStyleRow = borderRows[1]
    const borderStyleLabel = borderStyleRow?.querySelector('.fortune-toolbar-menu-line')
    borderStyleLabel?.click()
    const borderStyleSubmenu = await waitUntil(() => {
      const candidate = borderStyleRow?.querySelector('.fortune-border-select-menu')
      return candidate && getComputedStyle(candidate).display !== 'none'
        && candidate.dataset.excelPopupBoundary === 'true'
        ? candidate
        : null
    })
    const borderStyleSubmenuReport = {
      openedByInnerLabelClick: Boolean(borderStyleSubmenu),
      colorSubmenuClosed: borderColorSubmenu
        ? getComputedStyle(borderColorSubmenu).display === 'none'
        : false,
      bounded: bounded(borderStyleSubmenu),
      paintedAcrossWidth: paintedAcrossWidth(borderStyleSubmenu),
      marked: borderStyleSubmenu?.dataset.excelPopupBoundary === 'true',
      escapedClip: borderStyleSubmenu?.dataset.excelPopupEscapedClip === 'true',
      rect: rect(borderStyleSubmenu),
      shell: rect(shell),
    }

    return {
      shellWidth: shell.getBoundingClientRect().width,
      moreInitial,
      colorBeforeResize,
      colorAfterResize,
      format,
      border,
      borderColorSubmenu: borderColorSubmenuReport,
      borderStyleSubmenu: borderStyleSubmenuReport,
    }
  })()`, true)

  check('Excel viewport is narrow enough to exercise toolbar overflow', report.shellWidth < 560, `width=${report.shellWidth}`)
  check('three-dot overflow menu is bounded', report.moreInitial.found && report.moreInitial.bounded, JSON.stringify(report.moreInitial))
  check('three-dot overflow menu uses boundary policy', report.moreInitial.marked, JSON.stringify(report.moreInitial))
  check('Reset color popup opens from overflow', report.colorBeforeResize.found && report.colorBeforeResize.inOverflow && report.colorBeforeResize.resetVisible, JSON.stringify(report.colorBeforeResize))
  check('Reset color popup is bounded before sidebar resize', report.colorBeforeResize.bounded, JSON.stringify(report.colorBeforeResize))
  check('open color popup remains bounded after sidebar grows', report.colorAfterResize.stillOpen && report.colorAfterResize.bounded, JSON.stringify(report.colorAfterResize))
  check('format dropdown is bounded', report.format.found && report.format.bounded && report.format.marked, JSON.stringify(report.format))
  check('border dropdown is bounded', report.border.found && report.border.bounded && report.border.marked, JSON.stringify(report.border))
  check(
    'border color opens by clicking its inner label and remains usable',
    report.borderColorSubmenu.openedByInnerLabelClick
      && report.borderColorSubmenu.bounded
      && report.borderColorSubmenu.paintedAcrossWidth
      && report.borderColorSubmenu.marked
      && report.borderColorSubmenu.escapedClip,
    JSON.stringify(report.borderColorSubmenu),
  )
  check(
    'border style opens by clicking its inner label and replaces the color submenu',
    report.borderStyleSubmenu.openedByInnerLabelClick
      && report.borderStyleSubmenu.colorSubmenuClosed
      && report.borderStyleSubmenu.bounded
      && report.borderStyleSubmenu.paintedAcrossWidth
      && report.borderStyleSubmenu.marked
      && report.borderStyleSubmenu.escapedClip,
    JSON.stringify(report.borderStyleSubmenu),
  )

  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, 'base64'))
  console.log(`[PASS] screenshot saved: ${screenshotPath}`)
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
