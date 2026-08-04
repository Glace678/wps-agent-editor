import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const ExcelJS = require('exceljs')
const { createCanvas, loadImage } = require('@napi-rs/canvas')
const electronPath = require('electron')
const root = process.cwd()
const packagedAppPath = process.env.WPS_THEME_VERIFY_APP
const artifactDir = path.join(root, '.cache')
const screenshotPath = path.join(artifactDir, 'electron-verify-excel-theme.png')
const samplePath = path.join(os.tmpdir(), `wps-excel-theme-${process.pid}.xlsx`)
const profilePath = path.join(os.tmpdir(), `wps-excel-theme-profile-${process.pid}`)
const port = Number(process.env.WPS_THEME_VERIFY_PORT || 9341)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

fs.mkdirSync(artifactDir, { recursive: true })
fs.mkdirSync(profilePath, { recursive: true })

const workbook = new ExcelJS.Workbook()
const sampleSheet = workbook.addWorksheet('Theme check')
sampleSheet.getColumn(1).width = 18
sampleSheet.getColumn(2).width = 20
for (let row = 1; row <= 7; row += 1) sampleSheet.getRow(row).height = 24

const sampleCells = [
  ['A1', 'PLAIN', 'FF000000', 'FFFFFFFF'],
  ['A2', 'RED', 'FFFF2020', 'FFFFFFFF'],
  ['A3', 'BLUE', 'FF1677FF', 'FFFFFFFF'],
  ['B1', 'WHITE GREEN', 'FFFFFFFF', 'FF16A05D'],
  ['B2', 'BLACK YELLOW', 'FF000000', 'FFFFCC19'],
  ['B3', 'GRAY', 'FF555555', 'FFF4F4F4'],
]
for (const [address, value, fontColor, fillColor] of sampleCells) {
  const cell = sampleSheet.getCell(address)
  cell.value = value
  cell.font = { bold: true, size: 16, color: { argb: fontColor } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } }
}

const numericSamples = [
  ['A4', '012345'],
  ['A5', -1234.56],
  ['A6', '12.5%'],
  ['B4', '6789'],
  ['B5', 98765.43],
  ['B6', '100.00'],
]
for (const [address, value] of numericSamples) {
  const cell = sampleSheet.getCell(address)
  cell.value = value
  // Reproduce workbooks that author ordinary values in dark neutral gray.
  // Exercise both common Windows/WPS digit fonts; dark mode should lift
  // either one to the same near-white contrast as the live editor.
  cell.font = {
    name: address.startsWith('B') ? 'Arial' : 'Segoe UI',
    size: 11,
    color: { argb: 'FF444444' },
  }
}
sampleSheet.getCell('A7').value = 'DEFAULT COLOR'
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

    socket.addEventListener('open', () => resolve({ send }))
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
  const result = response.result
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  }
  return result.result.value
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

function closeTo(actual, expected, tolerance) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance
}

function canvasBackingMatchesDpr(geometry) {
  return (
    closeTo(geometry.canvasRatioX, geometry.devicePixelRatio, 0.03)
    && closeTo(geometry.canvasRatioY, geometry.devicePixelRatio, 0.03)
  )
}

async function readExcelGeometry(send) {
  return evaluate(send, `(() => {
    const shell = document.querySelector('[data-testid="excel-editor-shell"]')
    const toolbar = shell?.querySelector('.fortune-toolbar')
    const toolbarText = toolbar?.querySelector('.fortune-toolbar-combo-text') || toolbar
    const canvas = shell?.querySelector('.fortune-sheet-canvas')
    const overlay = shell?.querySelector('.fortune-sheet-overlay')
    const scrollX = shell?.querySelector('.luckysheet-scrollbar-x')
    const scrollY = shell?.querySelector('.luckysheet-scrollbar-y')
    const outerZoomTarget = shell?.closest('.document-zoom-target')
    const documentZoomRoot = shell?.closest('.document-zoom-root')
    const zoomText = shell?.querySelector('.fortune-zoom-ratio-current')?.textContent?.trim() || ''
    const zoomPercent = Number.parseFloat(zoomText)
    const rect = (element) => {
      if (!element) return null
      const value = element.getBoundingClientRect()
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      }
    }
    const cssZoom = (element) => {
      if (!element) return 1
      const value = Number.parseFloat(getComputedStyle(element).zoom)
      return Number.isFinite(value) ? value : 1
    }
    const shellRect = rect(shell)
    const toolbarRect = rect(toolbar)
    const toolbarTextRect = rect(toolbarText)
    const canvasRect = rect(canvas)
    const documentZoom = Number.parseFloat(
      documentZoomRoot?.getAttribute('data-document-zoom') || '1',
    )
    return {
      fortuneZoom: Number.isFinite(zoomPercent) ? zoomPercent / 100 : null,
      fortuneZoomText: zoomText,
      documentZoom: Number.isFinite(documentZoom) ? documentZoom : null,
      hasOuterZoomTarget: Boolean(outerZoomTarget),
      outerZoom: cssZoom(outerZoomTarget),
      shell: shellRect,
      toolbar: toolbarRect,
      toolbarTopOffset: shellRect && toolbarRect ? toolbarRect.top - shellRect.top : null,
      toolbarFontSize: toolbarText
        ? Number.parseFloat(getComputedStyle(toolbarText).fontSize)
        : null,
      toolbarTextHeight: toolbarTextRect?.height ?? null,
      canvas: canvasRect,
      canvasPixelWidth: canvas?.width ?? null,
      canvasPixelHeight: canvas?.height ?? null,
      canvasRatioX: canvas && canvasRect?.width ? canvas.width / canvasRect.width : null,
      canvasRatioY: canvas && canvasRect?.height ? canvas.height / canvasRect.height : null,
      devicePixelRatio: window.devicePixelRatio,
      overlay: rect(overlay),
      scrollX: rect(scrollX),
      scrollY: rect(scrollY),
    }
  })()`)
}

async function dispatchExcelZoomShortcut(send, key, code, shiftKey = false) {
  return evaluate(send, `(async () => {
    const target = document.querySelector(
      '[data-testid="excel-editor-shell"] .fortune-sheet-overlay',
    )
    if (!target) return { dispatched: false, reason: 'sheet overlay missing' }
    target.focus({ preventScroll: true })
    const init = {
      key: ${JSON.stringify(key)},
      code: ${JSON.stringify(code)},
      ctrlKey: true,
      shiftKey: ${JSON.stringify(shiftKey)},
      bubbles: true,
      cancelable: true,
    }
    const keydown = new KeyboardEvent('keydown', init)
    target.dispatchEvent(keydown)
    target.dispatchEvent(new KeyboardEvent('keyup', init))
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    })
    return { dispatched: true, defaultPrevented: keydown.defaultPrevented }
  })()`, true)
}

