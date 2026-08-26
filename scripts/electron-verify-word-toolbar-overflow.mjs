// Word 工具栏溢出策略验证：窄容器时左侧 UI（撤销/重做、缩放、字体、字号、
// 加粗斜体等）保留，右端项（标尺、格式标记、文档模式等）优先进「⋯」。
// 前置：npm run build；Node 22+。
import { createRequire } from 'node:module'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronPath = require('electron')
const JSZip = require('jszip')
const rendererEntry = path.join(root, 'out', 'renderer', 'index.html')
const artifactDir = path.join(root, '.cache')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close((error) => {
        if (error) reject(error)
        else if (port) resolve(port)
        else reject(new Error('Could not allocate a CDP port'))
      })
    })
  })
}

async function waitForRenderer(port, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find(
        (target) =>
          target.type === 'page' &&
          (String(target.url).includes('out/renderer') ||
            String(target.url).includes('index.html')),
      )
      if (page?.webSocketDebuggerUrl) return page
    } catch (error) {
      lastError = error
    }
    await sleep(200)
  }
  throw new Error(`Renderer CDP target did not appear: ${String(lastError ?? 'timeout')}`)
}

function connectCdp(wsUrl, onEvent) {
  if (!globalThis.WebSocket) {
    throw new Error('This verifier requires Node 22+ (global WebSocket support)')
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1
    let opened = false

    const send = (method, params = {}) =>
      new Promise((resolveCall, rejectCall) => {
        if (ws.readyState !== WebSocket.OPEN) {
          rejectCall(new Error(`CDP socket is not open for ${method}`))
          return
        }
        const id = nextId++
        const timer = setTimeout(() => {
          pending.delete(id)
          rejectCall(new Error(`CDP command timed out: ${method}`))
        }, 20_000)
        pending.set(id, {
          resolve: (message) => {
            clearTimeout(timer)
            if (message.error) {
              rejectCall(new Error(`${method}: ${message.error.message}`))
            } else {
              resolveCall(message)
            }
          },
        })
        ws.send(JSON.stringify({ id, method, params }))
      })

    ws.addEventListener('open', () => {
      opened = true
      resolve({ send, close: () => ws.close() })
    })
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id)
        pending.delete(message.id)
        entry.resolve(message)
      } else if (message.method) {
        onEvent(message)
      }
    })
    ws.addEventListener('error', (event) => {
      if (!opened) reject(new Error(`CDP WebSocket error: ${String(event.message ?? event)}`))
    })
    ws.addEventListener('close', () => {
      for (const entry of pending.values()) {
        entry.resolve({ error: { message: 'CDP socket closed' } })
      }
      pending.clear()
    })
  })
}

function describeException(exceptionDetails) {
  return (
    exceptionDetails?.exception?.description ||
    exceptionDetails?.text ||
    JSON.stringify(exceptionDetails)
  )
}

async function evaluate(send, expression) {
  const message = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (message.result.exceptionDetails) {
    throw new Error(describeException(message.result.exceptionDetails))
  }
  return message.result.result?.value
}

