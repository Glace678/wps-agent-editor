// 双页（book）模式下右页标尺镜像的端到端验证。
// 前置：npm run build（需要 out/renderer）；Node 22+（全局 WebSocket）。
// 覆盖：镜像存在性与对齐、刻度与主标尺一致、无重复 id、假手柄已隐藏、
// 缩放变化后重新同步、退出双页后镜像移除。
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
const screenshotPath = path.join(artifactDir, 'electron-verify-word-book-ruler.png')

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

const FIXTURE_PAGE_COUNT = 8

/** 多页 docx：双页并排需要至少两页。 */
async function buildDocxFixture(filePath) {
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  const wNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const paragraphs = []
  for (let page = 1; page <= FIXTURE_PAGE_COUNT; page++) {
    const text =
      page === 1
        ? 'RULER MIRROR FIXTURE'
        : `BOOK RULER PAGE ${page} — the quick brown fox jumps over the lazy dog.`
    paragraphs.push(
      `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`,
    )
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
      '</w:styles>',
  )
  zip.file('word/document.xml', documentXml)
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  fs.writeFileSync(filePath, buffer)
}

function zoomKeyExpression(key, code) {
  return `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, ctrlKey: true, bubbles: true, cancelable: true })), true`
}

/** book 模式下主标尺/镜像/两页的几何关系；任何一环缺失返回 null */
const rulerGeometryExpression = `(() => {
  const layout = document.querySelector('.word-document-layout')
  if (layout?.dataset.wordLayoutMode !== 'book') return null
  const spread = document.querySelector('.presentation-editor__pages > .superdoc-spread')
  const [leftPage, rightPage] = spread ? spread.children : []
  const host = document.querySelector('.ruler-host')
  const ruler = host?.querySelector(':scope > .ruler:not(.word-ruler-mirror)')
  const mirror = host?.querySelector(':scope > .word-ruler-mirror')
  if (!leftPage || !rightPage || !ruler || !mirror) return null
  const rp = ruler.getBoundingClientRect()
  const mp = mirror.getBoundingClientRect()
  const lp = leftPage.getBoundingClientRect()
  const rpp = rightPage.getBoundingClientRect()
  const hostIds = Array.from(host.querySelectorAll('[id]')).map((el) => el.id)
  const indicator = mirror.querySelector('.vertical-indicator')
  return {
    rulerLeftDelta: Math.abs(rp.left - lp.left),
    mirrorLeftDelta: Math.abs(mp.left - rpp.left),
    mirrorWidthDelta: Math.abs(mp.width - lp.width),
    gap: rpp.left - lp.right,
    mirrorTicks: mirror.querySelectorAll('.ruler-tick').length,
    rulerTicks: ruler.querySelectorAll('.ruler-tick').length,
    mirrorLabels: Array.from(mirror.querySelectorAll('.numbering')).map((n) => n.textContent).join(','),
    rulerLabels: Array.from(ruler.querySelectorAll('.numbering')).map((n) => n.textContent).join(','),
    uniqueIds: new Set(hostIds).size === hostIds.length,
    handlesHidden: Array.from(mirror.querySelectorAll('.margin-handle'))
      .every((h) => getComputedStyle(h).display === 'none'),
    indicatorHidden: !indicator || getComputedStyle(indicator).display === 'none',
  }
})()`

if (!fs.existsSync(rendererEntry)) {
  console.error('Built renderer is missing. Run `npm run build` before this verifier.')
  process.exit(1)
}

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-word-book-ruler-verify-'))
const fixturePath = path.join(fixtureDir, 'word-book-ruler-verification.docx')
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-word-book-ruler-profile-'))
await buildDocxFixture(fixturePath)