async function inspectPixels(pngBuffer, cellArea, screenshotRect) {
  const image = await loadImage(pngBuffer)
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, image.width, image.height).data
  let samples = 0
  let nearBlack = 0
  let nearWhite = 0
  const colors = new Set()

  const inspectRegion = (left, top, width, height) => {
    const counts = {
      samples: 0,
      black: 0,
      white: 0,
      light: 0,
      mid: 0,
      red: 0,
      blue: 0,
      green: 0,
      yellow: 0,
      pickerGreen: 0,
      grayFill: 0,
      grayText: 0,
      darkGrayText: 0,
    }
    const near = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance
    const startX = Math.max(0, Math.floor(left))
    const startY = Math.max(0, Math.floor(top))
    const endX = Math.min(image.width, Math.ceil(left + width))
    const endY = Math.min(image.height, Math.ceil(top + height))
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const index = (y * image.width + x) * 4
        const red = pixels[index]
        const green = pixels[index + 1]
        const blue = pixels[index + 2]
        if (pixels[index + 3] < 240) continue
        counts.samples += 1
        if (red <= 30 && green <= 30 && blue <= 30) counts.black += 1
        if (red >= 225 && green >= 225 && blue >= 225) counts.white += 1
        if (red >= 150 && green >= 150 && blue >= 150) counts.light += 1
        if (red >= 80 && green >= 80 && blue >= 80) counts.mid += 1
        if (near(red, 255, 24) && near(green, 32, 24) && near(blue, 32, 24)) counts.red += 1
        if (near(red, 22, 24) && near(green, 119, 24) && near(blue, 255, 24)) counts.blue += 1
        if (near(red, 22, 18) && near(green, 160, 18) && near(blue, 93, 18)) counts.green += 1
        if (near(red, 255, 18) && near(green, 204, 18) && near(blue, 25, 18)) counts.yellow += 1
        if (near(red, 0, 18) && near(green, 240, 18) && near(blue, 15, 18)) counts.pickerGreen += 1
        if (near(red, 244, 8) && near(green, 244, 8) && near(blue, 244, 8)) counts.grayFill += 1
        if (near(red, 85, 14) && near(green, 85, 14) && near(blue, 85, 14)) counts.grayText += 1
        if (near(red, 68, 14) && near(green, 68, 14) && near(blue, 68, 14)) counts.darkGrayText += 1
      }
    }
    return counts
  }

  for (let index = 0; index < pixels.length; index += 16) {
    const red = pixels[index]
    const green = pixels[index + 1]
    const blue = pixels[index + 2]
    const alpha = pixels[index + 3]
    if (alpha < 240) continue
    samples += 1
    if (red <= 24 && green <= 24 && blue <= 24) nearBlack += 1
    if (red >= 232 && green >= 232 && blue >= 232) nearWhite += 1
    colors.add(`${red >> 4},${green >> 4},${blue >> 4}`)
  }

  const firstColumnWidth = 72
  const rowHeight = 19
  const inset = 2
  const scaleX = screenshotRect?.width ? image.width / screenshotRect.width : 1
  const scaleY = screenshotRect?.height ? image.height / screenshotRect.height : 1
  const inspectCell = (column, row) => inspectRegion(
    (cellArea.x + firstColumnWidth * column + inset) * scaleX,
    (cellArea.y + rowHeight * row + inset) * scaleY,
    (firstColumnWidth - inset * 2) * scaleX,
    (rowHeight - inset * 2) * scaleY,
  )
  const cellRegions = cellArea ? {
    plain: inspectCell(0, 0),
    red: inspectCell(0, 1),
    blue: inspectCell(0, 2),
    green: inspectCell(1, 0),
    yellow: inspectCell(1, 1),
    gray: inspectCell(1, 2),
    digits: inspectCell(0, 3),
    decimal: inspectCell(0, 4),
    percent: inspectCell(0, 5),
    digitsArial: inspectCell(1, 3),
    decimalArial: inspectCell(1, 4),
    percentArial: inspectCell(1, 5),
  } : null

  return {
    width: image.width,
    height: image.height,
    nearBlackRatio: nearBlack / samples,
    nearWhiteRatio: nearWhite / samples,
    colorBuckets: colors.size,
    cellRegions,
  }
}

