// Word 页面拼接（双击页间黑边隐藏空白 / 双击接缝恢复）的端到端验证。
// 前置：npm run build（需要 out/renderer）；Node 22+（全局 WebSocket）。
// 关键点：
// - 双击必须走 CDP Input.dispatchMouseEvent（真实输入管线 + 浏览器命中检测），
//   页内合成事件测不出命中带遮挡/坐标错位这类 bug；
// - 拼接改的是引擎内部 pageGap，验证要同时盯 DOM 间距（视觉）与拼接态下的
//   点击编辑（几何一致性）——两者只要有一个错，说明视觉与坐标已脱钩。
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

/** 6 页 docx：每页一段可识别文本 + 显式分页符 */
async function buildDocxFixture(filePath) {
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  const wNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const paragraphs = []
  for (let page = 1; page <= 6; page++) {
    paragraphs.push(
      `<w:p><w:r><w:t xml:space="preserve">WORD STITCH FIXTURE PAGE ${page} — the quick brown fox jumps over the lazy dog.</w:t></w:r></w:p>`,
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

async function clickAt(send, x, y) {
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse',
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse',
  })
}

/** 真实双击：两组 press/release，第二组 clickCount=2（浏览器据此合成 dblclick） */
async function dblClickAt(send, x, y) {
  await clickAt(send, x, y)
  await sleep(60)
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 2, pointerType: 'mouse',
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', clickCount: 2, pointerType: 'mouse',
  })
}

/** 相邻已挂载页两两之间的视觉间距（虚拟化 pinned 页之间的 spacer 区段跳过） */
function gapsExpression() {
  return `(() => {
    const pages = Array.from(document.querySelectorAll('.presentation-editor__pages .superdoc-page[data-page-index]'))
      .map((el) => ({ el, i: parseInt(el.getAttribute('data-page-index') ?? '', 10) }))
      .filter((p) => Number.isFinite(p.i))
      .sort((a, b) => a.i - b.i)
    const gaps = []
    for (let k = 0; k + 1 < pages.length; k++) {
      if (pages[k + 1].i !== pages[k].i + 1) continue
      gaps.push({
        upper: pages[k].i,
        gap: pages[k + 1].el.getBoundingClientRect().top - pages[k].el.getBoundingClientRect().bottom,
      })
    }
    return gaps.length ? gaps : null
  })()`
}

/** 点击第 pageNumber 页第一行中心，再经真实输入管线插入 marker。
 * 布局切换/虚拟化会随时重建页面元素——scrollIntoView 必须在轮询里对
 * 当前元素反复执行（对已被替换的旧元素调用是无操作），直到目标行进入
 * 视口且矩形连续两次采样稳定，再取坐标点击；返回命中/焦点诊断 */
async function clickFirstLineAndType(send, pageNumber, marker) {
  let target = null
  let prevTop = null
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const sample = await evaluate(
      send,
      `(() => {
        const page = document.querySelector('.superdoc-page[data-page-number="${pageNumber}"]')
          || document.querySelectorAll('.superdoc-page')[${pageNumber - 1}]
        if (!page) return null
        const el = page.querySelector('.superdoc-line') || page
        const rect = el.getBoundingClientRect()
        if (!rect.width || !rect.height) return null
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        if (y < 80 || y > window.innerHeight - 20) {
          el.scrollIntoView({ block: 'center' })
          return { scrolled: true, top: rect.top }
        }
        const hit = document.elementFromPoint(x, y)
        return { x, y, top: rect.top, hitClass: hit ? String(hit.className).slice(0, 60) : null }
      })()`,
    )
    if (sample && !sample.scrolled && prevTop != null && Math.abs(sample.top - prevTop) < 0.5) {
      target = sample
      break
    }
    prevTop = sample && !sample.scrolled ? sample.top : null
    await sleep(150)
  }
  if (!target) return { clicked: false }
  await clickAt(send, target.x, target.y)
  await sleep(400)
  const focusInfo = await evaluate(
    send,
    `(() => {
      const ae = document.activeElement
      return ae ? String(ae.className || ae.tagName).slice(0, 60) : null
    })()`,
  )
  await send('Input.insertText', { text: marker })
  return { clicked: true, ...target, focusInfo }
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

/** 真实滚动容器按能力探测（superdoc 多层包装 shrink-to-fit，滚动者是
 * 内层 .super-editor-container，与引擎 #findScrollableAncestor 一致） */
const scrollerExpression = `(() => {
  let el = document.querySelector('.word-document-layout .presentation-editor__pages')?.parentElement
  while (el) {
    const cs = getComputedStyle(el)
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el
    el = el.parentElement
  }
  return null
})()`

/** 把「页 upperIndex 与下一页之间」滚到滚动容器视口中部；
 * 目标页可能已被虚拟化卸载，先粗略跳到其附近等它重新挂载 */
