import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronPath = require('electron')
const rendererEntry = path.join(root, 'out', 'renderer', 'index.html')
const cacheDirectory = path.join(root, '.cache')
const screenshotPath = path.join(cacheDirectory, 'electron-verify-presentation.png')
const toolbarTooltipScreenshotPath = path.join(cacheDirectory, 'electron-verify-presentation-toolbar-tooltip.png')
const resizerScreenshotPath = path.join(cacheDirectory, 'electron-verify-presentation-resizer.png')
const fullscreenScreenshotPath = path.join(cacheDirectory, 'electron-verify-presentation-fullscreen.png')
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-presentation-profile-'))
const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-presentation-fixture-'))
const fixturePath = path.join(fixtureDirectory, 'presentation-playback.pptx')
const legacyFixturePath = path.join(fixtureDirectory, 'presentation-playback-legacy.ppt')
const wmfFixturePath = path.join(fixtureDirectory, 'presentation-shape.wmf')
const externalFixturePath = process.env.WPS_PRESENTATION_VERIFY_INPUT
  ? path.resolve(process.env.WPS_PRESENTATION_VERIFY_INPUT)
  : null
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let injectedSlideXml = ''
let animationTargetShapeId = ''

function createWmfFixture() {
  if (process.platform !== 'win32') return false
  const script = `
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Runtime.InteropServices;
public static class PresentationWmfFixture {
  [DllImport("gdi32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr CreateMetaFile(string fileName);
  [DllImport("gdi32.dll")] public static extern bool Rectangle(IntPtr hdc, int left, int top, int right, int bottom);
  [DllImport("gdi32.dll")] public static extern bool MoveToEx(IntPtr hdc, int x, int y, IntPtr point);
  [DllImport("gdi32.dll")] public static extern bool LineTo(IntPtr hdc, int x, int y);
  [DllImport("gdi32.dll")] public static extern IntPtr CloseMetaFile(IntPtr hdc);
  [DllImport("gdi32.dll")] public static extern bool DeleteMetaFile(IntPtr hmf);
}
'@
Add-Type -TypeDefinition $source
$dc = [PresentationWmfFixture]::CreateMetaFile($env:WPS_AGENT_WMF_FIXTURE)
if ($dc -eq [IntPtr]::Zero) { throw 'Unable to create WMF fixture' }
[void][PresentationWmfFixture]::Rectangle($dc, 0, 0, 320, 180)
[void][PresentationWmfFixture]::MoveToEx($dc, 0, 0, [IntPtr]::Zero)
[void][PresentationWmfFixture]::LineTo($dc, 320, 180)
$metafile = [PresentationWmfFixture]::CloseMetaFile($dc)
if ($metafile -eq [IntPtr]::Zero) { throw 'Unable to close WMF fixture' }
[void][PresentationWmfFixture]::DeleteMetaFile($metafile)
`
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, WPS_AGENT_WMF_FIXTURE: wmfFixturePath },
    windowsHide: true,
    timeout: 30_000,
    stdio: 'ignore',
  })
  return fs.existsSync(wmfFixturePath) && fs.statSync(wmfFixturePath).size > 0
}

