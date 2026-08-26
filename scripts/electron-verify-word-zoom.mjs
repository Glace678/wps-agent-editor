// Word 缩放 / 双页布局 / 标尺 / 缩放态编辑 的端到端验证。
// 前置：npm run build（需要 out/renderer）；Node 22+（全局 WebSocket）。
// 关键点：编辑命中测试必须走 CDP Input.dispatchMouseEvent（真实输入管线），
// 页内合成事件绕过浏览器命中检测，测不出缩放坐标错位这类 bug。
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
const screenshotPath = path.join(artifactDir, 'electron-verify-word-zoom.png')
const fontRaster80ScreenshotPath = path.join(artifactDir, 'electron-verify-word-font-raster-80.png')
const fontRaster90ScreenshotPath = path.join(artifactDir, 'electron-verify-word-font-raster-90.png')
const fontRasterTransition80ScreenshotPath = path.join(
  artifactDir,
  'electron-verify-word-font-raster-transition-80.png',
)
const fontRasterTransition90ScreenshotPath = path.join(
  artifactDir,
  'electron-verify-word-font-raster-transition-90.png',
)
const settleFrameScreenshotPath = path.join(artifactDir, 'electron-verify-word-zoom-settle-worst.jpg')
const layoutBoundaryScreenshotPath = path.join(
  artifactDir,
  'electron-verify-word-zoom-40-to-50-worst.jpg',
)
const statusBarScreenshotPath = path.join(artifactDir, 'electron-verify-word-status-bar.png')
const narrowStatusBarScreenshotPath = path.join(artifactDir, 'electron-verify-word-status-bar-narrow.png')

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

async function waitForRenderer(port, timeoutMs = 60_000) {
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

async function measurePaperRatios(send, frames, rect, viewport) {
  if (!frames.length || !rect) return null
  return evaluate(
    send,
    `(async () => {
      const encodedFrames = ${JSON.stringify(frames)}
      const sourceRect = ${JSON.stringify(rect)}
      const sourceViewport = ${JSON.stringify(viewport)}
      const ratios = []
      for (const encoded of encodedFrames) {
        const response = await fetch('data:image/jpeg;base64,' + encoded)
        const bitmap = await createImageBitmap(await response.blob())
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d', { willReadFrequently: true })
        context.drawImage(bitmap, 0, 0)
        const scaleX = bitmap.width / sourceViewport.width
        const scaleY = bitmap.height / sourceViewport.height
        const x = Math.max(0, Math.floor(sourceRect.left * scaleX))
        const y = Math.max(0, Math.floor(sourceRect.top * scaleY))
        const width = Math.max(1, Math.min(bitmap.width - x, Math.ceil(sourceRect.width * scaleX)))
        const height = Math.max(1, Math.min(bitmap.height - y, Math.ceil(sourceRect.height * scaleY)))
        const pixels = context.getImageData(x, y, width, height).data
        let paper = 0
        let sampled = 0
        for (let py = 0; py < height; py += 3) {
          for (let px = 0; px < width; px += 3) {
            const offset = (py * width + px) * 4
            const red = pixels[offset]
            const green = pixels[offset + 1]
            const blue = pixels[offset + 2]
            if (red >= 235 && green >= 235 && blue >= 235) paper += 1
            sampled += 1
          }
        }
        ratios.push(paper / sampled)
        bitmap.close()
      }
      return ratios
    })()`,
  )
}

async function measureTextRasterChroma(send, encodedPng) {
  return evaluate(
    send,
    `(async () => {
      const response = await fetch('data:image/png;base64,' + ${JSON.stringify(encodedPng)})
      const bitmap = await createImageBitmap(await response.blob())
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(bitmap, 0, 0)
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data
      let darkPixels = 0
      let chromaticPixels = 0
      let channelSpread = 0
      let ink = 0
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const red = pixels[offset]
        const green = pixels[offset + 1]
        const blue = pixels[offset + 2]
        ink += 255 - (red + green + blue) / 3
        const darkest = Math.min(red, green, blue)
        if (darkest >= 245) continue
        const spread = Math.max(red, green, blue) - darkest
        darkPixels += 1
        channelSpread += spread
        if (spread >= 8) chromaticPixels += 1
      }
      const result = {
        width: bitmap.width,
        height: bitmap.height,
        darkPixels,
        chromaticPixels,
        chromaticRatio: darkPixels > 0 ? chromaticPixels / darkPixels : 1,
        meanChannelSpread: darkPixels > 0 ? channelSpread / darkPixels : 255,
        inkDensity: pixels.length > 0 ? ink / (pixels.length / 4 * 255) : 0,
      }
      bitmap.close()
      return result
    })()`,
  )
}

async function captureSimSunRaster(send, screenshotFile) {
  const geometry = await evaluate(
    send,
    `(() => {
      const sample = ${JSON.stringify(SIMSUN_RASTER_SAMPLE)}
      const scroller = document.querySelector('.presentation-editor__viewport')
        ?.closest('.super-editor-container')
        ?? document.querySelector('.superdoc__sub-document')
      if (scroller instanceof HTMLElement) scroller.scrollTop = 0
      const run = Array.from(document.querySelectorAll('.superdoc-text-run'))
        .find((element) => element.textContent?.includes(sample))
      const pages = document.querySelector('.presentation-editor__pages')
      if (!(run instanceof HTMLElement) || !(pages instanceof HTMLElement)) return null
      const frameCopy = document.querySelector('[data-word-zoom-frame-copy]')
      const rect = run.getBoundingClientRect()
      const runStyle = getComputedStyle(run)
      const pagesStyle = getComputedStyle(pages)
      const frameCopyStyle = frameCopy instanceof HTMLElement ? getComputedStyle(frameCopy) : null
      const frameHold = document.querySelector('[data-word-zoom-frame-hold]')
      return {
        rect: {
          x: Math.max(0, rect.left - 2),
          y: Math.max(0, rect.top - 2),
          width: Math.max(1, Math.min(window.innerWidth - rect.left + 2, rect.width + 4)),
          height: Math.max(1, Math.min(window.innerHeight - rect.top + 2, rect.height + 4)),
        },
        fontFamily: runStyle.fontFamily,
        pagesTransform: pagesStyle.transform,
        pagesWillChange: pagesStyle.willChange,
        frameHeld: document.querySelector('.word-editor-panel')?.dataset.wordZoomFrameHeld === 'true',
        frameReleasing: frameHold?.hasAttribute('data-releasing') ?? false,
        frameCopy: frameCopyStyle ? {
          transform: frameCopyStyle.transform,
          transformOrigin: frameCopyStyle.transformOrigin,
          willChange: frameCopyStyle.willChange,
          zoom: frameCopyStyle.zoom,
        } : null,
      }
    })()`,
  )
  if (!geometry?.rect) return null
  const capture = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    clip: { ...geometry.rect, scale: 1 },
  })
  await fs.promises.mkdir(path.dirname(screenshotFile), { recursive: true })
  await fs.promises.writeFile(screenshotFile, Buffer.from(capture.result.data, 'base64'))
  return {
    ...geometry,
    raster: await measureTextRasterChroma(send, capture.result.data),
  }
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

const FIXTURE_PAGE_COUNT = 42
const SIMSUN_RASTER_SAMPLE = '宋体缩放渲染回归：八九成显示应保持清晰一致。'

/** 长文档 docx：覆盖旧实现「超过 40 页不进入双页」的回归。 */
async function buildDocxFixture(filePath) {
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  const wNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const paragraphs = []
  for (let page = 1; page <= FIXTURE_PAGE_COUNT; page++) {
    const style = page === 1
      ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'
      : page === 2
        ? '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>'
        : ''
    const text = page === 1
      ? 'WORD VIEW HEADING'
      : page === 2
        ? 'WORD VIEW SECOND LEVEL'
        : `WORD ZOOM FIXTURE PAGE ${page} — the quick brown fox jumps over the lazy dog.`
    paragraphs.push(
      `<w:p>${style}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`,
    )
    if (page === 1) {
      paragraphs.push(
        '<w:p><w:r><w:rPr>' +
          '<w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun" w:cs="SimSun"/>' +
          '<w:sz w:val="24"/><w:szCs w:val="24"/>' +
          `</w:rPr><w:t>${SIMSUN_RASTER_SAMPLE}</w:t></w:r></w:p>`,
      )
    }
    if (page < FIXTURE_PAGE_COUNT) {
      paragraphs.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    }
  }
  const documentXml =
    `${xmlHeader}<w:document xmlns:w="${wNs}"><w:body>${paragraphs.join('')}` +
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
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'word/styles.xml',
    `${xmlHeader}<w:styles xmlns:w="${wNs}">` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>' +
      '</w:styles>',
  )
  zip.file('word/document.xml', documentXml)
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  fs.writeFileSync(filePath, buffer)
}