async function scrollGapIntoView(send, upperIndex) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const done = await evaluate(
      send,
      `(() => {
        const scroller = ${scrollerExpression}
        if (!scroller) return null
        const a = document.querySelector('.superdoc-page[data-page-index="${upperIndex}"]')
        if (!a) {
          // 未挂载：按页高估算位置跳过去，等虚拟化把它挂回来
          const any = document.querySelector('.superdoc-page[data-page-index]')
          const pageStride = any ? any.getBoundingClientRect().height + 24 : 1080
          scroller.scrollTop = Math.max(0, ${upperIndex} * pageStride + pageStride / 2)
          return false
        }
        const sr = scroller.getBoundingClientRect()
        scroller.scrollTop += a.getBoundingClientRect().bottom - (sr.top + sr.height / 2)
        return true
      })()`,
    )
    if (done) return true
    await sleep(300)
  }
  throw new Error(`page ${upperIndex} never mounted for scrollGapIntoView`)
}

if (!fs.existsSync(rendererEntry)) {
  console.error('Built renderer is missing. Run `npm run build` before this verifier.')
  process.exit(1)
}

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-word-stitch-verify-'))
const fixturePath = path.join(fixtureDir, 'word-stitch-verification.docx')
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-word-stitch-profile-'))
await buildDocxFixture(fixturePath)

const rendererExceptions = []
const rendererConsoleErrors = []
let child = null
let cdp = null

