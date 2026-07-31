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

/** 6 页 docx：每页一段可识别文本 + 显式分页符 */
async function buildDocxFixture(filePath) {
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  const wNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const paragraphs = []
  for (let page = 1; page <= 6; page++) {
    paragraphs.push(
      `<w:p><w:r><w:t xml:space="preserve">WORD ZOOM FIXTURE PAGE ${page} — the quick brown fox jumps over the lazy dog.</w:t></w:r></w:p>`,
    )
    if (page < 6) {
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
await buildDocxFixture(fixturePath)

const rendererExceptions = []
const rendererConsoleErrors = []
let child = null
let cdp = null

try {
  const port = await getFreePort()
  child = spawn(electronPath, [`--remote-debugging-port=${port}`, root], {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
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

  // 视口固定 1600×900：保证中栏放得下两页并排（book 阈值 1700px × zoom）
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

  // 4) 缩小到 30%（7 × Ctrl+-）：原生 setZoom 应用 transform scale
  for (let i = 0; i < 7; i++) {
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

  // 5) 双页（book）模式：两页并排（首页单独居中，其后成对）
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
}

const failed = results.filter((entry) => !entry.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (rendererConsoleErrors.length) {
  console.log(`[info] renderer console errors (${rendererConsoleErrors.length}):`)
  for (const line of rendererConsoleErrors.slice(0, 10)) console.log(`  - ${line}`)
}
process.exit(failed.length ? 1 : 0)