async function injectFixtureMotionAndWmf() {
  const zip = await JSZip.loadAsync(fs.readFileSync(fixturePath))
  const slideEntry = zip.file('ppt/slides/slide1.xml')
  if (!slideEntry) throw new Error('Fixture slide1.xml is missing')
  let slideXml = await slideEntry.async('string')
  const targetTextIndex = slideXml.indexOf('PPTX renderer verification')
  if (targetTextIndex < 0) throw new Error('Animation target text is missing')
  const targetPrefix = slideXml.slice(0, targetTextIndex)
  const shapeMatches = [...targetPrefix.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)]
  const targetShapeId = shapeMatches.at(-1)?.[1]
  if (!targetShapeId) throw new Error('Animation target shape id is missing')
  animationTargetShapeId = targetShapeId

  const motionXml = `<p:transition spd="med"><p:fade/></p:transition><p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="4" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="5" dur="500" fill="hold"/><p:tgtEl><p:spTgt spid="${targetShapeId}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`
  slideXml = slideXml.replace('</p:sld>', `${motionXml}</p:sld>`)
  injectedSlideXml = slideXml
  zip.file('ppt/slides/slide1.xml', slideXml)

  if (fs.existsSync(wmfFixturePath)) {
    const pngMedia = Object.values(zip.files).find(
      (entry) => !entry.dir && /^ppt\/media\/[^/]+\.png$/i.test(entry.name),
    )
    if (!pngMedia) throw new Error('Fixture PNG media is missing')
    const wmfMediaPath = pngMedia.name.replace(/\.png$/i, '.wmf')
    const pngName = path.posix.basename(pngMedia.name)
    const wmfName = path.posix.basename(wmfMediaPath)
    zip.file(wmfMediaPath, fs.readFileSync(wmfFixturePath))
    zip.remove(pngMedia.name)
    for (const entry of Object.values(zip.files).filter((item) => !item.dir && item.name.endsWith('.rels'))) {
      const rels = await entry.async('string')
      if (rels.includes(pngName)) zip.file(entry.name, rels.replaceAll(pngName, wmfName))
    }
    const contentTypes = zip.file('[Content_Types].xml')
    if (contentTypes) {
      const xml = await contentTypes.async('string')
      zip.file('[Content_Types].xml', xml.replace(
        '</Types>',
        '<Default Extension="wmf" ContentType="image/x-wmf"/></Types>',
      ))
    }
  }

  fs.writeFileSync(fixturePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

async function createFixture() {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'WPS Agent Editor verifier'
  pptx.subject = 'Presentation playback verification'
  pptx.title = 'Presentation playback'
  pptx.company = 'WPS Agent Editor'
  pptx.lang = 'zh-CN'
  pptx.theme = {
    headFontFace: 'Aptos Display',
    bodyFontFace: 'Aptos',
    lang: 'zh-CN',
  }

  const first = pptx.addSlide()
  first.background = { color: 'F4F7FB' }
  first.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.22,
    line: { color: 'D24726', transparency: 100 },
    fill: { color: 'D24726' },
  })
  first.addText('Presentation playback', {
    x: 0.8,
    y: 1.15,
    w: 7.5,
    h: 0.75,
    fontFace: 'Aptos Display',
    fontSize: 28,
    bold: true,
    color: '152238',
    margin: 0,
  })
  first.addText('PPTX renderer verification', {
    x: 0.82,
    y: 2.02,
    w: 5.5,
    h: 0.4,
    fontSize: 14,
    color: '526176',
    margin: 0,
  })
  first.addImage({
    data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlTXk0AAAAASUVORK5CYII=',
    x: 12.95,
    y: 7.1,
    w: 0.2,
    h: 0.2,
  })
  first.addShape(pptx.ShapeType.roundRect, {
    x: 8.65,
    y: 1.05,
    w: 3.55,
    h: 3.9,
    rectRadius: 0.08,
    line: { color: 'D24726', width: 1.5 },
    fill: { color: 'FFF4EF' },
  })
  first.addText('3', {
    x: 9.3,
    y: 1.65,
    w: 2.25,
    h: 1.35,
    fontSize: 54,
    bold: true,
    align: 'center',
    color: 'D24726',
    margin: 0,
  })
  first.addText('slides', {
    x: 9.3,
    y: 3.25,
    w: 2.25,
    h: 0.4,
    fontSize: 17,
    align: 'center',
    color: '7C3A2A',
    margin: 0,
  })

  const second = pptx.addSlide()
  second.background = { color: 'FFFFFF' }
  second.addText('Quarterly performance', {
    x: 0.65,
    y: 0.42,
    w: 7.2,
    h: 0.55,
    fontSize: 24,
    bold: true,
    color: '17212B',
    margin: 0,
  })
  second.addChart(pptx.ChartType.bar, [
    {
      name: 'Revenue',
      labels: ['Q1', 'Q2', 'Q3', 'Q4'],
      values: [24, 31, 38, 46],
    },
  ], {
    x: 0.65,
    y: 1.25,
    w: 7.4,
    h: 4.9,
    catAxisLabelFontSize: 11,
    valAxisLabelFontSize: 10,
    showLegend: false,
    showTitle: false,
    chartColors: ['16825D'],
    showValue: true,
    showCatName: false,
    showValAxisTitle: false,
    showCatAxisTitle: false,
    showBorder: false,
  })
  second.addTable([
    [{ text: 'Metric', options: { bold: true } }, { text: 'Result', options: { bold: true } }],
    ['Growth', '+18%'],
    ['Retention', '94%'],
    ['Delivery', 'On track'],
  ], {
    x: 8.55,
    y: 1.48,
    w: 3.95,
    h: 3.05,
    border: { type: 'solid', color: 'CCD4DD', pt: 1 },
    fill: 'F5F8FA',
    color: '253243',
    fontSize: 13,
    margin: 0.12,
    rowH: 0.62,
  })

  const third = pptx.addSlide()
  third.background = { color: '152238' }
  third.addText('Ready to present', {
    x: 0.75,
    y: 1.1,
    w: 7.5,
    h: 0.8,
    fontSize: 30,
    bold: true,
    color: 'FFFFFF',
    margin: 0,
  })
  third.addText('Navigation, thumbnails, zoom and fullscreen are active.', {
    x: 0.78,
    y: 2.02,
    w: 7.5,
    h: 0.55,
    fontSize: 16,
    color: 'D5E4EE',
    margin: 0,
  })
  for (let index = 0; index < 3; index += 1) {
    third.addShape(pptx.ShapeType.ellipse, {
      x: 9.1 + index * 0.82,
      y: 2.1 + index * 0.5,
      w: 1.45,
      h: 1.45,
      line: { color: ['EC704E', '30A46C', '4F93E7'][index], transparency: 100 },
      fill: { color: ['EC704E', '30A46C', '4F93E7'][index], transparency: index * 8 },
    })
  }

  await pptx.writeFile({ fileName: fixturePath, compression: true })
  await injectFixtureMotionAndWmf()
}

function createLegacyFixture() {
  if (process.platform !== 'win32') return false
  const script = `
$ErrorActionPreference = 'Stop'
$sourcePath = $env:WPS_AGENT_PPTX_SOURCE
$targetPath = $env:WPS_AGENT_PPT_TARGET
$app = $null
$presentation = $null
try {
  foreach ($progId in @('PowerPoint.Application', 'KWPP.Application')) {
    $type = [Type]::GetTypeFromProgID($progId)
    if ($null -eq $type) { continue }
    $app = [Activator]::CreateInstance($type)
    try { $app.DisplayAlerts = 1 } catch {}
    $presentation = $app.Presentations.Open($sourcePath, $true, $false, $false)
    $presentation.SaveAs($targetPath, 1)
    $presentation.Close()
    $presentation = $null
    $app.Quit()
    $app = $null
    exit 0
  }
  throw 'No presentation COM converter is registered.'
} finally {
  if ($null -ne $presentation) { try { $presentation.Close() } catch {} }
  if ($null -ne $app) { try { $app.Quit() } catch {} }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
`
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: {
        ...process.env,
        WPS_AGENT_PPTX_SOURCE: fixturePath,
        WPS_AGENT_PPT_TARGET: legacyFixturePath,
      },
      windowsHide: true,
      timeout: 120_000,
      stdio: 'ignore',
    })
    return fs.existsSync(legacyFixturePath) && fs.statSync(legacyFixturePath).size > 10_000
  } catch (error) {
    console.log(`[SKIP] Could not generate a legacy PPT fixture: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => {
        if (error) reject(error)
        else resolve(typeof address === 'object' && address ? address.port : 0)
      })
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
    } catch {
      // Electron has not enabled its inspector endpoint yet.
    }
    await sleep(100)
  }
  throw new Error('Timed out waiting for Electron renderer')
}

function connectCdp(url, onEvent) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const pending = new Map()
    let nextId = 1

    socket.addEventListener('open', () => resolve({
      send(method, params = {}) {
        return new Promise((resolveCall, rejectCall) => {
          const id = nextId++
          const timer = setTimeout(() => {
            pending.delete(id)
            rejectCall(new Error(`CDP command timed out: ${method}`))
          }, 30_000)
          pending.set(id, { resolveCall, rejectCall, timer, method })
          socket.send(JSON.stringify({ id, method, params }))
        })
      },
      close() { socket.close() },
    }))

    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      if (!message.id) {
        onEvent(message)
        return
      }
      const call = pending.get(message.id)
      if (!call) return
      clearTimeout(call.timer)
      pending.delete(message.id)
      if (message.error) call.rejectCall(new Error(`${call.method}: ${message.error.message}`))
      else call.resolveCall(message)
    })
    socket.addEventListener('error', reject)
  })
}

async function evaluate(send, expression) {
  let response
  try {
    response = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; expression=${expression.slice(0, 280)}`)
  }
  if (response.result.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text)
  }
  return response.result.result.value
}