try {
  const port = await getFreePort()
  // 独立 profile：避免用户 profile 里持久化的侧栏折叠/缩放状态影响
  // fiber 查找 onOpenFile 与布局阈值；多实例开关允许与开发实例共存
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
    width: 1600, height: 900, deviceScaleFactor: 0, mobile: false,
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
    `document.querySelectorAll('.superdoc-page').length >= 2`,
    'SuperDoc layout-engine pages to paint',
    60_000,
  )

  // 1) 基线：相邻页间有明显间距（默认 24px），且间隙命中带已渲染
  const baselineGaps = await waitFor(send, gapsExpression(), 'page gap measurements', 20_000)
  const baselineGap = baselineGaps[0]?.gap ?? 0
  check('baseline: adjacent pages separated by the engine page gap', baselineGap >= 12 && baselineGap <= 48,
    `gap(0,1)=${baselineGap.toFixed(1)}px`)

  // 2) 把第 1、2 页间隙滚入视口中部（命中带只对滚动视口内的间隙渲染），
  //    确认命中带真实可命中（elementFromPoint）
  await scrollGapIntoView(send, 0)
  await sleep(300)
  const gapBand = await waitFor(
    send,
    `(() => {
      const el = document.querySelector('[data-testid="word-page-gap"][data-upper-page-index="0"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      if (r.height < 4 || r.top < 0) return null
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }
    })()`,
    'gap band between pages 1 and 2 to be visible',
    10_000,
  )
  const hitTest = await evaluate(
    send,
    `(() => {
      const el = document.elementFromPoint(${gapBand.x}, ${gapBand.y})
      return Boolean(el && el.closest('[data-testid="word-page-gap"]'))
    })()`,
  )
  check('gap band is the topmost element at the gap center (real hit-testing)', hitTest,
    `point=(${gapBand.x.toFixed(0)},${gapBand.y.toFixed(0)}) bandHeight=${gapBand.h.toFixed(1)}`)

  // 3) 双击黑边 → 所有页面拼接（间距归零 + 拼接标记 + 接缝命中带）
  const anchorTopBefore = await evaluate(
    send,
    `document.querySelector('.superdoc-page[data-page-index="0"]').getBoundingClientRect().top`,
  )
  await dblClickAt(send, gapBand.x, gapBand.y)
  await waitFor(
    send,
    `document.querySelector('.word-document-layout')?.dataset.wordStitched === 'true'`,
    'stitched attribute after double-clicking the gap',
    10_000,
  )
  const stitchedGaps = await waitFor(
    send,
    `(() => {
      const gaps = ${gapsExpression()}
      return gaps && gaps.every((g) => Math.abs(g.gap) < 3) ? gaps : null
    })()`,
    'all adjacent page gaps to collapse to 0',
    15_000,
  )
  check('double-click on the gap stitches all pages together', Boolean(stitchedGaps),
    `gaps=[${stitchedGaps.map((g) => g.gap.toFixed(1)).join(', ')}]`)
  const seamCount = await evaluate(
    send,
    `document.querySelectorAll('[data-testid="word-page-seam"]').length`,
  )
  check('seam hit-bands rendered in stitched mode', seamCount >= 1, `seams=${seamCount}`)

  // 4) 滚动锚定：被双击间隙上方的页面在视口中大致原位（Word 同款体验）
  const anchorTopAfter = await evaluate(
    send,
    `document.querySelector('.superdoc-page[data-page-index="0"]').getBoundingClientRect().top`,
  )
  check('scroll anchoring keeps the clicked page in place',
    Math.abs(anchorTopAfter - anchorTopBefore) <= 8,
    `before=${anchorTopBefore.toFixed(1)} after=${anchorTopAfter.toFixed(1)}`)

  // 5) 拼接态下的几何一致性：真实点击第 2 页文本行并输入，必须落进文档
  const stitchedEdit = await clickFirstLineAndType(send, 2, 'STITCHEDIT')
  check('stitched: click targeted page 2 first line', stitchedEdit.clicked,
    stitchedEdit.clicked
      ? `(${stitchedEdit.x?.toFixed(0)},${stitchedEdit.y?.toFixed(0)}) hit=${stitchedEdit.hitClass} focus=${stitchedEdit.focusInfo}`
      : 'no target rect')
  let stitchedHit = null
  try {
    stitchedHit = await waitFor(send, editorTextExpression('STITCHEDIT'), 'STITCHEDIT to land', 8_000)
  } catch {}
  check('stitched: typing lands in the document (pointer mapping intact)', Boolean(stitchedHit),
    stitchedHit ? JSON.stringify(stitchedHit) : 'marker not found')

  // 6) 拼接态滚动到文档尾部：虚拟化新挂载的页同样零间距
  await evaluate(
    send,
    `(() => {
      const scroller = ${scrollerExpression}
      if (!scroller) return null
      scroller.scrollTop = scroller.scrollHeight
      return true
    })()`,
  )
  const tailGaps = await waitFor(
    send,
    `(() => {
      const gaps = ${gapsExpression()}
      if (!gaps || !gaps.some((g) => g.upper >= 3)) return null
      return gaps.every((g) => Math.abs(g.gap) < 3) ? gaps : null
    })()`,
    'freshly mounted tail pages to keep zero gap',
    15_000,
  )
  check('virtualized remount while scrolled keeps pages stitched', Boolean(tailGaps),
    `gaps=[${tailGaps.map((g) => `${g.upper}:${g.gap.toFixed(1)}`).join(', ')}]`)

  // 截图存档：拼接态
  await fs.promises.mkdir(artifactDir, { recursive: true })
  const stitchedShot = await send('Page.captureScreenshot', { format: 'png' })
  await fs.promises.writeFile(
    path.join(artifactDir, 'electron-verify-word-stitch-stitched.png'),
    Buffer.from(stitchedShot.result.data, 'base64'),
  )

  // 7) 双击接缝 → 全部拆分恢复
  await scrollGapIntoView(send, 0)
  await sleep(300)
  const seamBand = await waitFor(
    send,
    `(() => {
      const el = document.querySelector('[data-testid="word-page-seam"][data-upper-page-index="0"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      if (r.height < 4 || r.top < 0) return null
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`,
    'seam band between pages 1 and 2 to be visible',
    10_000,
  )
  await dblClickAt(send, seamBand.x, seamBand.y)
  await waitFor(
    send,
    `document.querySelector('.word-document-layout')?.dataset.wordStitched !== 'true'`,
    'stitched attribute removed after double-clicking the seam',
    10_000,
  )
  const restoredGaps = await waitFor(
    send,
    `(() => {
      const gaps = ${gapsExpression()}
      return gaps && gaps.every((g) => g.gap >= 12 && g.gap <= 48) ? gaps : null
    })()`,
    'page gaps to be restored to the original size',
    15_000,
  )
  check('double-click on the seam splits pages back apart', Boolean(restoredGaps),
    `gaps=[${restoredGaps.map((g) => g.gap.toFixed(1)).join(', ')}]`)
  const restoredDelta = Math.abs((restoredGaps[0]?.gap ?? 0) - baselineGap)
  check('restored gap matches the original engine gap', restoredDelta <= 2,
    `baseline=${baselineGap.toFixed(1)} restored=${(restoredGaps[0]?.gap ?? 0).toFixed(1)}`)

  // 8) 恢复后再次编辑，坐标换算依旧正常
  const splitEdit = await clickFirstLineAndType(send, 1, 'SPLITEDIT')
  check('restored: click targeted page 1 first line', splitEdit.clicked,
    splitEdit.clicked
      ? `(${splitEdit.x?.toFixed(0)},${splitEdit.y?.toFixed(0)}) hit=${splitEdit.hitClass} focus=${splitEdit.focusInfo}`
      : 'no target rect')
  let splitHit = null
  try {
    splitHit = await waitFor(send, editorTextExpression('SPLITEDIT'), 'SPLITEDIT to land', 8_000)
  } catch {}
  check('restored: typing lands in the document', Boolean(splitHit),
    splitHit ? JSON.stringify(splitHit) : 'marker not found')

  const restoredShot = await send('Page.captureScreenshot', { format: 'png' })
  await fs.promises.writeFile(
    path.join(artifactDir, 'electron-verify-word-stitch-restored.png'),
    Buffer.from(restoredShot.result.data, 'base64'),
  )

  // 9) 全程无功能相关渲染进程报错
  const relevant = /WordPageStitch|WordDocumentLayout|setLayoutMode|presentation|stitch/i
  const badExceptions = rendererExceptions.filter((text) => relevant.test(text))
  const badErrors = rendererConsoleErrors.filter((text) => relevant.test(text))
  check('no stitch/layout-related renderer errors', badExceptions.length === 0 && badErrors.length === 0,
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