const rendererExceptions = []
const rendererConsoleErrors = []
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
  })
  const { send } = cdp
  await send('Runtime.enable')
  await send('Console.enable')
  await send('Page.enable')

  // 视口 1600×900：默认三栏下 60% 可放下两张 A4，与 zoom 验证脚本一致
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600, height: 900, deviceScaleFactor: 0, mobile: false,
  })

  await waitFor(
    send,
    `document.getElementById('root')?.childElementCount > 0`,
    'the React application to render',
  )

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
      return { opened: false };
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

  // 60% 进入双页
  for (let i = 0; i < 4; i++) {
    await evaluate(send, zoomKeyExpression('-', 'Minus'))
    await sleep(120)
  }
  const bookAt60 = await waitFor(
    send,
    `document.querySelector('.document-zoom-root')?.dataset.documentZoom === '0.6'
      && document.querySelector('.word-document-layout')?.dataset.wordLayoutMode === 'book'`,
    'two-page layout at 60% zoom',
    30_000,
  )
  check('60% zoom enters two-page layout', Boolean(bookAt60))

  const mirrorAt60 = await waitFor(send, rulerGeometryExpression, 'the right-page ruler mirror', 20_000)
  check('right-page ruler mirror exists and sits on the right page',
    mirrorAt60.mirrorLeftDelta <= 2 && mirrorAt60.mirrorWidthDelta <= 2,
    `leftDelta=${mirrorAt60.mirrorLeftDelta.toFixed(2)} widthDelta=${mirrorAt60.mirrorWidthDelta.toFixed(2)} gap=${mirrorAt60.gap.toFixed(1)}`)
  check('left-page ruler stays aligned with the left page',
    mirrorAt60.rulerLeftDelta <= 2, `leftDelta=${mirrorAt60.rulerLeftDelta.toFixed(2)}`)
  check('mirror repeats every tick and label of the primary ruler',
    mirrorAt60.rulerTicks > 0
      && mirrorAt60.mirrorTicks === mirrorAt60.rulerTicks
      && mirrorAt60.mirrorLabels === mirrorAt60.rulerLabels,
    `ticks=${mirrorAt60.mirrorTicks}/${mirrorAt60.rulerTicks} labels=${mirrorAt60.mirrorLabels}`)
  check('mirror clone keeps the DOM free of duplicate ids', mirrorAt60.uniqueIds)
  check('inert margin handles and cursor indicator are hidden on the mirror',
    mirrorAt60.handlesHidden && mirrorAt60.indicatorHidden,
    `handles=${mirrorAt60.handlesHidden} indicator=${mirrorAt60.indicatorHidden}`)

  await fs.promises.mkdir(artifactDir, { recursive: true })
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await fs.promises.writeFile(screenshotPath, Buffer.from(shot.result.data, 'base64'))
  console.log(`[info] book-ruler screenshot: ${screenshotPath}`)

  // 缩放到 30%：镜像必须跟着重新同步（刻度变密、平移量随 gap×zoom 变化）
  for (let i = 0; i < 3; i++) {
    await evaluate(send, zoomKeyExpression('-', 'Minus'))
    await sleep(120)
  }
  await waitFor(
    send,
    `(() => {
      const pages = document.querySelector('.presentation-editor__pages')
      const root = document.querySelector('.document-zoom-root')
      return root?.dataset.documentZoom === '0.3'
        && (pages?.style.transform || '').includes('scale(0.3')
    })()`,
    'native zoom 30% (dataset + pages transform)',
    10_000,
  )
  const mirrorAt30 = await waitFor(send, rulerGeometryExpression, 'the re-synced mirror at 30%', 20_000)
  check('mirror re-syncs after zooming to 30% and stays on the right page',
    mirrorAt30.mirrorLeftDelta <= 2 && mirrorAt30.mirrorWidthDelta <= 2,
    `leftDelta=${mirrorAt30.mirrorLeftDelta.toFixed(2)} widthDelta=${mirrorAt30.mirrorWidthDelta.toFixed(2)} gap=${mirrorAt30.gap.toFixed(1)}`)

  // 回到 100% 单列：镜像必须移除，不能残留第二条标尺
  await evaluate(send, zoomKeyExpression('0', 'Digit0'))
  const verticalBack = await waitFor(
    send,
    `(() => {
      const layout = document.querySelector('.word-document-layout')
      return layout?.dataset.wordLayoutMode === 'vertical'
        && !document.querySelector('.word-ruler-mirror')
        ? true : null
    })()`,
    'mirror removed after returning to single-page layout',
    15_000,
  )
  check('mirror is removed when leaving two-page layout', Boolean(verticalBack))

  const relatedErrors = [...rendererExceptions, ...rendererConsoleErrors].filter((text) =>
    /mirror|ruler|WordDocumentLayout|setLayoutMode|setZoom|presentation/i.test(String(text)),
  )
  check('no ruler/layout-related renderer errors', relatedErrors.length === 0,
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