async function waitFor(send, expression, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastValue
  while (Date.now() < deadline) {
    lastValue = await evaluate(send, expression)
    if (lastValue) return lastValue
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`)
}

async function openFile(send, filePath) {
  return evaluate(send, `(async () => {
    const filePath = ${JSON.stringify(filePath)};
    await window.api.file.open(filePath);
    const root = document.getElementById('root');
    const rootKey = Object.keys(root || {}).find((name) =>
      name.startsWith('__reactContainer') || name.startsWith('__reactFiber'));
    const container = rootKey ? root[rootKey] : null;
    const queue = [container?.current, container?.stateNode?.current,
      container?._internalRoot?.current, container].filter(Boolean);
    const seen = new Set();
    while (queue.length) {
      const fiber = queue.shift();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      if (typeof fiber.memoizedProps?.onOpenFile === 'function') {
        await fiber.memoizedProps.onOpenFile(filePath);
        return true;
      }
      if (fiber.child) queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }
    return false;
  })()`)
}

async function pressKey(send, { key, code, keyCode, modifiers = 0 }) {
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers,
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers,
  })
}

async function dragMouse(send, start, end, steps = 8) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: start.x,
    y: start.y,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: start.x,
    y: start.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  for (let step = 1; step <= steps; step += 1) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: start.x + ((end.x - start.x) * step) / steps,
      y: start.y + ((end.y - start.y) * step) / steps,
      button: 'left',
      buttons: 1,
    })
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: end.x,
    y: end.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
}

async function wheelMouse(send, point, deltaY) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: point.x,
    y: point.y,
    deltaX: 0,
    deltaY,
  })
}

async function clickSelector(send, selector) {
  const focused = await evaluate(send, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.focus();
    return true;
  })()`)
  if (!focused) throw new Error(`Element not found for click: ${selector}`)
  await pressKey(send, { key: 'Enter', code: 'Enter', keyCode: 13 })
}