let child
let send
try {
  child = spawn(
    packagedAppPath || electronPath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profilePath}`,
      ...(packagedAppPath ? [] : [root]),
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
  ;({ send } = await connect(target.webSocketDebuggerUrl))
  await send('Runtime.enable')
  await send('Page.enable')

  await evaluate(send, `(() => {
    localStorage.setItem('app-theme', 'dark')
    localStorage.setItem('notepad-last-file', ${JSON.stringify(samplePath)})
    localStorage.removeItem('notepad-startup-behavior')
    location.reload()
    return true
  })()`)

  await waitFor(
    send,
    `Boolean(document.documentElement.classList.contains('dark')
      && document.querySelector('[data-testid="excel-editor-shell"] .fortune-container')
      && document.querySelector('.fortune-sheet-canvas'))`,
  )
  await sleep(1200)

  const baselineGeometry = await readExcelGeometry(send)
  check(
    'Fortune starts at 100% zoom',
    closeTo(baselineGeometry.fortuneZoom, 1, 0.01),
    JSON.stringify(baselineGeometry),
  )
  check(
    'Excel canvas backing scale matches devicePixelRatio before zoom',
    canvasBackingMatchesDpr(baselineGeometry),
    JSON.stringify(baselineGeometry),
  )
  check(
    'horizontal scrollbar starts attached to the overlay bottom',
    baselineGeometry.overlay
      && baselineGeometry.scrollX
      && closeTo(baselineGeometry.scrollX.bottom, baselineGeometry.overlay.bottom, 1),
    JSON.stringify(baselineGeometry),
  )
  check(
    'vertical scrollbar starts attached to the overlay right edge',
    baselineGeometry.overlay
      && baselineGeometry.scrollY
      && closeTo(baselineGeometry.scrollY.right, baselineGeometry.overlay.right, 1),
    JSON.stringify(baselineGeometry),
  )

  const zoomInDispatch = await dispatchExcelZoomShortcut(send, '+', 'Equal', true)
  check('Ctrl+Plus dispatched to Excel', zoomInDispatch.dispatched, JSON.stringify(zoomInDispatch))
  await waitFor(
    send,
    `Number.parseFloat(
      document.querySelector(
        '[data-testid="excel-editor-shell"] .fortune-zoom-ratio-current',
      )?.textContent || ''
    ) > 100`,
  )
  await sleep(250)

  const zoomedGeometry = await readExcelGeometry(send)
  check(
    'Ctrl+Plus applies exactly one native Fortune zoom step',
    closeTo(zoomedGeometry.fortuneZoom, 1.1, 0.01),
    JSON.stringify(zoomedGeometry),
  )
  check(
    'Excel is excluded from outer CSS zoom',
    closeTo(zoomedGeometry.outerZoom, 1, 0.01),
    JSON.stringify(zoomedGeometry),
  )
  check(
    'Excel toolbar remains pinned to the same top position',
    closeTo(zoomedGeometry.toolbar?.top, baselineGeometry.toolbar?.top, 1)
      && closeTo(zoomedGeometry.toolbarTopOffset, baselineGeometry.toolbarTopOffset, 1),
    JSON.stringify({ baseline: baselineGeometry, zoomed: zoomedGeometry }),
  )
  check(
    'Excel toolbar height remains unchanged',
    closeTo(zoomedGeometry.toolbar?.height, baselineGeometry.toolbar?.height, 1),
    JSON.stringify({ baseline: baselineGeometry.toolbar, zoomed: zoomedGeometry.toolbar }),
  )
  check(
    'Excel toolbar font size remains unchanged',
    closeTo(zoomedGeometry.toolbarFontSize, baselineGeometry.toolbarFontSize, 0.1)
      && closeTo(zoomedGeometry.toolbarTextHeight, baselineGeometry.toolbarTextHeight, 1),
    JSON.stringify({
      baselineFontSize: baselineGeometry.toolbarFontSize,
      zoomedFontSize: zoomedGeometry.toolbarFontSize,
      baselineTextHeight: baselineGeometry.toolbarTextHeight,
      zoomedTextHeight: zoomedGeometry.toolbarTextHeight,
    }),
  )
  check(
    'Excel canvas backing scale still matches devicePixelRatio at 110%',
    canvasBackingMatchesDpr(zoomedGeometry),
    JSON.stringify(zoomedGeometry),
  )
  check(
    'horizontal scrollbar stays attached to the overlay bottom at 110%',
    zoomedGeometry.overlay
      && zoomedGeometry.scrollX
      && closeTo(zoomedGeometry.scrollX.bottom, zoomedGeometry.overlay.bottom, 1),
    JSON.stringify(zoomedGeometry),
  )
  check(
    'vertical scrollbar stays attached to the overlay right edge at 110%',
    zoomedGeometry.overlay
      && zoomedGeometry.scrollY
      && closeTo(zoomedGeometry.scrollY.right, zoomedGeometry.overlay.right, 1),
    JSON.stringify(zoomedGeometry),
  )

  const zoomResetDispatch = await dispatchExcelZoomShortcut(send, '0', 'Digit0')
  check('Ctrl+0 dispatched to Excel', zoomResetDispatch.dispatched, JSON.stringify(zoomResetDispatch))
  await waitFor(
    send,
    `Math.abs(
      Number.parseFloat(
        document.querySelector(
          '[data-testid="excel-editor-shell"] .fortune-zoom-ratio-current',
        )?.textContent || '',
      ) / 100 - 1
    ) <= 0.01`,
  )
  await sleep(250)

  const resetGeometry = await readExcelGeometry(send)
  check(
    'Ctrl+0 restores native Fortune zoom to 100%',
    closeTo(resetGeometry.fortuneZoom, 1, 0.01),
    JSON.stringify(resetGeometry),
  )
  check(
    'Excel remains excluded from outer CSS zoom after reset',
    closeTo(resetGeometry.outerZoom, 1, 0.01),
    JSON.stringify(resetGeometry),
  )
  check(
    'Excel toolbar geometry is restored after reset',
    closeTo(resetGeometry.toolbar?.top, baselineGeometry.toolbar?.top, 1)
      && closeTo(resetGeometry.toolbar?.height, baselineGeometry.toolbar?.height, 1)
      && closeTo(resetGeometry.toolbarFontSize, baselineGeometry.toolbarFontSize, 0.1),
    JSON.stringify({ baseline: baselineGeometry, reset: resetGeometry }),
  )
  check(
    'Excel canvas backing scale matches devicePixelRatio after reset',
    canvasBackingMatchesDpr(resetGeometry),
    JSON.stringify(resetGeometry),
  )
  check(
    'Excel scrollbars remain attached after reset',
    resetGeometry.overlay
      && resetGeometry.scrollX
      && resetGeometry.scrollY
      && closeTo(resetGeometry.scrollX.bottom, resetGeometry.overlay.bottom, 1)
      && closeTo(resetGeometry.scrollY.right, resetGeometry.overlay.right, 1),
    JSON.stringify(resetGeometry),
  )

  const fontButton = await evaluate(send, `(() => {
    const buttons = [...document.querySelectorAll('.fortune-toolbar-combo-button')]
    const button = buttons.find((item) => /font|字体|字體/i.test(item.getAttribute('aria-label') || ''))
      || buttons.find((item) => /Arial|Calibri|宋体|微软雅黑|Microsoft YaHei/i.test(item.textContent || ''))
    if (!button) return { clicked: false, labels: buttons.map((item) => item.getAttribute('aria-label')) }
    button.click()
    return { clicked: true, label: button.getAttribute('aria-label') }
  })()`)
  check('font-family control found', fontButton.clicked, JSON.stringify(fontButton))

  await waitFor(send, `Boolean(document.querySelector('.fortune-toolbar-combo-popup .fortune-toolbar-select-option'))`)
  await sleep(250)

  const sharedFontLibrary = await evaluate(send, `(async () => {
    const normalize = (name) => String(name || '').trim().replace(/["']/g, '').toLowerCase()
    const faces = await window.api.lw.listFonts('zh-CN')
    const families = new Map()
    for (const face of faces) {
      const family = String(face.familyName || '').trim()
      const key = normalize(family)
      if (family && key && !families.has(key)) {
        families.set(key, {
          familyName: family,
          displayName: String(face.displayName || '').trim() || family,
        })
      }
    }
    const defaultKey = normalize('Segoe UI')
    const defaultFamily = families.get(defaultKey) || {
      familyName: 'Segoe UI',
      displayName: 'Segoe UI',
    }
    const orderedFamilies = [
      defaultFamily,
      ...[...families.entries()]
        .filter(([key]) => key !== defaultKey)
        .map(([, family]) => family)
        .sort((left, right) => left.familyName.localeCompare(right.familyName)),
    ]
    const usedMenuNames = new Set()
    const menuFamilies = orderedFamilies.map((family) => {
      const displayName = family.displayName || family.familyName
      const displayKey = normalize(displayName)
      const menuName = displayKey && !usedMenuNames.has(displayKey)
        ? displayName
        : family.familyName
      usedMenuNames.add(normalize(menuName))
      return { ...family, menuName }
    })
    return { menuFamilies }
  })()`, true)
  check(
    'shared system font provider is available',
    Array.isArray(sharedFontLibrary?.menuFamilies) && sharedFontLibrary.menuFamilies.length > 0,
    JSON.stringify({ count: sharedFontLibrary?.menuFamilies?.length }),
  )

  const excelFontLibrary = await evaluate(send, `(() => {
    const names = [...document.querySelectorAll(
      '.fortune-toolbar-combo-popup .fortune-toolbar-select-option',
    )]
      .map((option) => option.textContent?.trim())
      .filter(Boolean)
    return { names, uniqueCount: new Set(names).size }
  })()`)
  const normalizeFontName = (name) => String(name || '').trim().replace(/["']/g, '').toLowerCase()
  const expectedFontKeys = new Set(sharedFontLibrary.menuFamilies.map((font) => normalizeFontName(font.menuName)))
  const actualFontKeys = new Set(excelFontLibrary.names.map(normalizeFontName))
  const missingFontFamilies = sharedFontLibrary.menuFamilies
    .filter((font) => !actualFontKeys.has(normalizeFontName(font.menuName)))
    .map((font) => font.menuName)
  const unexpectedFontFamilies = excelFontLibrary.names
    .filter((family) => !expectedFontKeys.has(normalizeFontName(family)))
  check(
    'Excel font picker uses the shared system font library and localized labels',
    excelFontLibrary.uniqueCount === excelFontLibrary.names.length
      && missingFontFamilies.length === 0
      && unexpectedFontFamilies.length === 0,
    JSON.stringify({
      expected: sharedFontLibrary.menuFamilies.length,
      actual: excelFontLibrary.names.length,
      missing: missingFontFamilies.slice(0, 8),
      unexpected: unexpectedFontFamilies.slice(0, 8),
    }),
  )
  const installedChineseFontNames = sharedFontLibrary.menuFamilies
    .filter((font) => ['SimSun', 'NSimSun', 'FangSong', 'KaiTi', 'SimHei', 'DengXian'].includes(font.familyName))
    .map((font) => font.menuName)
  check(
    'Excel exposes installed Chinese font names',
    installedChineseFontNames.every((name) => actualFontKeys.has(normalizeFontName(name))),
    JSON.stringify(installedChineseFontNames),
  )

  const styles = await evaluate(send, `(() => {
    const pick = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return null
      const style = getComputedStyle(element)
      return {
        background: style.backgroundColor,
        color: style.color,
        border: style.borderColor,
        filter: style.filter,
        fontFamily: style.fontFamily,
        fontSmoothing: style.webkitFontSmoothing,
        textRendering: style.textRendering,
      }
    }
    const shell = document.querySelector('[data-testid="excel-editor-shell"]')
    const rect = shell.getBoundingClientRect()
    const cellAreaRect = document.querySelector('.fortune-cell-area').getBoundingClientRect()
    const canvas = document.querySelector('.fortune-sheet-canvas')
    return {
      isDark: document.documentElement.classList.contains('dark'),
      shell: pick('[data-testid="excel-editor-shell"]'),
      root: pick('.fortune-container'),
      toolbar: pick('.fortune-toolbar'),
      formulaBar: pick('.fortune-fx-editor'),
      sheetTabs: pick('.luckysheet-sheet-area'),
      fontPicker: pick('.fortune-toolbar-combo-popup .fortune-toolbar-select'),
      fontOption: pick('.fortune-toolbar-combo-popup .fortune-toolbar-select-option'),
      cellEditor: pick('.luckysheet-input-box-inner'),
      canvas: pick('.fortune-sheet-canvas'),
      canvasRect: (() => {
        const canvasRect = canvas.getBoundingClientRect()
        return {
          x: canvasRect.x - rect.x,
          y: canvasRect.y - rect.y,
          width: canvasRect.width,
          height: canvasRect.height,
          pixelWidth: canvas.width,
          pixelHeight: canvas.height,
        }
      })(),
      fontOptionText: document.querySelector('.fortune-toolbar-combo-popup .fortune-toolbar-select-option')?.textContent?.trim(),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      cellArea: {
        x: cellAreaRect.x - rect.x,
        y: cellAreaRect.y - rect.y,
        width: cellAreaRect.width,
        height: cellAreaRect.height,
      },
    }
  })()`)

  check('application dark class active', styles.isDark)
  for (const [name, style] of Object.entries({
    root: styles.root,
    toolbar: styles.toolbar,
    formulaBar: styles.formulaBar,
    sheetTabs: styles.sheetTabs,
  })) {
    check(`${name} uses pure black`, style?.background === 'rgb(0, 0, 0)', JSON.stringify(style))
  }
  check(
    'font option has readable light text',
    styles.fontOption?.color === 'rgb(245, 245, 245)',
    `${styles.fontOptionText} ${JSON.stringify(styles.fontOption)}`,
  )
  const darkPickerSurfaces = await evaluate(send, `(async () => {
    const popupFor = (kind) => document.querySelector(
      \`.fortune-toolbar-combo-popup[data-excel-picker-kind="\${kind}"]\`,
    )
    const waitForState = async (predicate) => {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        if (predicate()) return
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error('Timed out waiting for Excel picker state')
    }
    const buttonFor = (kind) => {
      const buttons = [...document.querySelectorAll('.fortune-toolbar-combo-button')]
      return buttons.find((button) => {
        const label = [button.getAttribute('aria-label'), button.dataset.tips]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase()
        if (kind === 'font-size') {
          return /font\\s*[- ]?\\s*size|字号|字號|字体大小|字體大小/i.test(label)
        }
        if (kind === 'format') return /format|格式|формат|書式/i.test(label)
        return /font|字体|字體|шрифт/i.test(label)
          && !/size|字号|字號|大小|color|颜色|顏色/i.test(label)
      })
    }
    const readSurface = (kind) => {
      const popup = popupFor(kind)
      const list = popup?.querySelector('.fortune-toolbar-select')
      const header = popup?.querySelector('.excel-toolbar-picker-search')
      const input = popup?.querySelector('.excel-toolbar-picker-search-input')
      if (!popup || !list || !header || !input) return null
      return {
        popup: getComputedStyle(popup).backgroundColor,
        list: getComputedStyle(list).backgroundColor,
        header: getComputedStyle(header).backgroundColor,
        input: getComputedStyle(input).backgroundColor,
        border: getComputedStyle(popup).borderColor,
        radius: getComputedStyle(popup).borderRadius,
        shadow: getComputedStyle(popup).boxShadow,
      }
    }
    const closePicker = async (kind) => {
      if (!popupFor(kind)) return
      buttonFor(kind)?.click()
      await waitForState(() => !popupFor(kind))
    }
    const openPicker = async (kind) => {
      const button = buttonFor(kind)
      if (!button) return null
      button.click()
      await waitForState(() => Boolean(popupFor(kind)))
      return readSurface(kind)
    }

    const surfaces = {
      worksheet: getComputedStyle(document.querySelector('.fortune-container')).backgroundColor,
      font: readSurface('font'),
      fontSize: null,
      format: null,
    }
    await closePicker('font')
    surfaces.fontSize = await openPicker('font-size')
    await closePicker('font-size')
    surfaces.format = await openPicker('format')
    await closePicker('format')
    return surfaces
  })()`, true)
  for (const [kind, surface] of Object.entries({
    font: darkPickerSurfaces.font,
    fontSize: darkPickerSurfaces.fontSize,
    format: darkPickerSurfaces.format,
  })) {
    check(
      `${kind} picker uses a raised charcoal surface distinct from the black worksheet`,
      surface?.popup === 'rgb(37, 37, 37)'
        && surface.list === surface.popup
        && surface.header === surface.popup
        && surface.input === 'rgb(48, 48, 48)'
        && surface.radius === '6px'
        && surface.popup !== darkPickerSurfaces.worksheet,
      JSON.stringify({ worksheet: darkPickerSurfaces.worksheet, surface }),
    )
  }
  const dropdownSurfaceContracts = await evaluate(send, `(() => {
    const shell = document.querySelector('[data-testid="excel-editor-shell"]')
    const container = shell?.querySelector('.fortune-container')
    if (!container) return null
    const specs = [
      ['toolbar-list', 'fortune-toolbar-select'],
      ['color-picker', 'fortune-toolbar-color-picker'],
      ['more-tools', 'fortune-toolbar-more-container'],
      ['toolbar-submenu', 'toolbar-item-sub-menu'],
      ['condition-format', 'condition-format-sub-menu'],
      ['filter', 'fortune-context-menu luckysheet-cols-menu fortune-filter-menu'],
      ['filter-color', 'luckysheet-filter-bycolor-submenu'],
      ['zoom', 'fortune-zoom-ratio-menu'],
      ['sheet-list', 'fortune-context-menu luckysheet-cols-menu fortune-sheet-list'],
    ]
    const fixture = document.createElement('div')
    fixture.style.cssText = 'position:absolute;left:-10000px;top:-10000px;visibility:hidden;'
    container.append(fixture)
    const surfaces = Object.fromEntries(specs.map(([name, className]) => {
      const element = document.createElement('div')
      element.className = className
      fixture.append(element)
      const style = getComputedStyle(element)
      return [name, {
        background: style.backgroundColor,
        border: style.borderColor,
        radius: style.borderRadius,
        shadow: style.boxShadow,
      }]
    }))
    for (const [name, id] of [
      ['custom-color', 'fortune-custom-color'],
      ['sheet-color', 'fortune-change-color'],
      ['data-validation', 'luckysheet-dataVerification-dropdown-List'],
    ]) {
      const element = document.createElement('div')
      element.id = id
      fixture.append(element)
      const style = getComputedStyle(element)
      surfaces[name] = {
        background: style.backgroundColor,
        border: style.borderColor,
        radius: style.borderRadius,
        shadow: style.boxShadow,
      }
    }
    const select = document.createElement('select')
    const option = document.createElement('option')
    select.append(option)
    fixture.append(select)
    surfaces['native-select'] = {
      background: getComputedStyle(select).backgroundColor,
      optionBackground: getComputedStyle(option).backgroundColor,
      border: getComputedStyle(select).borderColor,
      radius: getComputedStyle(select).borderRadius,
    }
    fixture.remove()
    return surfaces
  })()`)
  for (const [kind, surface] of Object.entries(dropdownSurfaceContracts || {})) {
    check(
      `${kind} dropdown uses the shared charcoal rounded surface`,
      surface.background === 'rgb(37, 37, 37)'
        && surface.radius === '6px'
        && surface.border === 'rgb(74, 74, 74)'
        && (kind === 'native-select'
          ? surface.optionBackground === surface.background
          : surface.shadow !== 'none'),
      JSON.stringify(surface),
    )
  }
  check(
    'worksheet canvas is not post-processed in dark mode',
    styles.canvas?.filter === 'none',
    styles.canvas?.filter,
  )
  check(
    'live cell editor preserves the selected authored white fill and black font',
    styles.cellEditor?.background === 'rgb(255, 255, 255)'
      && styles.cellEditor?.color === 'rgb(0, 0, 0)',
    JSON.stringify(styles.cellEditor),
  )
  check(
    'Excel chrome uses native Windows text hinting',
    styles.root?.fontSmoothing === 'auto'
      && styles.root?.textRendering === 'auto'
      && /Segoe UI/i.test(styles.root?.fontFamily ?? ''),
    JSON.stringify(styles.root),
  )

  const contextMenuDispatched = await evaluate(send, `(() => {
    const cellArea = document.querySelector('.fortune-cell-area')
    if (!cellArea) return false
    const rect = cellArea.getBoundingClientRect()
    cellArea.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: rect.left + Math.min(160, rect.width / 2),
      clientY: rect.top + Math.min(120, rect.height / 2),
    }))
    return true
  })()`)
  check('worksheet context-menu event dispatched', contextMenuDispatched)
  await waitFor(send, `Boolean(document.querySelector('.fortune-context-menu'))`)
  const contextMenuStyle = await evaluate(send, `(() => {
    const menu = getComputedStyle(document.querySelector('.fortune-context-menu'))
    const itemElement = document.querySelector('.fortune-context-menu .luckysheet-cols-menuitem-content')
      || document.querySelector('.fortune-context-menu .luckysheet-cols-menuitem')
    const item = getComputedStyle(itemElement)
    return {
      background: menu.backgroundColor,
      color: item.color,
      text: itemElement.textContent.trim(),
    }
  })()`)
  check('worksheet context menu uses pure black', contextMenuStyle.background === 'rgb(0, 0, 0)', JSON.stringify(contextMenuStyle))
  check('worksheet context menu has readable light text', contextMenuStyle.color === 'rgb(245, 245, 245)', JSON.stringify(contextMenuStyle))

  await evaluate(send, `(() => {
    const firstItem = document.querySelector('.fortune-context-menu .luckysheet-cols-menuitem')
    firstItem?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    return true
  })()`)
  await waitFor(send, `!document.querySelector('.fortune-context-menu')`)
  await evaluate(send, `(() => {
    const buttons = [...document.querySelectorAll('.fortune-toolbar-combo-button')]
    const button = buttons.find((item) => /font|字体|字體/i.test(item.getAttribute('aria-label') || ''))
    button?.click()
    return true
  })()`)
  await waitFor(send, `Boolean(document.querySelector('.fortune-toolbar-combo-popup .fortune-toolbar-select-option'))`)

  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    clip: {
      x: Math.max(0, styles.rect.x),
      y: Math.max(0, styles.rect.y),
      width: styles.rect.width,
      height: styles.rect.height,
      scale: 1,
    },
  })
  const pngBuffer = Buffer.from(screenshot.result.data, 'base64')
  fs.writeFileSync(screenshotPath, pngBuffer)
  const pixels = await inspectPixels(pngBuffer, styles.cellArea, styles.rect)
  check('Excel screenshot is nonblank', pixels.colorBuckets > 20, JSON.stringify(pixels))
  check('worksheet and chrome use a true dark surface', pixels.nearBlackRatio > 0.75, JSON.stringify(pixels))
  check('dark mode does not fall back to a white worksheet', pixels.nearWhiteRatio < 0.1, JSON.stringify(pixels))
  check('authored white cell remains white with black text', pixels.cellRegions.plain.white > 700 && pixels.cellRegions.plain.black > 10, JSON.stringify(pixels.cellRegions.plain))
  check('authored red font remains red on white', pixels.cellRegions.red.white > 700 && pixels.cellRegions.red.red > 10, JSON.stringify(pixels.cellRegions.red))
  check('authored blue font remains blue on white', pixels.cellRegions.blue.white > 700 && pixels.cellRegions.blue.blue > 10, JSON.stringify(pixels.cellRegions.blue))
  check('authored green fill remains green with white text', pixels.cellRegions.green.green > 700 && pixels.cellRegions.green.white > 10, JSON.stringify(pixels.cellRegions.green))
  check('authored yellow fill remains yellow with black text', pixels.cellRegions.yellow.yellow > 700 && pixels.cellRegions.yellow.black > 10, JSON.stringify(pixels.cellRegions.yellow))
  check('authored gray fill and gray font remain unchanged', pixels.cellRegions.gray.grayFill > 700 && pixels.cellRegions.gray.grayText > 5, JSON.stringify(pixels.cellRegions.gray))
  for (const name of [
    'digits',
    'decimal',
    'percent',
    'digitsArial',
    'decimalArial',
    'percentArial',
  ]) {
    const region = pixels.cellRegions[name]
    check(`${name} keeps the black default fill and authored dark-gray font`, region.black > 500 && region.darkGrayText > 2, JSON.stringify(region))
  }
  console.log(`[PASS] screenshot saved: ${screenshotPath}`)

  const fontColorSwatch = '#00f00f'
  const fontColorPick = await evaluate(send, `(async () => {
    const cellArea = document.querySelector('.fortune-cell-area')
    if (!cellArea) return { clicked: false, reason: 'cell area missing' }
    const cellRect = cellArea.getBoundingClientRect()
    const point = {
      clientX: cellRect.left + 16,
      clientY: cellRect.top + 19 * 6 + 8,
    }
    cellArea.dispatchEvent(new MouseEvent('mousedown', {
      ...point,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
    }))
    cellArea.dispatchEvent(new MouseEvent('mouseup', {
      ...point,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 0,
    }))
    cellArea.dispatchEvent(new MouseEvent('click', {
      ...point,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 0,
    }))
    await new Promise((resolve) => setTimeout(resolve, 100))
    cellArea.dispatchEvent(new MouseEvent('dblclick', {
      ...point,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 0,
    }))
    await new Promise((resolve) => setTimeout(resolve, 100))
    const editorBeforePick = document.querySelector('.luckysheet-input-box-inner')
    const editingBeforePick = editorBeforePick?.closest('#luckysheet-input-box')
      ? getComputedStyle(editorBeforePick.closest('#luckysheet-input-box')).display !== 'none'
      : false

    const buttons = [...document.querySelectorAll('.fortune-toolbar-combo-button')]
    const fontFamily = buttons.find((item) => /font|瀛椾綋|瀛楅珨/i.test(
      item.getAttribute('aria-label') || '',
    ) && !/size|瀛楀彿|瀛楄櫉|color|棰滆壊|椤忚壊/i.test(
      item.getAttribute('aria-label') || '',
    ))
    if (fontFamily?.closest('.fortune-toobar-combo-container')
      ?.querySelector('.fortune-toolbar-combo-popup')) {
      fontFamily.click()
    }

    const fontColor = buttons.find((item) => /font color|文本颜色|文字顏色|color texto|цвет текста/i.test(
      item.getAttribute('aria-label') || '',
    ))
    const arrow = fontColor?.closest('.fortune-toolbar-combo')
      ?.querySelector('.fortune-toolbar-combo-arrow')
    if (!arrow) {
      return {
        clicked: false,
        labels: buttons.map((item) => item.getAttribute('aria-label')),
      }
    }
    arrow.click()
    const deadline = Date.now() + 5000
    let swatch
    while (Date.now() < deadline) {
      swatch = [...document.querySelectorAll('.fortune-toolbar-color-picker-item')]
        .find((item) => item.style.backgroundColor === 'rgb(0, 240, 15)')
      if (swatch) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (!swatch) return { clicked: false, reason: 'font color swatch missing' }
    swatch.click()
    await new Promise((resolve) => setTimeout(resolve, 350))
    const editor = document.querySelector('.luckysheet-input-box-inner')
    return {
      clicked: true,
      selection: document.querySelector('.fortune-name-box')?.textContent?.trim() || '',
      editingBeforePick,
      editingAfterPick: editor?.closest('#luckysheet-input-box')
        ? getComputedStyle(editor.closest('#luckysheet-input-box')).display !== 'none'
        : false,
      editorForeground: editor?.dataset.excelCellForeground || '',
      editorColor: editor ? getComputedStyle(editor).color : '',
    }
  })()`, true)
  check('font-color palette swatch can be clicked', fontColorPick.clicked, JSON.stringify(fontColorPick))
  check('font-color palette test targets A7', fontColorPick.selection === 'A7', JSON.stringify(fontColorPick))
  check('font-color palette test starts with A7 in edit mode', fontColorPick.editingBeforePick, JSON.stringify(fontColorPick))
  check(
    'font-color palette swatch updates the active cell color model',
    fontColorPick.editorForeground.toLowerCase() === fontColorSwatch,
    JSON.stringify(fontColorPick),
  )

  const swatchPixels = await evaluate(send, `(() => {
    const canvas = document.querySelector('.fortune-sheet-canvas')
    const cellArea = document.querySelector('.fortune-cell-area')
    const context = canvas?.getContext('2d')
    if (!canvas || !cellArea || !context) return null
    const canvasRect = canvas.getBoundingClientRect()
    const cellRect = cellArea.getBoundingClientRect()
    const scaleX = canvas.width / canvasRect.width
    const scaleY = canvas.height / canvasRect.height
    const left = Math.floor((cellRect.left - canvasRect.left + 2) * scaleX)
    const top = Math.floor((cellRect.top - canvasRect.top + 19 * 6 + 2) * scaleY)
    const width = Math.max(1, Math.floor(68 * scaleX))
    const height = Math.max(1, Math.floor(15 * scaleY))
    const pixels = context.getImageData(left, top, width, height).data
    let pickerGreen = 0
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index]
      const green = pixels[index + 1]
      const blue = pixels[index + 2]
      if (Math.abs(red - 0) <= 18
        && Math.abs(green - 240) <= 18
        && Math.abs(blue - 15) <= 18) pickerGreen += 1
    }
    return { pickerGreen, samples: pixels.length / 4 }
  })()`)
  check(
    'font-color palette swatch repaints the selected cell text',
    swatchPixels?.pickerGreen > 10,
    JSON.stringify(swatchPixels),
  )

  const toggledToLight = await evaluate(send, `(() => {
    const button = document.querySelector('[data-testid="theme-toggle"]')
    if (!button) return false
    button.click()
    return true
  })()`)
  check('theme toggle found', toggledToLight)
  await waitFor(send, `!document.documentElement.classList.contains('dark')`)
  await sleep(300)

  const lightCanvasPixels = await evaluate(send, `(() => {
    const canvas = document.querySelector('.fortune-sheet-canvas')
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return null
    const left = Math.floor(canvas.width * 0.62)
    const top = Math.floor(canvas.height * 0.4)
    const width = Math.max(1, Math.floor(canvas.width * 0.12))
    const height = Math.max(1, Math.floor(canvas.height * 0.12))
    const pixels = context.getImageData(left, top, width, height).data
    let samples = 0
    let black = 0
    let white = 0
    for (let index = 0; index < pixels.length; index += 16) {
      const red = pixels[index]
      const green = pixels[index + 1]
      const blue = pixels[index + 2]
      if (pixels[index + 3] < 240) continue
      samples += 1
      if (red <= 24 && green <= 24 && blue <= 24) black += 1
      if (red >= 232 && green >= 232 && blue >= 232) white += 1
    }
    return {
      blackRatio: black / samples,
      whiteRatio: white / samples,
    }
  })()`)
  check(
    'light mode restores native white worksheet pixels',
    lightCanvasPixels?.whiteRatio > 0.8 && lightCanvasPixels?.blackRatio < 0.1,
    JSON.stringify(lightCanvasPixels),
  )

  await evaluate(send, `(() => {
    if (document.querySelector('.fortune-toolbar-combo-popup .fortune-toolbar-select-option')) return true
    const buttons = [...document.querySelectorAll('.fortune-toolbar-combo-button')]
    const button = buttons.find((item) => /font|字体|字體/i.test(item.getAttribute('aria-label') || ''))
      || buttons.find((item) => /Arial|Calibri|宋体|微软雅黑|Microsoft YaHei/i.test(item.textContent || ''))
    button?.click()
    return Boolean(button)
  })()`)
  await waitFor(send, `Boolean(document.querySelector('.fortune-toolbar-combo-popup .fortune-toolbar-select-option'))`)

  const lightStyles = await evaluate(send, `(() => {
    const read = (selector) => {
      const style = getComputedStyle(document.querySelector(selector))
      return { background: style.backgroundColor, color: style.color }
    }
    return {
      root: read('.fortune-container'),
      fontPicker: read('.fortune-toolbar-combo-popup .fortune-toolbar-select'),
      fontOption: read('.fortune-toolbar-combo-popup .fortune-toolbar-select-option'),
    }
  })()`)
  const lightOptionRgb = lightStyles.fontOption.color.match(/\d+/g)?.map(Number) ?? []
  check('light mode restores white Excel surface', lightStyles.root.background === 'rgb(255, 255, 255)', JSON.stringify(lightStyles.root))
  check('light mode restores white font picker', lightStyles.fontPicker.background === 'rgb(255, 255, 255)', JSON.stringify(lightStyles.fontPicker))
  check(
    'light mode font option remains readable',
    lightOptionRgb.length >= 3 && lightOptionRgb.slice(0, 3).every((channel) => channel < 100),
    JSON.stringify(lightStyles.fontOption),
  )
  const chineseSelectionProbe = sharedFontLibrary.menuFamilies
    .find((font) => font.menuName === '宋体')?.menuName || installedChineseFontNames[0]
  if (chineseSelectionProbe) {
    const chineseFontSelected = await evaluate(send, `(() => {
      const option = [...document.querySelectorAll(
        '.fortune-toolbar-combo-popup .fortune-toolbar-select-option',
      )].find((item) => item.textContent?.trim() === ${JSON.stringify(chineseSelectionProbe)})
      if (!option) return false
      option.click()
      return true
    })()`)
    check('Chinese font option can be selected', chineseFontSelected, chineseSelectionProbe)
    await waitFor(send, `(() => {
      const button = [...document.querySelectorAll('.fortune-toolbar-combo-button')]
        .find((item) => /font|字体|字體/i.test(item.getAttribute('aria-label') || ''))
      return button?.getAttribute('aria-label')?.includes(${JSON.stringify(chineseSelectionProbe)})
    })()`)
    const selectedChineseFont = await evaluate(send, `(() => {
      return [...document.querySelectorAll('.fortune-toolbar-combo-button')]
        .find((item) => /font|字体|字體/i.test(item.getAttribute('aria-label') || ''))
        ?.getAttribute('aria-label') || ''
    })()`)
    check(
      'Chinese font selection updates the Excel toolbar',
      selectedChineseFont.includes(chineseSelectionProbe),
      selectedChineseFont,
    )
  }

  const fontSearchOpened = await evaluate(send, `(() => {
    const input = document.querySelector('[data-testid="excel-font-search"]')
    if (input) return { opened: true }
    const button = [...document.querySelectorAll('.fortune-toolbar-combo-button')]
      .find((item) => /font|字体|字體/i.test(item.getAttribute('aria-label') || ''))
    if (!button) return { opened: false, reason: 'font button missing' }
    button.click()
    return { opened: true }
  })()`)
  check('font picker can be opened for typed search', fontSearchOpened.opened, JSON.stringify(fontSearchOpened))
  await waitFor(send, `Boolean(document.querySelector('[data-testid="excel-font-search"]'))`)

  const fontSearchLayout = await evaluate(send, `(() => {
    const input = document.querySelector('[data-testid="excel-font-search"]')
    const header = input?.closest('.excel-toolbar-picker-search')
    if (!(input instanceof HTMLInputElement) || !header) return null
    const inputRect = input.getBoundingClientRect()
    const headerRect = header.getBoundingClientRect()
    const style = getComputedStyle(input)
    return {
      fontSize: style.fontSize,
      overflow: style.overflowX,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      titleMatchesPlaceholder: input.title === input.placeholder,
      inputRect: {
        left: inputRect.left,
        top: inputRect.top,
        right: inputRect.right,
        bottom: inputRect.bottom,
      },
      headerRect: {
        left: headerRect.left,
        top: headerRect.top,
        right: headerRect.right,
        bottom: headerRect.bottom,
      },
    }
  })()`)
  check(
    'font-search placeholder is contained and uses the menu font size',
    fontSearchLayout?.fontSize === '12px'
      && ['auto', 'hidden', 'clip'].includes(fontSearchLayout.overflow)
      // Full localized placeholder is preferred (clip); ellipsis remains acceptable.
      && ['clip', 'ellipsis'].includes(fontSearchLayout.textOverflow)
      && fontSearchLayout.whiteSpace === 'nowrap'
      && fontSearchLayout.titleMatchesPlaceholder
      && fontSearchLayout.inputRect.left >= fontSearchLayout.headerRect.left - 0.5
      && fontSearchLayout.inputRect.top >= fontSearchLayout.headerRect.top - 0.5
      && fontSearchLayout.inputRect.right <= fontSearchLayout.headerRect.right + 0.5
      && fontSearchLayout.inputRect.bottom <= fontSearchLayout.headerRect.bottom + 0.5,
    JSON.stringify(fontSearchLayout),
  )

  const fontSearchProbe = chineseSelectionProbe || installedChineseFontNames[0] || 'Segoe UI'
  await evaluate(send, `(() => {
    const input = document.querySelector('[data-testid="excel-font-search"]')
    if (!input) return false
    input.value = ''
    input.focus()
    input.setSelectionRange(0, 0)
    return true
  })()`)
  await send('Input.insertText', { text: fontSearchProbe })
  await sleep(50)
  const fontSearchResults = await evaluate(send, `(() => {
    const input = document.querySelector('[data-testid="excel-font-search"]')
    if (!input) return null
    const style = getComputedStyle(input)
    const visible = [...document.querySelectorAll(
      '.fortune-toolbar-combo-popup .fortune-toolbar-select-option',
    )]
      .filter((option) => !option.hidden)
      .map((option) => option.textContent?.trim())
    return {
      value: input.value,
      visible,
      active: document.activeElement === input,
      color: style.color,
      textFillColor: style.webkitTextFillColor,
      backgroundColor: style.backgroundColor,
      opacity: style.opacity,
      visibility: style.visibility,
      display: style.display,
      lineHeight: style.lineHeight,
      overflowX: style.overflowX,
      textOverflow: style.textOverflow,
      clientWidth: input.clientWidth,
      scrollWidth: input.scrollWidth,
      scrollLeft: input.scrollLeft,
    }
  })()`)
  check(
    'typed font search filters the Excel picker',
    fontSearchResults?.visible?.includes(fontSearchProbe),
    JSON.stringify(fontSearchResults),
  )
  check(
    'typed font search text remains visible in the input',
    Boolean(fontSearchResults?.value)
      && fontSearchResults.active
      && fontSearchResults.color !== 'rgba(0, 0, 0, 0)'
      && fontSearchResults.textFillColor !== 'rgba(0, 0, 0, 0)'
      && fontSearchResults.opacity !== '0'
      && fontSearchResults.visibility !== 'hidden'
      && fontSearchResults.display !== 'none'
      && fontSearchResults.textOverflow === 'clip'
      && fontSearchResults.overflowX !== 'hidden'
      && Number(fontSearchResults.clientWidth) > 0
      && Number(fontSearchResults.scrollWidth) > 0,
    JSON.stringify(fontSearchResults),
  )

  await evaluate(send, `(() => {
    const input = document.querySelector('[data-testid="excel-font-search"]')
    input?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    return true
  })()`)
  await waitFor(send, `!document.querySelector('[data-testid="excel-font-search"]')`)
  await waitFor(send, `(() => {
    const button = [...document.querySelectorAll('.fortune-toolbar-combo-button')]
      .find((item) => /font|字体|字體/i.test(item.getAttribute('aria-label') || ''))
    return button?.getAttribute('aria-label')?.includes(${JSON.stringify(fontSearchProbe)})
  })()`)
  check('Enter applies the active typed font-search result', true, fontSearchProbe)

  const fontSizePicker = await evaluate(send, `(() => {
    const button = [...document.querySelectorAll('.fortune-toolbar-combo-button')]
      .find((item) => /font\\s*[- ]?\\s*size|字号|字號|字体大小|字體大小/i.test(
        item.getAttribute('aria-label') || '',
      ))
    if (!button) return { clicked: false }
    button.click()
    return { clicked: true, label: button.getAttribute('aria-label') }
  })()`)
  check('font-size control found', fontSizePicker.clicked, JSON.stringify(fontSizePicker))
  await waitFor(send, `Boolean(document.querySelector('[data-testid="excel-font-size-input"]'))`)

  const customFontSize = '13.5'
  await evaluate(send, `(() => {
    const input = document.querySelector('[data-testid="excel-font-size-input"]')
    if (!(input instanceof HTMLInputElement)) return false
    input.value = ''
    input.focus()
    input.setSelectionRange(0, 0)
    return true
  })()`)
  await send('Input.insertText', { text: customFontSize })
  await sleep(50)
  const fontSizeInputVisibility = await evaluate(send, `(() => {
    const input = document.querySelector('[data-testid="excel-font-size-input"]')
    if (!(input instanceof HTMLInputElement)) return null
    const style = getComputedStyle(input)
    return {
      value: input.value,
      active: document.activeElement === input,
      color: style.color,
      textFillColor: style.webkitTextFillColor,
      opacity: style.opacity,
      visibility: style.visibility,
      display: style.display,
      overflowX: style.overflowX,
      textOverflow: style.textOverflow,
      clientWidth: input.clientWidth,
      scrollWidth: input.scrollWidth,
    }
  })()`)
  check(
    'typed font size remains visible in the input',
    Boolean(fontSizeInputVisibility?.value)
      && fontSizeInputVisibility.active
      && fontSizeInputVisibility.color !== 'rgba(0, 0, 0, 0)'
      && fontSizeInputVisibility.textFillColor !== 'rgba(0, 0, 0, 0)'
      && fontSizeInputVisibility.opacity !== '0'
      && fontSizeInputVisibility.visibility !== 'hidden'
      && fontSizeInputVisibility.display !== 'none'
      && fontSizeInputVisibility.textOverflow === 'clip'
      && fontSizeInputVisibility.overflowX !== 'hidden'
      && Number(fontSizeInputVisibility.clientWidth) > 0
      && Number(fontSizeInputVisibility.scrollWidth) > 0,
    JSON.stringify(fontSizeInputVisibility),
  )

  await evaluate(send, `(() => {
    const input = document.querySelector('[data-testid="excel-font-size-input"]')
    if (!input) return false
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    return true
  })()`)
  await waitFor(send, `!document.querySelector('[data-testid="excel-font-size-input"]')`)
  await waitFor(send, `(() => {
    const button = [...document.querySelectorAll('.fortune-toolbar-combo-button')]
      .find((item) => /font\\s*[- ]?\\s*size|字号|字號|字体大小|字體大小/i.test(
        item.getAttribute('aria-label') || '',
      ))
    return button?.getAttribute('aria-label')?.includes(${JSON.stringify(customFontSize)})
  })()`)
  check('typed custom font size is applied', true, customFontSize)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  child?.kill()
  await sleep(500)
  try { fs.rmSync(samplePath, { force: true }) } catch {}
  try { fs.rmSync(profilePath, { recursive: true, force: true }) } catch {}
}