async function waitFor(send, expression, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let lastValue
  while (Date.now() < deadline) {
    lastValue = await evaluate(send, expression)
    if (lastValue) return lastValue
    await sleep(150)
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`)
}

const results = []
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail })
  const marker = pass ? 'PASS' : 'FAIL'
  console.log(`[${marker}] ${name}${detail ? `: ${detail}` : ''}`)
}

async function buildDocxFixture(filePath) {
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  const wNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const documentXml =
    `${xmlHeader}<w:document xmlns:w="${wNs}"><w:body>` +
    '<w:p><w:r><w:t>TOOLBAR OVERFLOW FIXTURE — the quick brown fox.</w:t></w:r></w:p>' +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>'
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  )
  zip.file('word/document.xml', documentXml)
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  fs.writeFileSync(filePath, buffer)
}

/** 读取 SuperToolbar 实例状态（经 Vue app 全局属性） */
const TOOLBAR_STATE = `(() => {
  const container = document.querySelector('.superdoc-toolbar-container') || document.querySelector('.superdoc-toolbar')
  if (!container) return null
  let app = null
  let host = container
  while (host) {
    if (host.__vue_app__) { app = host.__vue_app__; break }
    host = host.parentElement
  }
  if (!app) {
    for (const el of container.querySelectorAll('*')) { if (el.__vue_app__) { app = el.__vue_app__; break } }
  }
  const tb = app?.config?.globalProperties?.$toolbar
  if (!tb) return null
  const names = (items) => (items || []).map((i) => i.name?.value).filter(Boolean)
  const row = container.querySelector('.superdoc-toolbar')
  const visibleItems = (tb.toolbarItems || []).map((item) => ({
    name: item.name?.value || '',
    group: item.group?.value || 'center',
  }))
  const itemRects = []
  for (const group of row?.querySelectorAll(':scope > [data-toolbar-position]') || []) {
    const position = group.getAttribute('data-toolbar-position') || 'center'
    const groupItems = visibleItems.filter((item) => item.group === position)
    const children = Array.from(group.querySelectorAll(':scope > .sd-toolbar-item-ctn'))
    children.forEach((element, index) => {
      const rect = element.getBoundingClientRect()
      itemRects.push({
        name: groupItems[index]?.name || '',
        group: position,
        domItem: element.querySelector('[data-item]')?.getAttribute('data-item') || '',
        left: Math.round(rect.left * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
      })
    })
  }
  const overflowRect = itemRects.find((item) => item.name === 'overflow')
  const lastBeforeOverflow = overflowRect
    ? itemRects
        .filter((item) => item.name !== 'overflow' && item.right <= overflowRect.left + 0.5)
        .sort((a, b) => b.right - a.right)[0]
    : null
  return {
    width: tb.getAvailableWidth(),
    visible: names(tb.toolbarItems),
    overflow: names(tb.overflowItems),
    rowScrollWidth: row ? row.scrollWidth : null,
    rowClientWidth: row ? row.clientWidth : null,
    itemRects,
    domOrder: itemRects
      .filter((item) => item.name && item.name !== 'overflow' && item.width > 0)
      .sort((a, b) => a.left - b.left)
      .map((item) => item.name),
    rightGapBeforeOverflow: overflowRect && lastBeforeOverflow
      ? Math.round((overflowRect.left - lastBeforeOverflow.right) * 10) / 10
      : null,
  }
})()`

/** 视觉顺序（与 word-toolbar-overflow.ts 的 VISUAL_ORDER 一致） */
const VISUAL_ORDER = [
  'undo', 'redo', 'acceptTrackedChangeBySelection', 'rejectTrackedChangeOnSelection',
  'zoom', 'fontFamily', 'fontSize', 'bold', 'italic', 'underline', 'strike',
  'color', 'highlight', 'link', 'image', 'table', 'tableActions', 'textAlign',
  'list', 'numberedlist', 'indentleft', 'indentright', 'lineHeight',
  'linkedStyles', 'ruler', 'formattingMarks', 'copyFormat', 'clearFormatting', 'documentMode',
]
const orderIndex = (name) => {
  const idx = VISUAL_ORDER.indexOf(name)
  return idx === -1 ? VISUAL_ORDER.length : idx
}

/** 溢出集必须是视觉顺序的「后缀」：任一可见项（除 overflow 控件）都排在所有溢出项之前 */
function isSuffixPartition(state) {
  const visibleIdx = state.visible.filter((n) => n !== 'overflow').map(orderIndex)
  const overflowIdx = state.overflow.map(orderIndex)
  if (!overflowIdx.length) return true
  const maxVisible = Math.max(...visibleIdx)
  const minOverflow = Math.min(...overflowIdx)
  return maxVisible < minOverflow
}

function visibleNames(state) {
  return state.visible.filter((name) => name !== 'overflow')
}

function isDomOrderCorrect(state) {
  return JSON.stringify(state.domOrder) === JSON.stringify(visibleNames(state))
}

function maximalFill(state, widthByName) {
  const next = state.overflow[0]
  if (!next) return { pass: true, detail: 'all items visible' }
  const nextWidth = widthByName.get(next)
  const gap = state.rightGapBeforeOverflow
  return {
    pass: Number.isFinite(gap) && Number.isFinite(nextWidth) && gap + 0.75 < nextWidth,
    detail: `gap=${gap}px next=${next}(${nextWidth}px)`,
  }
}

async function setWidthAndSettle(send, width) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: 900, deviceScaleFactor: 0, mobile: false,
  })
  // 组件的 onWindowResized 节流 300ms，再等一拍渲染
  await sleep(900)
  return waitFor(send, TOOLBAR_STATE, `toolbar state at window width ${width}`, 10_000)
}

async function setPanelWidthsAndSettle(send, leftWidth, rightWidth) {
  const panelState = await evaluate(send, `(() => {
    const left = document.querySelector('[data-panel="file-manager"]')
    const right = document.querySelector('[data-panel="agent-assistant"]')
    if (!left || !right) return null
    const previous = { left: left.style.width, right: right.style.width }
    if (${JSON.stringify(leftWidth)} !== null) left.style.width = ${JSON.stringify(leftWidth)}
    if (${JSON.stringify(rightWidth)} !== null) right.style.width = ${JSON.stringify(rightWidth)}
    return previous
  })()`)
  if (!panelState) throw new Error('Resizable side panels were not found')
  // WordEditor has its own container observer and should update before SuperDoc's 300ms throttle.
  await sleep(180)
  const state = await evaluate(send, TOOLBAR_STATE)
  if (!state) throw new Error('Toolbar state disappeared after resizing side panels')
  return { panelState, state }
}

async function dragPanelDivider(send, side, delta, steps = 72) {
  const startState = await evaluate(send, TOOLBAR_STATE)
  const handle = await evaluate(send, `(() => {
    const handles = Array.from(document.querySelectorAll('[role="separator"][aria-orientation="vertical"]'))
    const handle = handles[${JSON.stringify(side)} === 'left' ? 0 : handles.length - 1]
    const panelLayout = document.querySelector('[data-panel="document-editor"]')?.parentElement
    if (!handle || !panelLayout) return null

    const metrics = {
      markerStarts: 0,
      markerEnds: 0,
      pageQueriesDuring: 0,
      pageQueriesAfter: 0,
      pageRectsDuring: 0,
      toolbarEmitsDuring: 0,
      frames: 0,
      maxFrameGap: 0,
      sawStart: false,
      toolbarHooked: false,
    }
    const isDragging = () => panelLayout.getAttribute('data-panel-resizing') === 'true'
    const originalQuerySelectorAll = Element.prototype.querySelectorAll
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect

    Element.prototype.querySelectorAll = function(selector) {
      if (selector === '.superdoc-page[data-page-index]') {
        if (isDragging()) metrics.pageQueriesDuring += 1
        else if (metrics.sawStart) metrics.pageQueriesAfter += 1
      }
      return originalQuerySelectorAll.call(this, selector)
    }
    Element.prototype.getBoundingClientRect = function() {
      if (isDragging() && this instanceof Element && this.matches('.superdoc-page')) {
        metrics.pageRectsDuring += 1
      }
      return originalGetBoundingClientRect.call(this)
    }

    let app = null
    let toolbarHost = document.querySelector('.superdoc-toolbar-container')
    while (toolbarHost) {
      if (toolbarHost.__vue_app__) { app = toolbarHost.__vue_app__; break }
      toolbarHost = toolbarHost.parentElement
    }
    if (!app) {
      const container = document.querySelector('.superdoc-toolbar-container')
      for (const el of container?.querySelectorAll('*') || []) {
        if (el.__vue_app__) { app = el.__vue_app__; break }
      }
    }
    const toolbar = app?.config?.globalProperties?.$toolbar ?? null
    const originalEmit = toolbar?.emit
    if (toolbar && typeof originalEmit === 'function') {
      metrics.toolbarHooked = true
      toolbar.emit = function(event, ...args) {
        if (isDragging() && event === 'toolbar-items-changed') metrics.toolbarEmitsDuring += 1
        return originalEmit.call(this, event, ...args)
      }
    }

    const markerObserver = new MutationObserver(() => {
      if (isDragging()) {
        metrics.markerStarts += 1
        metrics.sawStart = true
      } else if (metrics.sawStart) {
        metrics.markerEnds += 1
      }
    })
    markerObserver.observe(panelLayout, {
      attributes: true,
      attributeFilter: ['data-panel-resizing'],
    })

    let frameId = 0
    let lastFrame = null
    const monitorFrame = (now) => {
      if (isDragging()) {
        metrics.frames += 1
        if (lastFrame !== null) metrics.maxFrameGap = Math.max(metrics.maxFrameGap, now - lastFrame)
        lastFrame = now
      } else {
        lastFrame = null
      }
      frameId = requestAnimationFrame(monitorFrame)
    }
    frameId = requestAnimationFrame(monitorFrame)

    window.__finishWordPanelDragProbe = () => {
      cancelAnimationFrame(frameId)
      markerObserver.disconnect()
      Element.prototype.querySelectorAll = originalQuerySelectorAll
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
      if (toolbar && typeof originalEmit === 'function') toolbar.emit = originalEmit
      delete window.__finishWordPanelDragProbe
      return metrics
    }

    const rect = handle.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  if (!handle) throw new Error(`${side} resize handle was not found`)

  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: handle.x, y: handle.y, button: 'none', pointerType: 'mouse',
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', buttons: 1,
    clickCount: 1, pointerType: 'mouse',
  })
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: handle.x + delta * (i / steps),
      y: handle.y,
      button: 'left',
      buttons: 1,
      pointerType: 'mouse',
    })
    await sleep(4)
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: handle.x + delta, y: handle.y, button: 'left', buttons: 0,
    clickCount: 1, pointerType: 'mouse',
  })
  await sleep(250)

  const metrics = await evaluate(send, `window.__finishWordPanelDragProbe?.()`)
  const endState = await evaluate(send, TOOLBAR_STATE)
  if (!metrics || !endState) throw new Error(`Could not collect ${side} drag metrics`)
  return { startState, endState, metrics, steps }
}