/** DocumentZoom 监听 window keydown（capture）。向 body 派发（而非 window）：
 * 传播路径仍会经过 window 的 capture 监听器，且 target 是真实 Node——
 * SuperDoc 的键盘转发器会对 target 调用 Node.contains，window 会让它抛错。 */
function zoomKeyExpression(key, code) {
  return `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, ctrlKey: true, bubbles: true, cancelable: true })), true`
}

async function clickAt(send, x, y) {
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse',
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse',
  })
}

/** 点击第 pageNumber 页第一行文本中心，再经真实输入管线插入 marker */
async function clickFirstLineAndType(send, pageNumber, marker) {
  const target = await evaluate(
    send,
    `(() => {
      const page = document.querySelector('.superdoc-page[data-page-number="${pageNumber}"]')
        || document.querySelectorAll('.superdoc-page')[${pageNumber - 1}]
      if (!page) return null
      const line = page.querySelector('.superdoc-line')
      const rect = (line || page).getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })()`,
  )
  if (!target) return { clicked: false }
  await clickAt(send, target.x, target.y)
  await sleep(400)
  await send('Input.insertText', { text: marker })
  return { clicked: true, ...target }
}

function editorTextExpression(marker) {
  // 真编辑器在 body 的隐藏宿主里；绘制镜像是 .superdoc-page。两处都查。
  return `(() => {
    const m = ${JSON.stringify(marker)}
    const hidden = document.querySelector('.presentation-editor__hidden-host')
    const hiddenHit = Boolean(hidden && hidden.textContent && hidden.textContent.includes(m))
    const painted = Array.from(document.querySelectorAll('.superdoc-page'))
      .some((page) => page.textContent && page.textContent.includes(m))
    return hiddenHit || painted ? { hiddenHit, painted } : null
  })()`
}

if (!fs.existsSync(rendererEntry)) {
  console.error('Built renderer is missing. Run `npm run build` before this verifier.')
  process.exit(1)
}

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-word-zoom-verify-'))
const fixturePath = path.join(fixtureDir, 'word-zoom-verification.docx')
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-word-zoom-profile-'))
await buildDocxFixture(fixturePath)

const rendererExceptions = []
const rendererConsoleErrors = []
const zoomScreencastFrames = []
let collectZoomScreencastFrames = false
let child = null
let cdp = null