async function captureScreenshot(send, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  })
  fs.writeFileSync(outputPath, screenshot.result.data, 'base64')
  return fs.statSync(outputPath).size
}

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass: Boolean(pass) })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? `: ${detail}` : ''}`)
}

let child
let cdp
const rendererErrors = []
let hasLegacyFixture = false
let hasWmfFixture = false

try {
  hasWmfFixture = createWmfFixture()
  await createFixture()
  check('multi-slide PPTX fixture generated', fs.statSync(fixturePath).size > 10_000, `${fs.statSync(fixturePath).size} bytes`)
  if (hasWmfFixture) check('genuine WMF media fixture generated', true, `${fs.statSync(wmfFixturePath).size} bytes`)
  hasLegacyFixture = createLegacyFixture()
  if (hasLegacyFixture) {
    check('genuine legacy PPT fixture generated', true, `${fs.statSync(legacyFixturePath).size} bytes`)
  }
  if (!fs.existsSync(rendererEntry)) throw new Error('Built renderer is missing; run npm run build first')

  const port = await getFreePort()
  child = spawn(electronPath, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`], {
    cwd: root,
    env: {
      ...process.env,
      WPS_ALLOW_MULTI_INSTANCE: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    stdio: 'ignore',
    windowsHide: true,
  })

  const page = await waitForPage(port)
  cdp = await connectCdp(page.webSocketDebuggerUrl, (message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      rendererErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text)
    }
  })
  const { send } = cdp
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await waitFor(send, "document.getElementById('root')?.childElementCount > 0", 'React application')

  if (hasLegacyFixture) {
    const preparedLegacy = await evaluate(send, `(async () => {
      const result = await window.api.lw.readPresentation(${JSON.stringify(legacyFixturePath)});
      return {
        converted: result.convertedFromLegacy,
        converter: result.converter,
        bytes: result.data?.byteLength ?? result.data?.length ?? 0,
      };
    })()`)
    check('legacy PPT is converted through the application IPC',
      preparedLegacy.converted && preparedLegacy.bytes > 10_000,
      JSON.stringify(preparedLegacy))
  }

  if (hasWmfFixture) {
    const preparedWmf = await evaluate(send, `(async () => {
      const result = await window.api.lw.readPresentation(${JSON.stringify(fixturePath)});
      return {
        convertedWmf: result.normalizedWmfCount,
        bytes: result.data?.byteLength ?? result.data?.length ?? 0,
      };
    })()`)
    check('WMF media is normalized to PNG before browser rendering',
      preparedWmf.convertedWmf === 1 && preparedWmf.bytes > 10_000,
      JSON.stringify(preparedWmf))
  }

  if (hasLegacyFixture) {
    const reuseResult = await evaluate(send, `(async () => {
      try {
        const prepared = await window.api.lw.readPresentation(${JSON.stringify(fixturePath)});
        const result = await window.api.lw.editPresentation({
          data: prepared.data,
          operation: {
            type: 'reuseSlides',
            afterSlideIndex: 0,
            sourcePath: ${JSON.stringify(fixturePath)},
          },
        });
        return {
          slideCount: result.slideCount,
          currentSlideIndex: result.currentSlideIndex,
          bytes: result.data?.byteLength ?? result.data?.length ?? 0,
          converter: result.converter,
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    })()`)
    check('reuse-slides operation preserves the presentation through Office automation',
      reuseResult.slideCount === 6 && reuseResult.currentSlideIndex === 1 && reuseResult.bytes > 10_000,
      JSON.stringify(reuseResult))
  }

  check('PPTX file opened through the application', await openFile(send, fixturePath))
  await waitFor(
    send,
    "document.querySelector('[data-testid=presentation-viewer]')?.dataset.presentationState === 'ready'",
    'presentation viewer',
    45_000,
  )

  const initial = await evaluate(send, `(() => {
    const viewer = document.querySelector('[data-testid=presentation-viewer]');
    const host = document.querySelector('[data-testid=presentation-slide-host]');
    const stage = document.querySelector('[data-testid=presentation-stage]');
    const toolbar = viewer.querySelector('.presentation-toolbar');
    const thumbnailPane = document.querySelector('[data-testid=presentation-thumbnails]');
    const firstThumbnail = document.querySelector('[data-testid=presentation-thumbnail-1]');
    const thumbnailNumber = firstThumbnail.firstElementChild;
    const thumbnailFrame = firstThumbnail.querySelector('.presentation-thumbnail-frame');
    const rect = host.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const thumbnailPaneRect = thumbnailPane.getBoundingClientRect();
    const thumbnailNumberRect = thumbnailNumber.getBoundingClientRect();
    const thumbnailFrameRect = thumbnailFrame.getBoundingClientRect();
    return {
      state: viewer.dataset.presentationState,
      slides: Number(document.querySelector('[data-testid=presentation-page-input]').nextElementSibling.textContent.replace(/\\D/g, '')),
      text: host.textContent,
      renderedNodes: host.querySelectorAll('*').length,
      width: rect.width,
      height: rect.height,
      stageWidth: stageRect.width,
      stageHeight: stageRect.height,
      toolbarClientWidth: toolbar.clientWidth,
      toolbarScrollWidth: toolbar.scrollWidth,
      thumbnails: document.querySelectorAll('[data-testid=presentation-thumbnails] button').length,
      thumbnailNumberLeftInset: thumbnailNumberRect.left - thumbnailPaneRect.left,
      thumbnailFrameLeftInset: thumbnailFrameRect.left - thumbnailPaneRect.left,
      thumbnailScrollbarWidth: thumbnailPane.offsetWidth - thumbnailPane.clientWidth,
    };
  })()`)
  check('presentation routes to the dedicated viewer', initial.state === 'ready')
  check('all slides are exposed in the thumbnail rail', initial.slides === 3 && initial.thumbnails === 3, JSON.stringify(initial))
  check('first slide renders real text and layout nodes', initial.text.includes('Presentation playback') && initial.renderedNodes > 10, `${initial.renderedNodes} nodes`)
  check('slide is fitted inside a stable visible stage', initial.width > 350 && initial.height > 190 && initial.width <= initial.stageWidth && initial.height <= initial.stageHeight, JSON.stringify(initial))
  check('toolbar fits without horizontal clipping', initial.toolbarScrollWidth <= initial.toolbarClientWidth + 1, `${initial.toolbarScrollWidth}/${initial.toolbarClientWidth}`)
  const editToolbar = await evaluate(send, `(() => ({
    height: document.querySelector('.presentation-toolbar').getBoundingClientRect().height,
    newSlide: Boolean(document.querySelector('[data-testid=presentation-new-slide]')),
    edit: Boolean(document.querySelector('[data-testid=presentation-edit-slide]')),
    duplicate: Boolean(document.querySelector('[data-testid=presentation-duplicate-slide]')),
    remove: Boolean(document.querySelector('[data-testid=presentation-delete-slide]')),
    slideshowMenu: Boolean(document.querySelector('[data-testid=presentation-slideshow-menu]')),
  }))()`)
  check('PowerPoint editing toolbar reuses the compact Word and Excel dimensions',
    editToolbar.height >= 40 && editToolbar.height <= 42
      && editToolbar.newSlide && editToolbar.edit && editToolbar.duplicate
      && editToolbar.remove && editToolbar.slideshowMenu,
    JSON.stringify(editToolbar))

  await clickSelector(send, '[data-testid=presentation-new-slide-menu]')
  await waitFor(send,
    "Boolean(document.querySelector('[data-testid=presentation-import-outline]') && document.querySelector('[data-testid=presentation-reuse-slides]'))",
    'new slide dropdown')
  check('new slide dropdown exposes outline import and reuse slides', true)
  await pressKey(send, { key: 'Escape', code: 'Escape', keyCode: 27 })

  await clickSelector(send, '[data-testid=presentation-slideshow-menu]')
  await waitFor(send,
    "Boolean(document.querySelector('[data-testid=presentation-start-from-beginning]') && document.querySelector('[data-testid=presentation-start-from-current]'))",
    'slideshow dropdown')
  check('slideshow dropdown exposes beginning and current-slide starts', true)
  await pressKey(send, { key: 'Escape', code: 'Escape', keyCode: 27 })
  check('thumbnail number and preview use compact left spacing',
    initial.thumbnailNumberLeftInset <= 5 && initial.thumbnailFrameLeftInset <= 27,
    `${initial.thumbnailNumberLeftInset}px / ${initial.thumbnailFrameLeftInset}px`)
  check('thumbnail rail reserves no more than an 8px scrollbar',
    initial.thumbnailScrollbarWidth <= 8,
    `${initial.thumbnailScrollbarWidth}px`)

  const thumbnailToggleCenter = await evaluate(send, `(() => {
    const rect = document.querySelector('[data-testid=presentation-thumbnail-toggle]').getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: thumbnailToggleCenter.x,
    y: thumbnailToggleCenter.y,
  })
  await waitFor(send,
    "document.querySelector('[data-testid=presentation-toolbar-tooltip]')?.getBoundingClientRect().width > 0",
    'presentation toolbar tooltip')
  const toolbarTooltip = await evaluate(send, `(() => {
    const tooltip = document.querySelector('[data-testid=presentation-toolbar-tooltip]');
    const trigger = document.querySelector('[data-testid=presentation-thumbnail-toggle]');
    const toolbar = document.querySelector('.presentation-toolbar');
    const style = getComputedStyle(tooltip);
    const rect = tooltip.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    return {
      text: tooltip.textContent.trim(),
      triggerLabel: trigger.getAttribute('aria-label'),
      background: style.backgroundColor,
      color: style.color,
      fontSize: style.fontSize,
      borderWidth: Number.parseFloat(style.borderTopWidth),
      borderStyle: style.borderTopStyle,
      borderRadius: style.borderTopLeftRadius,
      top: rect.top,
      toolbarBottom: toolbarRect.bottom,
    };
  })()`)
  check('toolbar hover popup matches the Word and Excel gray boxed style',
    toolbarTooltip.text.includes(toolbarTooltip.triggerLabel)
      && toolbarTooltip.background === 'rgb(102, 102, 102)'
      && toolbarTooltip.color === 'rgb(255, 255, 255)'
      && toolbarTooltip.fontSize === '12px'
      && toolbarTooltip.borderWidth >= 0.5
      && toolbarTooltip.borderWidth <= 1.1
      && toolbarTooltip.borderStyle === 'solid'
      && toolbarTooltip.borderRadius === '2px'
      && toolbarTooltip.top >= toolbarTooltip.toolbarBottom - 1,
    JSON.stringify(toolbarTooltip))
  const toolbarTooltipScreenshotSize = await captureScreenshot(send, toolbarTooltipScreenshotPath)
  check('toolbar hover popup screenshot captured',
    toolbarTooltipScreenshotSize > 20_000,
    toolbarTooltipScreenshotPath)

  const initialResizeLayout = await evaluate(send, `(() => {
    const pane = document.querySelector('[data-testid=presentation-thumbnails]').getBoundingClientRect();
    const handle = document.querySelector('[data-testid=presentation-thumbnail-resizer]').getBoundingClientRect();
    const stage = document.querySelector('[data-testid=presentation-stage]').getBoundingClientRect();
    const slide = document.querySelector('[data-testid=presentation-slide-host]').getBoundingClientRect();
    return {
      paneWidth: pane.width,
      handle: { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
      stageWidth: stage.width,
      slideWidth: slide.width,
    };
  })()`)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: initialResizeLayout.handle.x,
    y: initialResizeLayout.handle.y,
  })
  await sleep(180)
  const resizeHover = await evaluate(send, `(() => {
    const handle = document.querySelector('[data-testid=presentation-thumbnail-resizer]');
    const indicator = handle.querySelector('.presentation-thumbnail-resizer-indicator');
    return {
      cursor: getComputedStyle(handle).cursor,
      opacity: Number.parseFloat(getComputedStyle(indicator).opacity),
      label: handle.getAttribute('aria-label'),
      min: Number(handle.getAttribute('aria-valuemin')),
      now: Number(handle.getAttribute('aria-valuenow')),
    };
  })()`)
  check('thumbnail divider exposes a visible horizontal resize affordance',
    resizeHover.cursor === 'col-resize' && resizeHover.opacity > 0.9 && resizeHover.label,
    JSON.stringify(resizeHover))
  const resizerScreenshotSize = await captureScreenshot(send, resizerScreenshotPath)
  check('thumbnail divider hover screenshot captured', resizerScreenshotSize > 20_000, resizerScreenshotPath)

  await dragMouse(
    send,
    initialResizeLayout.handle,
    { x: initialResizeLayout.handle.x + 72, y: initialResizeLayout.handle.y },
  )
  const expandedLayout = await waitFor(send, `(() => {
    const pane = document.querySelector('[data-testid=presentation-thumbnails]').getBoundingClientRect();
    if (pane.width < ${initialResizeLayout.paneWidth + 50}) return null;
    const stage = document.querySelector('[data-testid=presentation-stage]').getBoundingClientRect();
    const slide = document.querySelector('[data-testid=presentation-slide-host]').getBoundingClientRect();
    return { paneWidth: pane.width, stageWidth: stage.width, slideWidth: slide.width };
  })()`, 'expanded thumbnail pane')
  check('dragging right expands thumbnails and refits the main slide live',
    expandedLayout.stageWidth < initialResizeLayout.stageWidth - 40
      && expandedLayout.slideWidth < initialResizeLayout.slideWidth - 30,
    JSON.stringify({ initial: initialResizeLayout, expanded: expandedLayout }))

  const expandedHandle = await evaluate(send, `(() => {
    const rect = document.querySelector('[data-testid=presentation-thumbnail-resizer]').getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`)
  await dragMouse(send, expandedHandle, { x: 0, y: expandedHandle.y })
  const minimumWidth = await waitFor(send, `(() => {
    const pane = document.querySelector('[data-testid=presentation-thumbnails]').getBoundingClientRect();
    return pane.width <= 169 ? pane.width : 0;
  })()`, 'minimum thumbnail pane width')
  check('dragging left stops at the usable minimum width', minimumWidth >= 167 && minimumWidth <= 169, `${minimumWidth}px`)

  await evaluate(send, `(() => {
    const handle = document.querySelector('[data-testid=presentation-thumbnail-resizer]');
    handle.focus();
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    return true;
  })()`)
  await waitFor(send,
    `Math.abs(document.querySelector('[data-testid=presentation-thumbnails]').getBoundingClientRect().width - 194) < 2`,
    'default thumbnail pane width')
  check('double-click restores the default thumbnail width', true)

  await waitFor(
    send,
    "document.querySelectorAll('[data-testid=presentation-thumbnails] [data-pptx-thumbnail=true]').length >= 2",
    'rendered thumbnails',
  )
  check('visible thumbnail previews are rendered', true)

  await evaluate(send, "document.querySelector('[data-testid=presentation-next-slide]').click(); true")
  await waitFor(
    send,
    "document.querySelector('[data-testid=presentation-page-input]').value === '2' && document.querySelector('[data-testid=presentation-slide-host]').textContent.includes('Quarterly performance')",
    'second slide',
  )
  check('Next renders the second slide content', true)

  await evaluate(send, "document.querySelector('[data-testid=presentation-thumbnail-3]').click(); true")
  await waitFor(
    send,
    "document.querySelector('[data-testid=presentation-page-input]').value === '3' && document.querySelector('[data-testid=presentation-slide-host]').textContent.includes('Ready to present')",
    'third slide from thumbnail',
  )
  check('thumbnail selection jumps directly to a slide', true)

  await evaluate(send, "document.querySelector('[data-testid=presentation-viewer]').focus(); true")
  await pressKey(send, { key: 'Home', code: 'Home', keyCode: 36 })
  await waitFor(send, "document.querySelector('[data-testid=presentation-page-input]').value === '1'", 'Home navigation')
  check('isolated presentation keyboard navigation works', true)

  const stageCenter = await evaluate(send, `(() => {
    const rect = document.querySelector('[data-testid=presentation-stage]').getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`)
  await wheelMouse(send, stageCenter, 48)
  await wheelMouse(send, stageCenter, 48)
  await wheelMouse(send, stageCenter, 48)
  await waitFor(send,
    "document.querySelector('[data-testid=presentation-page-input]').value === '2'",
    'wheel navigation to next slide')
  const wheelDownDirection = await evaluate(send,
    "document.querySelector('[data-testid=presentation-slide-host]').dataset.slideDirection")
  check('wheel down over the main slide advances exactly one slide',
    wheelDownDirection === 'next',
    wheelDownDirection)

  await sleep(220)
  await wheelMouse(send, stageCenter, -120)
  await waitFor(send,
    "document.querySelector('[data-testid=presentation-page-input]').value === '1'",
    'wheel navigation to previous slide')
  const wheelUpDirection = await evaluate(send,
    "document.querySelector('[data-testid=presentation-slide-host]').dataset.slideDirection")
  check('wheel up over the main slide returns to the previous slide',
    wheelUpDirection === 'previous',
    wheelUpDirection)

  const fittedWidth = await evaluate(send, "document.querySelector('[data-testid=presentation-slide-host]').getBoundingClientRect().width")
  await evaluate(send, "document.querySelector('[data-testid=presentation-zoom-in]').click(); true")
  const zoomedWidth = await waitFor(
    send,
    `(() => { const width = document.querySelector('[data-testid=presentation-slide-host]').getBoundingClientRect().width; return width > ${fittedWidth * 1.15} ? width : 0; })()`,
    'zoomed slide size',
  )
  check('zoom changes the rendered slide size', zoomedWidth > fittedWidth * 1.15, `${fittedWidth.toFixed(1)} -> ${zoomedWidth.toFixed(1)}`)
  await evaluate(send, "document.querySelector('[data-testid=presentation-fit-slide]').click(); true")
  await waitFor(
    send,
    `Math.abs(document.querySelector('[data-testid=presentation-slide-host]').getBoundingClientRect().width - ${fittedWidth}) < 3`,
    'fit slide size',
  )
  check('fit-to-window restores the fitted slide size', true)

  const normalScreenshotSize = await captureScreenshot(send, screenshotPath)
  check('normal viewer screenshot captured', normalScreenshotSize > 20_000, screenshotPath)

  await evaluate(send, "document.querySelector('[data-testid=presentation-viewer]').focus(); true")
  await pressKey(send, { key: 'F5', code: 'F5', keyCode: 116 })
  await waitFor(send, "document.querySelector('[data-testid=presentation-viewer]').classList.contains('presentation-viewer--presenting')", 'F5 slideshow mode')
  check('F5 starts slideshow mode', true)

  const animationDiagnostics = await evaluate(send, `(() => {
    const parsed = new DOMParser().parseFromString(${JSON.stringify(injectedSlideXml)}, 'application/xml');
    const timeNodes = [...parsed.getElementsByTagName('*')].filter(element =>
      element.localName === 'cTn' && element.getAttribute('presetClass') === 'entr');
    const target = timeNodes[0]
      ? [...timeNodes[0].getElementsByTagName('*')].find(element => element.localName === 'spTgt')?.getAttribute('spid')
      : null;
    const host = document.querySelector('[data-testid=presentation-slide-host]');
    return {
      parserError: Boolean(parsed.querySelector('parsererror')),
      timeNodes: timeNodes.length,
      target,
      expectedTarget: ${JSON.stringify(animationTargetShapeId)},
      annotatedIds: [...host.querySelectorAll('[data-presentation-node-id]')].map(element => element.dataset.presentationNodeId),
      pending: host.querySelectorAll('.presentation-animation-target--pending').length,
    };
  })()`)
  console.log(`[INFO] animation diagnostics: ${JSON.stringify(animationDiagnostics)}`)

  const pendingAnimationTargets = await waitFor(send,
    "document.querySelectorAll('[data-testid=presentation-slide-host] .presentation-animation-target--pending').length",
    'pending click animation')
  check('slideshow initializes click-triggered object animations', pendingAnimationTargets > 0, `${pendingAnimationTargets} target(s)`)

  await pressKey(send, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 })
  await waitFor(send,
    "document.querySelector('[data-testid=presentation-page-input]').value === '1' && document.querySelector('[data-testid=presentation-slide-host] .presentation-animation-target--entrance')",
    'first click animation step')
  check('first slideshow click runs the object animation without changing slides', true)

  await pressKey(send, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 })
  await waitFor(send, "document.querySelector('[data-testid=presentation-page-input]').value === '2'", 'fullscreen arrow navigation')
  check('next click advances after the current slide animation steps finish', true)

  await waitFor(
    send,
    "document.querySelector('[data-testid=presentation-slide-host]').getBoundingClientRect().width > innerWidth * 0.8",
    'fullscreen slide fit',
  )
  await sleep(1_200)

  const fullscreenLayout = await evaluate(send, `(() => {
    const root = document.querySelector('[data-testid=presentation-viewer]').getBoundingClientRect();
    const slide = document.querySelector('[data-testid=presentation-slide-host]').getBoundingClientRect();
    return { root: { left: root.left, top: root.top, width: root.width, height: root.height },
      slide: { left: slide.left, top: slide.top, width: slide.width, height: slide.height },
      viewport: { width: innerWidth, height: innerHeight } };
  })()`)
  check('slideshow covers the viewport and keeps the slide fully visible',
    fullscreenLayout.root.left === 0 && fullscreenLayout.root.top === 0
      && Math.abs(fullscreenLayout.root.width - fullscreenLayout.viewport.width) < 2
      && Math.abs(fullscreenLayout.root.height - fullscreenLayout.viewport.height) < 2
      && fullscreenLayout.slide.left >= 0 && fullscreenLayout.slide.top >= 0
      && fullscreenLayout.slide.width <= fullscreenLayout.viewport.width
      && fullscreenLayout.slide.height <= fullscreenLayout.viewport.height,
    JSON.stringify(fullscreenLayout))

  const fullscreenScreenshotSize = await captureScreenshot(send, fullscreenScreenshotPath)
  check('fullscreen slideshow screenshot captured', fullscreenScreenshotSize > 20_000, fullscreenScreenshotPath)

  await pressKey(send, { key: 'Escape', code: 'Escape', keyCode: 27 })
  await waitFor(send, "!document.querySelector('[data-testid=presentation-viewer]').classList.contains('presentation-viewer--presenting')", 'exit slideshow')
  check('Escape exits slideshow mode', true)

  await clickSelector(send, '[data-testid=presentation-slideshow-menu]')
  await waitFor(send, "Boolean(document.querySelector('[data-testid=presentation-start-from-current]'))", 'current-slide slideshow item')
  await clickSelector(send, '[data-testid=presentation-start-from-current]')
  await waitFor(send,
    "document.querySelector('[data-testid=presentation-viewer]').classList.contains('presentation-viewer--presenting') && document.querySelector('[data-testid=presentation-page-input]').value === '2'",
    'toolbar slideshow from current')
  check('toolbar starts slideshow from the current slide', true)
  await waitFor(send, "Boolean(document.querySelector('[data-testid=presentation-exit-slideshow]'))", 'current slideshow exit control')
  await evaluate(send, "document.querySelector('[data-testid=presentation-exit-slideshow]').click(); true")
  await waitFor(send, "!document.querySelector('[data-testid=presentation-viewer]').classList.contains('presentation-viewer--presenting')", 'exit current slideshow')

  await evaluate(send, "document.querySelector('[data-testid=presentation-thumbnail-3]').click(); true")
  await waitFor(send, "document.querySelector('[data-testid=presentation-page-input]').value === '3'", 'third slide before beginning slideshow')
  await clickSelector(send, '[data-testid=presentation-slideshow-menu]')
  await waitFor(send, "Boolean(document.querySelector('[data-testid=presentation-start-from-beginning]'))", 'beginning slideshow item')
  await clickSelector(send, '[data-testid=presentation-start-from-beginning]')
  await waitFor(send,
    "document.querySelector('[data-testid=presentation-viewer]').classList.contains('presentation-viewer--presenting') && document.querySelector('[data-testid=presentation-page-input]').value === '1'",
    'toolbar slideshow from beginning')
  check('toolbar starts slideshow from the beginning', true)
  await waitFor(send, "Boolean(document.querySelector('[data-testid=presentation-exit-slideshow]'))", 'beginning slideshow exit control')
  await evaluate(send, "document.querySelector('[data-testid=presentation-exit-slideshow]').click(); true")
  await waitFor(send, "!document.querySelector('[data-testid=presentation-viewer]').classList.contains('presentation-viewer--presenting')", 'exit beginning slideshow')

  if (hasLegacyFixture) {
    await waitFor(send,
      "Boolean(document.querySelector('[data-testid=presentation-new-slide]') && !document.querySelector('[data-testid=presentation-new-slide]').disabled)",
      'enabled new slide control')
    await evaluate(send, "document.querySelector('[data-testid=presentation-new-slide]').click(); true")
    await waitFor(send, `(() => {
      const input = document.querySelector('[data-testid=presentation-page-input]');
      const total = Number(input?.nextElementSibling?.textContent.replace(/\D/g, ''));
      return document.querySelector('[data-testid=presentation-viewer]')?.dataset.presentationState === 'ready'
        && total === 4 && input?.value === '2';
    })()`, 'new slide created through Office automation', 120_000)
    check('New slide inserts after the current slide and selects it', true)

    await evaluate(send, "document.querySelector('[data-testid=presentation-edit-slide]').click(); true")
    await waitFor(send, "Boolean(document.querySelector('[data-testid=presentation-text-dialog]'))", 'slide text editor', 120_000)
    await evaluate(send, `(() => {
      const title = document.querySelector('[data-testid=presentation-slide-title-input]');
      const body = document.querySelector('[data-testid=presentation-slide-body-input]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(title, 'Edited slide title');
      title.dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(body, 'First point\\nSecond point');
      body.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-testid=presentation-edit-dialog-submit]').click();
      return true;
    })()`)
    await waitFor(send,
      "document.querySelector('[data-testid=presentation-viewer]')?.dataset.presentationState === 'ready' && document.querySelector('[data-testid=presentation-slide-host]')?.textContent.includes('Edited slide title')",
      'edited slide text rendered',
      120_000)
    check('simple title and body editing updates the rendered slide', true)

    await evaluate(send, "document.querySelector('[data-testid=presentation-duplicate-slide]').click(); true")
    await waitFor(send, `(() => {
      const input = document.querySelector('[data-testid=presentation-page-input]');
      return document.querySelector('[data-testid=presentation-viewer]')?.dataset.presentationState === 'ready'
        && Number(input?.nextElementSibling?.textContent.replace(/\D/g, '')) === 5;
    })()`, 'duplicated slide', 120_000)
    check('Duplicate slide creates an independent copy', true)

    await evaluate(send, "document.querySelector('[data-testid=presentation-delete-slide]').click(); true")
    await waitFor(send, `(() => {
      const input = document.querySelector('[data-testid=presentation-page-input]');
      return document.querySelector('[data-testid=presentation-viewer]')?.dataset.presentationState === 'ready'
        && Number(input?.nextElementSibling?.textContent.replace(/\D/g, '')) === 4;
    })()`, 'deleted duplicated slide', 120_000)
    check('Delete slide removes the selected slide while preserving the deck', true)

    await clickSelector(send, '[data-testid=presentation-new-slide-menu]')
    await waitFor(send, "Boolean(document.querySelector('[data-testid=presentation-import-outline]'))", 'outline import menu item')
    await clickSelector(send, '[data-testid=presentation-import-outline]')
    await waitFor(send, "Boolean(document.querySelector('[data-testid=presentation-outline-dialog]'))", 'outline import dialog')
    await evaluate(send, `(() => {
      const outline = document.querySelector('[data-testid=presentation-outline-input]');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
        outline,
        'Roadmap\\n  Alpha milestone\\nDelivery\\n  Beta milestone',
      );
      outline.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-testid=presentation-edit-dialog-submit]').click();
      return true;
    })()`)
    await waitFor(send, `(() => {
      const input = document.querySelector('[data-testid=presentation-page-input]');
      return document.querySelector('[data-testid=presentation-viewer]')?.dataset.presentationState === 'ready'
        && Number(input?.nextElementSibling?.textContent.replace(/\D/g, '')) === 6
        && document.querySelector('[data-testid=presentation-slide-host]')?.textContent.includes('Roadmap');
    })()`, 'outline slides imported', 120_000)
    check('outline import creates title-and-content slides in order', true)

    const saveMtime = fs.statSync(fixturePath).mtimeMs
    await pressKey(send, { key: 's', code: 'KeyS', keyCode: 83, modifiers: 2 })
    await waitFor(send,
      `window.api.lw.readPresentation(${JSON.stringify(fixturePath)}).then(result => (result.data?.byteLength ?? result.data?.length ?? 0) > 10000)`,
      'saved edited presentation',
      120_000)
    await sleep(500)
    const savedZip = await JSZip.loadAsync(fs.readFileSync(fixturePath))
    const savedSlideCount = Object.keys(savedZip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length
    check('Ctrl+S persists the edited PPTX buffer',
      fs.statSync(fixturePath).mtimeMs >= saveMtime && savedSlideCount === 6,
      `${savedSlideCount} slides`)
  }

  if (hasLegacyFixture) {
    check('legacy PPT file opened through the application', await openFile(send, legacyFixturePath))
    await waitFor(
      send,
      `document.querySelector('[data-testid=presentation-viewer]')?.dataset.presentationState === 'ready'
        && document.querySelector('[data-testid=presentation-slide-host]')?.textContent.includes('Presentation playback')
        && document.body.textContent.includes('presentation-playback-legacy.ppt')`,
      'legacy PPT presentation viewer',
      45_000,
    )
    check('converted legacy PPT renders in the same slideshow viewer', true)
  }

  if (externalFixturePath) {
    check('external presentation fixture exists', fs.existsSync(externalFixturePath), externalFixturePath)
    check('external presentation opened through the application', await openFile(send, externalFixturePath))
    const state = await waitFor(
      send,
      `(() => {
        const viewer = document.querySelector('[data-testid=presentation-viewer]');
        return ['ready', 'error'].includes(viewer?.dataset.presentationState)
          ? viewer.dataset.presentationState
          : '';
      })()`,
      'external presentation result',
      120_000,
    )
    const detail = await evaluate(send, `(() => ({
      state: document.querySelector('[data-testid=presentation-viewer]')?.dataset.presentationState,
      text: document.querySelector('[data-testid=presentation-stage]')?.innerText,
      slideCount: document.querySelectorAll('[data-testid=presentation-thumbnails] button').length,
    }))()`)
    check('external presentation renders', state === 'ready', JSON.stringify(detail))
  }

  const unexpectedErrors = rendererErrors.filter((message) => !/ResizeObserver loop/i.test(String(message)))
  check('renderer completed without uncaught exceptions', unexpectedErrors.length === 0, unexpectedErrors.join(' | '))
} catch (error) {
  check('presentation verifier completed', false, error instanceof Error ? error.stack : String(error))
} finally {
  cdp?.close()
  child?.kill()
  await sleep(500)
  fs.rmSync(profilePath, { recursive: true, force: true })
  fs.rmSync(fixtureDirectory, { recursive: true, force: true })
}

const failures = results.filter((result) => !result.pass)
console.log(`\nPresentation verification: ${results.length - failures.length}/${results.length} passed`)
if (failures.length) process.exitCode = 1