if (!fs.existsSync(rendererEntry)) {
  console.error('Built renderer is missing. Run `npm run build` before this verifier.')
  process.exit(1)
}

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-word-toolbar-verify-'))
const fixturePath = path.join(fixtureDir, 'word-toolbar-verification.docx')
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-word-toolbar-profile-'))
await buildDocxFixture(fixturePath)

const rendererExceptions = []
const rendererConsoleErrors = []
let child = null
let cdp = null

try {
  const port = await getFreePort()
  child = spawn(
    electronPath,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, root],
    {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
        WPS_ALLOW_MULTI_INSTANCE: '1',
        WPS_BRIDGE_PORT: process.env.WPS_BRIDGE_PORT || String(port + 4000),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  child.stdout.on('data', (chunk) => process.stdout.write(`[electron] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[electron] ${chunk}`))

  const page = await waitForRenderer(port)
  cdp = await connectCdp(page.webSocketDebuggerUrl, (message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      rendererExceptions.push(describeException(message.params.exceptionDetails))
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      rendererConsoleErrors.push(
        (message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' '),
      )
    }
  })
  const { send } = cdp
  await send('Runtime.enable')
  await send('Console.enable')
  await send('Page.enable')

  await send('Emulation.setDeviceMetricsOverride', {
    width: 1900, height: 900, deviceScaleFactor: 0, mobile: false,
  })

  await waitFor(
    send,
    `document.getElementById('root')?.childElementCount > 0`,
    'the React application to render',
  )

  const openResult = await evaluate(
    send,
    `(async () => {
      const filePath = ${JSON.stringify(fixturePath)};
      await window.api.file.open(filePath);
      const root = document.getElementById('root');
      const rootKeys = root ? Object.keys(root) : [];
      const key = rootKeys.find(
        (name) => name.startsWith('__reactContainer') || name.startsWith('__reactFiber'),
      );
      const container = key ? root[key] : null;
      const queue = container ? [
        container.current,
        container.stateNode?.current,
        container._internalRoot?.current,
        container,
      ].filter(Boolean) : [];
      const seen = new Set();
      while (queue.length) {
        const fiber = queue.shift();
        if (!fiber || seen.has(fiber)) continue;
        seen.add(fiber);
        const props = fiber.memoizedProps;
        if (props && typeof props.onOpenFile === 'function') {
          await props.onOpenFile(filePath);
          return { opened: true };
        }
        if (fiber.child) queue.push(fiber.child);
        if (fiber.sibling) queue.push(fiber.sibling);
      }
      return { opened: false, reason: 'onOpenFile callback not found', visited: seen.size };
    })()`,
  )
  check('fixture opened through the production FileManager path', openResult?.opened,
    openResult?.opened ? '' : JSON.stringify(openResult))

  await waitFor(
    send,
    `document.querySelectorAll('.superdoc-page').length >= 1`,
    'SuperDoc layout-engine pages to paint',
    60_000,
  )
  await sleep(1500)

  const full = await setWidthAndSettle(send, 2600)
  const widthByName = new Map(full.itemRects.map((item) => [item.name, item.width]))
  check('full: every configured item is visible and the ellipsis is empty',
    full.overflow.length === 0 && VISUAL_ORDER.every((name) => full.visible.includes(name)),
    `visible=${visibleNames(full).length} overflow=${full.overflow.length}`)
  check('full: DOM follows the same left-to-right order as the overflow menu',
    isDomOrderCorrect(full),
    `dom=[${full.domOrder.join(',')}]`)

  // 1) 宽窗（容器 ~1300px）：字体字号可见；溢出（若有）只含右端后缀项
  const wide = await setWidthAndSettle(send, 1900)
  check('wide: fontFamily/fontSize/zoom visible',
    ['fontFamily', 'fontSize', 'zoom'].every((n) => wide.visible.includes(n)),
    `visible=[${wide.visible.join(',')}]`)
  check('wide: overflow is a right-end suffix of the visual order', isSuffixPartition(wide),
    `overflow=[${wide.overflow.join(',')}]`)
  check('wide: visible DOM order matches the menu order', isDomOrderCorrect(wide), '')
  const wideFill = maximalFill(wide, widthByName)
  check('wide: no room remains for the next ellipsis item', wideFill.pass, wideFill.detail)
  check('wide: toolbar row does not clip horizontally',
    wide.rowScrollWidth <= wide.rowClientWidth + 2,
    `scroll=${wide.rowScrollWidth} client=${wide.rowClientWidth}`)

  // Directly change both panel widths: this is the same width path used while dragging the two dividers.
  const tightenedPanels = await setPanelWidthsAndSettle(send, '500px', '500px')
  const tightened = tightenedPanels.state
  check('panels: widening both sidebars immediately reduces visible toolbar items',
    tightened.width < wide.width && visibleNames(tightened).length < visibleNames(wide).length,
    `toolbar=${wide.width}->${tightened.width}, visible=${visibleNames(wide).length}->${visibleNames(tightened).length}`)
  const tightenedFill = maximalFill(tightened, widthByName)
  check('panels: tightened toolbar remains maximally filled', tightenedFill.pass, tightenedFill.detail)

  const expandedPanels = await setPanelWidthsAndSettle(send, '180px', '220px')
  const expanded = expandedPanels.state
  check('panels: narrowing both sidebars refills items from the ellipsis head',
    expanded.width > tightened.width
      && visibleNames(expanded).length > visibleNames(tightened).length
      && isSuffixPartition(expanded),
    `toolbar=${tightened.width}->${expanded.width}, visible=${visibleNames(tightened).length}->${visibleNames(expanded).length}`)
  check('panels: refilled DOM order still matches the menu order', isDomOrderCorrect(expanded), '')

  const restoredPanels = await setPanelWidthsAndSettle(
    send,
    tightenedPanels.panelState.left,
    tightenedPanels.panelState.right,
  )
  const restored = restoredPanels.state
  check('panels: restoring sidebar widths restores the same partition',
    JSON.stringify(restored.visible) === JSON.stringify(wide.visible)
      && JSON.stringify(restored.overflow) === JSON.stringify(wide.overflow),
    `visible=${visibleNames(restored).length}`)

  // Real divider drags: many pointer moves must not cause a full page scan or
  // a Vue toolbar redraw on every frame. One trailing page refresh realigns the
  // invisible page-gap hit areas after mouseup.
  const leftDrag = await dragPanelDivider(send, 'left', 320)
  const leftVisibleDelta = Math.abs(
    visibleNames(leftDrag.endState).length - visibleNames(leftDrag.startState).length,
  )
  check('drag: left divider updates the toolbar while the pointer is moving',
    leftVisibleDelta > 0 && isSuffixPartition(leftDrag.endState),
    `visible delta=${leftVisibleDelta}`)
  check('drag: page-gap geometry is not rescanned during left-panel movement',
    leftDrag.metrics.pageQueriesDuring === 0 && leftDrag.metrics.pageRectsDuring === 0,
    `queries=${leftDrag.metrics.pageQueriesDuring} rects=${leftDrag.metrics.pageRectsDuring}`)
  check('drag: toolbar redraws only when an item crosses the overflow boundary',
    leftDrag.metrics.toolbarHooked && leftDrag.metrics.toolbarEmitsDuring <= leftVisibleDelta + 2,
    `moves=${leftDrag.steps} emits=${leftDrag.metrics.toolbarEmitsDuring} item delta=${leftVisibleDelta}`)
  check('drag: release performs a bounded trailing page-gap refresh',
    leftDrag.metrics.pageQueriesAfter >= 1 && leftDrag.metrics.pageQueriesAfter <= 4,
    `post-release queries=${leftDrag.metrics.pageQueriesAfter}`)
  check('drag: left resize marker and animation frames complete normally',
    leftDrag.metrics.markerStarts === 1
      && leftDrag.metrics.markerEnds === 1
      && leftDrag.metrics.frames >= 8
      && leftDrag.metrics.maxFrameGap < 80,
    `markers=${leftDrag.metrics.markerStarts}/${leftDrag.metrics.markerEnds} frames=${leftDrag.metrics.frames} maxGap=${leftDrag.metrics.maxFrameGap.toFixed(1)}ms`)

  const rightDrag = await dragPanelDivider(send, 'right', -220)
  const rightVisibleDelta = Math.abs(
    visibleNames(rightDrag.endState).length - visibleNames(rightDrag.startState).length,
  )
  check('drag: right divider also avoids per-frame page scans',
    rightVisibleDelta > 0
      && rightDrag.metrics.pageQueriesDuring === 0
      && rightDrag.metrics.pageRectsDuring === 0,
    `visible delta=${rightVisibleDelta} queries=${rightDrag.metrics.pageQueriesDuring}`)
  check('drag: right divider keeps frame delivery responsive',
    rightDrag.metrics.frames >= 8 && rightDrag.metrics.maxFrameGap < 80,
    `frames=${rightDrag.metrics.frames} maxGap=${rightDrag.metrics.maxFrameGap.toFixed(1)}ms`)

  await dragPanelDivider(send, 'right', 220)
  const dragRestored = await dragPanelDivider(send, 'left', -320)
  check('drag: moving both dividers back restores the original toolbar partition',
    JSON.stringify(dragRestored.endState.visible) === JSON.stringify(wide.visible)
      && JSON.stringify(dragRestored.endState.overflow) === JSON.stringify(wide.overflow),
    `visible=${visibleNames(dragRestored.endState).length}`)

  // 2) 中窗（容器 ~860px）：字体字号仍可见；标尺/格式标记/文档模式等右端项进「⋯」
  const mid = await setWidthAndSettle(send, 1450)
  check('mid: fontFamily/fontSize still visible (SuperDoc default would keep them but hide right tail)',
    ['fontFamily', 'fontSize'].every((n) => mid.visible.includes(n)),
    `visible=[${mid.visible.join(',')}]`)
  check('mid: right-end items collapsed into the ellipsis',
    ['ruler', 'formattingMarks', 'copyFormat', 'clearFormatting', 'documentMode'].every((n) =>
      mid.overflow.includes(n)),
    `overflow=[${mid.overflow.join(',')}]`)
  check('mid: overflow is a right-end suffix of the visual order', isSuffixPartition(mid),
    '')
  check('mid: visible DOM order matches the menu order', isDomOrderCorrect(mid), '')
  const midFill = maximalFill(mid, widthByName)
  check('mid: no room remains for the next ellipsis item', midFill.pass, midFill.detail)
  check('mid: toolbar row does not clip horizontally',
    mid.rowScrollWidth <= mid.rowClientWidth + 2,
    `scroll=${mid.rowScrollWidth} client=${mid.rowClientWidth}`)

  // 3) 窄窗（容器 ~560px）：核心验收——字体字号保留（SuperDoc 默认在此宽度强制隐藏），
  //    右端项全部在「⋯」里，左端 undo/redo/zoom 全可见
  const narrow = await setWidthAndSettle(send, 1150)
  check('narrow: fontFamily/fontSize REMAIN visible (the user-reported bug)',
    ['fontFamily', 'fontSize'].every((n) => narrow.visible.includes(n)),
    `visible=[${narrow.visible.join(',')}]`)
  check('narrow: undo/redo/zoom remain visible',
    ['undo', 'redo', 'zoom'].every((n) => narrow.visible.includes(n)),
    '')
  check('narrow: right-end items are in the ellipsis',
    ['ruler', 'formattingMarks', 'documentMode', 'clearFormatting', 'copyFormat'].every((n) =>
      narrow.overflow.includes(n)),
    `overflow=[${narrow.overflow.join(',')}]`)
  check('narrow: overflow is a right-end suffix of the visual order', isSuffixPartition(narrow), '')
  check('narrow: visible DOM order matches the menu order', isDomOrderCorrect(narrow), '')
  const narrowFill = maximalFill(narrow, widthByName)
  check('narrow: no room remains for the next ellipsis item', narrowFill.pass, narrowFill.detail)
  check('narrow: toolbar row does not clip horizontally',
    narrow.rowScrollWidth <= narrow.rowClientWidth + 2,
    `scroll=${narrow.rowScrollWidth} client=${narrow.rowClientWidth}`)

  await fs.promises.mkdir(artifactDir, { recursive: true })
  const narrowShot = await send('Page.captureScreenshot', { format: 'png' })
  await fs.promises.writeFile(
    path.join(artifactDir, 'electron-verify-word-toolbar-narrow.png'),
    Buffer.from(narrowShot.result.data, 'base64'),
  )

  // 4) 打开「⋯」菜单：溢出项（含 documentMode）真实渲染且可命中
  const overflowBtn = await evaluate(
    send,
    `(() => {
      const el = document.querySelector('[data-item="btn-overflow"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`,
  )
  check('narrow: ellipsis button present', Boolean(overflowBtn), '')
  if (overflowBtn) {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: overflowBtn.x, y: overflowBtn.y, button: 'left', clickCount: 1, pointerType: 'mouse',
    })
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: overflowBtn.x, y: overflowBtn.y, button: 'left', clickCount: 1, pointerType: 'mouse',
    })
    const menuState = await waitFor(
      send,
      `(() => {
        const menu = document.querySelector('.overflow-menu_items')
        if (!menu) return null
        const r = menu.getBoundingClientRect()
        if (!r.width || !r.height) return null
        const buttons = menu.querySelectorAll('[data-item]').length
        return { buttons, width: Math.round(r.width) }
      })()`,
      'overflow menu to open with items',
      8_000,
    )
    check('narrow: overflow menu opens and renders the collapsed items',
      menuState && menuState.buttons >= 5,
      menuState ? `buttons=${menuState.buttons} width=${menuState.width}` : 'menu not visible')
    const menuShot = await send('Page.captureScreenshot', { format: 'png' })
    await fs.promises.writeFile(
      path.join(artifactDir, 'electron-verify-word-toolbar-overflow-menu.png'),
      Buffer.from(menuShot.result.data, 'base64'),
    )
  }

  // 5) 无相关渲染进程错误
  const relevant = /toolbar|overflow|WordEditor|word-toolbar/i
  const badExceptions = rendererExceptions.filter((text) => relevant.test(text))
  const badErrors = rendererConsoleErrors.filter((text) => relevant.test(text))
  check('no toolbar-related renderer errors', badExceptions.length === 0 && badErrors.length === 0,
    badExceptions.concat(badErrors).slice(0, 3).join(' | ') || '')
} catch (error) {
  check('verifier completed without harness errors', false, String(error?.stack ?? error))
} finally {
  try {
    cdp?.close()
  } catch {}
  try {
    child?.kill()
  } catch {}
  await sleep(400)
  try {
    fs.rmSync(fixtureDir, { recursive: true, force: true })
  } catch {}
  try {
    fs.rmSync(profileDir, { recursive: true, force: true })
  } catch {}
}

const failed = results.filter((entry) => !entry.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (rendererConsoleErrors.length) {
  console.log('\nRenderer console errors (up to 10):')
  for (const line of rendererConsoleErrors.slice(0, 10)) console.log(`  - ${line}`)
}
process.exit(failed.length ? 1 : 0)