try {
  const port = await getFreePort()
  const bridgePort = await getFreePort()
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
      WPS_BRIDGE_PORT: String(bridgePort),
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
    if (message.method === 'Page.screencastFrame') {
      if (collectZoomScreencastFrames && zoomScreencastFrames.length < 80) {
        zoomScreencastFrames.push(message.params.data)
      }
      cdp?.send('Page.screencastFrameAck', { sessionId: message.params.sessionId }).catch(() => {})
    }
  })
  const { send } = cdp
  await send('Runtime.enable')
  await send('Console.enable')
  await send('Page.enable')

  // 视口固定 1600×900：默认三栏下，中栏在 60% 时可放下两张 A4。
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600, height: 900, deviceScaleFactor: 0, mobile: false,
  })

  await waitFor(
    send,
    `document.getElementById('root')?.childElementCount > 0`,
    'the React application to render',
  )

  // 起始归一：Ctrl+0 重置缩放（用户 profile 可能持久化了其他值）
  await evaluate(send, zoomKeyExpression('0', 'Digit0'))
  await sleep(200)

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

  // SuperDoc 布局引擎绘制出页面（字体加载 + 解析较慢，放宽超时）
  await waitFor(
    send,
    `document.querySelectorAll('.superdoc-page').length >= 2`,
    'SuperDoc layout-engine pages to paint',
    60_000,
  )
  const pageCount = await evaluate(send, `document.querySelectorAll('.superdoc-page').length`)
  check('multi-page fixture painted as discrete .superdoc-page elements', pageCount >= 4,
    `pages=${pageCount}`)
  const reportedPages = await waitFor(
    send,
    `document.querySelector('.word-document-layout')?.dataset.wordPageCount === '${FIXTURE_PAGE_COUNT}'`,
    'the complete long-document page count',
    20_000,
  )
  check('long document reports every page before layout switching', Boolean(reportedPages),
    `pages=${FIXTURE_PAGE_COUNT}`)

  // 0) WPS-style bottom-right view controls and zoom popup.
  await waitFor(send, `Boolean(document.querySelector('[data-testid="word-status-bar"]'))`, 'Word status bar')
  const statusLayout = await evaluate(
    send,
    `(() => {
      const panel = document.querySelector('.word-editor-panel')
      const bar = document.querySelector('[data-testid="word-status-bar"]')
      if (!panel || !bar) return null
      const p = panel.getBoundingClientRect()
      const b = bar.getBoundingClientRect()
      const ids = Array.from(bar.querySelectorAll('.word-status-controls [data-testid]'))
        .map((element) => element.getAttribute('data-testid'))
      return {
        ids,
        interactiveCount: bar.querySelectorAll('button, input[type="range"]').length,
        rightDelta: Math.abs(p.right - b.right),
        bottomDelta: Math.abs(p.bottom - b.bottom),
        height: b.height,
      }
    })()`,
  )
  const expectedControlOrder = [
    'word-eye-care',
    'word-view-page',
    'word-view-outline',
    'word-view-reading',
    'word-view-web',
    'word-zoom-fit',
    'word-zoom-trigger',
    'word-zoom-out',
    'word-zoom-slider',
    'word-zoom-in',
  ]
  check('status controls match the requested left-to-right order only',
    statusLayout?.ids?.join(',') === expectedControlOrder.join(',') && statusLayout.interactiveCount === 10,
    JSON.stringify(statusLayout?.ids))
  check('status bar is anchored to the Word preview bottom-right edge',
    statusLayout && statusLayout.rightDelta <= 1 && statusLayout.bottomDelta <= 1 && Math.abs(statusLayout.height - 29) <= 0.1,
    JSON.stringify(statusLayout))

  await evaluate(send, `document.querySelector('[data-testid="word-eye-care"]')?.click()`)
  const eyeCareOn = await waitFor(
    send,
    `(() => {
      const panel = document.querySelector('.word-editor-panel')
      const page = document.querySelector('.superdoc-page')
      if (panel?.dataset.wordEyeCare !== 'true' || !page) return null
      return { background: getComputedStyle(page).backgroundColor }
    })()`,
    'eye-care page tint',
  )
  check('eye-care mode visibly tints the live editable page',
    eyeCareOn && eyeCareOn.background !== 'rgb(255, 255, 255)',
    eyeCareOn ? eyeCareOn.background : '')
  await evaluate(send, `document.querySelector('[data-testid="word-eye-care"]')?.click()`)
  await waitFor(
    send,
    `document.querySelector('.word-editor-panel')?.dataset.wordEyeCare === 'false'`,
    'eye-care mode to turn off',
  )

  await evaluate(send, `document.querySelector('[data-testid="word-view-outline"]')?.click()`)
  await waitFor(
    send,
    `Boolean(document.querySelector('[data-testid="word-outline-view"]'))
      && document.querySelector('.word-editor-panel')?.dataset.wordViewMode === 'outline'`,
    'outline projection surface',
  )
  await sleep(250)
  const outlineView = await evaluate(
    send,
    `(() => {
      const view = document.querySelector('[data-testid="word-outline-view"]')
      const panel = document.querySelector('.word-editor-panel')
      const text = view?.textContent || ''
      return {
        mode: panel?.dataset.wordViewMode,
        items: view?.querySelectorAll('[role="treeitem"]').length || 0,
        text,
        emptyVisible: Boolean(view?.querySelector('.word-outline-empty')),
      }
    })()`,
  )
  check('outline view reads real heading levels from the document',
    outlineView?.items === 2
      && outlineView.text.includes('WORD VIEW HEADING')
      && outlineView.text.includes('WORD VIEW SECOND LEVEL'),
    JSON.stringify(outlineView))

  await evaluate(send, `document.querySelector('[data-testid="word-view-reading"]')?.click()`)
  const readingView = await waitFor(
    send,
    `(() => {
      const view = document.querySelector('[data-testid="word-reading-view"]')
      return document.querySelector('.word-editor-panel')?.dataset.wordViewMode === 'reading'
        && view?.textContent?.includes('WORD VIEW HEADING')
        ? getComputedStyle(view.querySelector('.word-alternate-content')).maxWidth
        : null
    })()`,
    'reading-layout projection',
  )
  check('reading layout renders the live document in its reading surface', Boolean(readingView),
    `maxWidth=${readingView}`)

  await evaluate(send, `document.querySelector('[data-testid="word-view-web"]')?.click()`)
  const webView = await waitFor(
    send,
    `(() => {
      const view = document.querySelector('[data-testid="word-web-view"]')
      const content = view?.querySelector('.word-alternate-content')
      if (!view || !content || !view.textContent?.includes('WORD VIEW HEADING')) return null
      const viewRect = view.getBoundingClientRect()
      const contentRect = content.getBoundingClientRect()
      return {
        widthDelta: Math.abs(view.clientWidth - contentRect.width),
        scrollbarWidth: viewRect.width - view.clientWidth,
      }
    })()`,
    'web-layout projection',
  )
  check('web layout renders a continuous full-width document surface', webView?.widthDelta <= 2,
    JSON.stringify(webView))

  await evaluate(send, `document.querySelector('[data-testid="word-view-page"]')?.click()`)
  const pageViewBack = await waitFor(
    send,
    `(() => {
      const panel = document.querySelector('.word-editor-panel')
      const wrapper = document.querySelector('.word-editor-panel .superdoc-wrapper')
      return panel?.dataset.wordViewMode === 'page'
        && !document.querySelector('[data-word-alternate-view]')
        && wrapper && getComputedStyle(wrapper).visibility === 'visible'
    })()`,
    'page view to restore the editable canvas',
  )
  check('page view restores the same editable SuperDoc canvas', Boolean(pageViewBack))

  await evaluate(send, `document.querySelector('[data-testid="word-zoom-out"]')?.click()`)
  await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '0.9'`,
    'zoom-out button to reach 90%',
  )
  await waitFor(
    send,
    `document.querySelector('.word-editor-panel')?.dataset.wordZoomFrameHeld === 'true'
      && Boolean(document.querySelector('[data-word-zoom-frame-copy]'))
      && !document.querySelector('[data-word-zoom-frame-hold]')?.hasAttribute('data-releasing')`,
    '90% frozen transition frame',
  )
  const simSun90Transition = await captureSimSunRaster(
    send,
    fontRasterTransition90ScreenshotPath,
  )
  await waitFor(
    send,
    `(() => {
      const sample = ${JSON.stringify(SIMSUN_RASTER_SAMPLE)}
      const run = Array.from(document.querySelectorAll('.superdoc-text-run'))
        .find((element) => element.textContent?.includes(sample))
      const layout = document.querySelector('.word-document-layout')
      const panel = document.querySelector('.word-editor-panel')
      return Boolean(run)
        && !layout?.hasAttribute('data-word-zoom-preview')
        && panel?.dataset.wordZoomFrameHeld !== 'true'
    })()`,
    'stable 90% SimSun raster sample',
  )
  await sleep(120)
  const simSun90 = await captureSimSunRaster(send, fontRaster90ScreenshotPath)

  await evaluate(
    send,
    `(() => {
      const slider = document.querySelector('[data-testid="word-zoom-slider"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(slider, '8')
      slider?.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`,
  )
  await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '0.8'
      && document.querySelector('.word-editor-panel')?.dataset.wordZoomFrameHeld === 'true'
      && Boolean(document.querySelector('[data-word-zoom-frame-copy]'))
      && !document.querySelector('[data-word-zoom-frame-hold]')?.hasAttribute('data-releasing')`,
    '80% frozen transition frame',
  )
  const simSun80Transition = await captureSimSunRaster(
    send,
    fontRasterTransition80ScreenshotPath,
  )
  await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '0.8'
      && !document.querySelector('.word-document-layout')?.hasAttribute('data-word-zoom-preview')
      && document.querySelector('.word-editor-panel')?.dataset.wordZoomFrameHeld !== 'true'`,
    'stable 80% SimSun raster sample',
  )
  await sleep(120)
  const simSun80 = await captureSimSunRaster(send, fontRaster80ScreenshotPath)
  const transitionInkRatio = simSun80?.raster.inkDensity
    ? (simSun80Transition?.raster.inkDensity ?? 0) / simSun80.raster.inkDensity
    : 0
  const transition90InkRatio = simSun90?.raster.inkDensity
    ? (simSun90Transition?.raster.inkDensity ?? 0) / simSun90.raster.inkDensity
    : 0
  const simSunRasterSummary = {
    at80: simSun80,
    at90: simSun90,
    transition80: simSun80Transition,
    transitionInkRatio,
    transition90: simSun90Transition,
    transition90InkRatio,
  }
  check(
    '80% and 90% retain the document SimSun font family',
    [simSun80, simSun90].every((sample) => /SimSun|宋体/i.test(sample?.fontFamily ?? '')),
    JSON.stringify({ at80: simSun80?.fontFamily, at90: simSun90?.fontFamily }),
  )
  check(
    'sub-100% Word pages keep the stable transform rasterization hint',
    [simSun80, simSun90].every((sample) =>
      sample?.pagesWillChange.split(',').map((value) => value.trim()).includes('transform')),
    JSON.stringify({ at80: simSun80?.pagesWillChange, at90: simSun90?.pagesWillChange }),
  )
  check(
    'SimSun stays grayscale without scaled ClearType color fringes at 80% and 90%',
    [simSun80, simSun90].every((sample) =>
      (sample?.raster.darkPixels ?? 0) >= 50
      && (sample?.raster.chromaticRatio ?? 1) <= 0.03
      && (sample?.raster.meanChannelSpread ?? 255) <= 3),
    JSON.stringify(simSunRasterSummary),
  )
  check(
    'the frozen 80% and 90% settle frames use the live page transform raster path',
    [simSun80Transition, simSun90Transition].every((sample) =>
      sample?.frameHeld === true
      && sample.frameReleasing === false
      && sample.frameCopy?.zoom === '1'
      && sample.frameCopy.willChange
        .split(',').map((value) => value.trim()).includes('transform')
      && sample.frameCopy.transform !== 'none'),
    JSON.stringify({ at80: simSun80Transition?.frameCopy, at90: simSun90Transition?.frameCopy }),
  )
  check(
    'the frozen settle frames do not flash back to a different SimSun weight',
    [transitionInkRatio, transition90InkRatio].every((ratio) => ratio >= 0.88 && ratio <= 1.12),
    JSON.stringify({
      at80: {
        transitionInkDensity: simSun80Transition?.raster.inkDensity,
        stableInkDensity: simSun80?.raster.inkDensity,
        ratio: transitionInkRatio,
      },
      at90: {
        transitionInkDensity: simSun90Transition?.raster.inkDensity,
        stableInkDensity: simSun90?.raster.inkDensity,
        ratio: transition90InkRatio,
      },
    }),
  )
  console.log(
    `[info] SimSun raster screenshots: ${fontRaster80ScreenshotPath}, `
      + `${fontRaster90ScreenshotPath}, ${fontRasterTransition80ScreenshotPath}, `
      + fontRasterTransition90ScreenshotPath,
  )

  // Restore 90% so the existing plus-button assertion still verifies one native step.
  await evaluate(
    send,
    `(() => {
      const slider = document.querySelector('[data-testid="word-zoom-slider"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(slider, '9')
      slider?.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`,
  )
  await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '0.9'`,
    '90% restore after SimSun raster comparison',
  )
  await evaluate(send, `document.querySelector('[data-testid="word-zoom-in"]')?.click()`)
  const zoomButtons = await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '1'`,
    'zoom-in button to return to 100%',
  )
  check('zoom minus and plus buttons drive the native zoom state', Boolean(zoomButtons))
  const rasterHintAt100 = await waitFor(
    send,
    `(() => {
      const pages = document.querySelector('.presentation-editor__pages')
      const layout = document.querySelector('.word-document-layout')
      const panel = document.querySelector('.word-editor-panel')
      if (!(pages instanceof HTMLElement)
        || layout?.hasAttribute('data-word-zoom-preview')
        || panel?.dataset.wordZoomFrameHeld === 'true') return null
      const value = getComputedStyle(pages).willChange
      return value !== 'transform' ? value : null
    })()`,
    '100% rasterization hint cleanup',
  )
  check('100% releases the shrink-only rasterization hint', Boolean(rasterHintAt100),
    `will-change=${rasterHintAt100}`)

  await evaluate(
    send,
    `(() => {
      const slider = document.querySelector('[data-testid="word-zoom-slider"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(slider, '7')
      slider?.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`,
  )
  const sliderAt75 = await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '0.75'
      && document.querySelector('[data-testid="word-zoom-trigger"]')?.textContent?.includes('75%')`,
    'zoom slider to reach 75%',
  )
  check('zoom slider updates both the native document zoom and percentage label', Boolean(sliderAt75))

  await evaluate(send, `document.querySelector('[data-testid="word-zoom-trigger"]')?.click()`)
  const popupLayout = await waitFor(
    send,
    `(() => {
      const popup = document.querySelector('[data-testid="word-zoom-popup"]')
      const bar = document.querySelector('[data-testid="word-status-bar"]')
      if (!popup || !bar) return null
      const p = popup.getBoundingClientRect()
      const b = bar.getBoundingClientRect()
      const options = Array.from(popup.querySelectorAll('input[type="radio"]')).map((input) => input.value)
      return p.bottom <= b.top && options.length === 6
        ? { options, aboveBar: true, hasCustom: Boolean(popup.querySelector('[data-testid="word-zoom-custom-input"]')) }
        : null
    })()`,
    'zoom popup above the status bar',
  )
  check('zoom popup matches the six-option WPS layout plus custom percentage',
    popupLayout?.hasCustom && popupLayout.options.join(',') === '200,100,75,page-width,text-width,whole-page',
    JSON.stringify(popupLayout))

  await fs.promises.mkdir(artifactDir, { recursive: true })
  const statusShot = await send('Page.captureScreenshot', { format: 'png' })
  await fs.promises.writeFile(statusBarScreenshotPath, Buffer.from(statusShot.result.data, 'base64'))
  console.log(`[info] status-bar screenshot: ${statusBarScreenshotPath}`)

  await evaluate(send, `document.querySelector('[data-testid="word-zoom-option-200"]')?.click()`)
  const fixed200 = await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '2'
      && document.querySelector('[data-testid="word-zoom-option-200"]')?.checked`,
    'fixed 200% zoom option',
  )
  check('fixed 200% zoom option is functional', Boolean(fixed200))
  const rasterHintAt200 = await waitFor(
    send,
    `(() => {
      const pages = document.querySelector('.presentation-editor__pages')
      const layout = document.querySelector('.word-document-layout')
      const panel = document.querySelector('.word-editor-panel')
      if (!(pages instanceof HTMLElement)
        || layout?.hasAttribute('data-word-zoom-preview')
        || panel?.dataset.wordZoomFrameHeld === 'true') return null
      const value = getComputedStyle(pages).willChange
      return value !== 'transform' ? value : null
    })()`,
    '200% rasterization hint cleanup',
  )
  check('zoom above 100% does not pin a low-resolution compositor layer', Boolean(rasterHintAt200),
    `will-change=${rasterHintAt200}`)

  await evaluate(
    send,
    `(() => {
      const input = document.querySelector('[data-testid="word-zoom-custom-input"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '125')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`,
  )
  await sleep(120)
  await evaluate(
    send,
    `document.querySelector('[data-testid="word-zoom-custom-input"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`,
  )
  const custom125 = await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '1.25'`,
    'custom 125% zoom',
  )
  check('custom percentage input applies an exact native zoom', Boolean(custom125))

  await evaluate(send, `document.querySelector('[data-testid="word-zoom-trigger"]')?.click()`)
  await waitFor(send, `Boolean(document.querySelector('[data-testid="word-zoom-popup"]'))`, 'zoom popup to reopen')
  await evaluate(send, `document.querySelector('[data-testid="word-zoom-option-whole-page"]')?.click()`)
  const wholePageZoom = await waitFor(
    send,
    `(() => {
      const input = document.querySelector('[data-testid="word-zoom-option-whole-page"]')
      const zoom = Number(document.querySelector('.document-zoom-root')?.dataset.documentZoom)
      return input?.checked && zoom >= 0.1 && zoom <= 1 ? zoom : null
    })()`,
    'whole-page fit zoom',
  )
  check('whole-page fit computes and applies a viewport-based zoom', Boolean(wholePageZoom),
    `zoom=${wholePageZoom}`)

  await evaluate(send, `document.querySelector('[data-testid="word-zoom-option-page-width"]')?.click()`)
  const pageWidthZoom = await waitFor(
    send,
    `(() => {
      const input = document.querySelector('[data-testid="word-zoom-option-page-width"]')
      const zoom = Number(document.querySelector('.document-zoom-root')?.dataset.documentZoom)
      return input?.checked && zoom > 0 ? zoom : null
    })()`,
    'page-width fit zoom',
  )
  check('page-width fit computes and applies a viewport-based zoom', Boolean(pageWidthZoom),
    `zoom=${pageWidthZoom}`)

  await evaluate(send, `document.querySelector('[data-testid="word-zoom-option-text-width"]')?.click()`)
  const textWidthZoom = await waitFor(
    send,
    `(() => {
      const input = document.querySelector('[data-testid="word-zoom-option-text-width"]')
      const zoom = Number(document.querySelector('.document-zoom-root')?.dataset.documentZoom)
      return input?.checked && zoom > 0 ? zoom : null
    })()`,
    'text-width fit zoom',
  )
  check('text-width fit computes and applies a viewport-based zoom', Boolean(textWidthZoom),
    `zoom=${textWidthZoom}`)

  // Restore the baseline before the pre-existing zoom/layout regression suite.
  await evaluate(send, `document.querySelector('[data-testid="word-zoom-trigger"]')?.click()`)
  await evaluate(send, zoomKeyExpression('0', 'Digit0'))
  await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '1'`,
    '100% baseline after status-bar checks',
  )

  await send('Emulation.setDeviceMetricsOverride', {
    width: 1000, height: 900, deviceScaleFactor: 0, mobile: false,
  })
  await sleep(300)
  const narrowStatusLayout = await evaluate(
    send,
    `(() => {
      const bar = document.querySelector('[data-testid="word-status-bar"]')
      if (!bar) return null
      const controls = Array.from(bar.querySelectorAll('.word-status-controls [data-testid]'))
      const rects = controls.map((control) => {
        const rect = control.getBoundingClientRect()
        return { id: control.dataset.testid, left: rect.left, right: rect.right }
      })
      const ordered = rects.every((rect, index) => index === 0 || rect.left >= rects[index - 1].right - 0.5)
      const barRect = bar.getBoundingClientRect()
      const contained = rects.length > 0
        && rects[0].left >= barRect.left - 0.5
        && rects[rects.length - 1].right <= barRect.right + 0.5
      return {
        width: barRect.width,
        ordered,
        contained,
        noOverflow: bar.scrollWidth <= bar.clientWidth + 1,
      }
    })()`,
  )
  check('narrow Word preview keeps all requested controls visible without overlap',
    narrowStatusLayout?.ordered && narrowStatusLayout.contained && narrowStatusLayout.noOverflow,
    JSON.stringify(narrowStatusLayout))
  const narrowStatusShot = await send('Page.captureScreenshot', { format: 'png' })
  await fs.promises.writeFile(narrowStatusBarScreenshotPath, Buffer.from(narrowStatusShot.result.data, 'base64'))
  console.log(`[info] narrow status-bar screenshot: ${narrowStatusBarScreenshotPath}`)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600, height: 900, deviceScaleFactor: 0, mobile: false,
  })
  await sleep(300)
  await evaluate(send, zoomKeyExpression('0', 'Digit0'))
  await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '1'`,
    'stable 100% baseline after restoring the wide viewport',
  )
  await sleep(200)

  const settleCaptureRect = await evaluate(
    send,
    `(() => {
      const viewport = document.querySelector('.presentation-editor__viewport')
      const scroller = viewport?.closest('.super-editor-container')
        ?? viewport?.closest('.superdoc__sub-document')
      if (!(scroller instanceof HTMLElement)) return null
      const rect = scroller.getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    })()`,
  )
  zoomScreencastFrames.length = 0
  collectZoomScreencastFrames = true
  await send('Page.startScreencast', {
    format: 'jpeg', quality: 78, maxWidth: 800, maxHeight: 450, everyNthFrame: 1,
  })
  const wheelSettleFrames = await evaluate(
    send,
    `(async () => {
      const root = document.querySelector('.document-zoom-root')
      const target = document.querySelector('.word-document-layout')
      const viewport = document.querySelector('.presentation-editor__viewport')
      const scroller = viewport?.closest('.super-editor-container')
        ?? viewport?.closest('.superdoc__sub-document')
      if (!root || !target || !(scroller instanceof HTMLElement)) return null
      scroller.scrollTop = Math.min(1600, Math.max(0, scroller.scrollHeight - scroller.clientHeight))
      const scrollRect = scroller.getBoundingClientRect()
      const centerY = scrollRect.top + scrollRect.height / 2
      const initialPage = Array.from(document.querySelectorAll('.superdoc-page'))
        .map((page) => ({ page, rect: page.getBoundingClientRect() }))
        .sort((a, b) => Math.abs((a.rect.top + a.rect.bottom) / 2 - centerY)
          - Math.abs((b.rect.top + b.rect.bottom) / 2 - centerY))[0]?.page
      const pageIndex = initialPage?.getAttribute('data-page-index')
      const frames = []
      const start = performance.now()
      const capture = (now) => {
        const page = document.querySelector('.superdoc-page[data-page-index="' + pageIndex + '"]')
        const rect = page?.getBoundingClientRect()
        const ruler = document.querySelector('.ruler-wrapper, .ruler')?.getBoundingClientRect()
        frames.push({
          t: Math.round(now - start),
          zoom: root.getAttribute('data-document-zoom'),
          settled: root.getAttribute('data-document-zoom-settled'),
          preview: target.hasAttribute('data-word-zoom-preview'),
          frameHeld: document.querySelector('.word-editor-panel')?.dataset.wordZoomFrameHeld === 'true',
          heldPages: document.querySelectorAll('[data-word-zoom-frame-copy]').length,
          mode: target.getAttribute('data-word-layout-mode'),
          scrollTop: Math.round(scroller.scrollTop * 10) / 10,
          page: rect ? {
            top: Math.round(rect.top * 10) / 10,
            left: Math.round(rect.left * 10) / 10,
            width: Math.round(rect.width * 10) / 10,
          } : null,
          ruler: ruler ? {
            left: Math.round(ruler.left * 10) / 10,
            width: Math.round(ruler.width * 10) / 10,
          } : null,
        })
        if (now - start < 650) requestAnimationFrame(capture)
      }
      requestAnimationFrame(capture)
      target.dispatchEvent(new WheelEvent('wheel', {
        ctrlKey: true,
        deltaY: 100,
        bubbles: true,
        cancelable: true,
      }))
      await new Promise((resolve) => setTimeout(resolve, 680))
      scroller.scrollTop = 0
      return frames
    })()`,
  )
  await send('Page.stopScreencast')
  collectZoomScreencastFrames = false
  const paperRatios = await measurePaperRatios(
    send,
    zoomScreencastFrames,
    settleCaptureRect,
    { width: 1600, height: 900 },
  )
  const paperContinuity = paperRatios?.length >= 2 ? {
    frames: paperRatios.length,
    min: Math.min(...paperRatios),
    max: Math.max(...paperRatios),
  } : null
  if (paperRatios?.length) {
    const worstFrameIndex = paperRatios.indexOf(Math.min(...paperRatios))
    await fs.promises.mkdir(artifactDir, { recursive: true })
    await fs.promises.writeFile(
      settleFrameScreenshotPath,
      Buffer.from(zoomScreencastFrames[worstFrameIndex], 'base64'),
    )
    console.log(`[info] darkest zoom-settle frame: ${settleFrameScreenshotPath}`)
  }
  check(
    'Word zoom settle keeps a painted paper frame instead of flashing black',
    paperContinuity
      && paperContinuity.max >= 0.08
      && paperContinuity.min >= paperContinuity.max * 0.68,
    JSON.stringify(paperContinuity),
  )
  const heldSettleFrames = wheelSettleFrames?.filter((frame) => frame.frameHeld) ?? []
  check(
    'native zoom repaint is covered by visible-page copies until the live frame stabilizes',
    heldSettleFrames.length >= 2
      && heldSettleFrames.every((frame) => frame.heldPages > 0)
      && wheelSettleFrames?.at(-1)?.frameHeld === false,
    JSON.stringify({ heldFrames: heldSettleFrames.length, last: wheelSettleFrames?.at(-1) }),
  )
  const zoomedSettleFrames = wheelSettleFrames?.filter((frame) =>
    frame.zoom === '0.9' && frame.page && frame.ruler) ?? []
  const finalSettleFrame = [...zoomedSettleFrames].reverse().find((frame) =>
    frame.settled === '0.9' && !frame.preview)
  const settleContinuity = finalSettleFrame ? {
    frames: zoomedSettleFrames.length,
    maxPageLeftDrift: Math.max(...zoomedSettleFrames.map((frame) =>
      Math.abs(frame.page.left - finalSettleFrame.page.left))),
    maxPageTopDrift: Math.max(...zoomedSettleFrames.map((frame) =>
      Math.abs(frame.page.top - finalSettleFrame.page.top))),
    maxRulerLeftDrift: Math.max(...zoomedSettleFrames.map((frame) =>
      Math.abs(frame.ruler.left - finalSettleFrame.ruler.left))),
    maxRulerWidthDrift: Math.max(...zoomedSettleFrames.map((frame) =>
      Math.abs(frame.ruler.width - finalSettleFrame.ruler.width))),
  } : null
  check('Ctrl+wheel preview and native settle keep the page and ruler geometry continuous',
    settleContinuity
      && settleContinuity.frames >= 2
      && settleContinuity.maxPageLeftDrift <= 1
      && settleContinuity.maxPageTopDrift <= 1
      && settleContinuity.maxRulerLeftDrift <= 1
      && settleContinuity.maxRulerWidthDrift <= 1,
    JSON.stringify(settleContinuity))
  await evaluate(send, zoomKeyExpression('0', 'Digit0'))
  await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '1'`,
    '100% reset after wheel settle trace',
  )
  await sleep(200)

  // 40%（双页）→50%（单页）临界回归：把文档列校准到「40% 放得下、
  // 50% 放不下」的宽度。布局模式和倍率必须合并成一次原生分页，且过渡中
  // 冻结帧/原生页面至少有一方持续可见。
  let boundaryViewportWidth = 1350
  let boundaryGeometry = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    boundaryGeometry = await evaluate(
      send,
      `(() => {
        const layout = document.querySelector('.word-document-layout')
        const widths = Array.from(document.querySelectorAll('.superdoc-page'))
          .map((page) => page.offsetWidth)
          .filter((width) => Number.isFinite(width) && width > 0)
          .sort((a, b) => b - a)
        if (!(layout instanceof HTMLElement) || widths.length === 0) return null
        const first = widths[0]
        const second = widths[1] ?? first
        const baseWidth = first + second + 24 + 44
        return {
          viewportWidth: window.innerWidth,
          availableWidth: layout.clientWidth,
          baseWidth,
          targetWidth: baseWidth * 0.45,
        }
      })()`,
    )
    if (!boundaryGeometry) break
    const nextWidth = Math.round(
      boundaryGeometry.viewportWidth
      + boundaryGeometry.targetWidth
      - boundaryGeometry.availableWidth,
    )
    boundaryViewportWidth = Math.max(1000, Math.min(1590, nextWidth))
    await send('Emulation.setDeviceMetricsOverride', {
      width: boundaryViewportWidth, height: 900, deviceScaleFactor: 0, mobile: false,
    })
    await sleep(350)
  }
  boundaryGeometry = await evaluate(
    send,
    `(() => {
      const layout = document.querySelector('.word-document-layout')
      const widths = Array.from(document.querySelectorAll('.superdoc-page'))
        .map((page) => page.offsetWidth)
        .filter((width) => Number.isFinite(width) && width > 0)
        .sort((a, b) => b - a)
      if (!(layout instanceof HTMLElement) || widths.length === 0) return null
      const first = widths[0]
      const second = widths[1] ?? first
      const baseWidth = first + second + 24 + 44
      return {
        viewportWidth: window.innerWidth,
        availableWidth: layout.clientWidth,
        baseWidth,
        fitsAt40: layout.clientWidth + 1 >= baseWidth * 0.4,
        fitsAt50: layout.clientWidth + 1 >= baseWidth * 0.5,
      }
    })()`,
  )
  check(
    'boundary viewport fits two pages at 40% but only one at 50%',
    boundaryGeometry?.fitsAt40 && !boundaryGeometry?.fitsAt50,
    JSON.stringify(boundaryGeometry),
  )

  await evaluate(
    send,
    `(() => {
      const slider = document.querySelector('[data-testid="word-zoom-slider"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(slider, '3')
      slider?.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`,
  )
  await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '0.4'
      && document.querySelector('.word-document-layout')?.dataset.wordLayoutMode === 'book'
      && document.querySelectorAll(
        '.presentation-editor__pages > .superdoc-spread:first-child > .superdoc-page'
      ).length === 2
      && document.querySelector('.word-editor-panel')?.dataset.wordZoomFrameHeld !== 'true'`,
    'stable 40% two-page side of the layout boundary',
    30_000,
  )
  await sleep(250)

  const boundaryCapture = await evaluate(
    send,
    `(() => {
      const viewport = document.querySelector('.presentation-editor__viewport')
      const scroller = viewport?.closest('.super-editor-container')
        ?? viewport?.closest('.superdoc__sub-document')
      if (!(scroller instanceof HTMLElement)) return null
      scroller.scrollTop = 0
      const rect = scroller.getBoundingClientRect()
      return {
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }
    })()`,
  )
  zoomScreencastFrames.length = 0
  collectZoomScreencastFrames = true
  await send('Page.startScreencast', {
    format: 'jpeg', quality: 78, maxWidth: 800, maxHeight: 450, everyNthFrame: 1,
  })
  const layoutBoundaryTrace = await evaluate(
    send,
    `(async () => {
      const appRoot = document.getElementById('root')
      const reactKey = appRoot && Object.keys(appRoot).find(
        (name) => name.startsWith('__reactContainer') || name.startsWith('__reactFiber'),
      )
      const container = reactKey ? appRoot[reactKey] : null
      const queue = container ? [
        container.current,
        container.stateNode?.current,
        container._internalRoot?.current,
        container,
      ].filter(Boolean) : []
      const seen = new Set()
      let presentation = null
      while (queue.length) {
        const fiber = queue.shift()
        if (!fiber || seen.has(fiber)) continue
        seen.add(fiber)
        const candidate = fiber.memoizedProps?.superdoc?.activeEditor?.presentationEditor
        if (candidate?.on && candidate?.off) {
          presentation = candidate
          break
        }
        if (fiber.child) queue.push(fiber.child)
        if (fiber.sibling) queue.push(fiber.sibling)
      }

      const root = document.querySelector('.document-zoom-root')
      const layout = document.querySelector('.word-document-layout')
      const slider = document.querySelector('[data-testid="word-zoom-slider"]')
      if (!root || !layout || !slider || !presentation) return null

      let paginationUpdates = 0
      const onPaginationUpdate = () => { paginationUpdates += 1 }
      presentation.on('paginationUpdate', onPaginationUpdate)
      const modeSequence = [layout.getAttribute('data-word-layout-mode')]
      const modeObserver = new MutationObserver(() => {
        const next = layout.getAttribute('data-word-layout-mode')
        if (modeSequence.at(-1) !== next) modeSequence.push(next)
      })
      modeObserver.observe(layout, {
        attributes: true,
        attributeFilter: ['data-word-layout-mode'],
      })

      const frames = []
      const start = performance.now()
      const capture = (now) => {
        const scroller = document.querySelector('.presentation-editor__viewport')
          ?.closest('.super-editor-container')
          ?? document.querySelector('.presentation-editor__viewport')
            ?.closest('.superdoc__sub-document')
        const clip = scroller?.getBoundingClientRect()
        const visiblePages = clip
          ? Array.from(document.querySelectorAll('.superdoc-page')).filter((page) => {
            const rect = page.getBoundingClientRect()
            return rect.width > 1 && rect.height > 1
              && rect.bottom > clip.top && rect.top < clip.bottom
              && rect.right > clip.left && rect.left < clip.right
          }).length
          : 0
        frames.push({
          t: Math.round(now - start),
          zoom: root.getAttribute('data-document-zoom'),
          settled: root.getAttribute('data-document-zoom-settled'),
          mode: layout.getAttribute('data-word-layout-mode'),
          visiblePages,
          heldPages: document.querySelectorAll('[data-word-zoom-frame-copy]').length,
          frameHeld: document.querySelector('.word-editor-panel')?.dataset.wordZoomFrameHeld === 'true',
        })
        if (now - start < 1500) requestAnimationFrame(capture)
      }
      requestAnimationFrame(capture)

      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      slider.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        buttons: 1,
      }))
      setter?.call(slider, '4')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 120))
      const duringDrag = {
        zoom: root.getAttribute('data-document-zoom'),
        settled: root.getAttribute('data-document-zoom-settled'),
        mode: layout.getAttribute('data-word-layout-mode'),
        preview: layout.hasAttribute('data-word-zoom-preview'),
        paginationUpdates,
      }
      slider.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      }))
      await new Promise((resolve) => setTimeout(resolve, 1300))

      modeObserver.disconnect()
      presentation.off('paginationUpdate', onPaginationUpdate)
      return {
        paginationUpdates,
        modeSequence,
        duringDrag,
        frames,
        final: {
          zoom: root.getAttribute('data-document-zoom'),
          settled: root.getAttribute('data-document-zoom-settled'),
          mode: layout.getAttribute('data-word-layout-mode'),
          pageCount: document.querySelectorAll('.superdoc-page').length,
          frameHeld: document.querySelector('.word-editor-panel')?.dataset.wordZoomFrameHeld === 'true',
        },
      }
    })()`,
  )
  await send('Page.stopScreencast')
  collectZoomScreencastFrames = false

  const boundaryPaperRatios = boundaryCapture
    ? await measurePaperRatios(
      send,
      zoomScreencastFrames,
      boundaryCapture.rect,
      boundaryCapture.viewport,
    )
    : null
  const boundaryPaperContinuity = boundaryPaperRatios?.length >= 2 ? {
    frames: boundaryPaperRatios.length,
    min: Math.min(...boundaryPaperRatios),
    max: Math.max(...boundaryPaperRatios),
  } : null
  if (boundaryPaperRatios?.length) {
    const worstFrameIndex = boundaryPaperRatios.indexOf(Math.min(...boundaryPaperRatios))
    await fs.promises.writeFile(
      layoutBoundaryScreenshotPath,
      Buffer.from(zoomScreencastFrames[worstFrameIndex], 'base64'),
    )
    console.log(`[info] darkest 40%→50% frame: ${layoutBoundaryScreenshotPath}`)
  }
  const boundaryUnpaintedFrames = layoutBoundaryTrace?.frames.filter(
    (frame) => frame.visiblePages === 0 && frame.heldPages === 0,
  ).length
  check(
    'slider drag previews the two-page zoom without paginating until pointer release',
    layoutBoundaryTrace?.duringDrag.zoom === '0.5'
      && layoutBoundaryTrace?.duringDrag.settled === '0.4'
      && layoutBoundaryTrace?.duringDrag.mode === 'book'
      && layoutBoundaryTrace?.duringDrag.preview === true
      && layoutBoundaryTrace?.duringDrag.paginationUpdates === 0,
    JSON.stringify(layoutBoundaryTrace?.duringDrag),
  )
  check(
    '40%→50% commits zoom and two-page→single-page mode in one native pagination',
    layoutBoundaryTrace?.paginationUpdates === 1
      && layoutBoundaryTrace.modeSequence.join(',') === 'book,vertical',
    JSON.stringify({
      paginationUpdates: layoutBoundaryTrace?.paginationUpdates,
      modeSequence: layoutBoundaryTrace?.modeSequence,
    }),
  )
  check(
    '40%→50% keeps painted content throughout the layout-mode transition',
    boundaryUnpaintedFrames === 0
      && layoutBoundaryTrace?.frames.some((frame) => frame.frameHeld && frame.heldPages > 0)
      && layoutBoundaryTrace?.final.zoom === '0.5'
      && layoutBoundaryTrace?.final.settled === '0.5'
      && layoutBoundaryTrace?.final.mode === 'vertical'
      && layoutBoundaryTrace?.final.pageCount === FIXTURE_PAGE_COUNT
      && layoutBoundaryTrace?.final.frameHeld === false
      && boundaryPaperContinuity
      && boundaryPaperContinuity.min >= 0.02
      && boundaryPaperContinuity.min >= boundaryPaperContinuity.max * 0.22,
    JSON.stringify({
      unpaintedFrames: boundaryUnpaintedFrames,
      final: layoutBoundaryTrace?.final,
      paper: boundaryPaperContinuity,
    }),
  )

  await evaluate(send, zoomKeyExpression('0', 'Digit0'))
  await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '1'
      && document.querySelector('.word-document-layout')?.dataset.wordLayoutMode === 'vertical'`,
    '100% reset after the 40%→50% boundary trace',
    20_000,
  )
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600, height: 900, deviceScaleFactor: 0, mobile: false,
  })
  await sleep(300)

  // Ctrl+wheel 性能回归：手势中允许合成层预览逐帧跟手，但提交给
  // SuperDoc 的完整布局倍率必须保持不动，停止后只重绘最终倍率一次。
  const wheelBurst = await evaluate(
    send,
    `(async () => {
      const root = document.querySelector('.document-zoom-root')
      const target = document.querySelector('.word-document-layout')
      const viewport = document.querySelector('.presentation-editor__viewport')
      const scroller = viewport?.closest('.super-editor-container')
        ?? viewport?.closest('.superdoc__sub-document')
      if (!root || !target || !(scroller instanceof HTMLElement)) return null
      scroller.scrollTop = Math.min(2400, Math.max(0, scroller.scrollHeight - scroller.clientHeight))
      const anchorBefore = (scroller.scrollTop + scroller.clientHeight / 2)
      let settledChanges = 0
      const observer = new MutationObserver((records) => {
        settledChanges += records.filter(
          (record) => record.attributeName === 'data-document-zoom-settled',
        ).length
      })
      observer.observe(root, {
        attributes: true,
        attributeFilter: ['data-document-zoom-settled'],
      })
      for (let index = 0; index < 8; index += 1) {
        target.dispatchEvent(new WheelEvent('wheel', {
          ctrlKey: true,
          deltaY: 100,
          bubbles: true,
          cancelable: true,
        }))
        await new Promise((resolve) => setTimeout(resolve, 2))
      }
      await new Promise((resolve) => setTimeout(resolve, 40))
      const pages = document.querySelector('.presentation-editor__pages')
      const preview = {
        zoom: Number(root.dataset.documentZoom),
        settled: Number(root.dataset.documentZoomSettled),
        active: target.hasAttribute('data-word-zoom-preview'),
        transform: pages instanceof HTMLElement ? pages.style.transform : '',
        anchor: (scroller.scrollTop + scroller.clientHeight / 2) / Number(root.dataset.documentZoom),
      }
      // WHEEL_GESTURE_IDLE_MS=280：等待超过空闲窗口，确认手势只结算一次。
      await new Promise((resolve) => setTimeout(resolve, 420))
      observer.disconnect()
      const anchorAfter = (scroller.scrollTop + scroller.clientHeight / 2)
        / Number(root.dataset.documentZoomSettled)
      // 后续编辑命中用例从第一页开始，不继承本性能用例刻意设置的中段位置。
      scroller.scrollTop = 0
      return {
        preview,
        zoom: Number(root.dataset.documentZoom),
        settled: Number(root.dataset.documentZoomSettled),
        previewActive: target.hasAttribute('data-word-zoom-preview'),
        pointerEvents: getComputedStyle(
          target.querySelector('.presentation-editor__viewport'),
        ).pointerEvents,
        settledChanges,
        anchorBefore,
        anchorAfter,
      }
    })()`,
  )
  check(
    'rapid Ctrl+wheel previews every frame and commits one native layout at gesture end',
    wheelBurst?.preview?.zoom === 0.2
      && wheelBurst.preview.settled === 1
      && wheelBurst.preview.active
      && wheelBurst.preview.transform.includes('scale(0.2')
      && wheelBurst.zoom === 0.2
      && wheelBurst.settled === 0.2
      && !wheelBurst.previewActive
      && wheelBurst.pointerEvents !== 'none'
      && wheelBurst.settledChanges <= 1
      && Math.abs(wheelBurst.preview.anchor - wheelBurst.anchorBefore) <= 20
      && Math.abs(wheelBurst.anchorAfter - wheelBurst.anchorBefore) <= 20,
    JSON.stringify(wheelBurst),
  )

  const wheelEdit = await clickFirstLineAndType(send, 1, 'WHEELEDIT')
  check('wheel-zoomed Word page accepts a real mouse click', wheelEdit.clicked,
    wheelEdit.clicked ? `x=${wheelEdit.x.toFixed(1)} y=${wheelEdit.y.toFixed(1)}` : 'target not found')
  const wheelEditResult = wheelEdit.clicked && await waitFor(
    send,
    editorTextExpression('WHEELEDIT'),
    'wheel-zoomed edit to appear',
  )
  check('wheel-zoomed Word page accepts text immediately after settle', Boolean(wheelEditResult),
    JSON.stringify(wheelEditResult))

  await evaluate(send, zoomKeyExpression('0', 'Digit0'))
  await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '1'`,
    '100% reset after wheel burst',
  )

  // High-resolution wheels and trackpads emit many small pixel deltas. Ten
  // 10px events represent one logical zoom step, not ten separate renders.
  const precisionWheelZoom = await evaluate(
    send,
    `(() => {
      const target = document.querySelector('.word-document-layout')
      if (!target) return false
      for (let index = 0; index < 10; index += 1) {
        target.dispatchEvent(new WheelEvent('wheel', {
          ctrlKey: true,
          deltaY: 10,
          bubbles: true,
          cancelable: true,
        }))
      }
      return true
    })()`,
  )
  const precisionWheelSettled = precisionWheelZoom && await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '0.9'`,
    'precision-wheel deltas to accumulate to 90%',
  )
  check(
    'small Ctrl+wheel deltas accumulate into one logical 10% zoom step',
    Boolean(precisionWheelSettled),
  )
  await evaluate(send, zoomKeyExpression('0', 'Digit0'))
  await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '1'`,
    '100% reset after precision-wheel gesture',
  )

  // 1) 容器上不再有外部 CSS zoom（无法编辑的根因）
  const containerZoom = await evaluate(
    send,
    `(() => {
      const el = document.querySelector('.superdoc-editor-container')
      return el ? String(getComputedStyle(el).zoom ?? '1') : null
    })()`,
  )
  check('no external CSS zoom on .superdoc-editor-container', containerZoom === '1' || containerZoom === 'normal',
    `computed zoom=${containerZoom}`)

  // 2) 100% 基线：标尺宽度与页面宽度对齐（旧 CSS 在 100% 时就是错的）
  const rulerBaseline = await evaluate(
    send,
    `(() => {
      const ruler = document.querySelector('.ruler-wrapper') || document.querySelector('.superdoc-ruler')
      const page = document.querySelector('.superdoc-page')
      if (!ruler || !page) return null
      const r = ruler.getBoundingClientRect()
      const p = page.getBoundingClientRect()
      return { ruler: r.width, page: p.width, delta: Math.abs(r.width - p.width) }
    })()`,
  )
  check('ruler width matches page width at 100%', rulerBaseline && rulerBaseline.delta <= 6,
    rulerBaseline ? `ruler=${rulerBaseline.ruler.toFixed(1)} page=${rulerBaseline.page.toFixed(1)}` : 'ruler or page missing')

  // 3) 100% 基线编辑（真实鼠标 + 输入管线）
  const baseEdit = await clickFirstLineAndType(send, 1, 'BASEEDIT')
  check('baseline click targeted page 1 first line', baseEdit.clicked,
    baseEdit.clicked ? `(${baseEdit.x?.toFixed(0)},${baseEdit.y?.toFixed(0)})` : 'no target rect')
  let baseHit = null
  try {
    baseHit = await waitFor(send, editorTextExpression('BASEEDIT'), 'BASEEDIT to land in the document', 8_000)
  } catch {}
  check('typing at 100% zoom lands in the document', Boolean(baseHit),
    baseHit ? JSON.stringify(baseHit) : 'marker not found in hidden host or painted pages')

  // 4) 70% 仍为单页；降到 60% 且宽度足够时自动进入双页。
  for (let i = 0; i < 3; i++) {
    await evaluate(send, zoomKeyExpression('-', 'Minus'))
    await sleep(120)
  }
  const verticalAt70 = await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '0.7'
      && document.querySelector('.word-document-layout')?.dataset.wordLayoutMode === 'vertical'`,
    'single-page layout at 70% zoom',
    10_000,
  )
  check('70% stays in single-page layout', Boolean(verticalAt70))

  await evaluate(send, zoomKeyExpression('-', 'Minus'))
  const bookAt60 = await waitFor(
    send,
    `(() => {
      const root = document.querySelector('.document-zoom-root')
      const layout = document.querySelector('.word-document-layout')
      const firstSpread = document.querySelector('.presentation-editor__pages > .superdoc-spread')
      const indices = firstSpread
        ? Array.from(firstSpread.querySelectorAll(':scope > .superdoc-page')).map((page) => page.dataset.pageIndex)
        : []
      return root?.dataset.documentZoom === '0.6'
        && layout?.dataset.wordLayoutMode === 'book'
        && indices.join(',') === '0,1'
        ? { indices, pageCount: document.querySelectorAll('.superdoc-page').length }
        : null
    })()`,
    'two-page layout at 60% zoom',
    30_000,
  )
  check('60% shows pages 1 and 2 side by side, including documents over 40 pages',
    bookAt60?.pageCount === FIXTURE_PAGE_COUNT,
    bookAt60 ? `first pair=${bookAt60.indices.join(',')} pages=${bookAt60.pageCount}` : '')

  const rulerAt60 = await evaluate(
    send,
    `(() => {
      const [page] = Array.from(document.querySelectorAll(
        '.presentation-editor__pages > .superdoc-spread:first-child > .superdoc-page',
      ))
      const ruler = document.querySelector('.ruler-wrapper')
      if (!page || !ruler) return null
      const p = page.getBoundingClientRect()
      const r = ruler.getBoundingClientRect()
      return {
        widthDelta: Math.abs(p.width - r.width),
        leftDelta: Math.abs(p.left - r.left),
        page: { left: p.left, width: p.width },
        ruler: { left: r.left, width: r.width },
      }
    })()`,
  )
  check('top ruler stays aligned with a page in two-page layout',
    rulerAt60 && rulerAt60.widthDelta <= 6 && rulerAt60.leftDelta <= 6,
    JSON.stringify(rulerAt60))

  // 4b) 相同缩放在窄窗口放不下两页时回单列；恢复宽度后重新双页。
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1000, height: 900, deviceScaleFactor: 0, mobile: false,
  })
  const narrowVertical = await waitFor(
    send,
    `document.querySelector('.word-document-layout')?.dataset.wordLayoutMode === 'vertical'`,
    'single-page fallback in a narrow window',
    20_000,
  )
  check('narrow window falls back to one page without clipping the layout', Boolean(narrowVertical))
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600, height: 900, deviceScaleFactor: 0, mobile: false,
  })
  const wideBookAgain = await waitFor(
    send,
    `document.querySelector('.word-document-layout')?.dataset.wordLayoutMode === 'book'`,
    'two-page layout after restoring window width',
    30_000,
  )
  check('restoring window width returns to two pages', Boolean(wideBookAgain))

  // 4c) 继续缩小到 30%：原生 setZoom 应用 transform scale。
  for (let i = 0; i < 3; i++) {
    await evaluate(send, zoomKeyExpression('-', 'Minus'))
    await sleep(120)
  }
  const zoomState = await waitFor(
    send,
    `(() => {
      const root = document.querySelector('.document-zoom-root')
      const pages = document.querySelector('.presentation-editor__pages')
      if (!root || !pages) return null
      const z = root.dataset.documentZoom
      const transform = pages.style.transform || ''
      return z === '0.3' && transform.includes('scale(0.3') ? { z, transform } : null
    })()`,
    'native zoom 30% (dataset + pages transform)',
    10_000,
  )
  check('Ctrl+- drives native superdoc.setZoom (transform on pages host)', Boolean(zoomState),
    zoomState ? `${zoomState.transform}` : '')

  // 5) 双页（book）模式：从首页开始每两页一排。
  const bookState = await waitFor(
    send,
    `(() => {
      const layout = document.querySelector('.word-document-layout')
      if (!layout || layout.dataset.wordLayoutMode !== 'book') return null
      const spread = Array.from(document.querySelectorAll('.superdoc-spread')).find(
        (el) => el.querySelectorAll('.superdoc-page').length >= 2,
      )
      if (!spread) return null
      const [a, b] = spread.querySelectorAll('.superdoc-page')
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      const sideBySide = Math.abs(ra.top - rb.top) < 4 && rb.left >= ra.right - 2
      return sideBySide ? { aLeft: ra.left, bLeft: rb.left, top: ra.top } : null
    })()`,
    'book layout with two side-by-side pages',
    15_000,
  )
  check('zoomed-out view lays two pages side by side (book mode)', Boolean(bookState),
    bookState ? `page lefts ${bookState.aLeft.toFixed(0)} / ${bookState.bLeft.toFixed(0)}` : '')

  // 5b) book 模式无横向裁剪：对开完整落在文档列内，且视口宽 ≈ 对开宽 × zoom
  //（引擎 #applyZoom 无 book 分支，宽度按单页算 → 由 WordDocumentLayout 修正）
  const bookGeometry = await waitFor(
    send,
    `(() => {
      const subDoc = document.querySelector('.superdoc__sub-document')
      const viewport = document.querySelector('.presentation-editor__viewport')
      const spread = document.querySelector('.superdoc-spread')
      if (!subDoc || !viewport || !spread) return null
      const s = subDoc.getBoundingClientRect()
      const v = viewport.getBoundingClientRect()
      const sp = spread.getBoundingClientRect()
      const noClip = sp.left >= s.left - 2 && sp.right <= s.right + 2
      const wideEnough = v.width >= sp.width - 4
      return noClip && wideEnough
        ? { subDoc: [s.left, s.width], viewport: v.width, spread: [sp.left, sp.width] }
        : null
    })()`,
    'book spread fully visible (no horizontal clipping)',
    10_000,
  )
  check('book spread is not horizontally clipped', Boolean(bookGeometry),
    bookGeometry ? `viewport=${bookGeometry.viewport.toFixed(0)} spread=${bookGeometry.spread[1].toFixed(0)}` : '')

  // 5c) 文档列在窗格内水平居中（与全宽的编辑器容器比对，收缩层不可作基准）
  const centered = await evaluate(
    send,
    `(() => {
      const pane = document.querySelector('.superdoc-editor-container')
      const subDoc = document.querySelector('.superdoc__sub-document')
      if (!pane || !subDoc) return null
      const p = pane.getBoundingClientRect()
      const s = subDoc.getBoundingClientRect()
      const delta = Math.abs((s.left + s.width / 2) - (p.left + p.width / 2))
      return { delta: Math.round(delta), paneWidth: Math.round(p.width), subDocWidth: Math.round(s.width) }
    })()`,
  )
  check('document column is horizontally centered in the pane',
    centered && centered.paneWidth > centered.subDocWidth + 40 && centered.delta <= 10,
    centered ? `delta=${centered.delta} pane=${centered.paneWidth} doc=${centered.subDocWidth}` : 'elements missing')

  // 5d) book 模式无死区滚动尾巴（引擎按单列总高算 minHeight，已按内容高度修正）
  const deadTail = await evaluate(
    send,
    `(() => {
      const viewport = document.querySelector('.presentation-editor__viewport')
      const pages = Array.from(document.querySelectorAll('.superdoc-page'))
      if (!viewport || !pages.length) return null
      const v = viewport.getBoundingClientRect()
      const tops = pages.map((p) => p.getBoundingClientRect().top)
      const bottoms = pages.map((p) => p.getBoundingClientRect().bottom)
      const contentH = Math.max(...bottoms) - Math.min(...tops)
      const host = document.querySelector('.presentation-editor__pages')
      return {
        viewportH: Math.round(v.height), contentH: Math.round(contentH), tail: Math.round(v.height - contentH),
        styles: {
          vpWidth: viewport.style.width, vpMinH: viewport.style.minHeight,
          hostW: host?.style.width, hostMinH: host?.style.minHeight,
          hostMB: host?.style.marginBottom, hostScrollH: host?.scrollHeight,
          hostTransform: host?.style.transform, viewportCount: document.querySelectorAll('.presentation-editor__viewport').length,
        },
      }
    })()`,
  )
  check('book mode has no dead scroll tail below the last spread',
    deadTail && deadTail.tail <= 40,
    deadTail
      ? `viewport=${deadTail.viewportH} content=${deadTail.contentH} tail=${deadTail.tail} styles=${JSON.stringify(deadTail.styles)}`
      : 'elements missing')

  const visiblePages = await evaluate(
    send,
    `(() => {
      const vh = window.innerHeight
      return Array.from(document.querySelectorAll('.superdoc-page')).filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.bottom > 0 && r.top < vh
      }).length
    })()`,
  )
  check('at 30% zoom at least 4 pages are visible in the viewport', visiblePages >= 4,
    `visible=${visiblePages}`)

  await fs.promises.mkdir(artifactDir, { recursive: true })
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await fs.promises.writeFile(screenshotPath, Buffer.from(shot.result.data, 'base64'))
  console.log(`[info] book-mode screenshot: ${screenshotPath}`)

  // 6) 关键回归：book 模式 + 30% 缩放下仍可编辑（点击命中 + 输入落点正确）
  const bookEdit = await clickFirstLineAndType(send, 2, 'ZOOMEDIT')
  check('book-mode click targeted page 2 first line', bookEdit.clicked,
    bookEdit.clicked ? `(${bookEdit.x?.toFixed(0)},${bookEdit.y?.toFixed(0)})` : 'no target rect')
  let zoomHit = null
  try {
    zoomHit = await waitFor(send, editorTextExpression('ZOOMEDIT'), 'ZOOMEDIT to land in the document', 8_000)
  } catch {}
  check('typing at 30% zoom in book mode lands in the document', Boolean(zoomHit),
    zoomHit ? JSON.stringify(zoomHit) : 'marker not found — book-mode editing broken')

  // 7) Ctrl+0 复位：回单列 vertical，spread 消失
  await evaluate(send, zoomKeyExpression('0', 'Digit0'))
  const verticalBack = await waitFor(
    send,
    `(() => {
      const layout = document.querySelector('.word-document-layout')
      const root = document.querySelector('.document-zoom-root')
      return layout?.dataset.wordLayoutMode === 'vertical' && root?.dataset.documentZoom === '1'
        && document.querySelectorAll('.superdoc-spread .superdoc-page').length === 0
        ? true : null
    })()`,
    'return to vertical single-column at 100%',
    15_000,
  )
  check('Ctrl+0 returns to single-column vertical layout', Boolean(verticalBack))

  // 8) 模式往返后编辑仍正常（setLayoutMode 重建画布的回归点）
  const backEdit = await clickFirstLineAndType(send, 1, 'BACKEDIT')
  let backHit = null
  try {
    backHit = await waitFor(send, editorTextExpression('BACKEDIT'), 'BACKEDIT to land in the document', 8_000)
  } catch {}
  check('editing still works after layout-mode round trip', Boolean(backEdit.clicked && backHit),
    backHit ? JSON.stringify(backHit) : 'marker not found after round trip')

  const relatedErrors = [...rendererExceptions, ...rendererConsoleErrors].filter((text) =>
    /setLayoutMode|WordDocumentLayout|setZoom|presentation/i.test(String(text)),
  )
  check('no zoom/layout-related renderer errors', relatedErrors.length === 0,
    relatedErrors.slice(0, 3).join(' | '))
} catch (error) {
  check('verifier completed without harness errors', false, String(error?.stack || error))
} finally {
  if (cdp) {
    try { cdp.close() } catch {}
  }
  if (child) {
    try { child.kill() } catch {}
  }
  try { fs.rmSync(fixtureDir, { recursive: true, force: true }) } catch {}
  try { fs.rmSync(profileDir, { recursive: true, force: true }) } catch {}
}

const failed = results.filter((entry) => !entry.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (rendererConsoleErrors.length) {
  console.log(`[info] renderer console errors (${rendererConsoleErrors.length}):`)
  for (const line of rendererConsoleErrors.slice(0, 10)) console.log(`  - ${line}`)
}
process.exit(failed.length ? 1 : 0)
