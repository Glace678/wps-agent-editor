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
  return {
    width: tb.getAvailableWidth(),
    visible: names(tb.toolbarItems),
    overflow: names(tb.overflowItems),
    rowScrollWidth: row ? row.scrollWidth : null,
    rowClientWidth: row ? row.clientWidth : null,
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

async function setWidthAndSettle(send, width) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: 900, deviceScaleFactor: 0, mobile: false,
  })
  // 组件的 onWindowResized 节流 300ms，再等一拍渲染
  await sleep(900)
  return waitFor(send, TOOLBAR_STATE, `toolbar state at window width ${width}`, 10_000)
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

  // 1) 宽窗（容器 ~1300px）：字体字号可见；溢出（若有）只含右端后缀项
  const wide = await setWidthAndSettle(send, 1900)
  check('wide: fontFamily/fontSize/zoom visible',
    ['fontFamily', 'fontSize', 'zoom'].every((n) => wide.visible.includes(n)),
    `visible=[${wide.visible.join(',')}]`)
  check('wide: overflow is a right-end suffix of the visual order', isSuffixPartition(wide),
    `overflow=[${wide.overflow.join(',')}]`)
  check('wide: toolbar row does not clip horizontally',
    wide.rowScrollWidth <= wide.rowClientWidth + 2,
    `scroll=${wide.rowScrollWidth} client=${wide.rowClientWidth}`)

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
