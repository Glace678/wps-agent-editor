/**
 * E2E (CDP): PDF preview fixes —
 *  1) Ctrl+wheel zoom must NOT scale the shell document tab bar.
 *  2) Page bitmaps must be rendered at >= display-width × devicePixelRatio
 *     (sharp at 100%), and re-rendered sharper after zooming in.
 * Usage: npm run build && node scripts/electron-verify-pdf-zoom-sharpness.mjs
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { spawn, execSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = process.cwd()
const electronPath = require('electron')
const desktop = path.join(os.homedir(), 'Desktop')
const sample = fs.readdirSync(desktop).find((n) => n.toLowerCase().endsWith('.pdf'))
if (!sample) {
  console.error('no pdf on desktop')
  process.exit(1)
}
const samplePdf = path.join(desktop, sample)
console.log('sample', samplePdf)

const port = 9377
const bridgePort = 13777
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-pdf-verify-'))
const shotDir = process.env.PDF_VERIFY_SHOT_DIR || os.tmpdir()

const child = spawn(
  electronPath,
  [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, root],
  {
    cwd: root,
    env: {
      ...process.env,
      WPS_BRIDGE_PORT: String(bridgePort),
      WPS_ALLOW_MULTI_INSTANCE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
child.stderr.on('data', (b) => {
  const s = String(b)
  if (/error/i.test(s)) process.stdout.write(s)
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let nextId = 1
    const pending = new Map()
    const send = (method, params = {}) =>
      new Promise((res) => {
        const id = nextId++
        pending.set(id, res)
        ws.send(JSON.stringify({ id, method, params }))
      })
    ws.addEventListener('open', () => resolve({ send }))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const res = pending.get(msg.id)
        pending.delete(msg.id)
        res(msg)
      }
    })
    ws.addEventListener('error', reject)
  })
}

const evalIn = async (send, expression) => {
  const r = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  })
  if (r.result?.exceptionDetails) {
    throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500))
  }
  return r.result?.result?.value
}

let failures = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures += 1
}

const MEASURE_FN = `(() => {
  const bar = document.querySelector('[data-testid="shell-document-tab-bar"]')
  const barRect = bar ? bar.getBoundingClientRect() : null
  const target = document.querySelector('[data-manages-document-zoom]')
  const img = target ? target.querySelector('img') : null
  const rect = img ? img.getBoundingClientRect() : null
  const zoomRoot = document.querySelector('[data-document-zoom]')
  return {
    hasBar: !!bar,
    barInsideTarget: !!(bar && (bar.closest('.document-zoom-target') || bar.closest('[data-manages-document-zoom]'))),
    barW: barRect ? barRect.width : 0,
    barH: barRect ? barRect.height : 0,
    barFont: bar ? getComputedStyle(bar).fontSize : '',
    imgNatural: img ? img.naturalWidth : 0,
    imgVisualW: rect ? rect.width : 0,
    dpr: window.devicePixelRatio,
    zoomAttr: zoomRoot ? Number(zoomRoot.getAttribute('data-document-zoom')) : NaN,
    imgCount: target ? target.querySelectorAll('img').length : 0,
  }
})()`

const WHEEL_FN = (deltaY) => `(async () => {
  const img = document.querySelector('[data-manages-document-zoom] img');
  for (let i = 0; i < 5; i++) {
    img.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: ${deltaY}, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 60));
  }
  return true;
})()`

try {
  // Poll until the debug port and renderer page are ready
  let page = null
  for (let i = 0; i < 45 && !page; i++) {
    await sleep(1000)
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      page = list.find((t) => String(t.url).includes('out/renderer')) || null
    } catch {
      /* not up yet */
    }
  }
  if (!page) throw new Error('renderer page not found within 45s')
  const { send } = await connect(page.webSocketDebuggerUrl)
  await send('Runtime.enable')
  await send('Page.enable')

  // Open the PDF: click-navigate home -> Desktop -> file; fall back to fiber walk
  const opened = await evalIn(send, `(async () => {
    const filePath = ${JSON.stringify(samplePdf)};
    const name = ${JSON.stringify(sample)};
    const homeBtn = [...document.querySelectorAll('button')].find(b => b.title === '主目录');
    if (homeBtn) homeBtn.click();
    await new Promise(r => setTimeout(r, 800));
    const desk = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === 'Desktop');
    if (desk) { desk.click(); await new Promise(r => setTimeout(r, 1200)); }
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent||'').includes(name));
    if (btn) { btn.click(); return 'clicked'; }
    const rootEl = document.getElementById('root');
    const k = Object.keys(rootEl).find(x => x.startsWith('__reactContainer') || x.startsWith('__reactFiber'));
    const q = [rootEl[k]]; const seen = new Set();
    while (q.length) {
      const n = q.shift(); if (!n || seen.has(n)) continue; seen.add(n);
      if (n.memoizedProps && typeof n.memoizedProps.onOpenFile === 'function') {
        n.memoizedProps.onOpenFile(filePath); return 'fiber';
      }
      if (n.child) q.push(n.child); if (n.sibling) q.push(n.sibling);
    }
    return 'not-found';
  })()`)
  console.log('open method:', opened)

  // Wait for the first pages to render
  let baseline = null
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const m = await evalIn(send, MEASURE_FN)
    if (m.imgCount >= 1 && m.imgNatural > 0 && m.imgVisualW > 0) {
      baseline = m
      break
    }
    if (i % 10 === 9) {
      const txt = await evalIn(send, `document.body.innerText.replace(/\\n+/g, ' | ').slice(0, 260)`)
      console.log(`[wait ${i + 1}s]`, JSON.stringify(m), txt)
    }
  }
  if (!baseline) {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(shotDir, 'pdf-verify-0-failed.png'), Buffer.from(shot.result.data, 'base64'))
    throw new Error('PDF pages never rendered (screenshot: pdf-verify-0-failed.png)')
  }
  // Settle one beat past first paint (initial ResizeObserver window)
  await sleep(1500)
  baseline = await evalIn(send, MEASURE_FN)
  console.log('baseline', JSON.stringify(baseline))

  check('tab bar exists', baseline.hasBar)
  check('tab bar outside any zoom scope', !baseline.barInsideTarget)
  check(
    'sharp at 100%: naturalWidth >= visualWidth x dpr',
    baseline.imgNatural >= baseline.imgVisualW * baseline.dpr * 0.95,
    `natural=${baseline.imgNatural} visual=${Math.round(baseline.imgVisualW)} dpr=${baseline.dpr}`,
  )

  const shot1 = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(shotDir, 'pdf-verify-1-baseline.png'), Buffer.from(shot1.result.data, 'base64'))

  // Ctrl+wheel up x5 (zoom 1.0 -> 1.5)
  await evalIn(send, WHEEL_FN(-100))
  await sleep(300)
  const zoomed = await evalIn(send, MEASURE_FN)
  console.log('zoomed ', JSON.stringify(zoomed))

  check('zoom applied (attr ~ 1.5)', Math.abs(zoomed.zoomAttr - 1.5) < 0.01, `attr=${zoomed.zoomAttr}`)
  check(
    'tab bar size UNCHANGED after zoom in',
    Math.abs(zoomed.barW - baseline.barW) < 1 &&
      Math.abs(zoomed.barH - baseline.barH) < 1 &&
      zoomed.barFont === baseline.barFont,
    `w ${baseline.barW}->${zoomed.barW}, h ${baseline.barH}->${zoomed.barH}, font ${baseline.barFont}->${zoomed.barFont}`,
  )
  check(
    'page visually grew ~1.5x',
    Math.abs(zoomed.imgVisualW / baseline.imgVisualW - 1.5) < 0.15,
    `visual ${Math.round(baseline.imgVisualW)}->${Math.round(zoomed.imgVisualW)}`,
  )

  // Wait for the debounced high-res re-render to land
  let rerendered = zoomed
  for (let i = 0; i < 20; i++) {
    await sleep(1000)
    rerendered = await evalIn(send, MEASURE_FN)
    if (rerendered.imgNatural > zoomed.imgNatural * 1.2) break
  }
  console.log('rerender', JSON.stringify(rerendered))
  check(
    'bitmap re-rendered sharper after zoom in',
    rerendered.imgNatural >= rerendered.imgVisualW * rerendered.dpr * 0.9,
    `natural ${zoomed.imgNatural}->${rerendered.imgNatural}, need ~${Math.round(rerendered.imgVisualW * rerendered.dpr)}`,
  )

  const shot2 = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(shotDir, 'pdf-verify-2-zoomed.png'), Buffer.from(shot2.result.data, 'base64'))

  // Ctrl+wheel down x5 back to 1.0; tab bar must stay fixed
  await evalIn(send, WHEEL_FN(100))
  await sleep(300)
  const restored = await evalIn(send, MEASURE_FN)
  console.log('restored', JSON.stringify(restored))
  check('zoom restored to 1', Math.abs(restored.zoomAttr - 1) < 0.01, `attr=${restored.zoomAttr}`)
  check(
    'tab bar size unchanged after zoom out',
    Math.abs(restored.barW - baseline.barW) < 1 && Math.abs(restored.barH - baseline.barH) < 1,
    `w=${restored.barW} h=${restored.barH}`,
  )

  // ---- PDF toolbar feature checks: rotate / fit / layout / page jump / tooltip ----
  const SCROLLER = `document.querySelector('[data-manages-document-zoom] .overflow-auto')`
  const FIRST_IMG = `document.querySelector('[data-manages-document-zoom] img')`

  const toolbarState = await evalIn(send, `(() => {
    const ids = ['pdf-toolbar','pdf-prev-page','pdf-next-page','pdf-page-input','pdf-zoom-out','pdf-zoom-reset','pdf-zoom-in','pdf-fit-width','pdf-fit-page','pdf-rotate-left','pdf-rotate-right','pdf-layout-single','pdf-layout-two'];
    const missing = ids.filter(id => !document.querySelector('[data-testid="' + id + '"]'));
    const zoomInBtn = document.querySelector('[data-testid="pdf-zoom-in"]');
    return { missing, zoomInAria: zoomInBtn ? zoomInBtn.getAttribute('aria-label') : '' };
  })()`)
  check('toolbar and all 12 buttons present', toolbarState.missing.length === 0, `missing: ${toolbarState.missing.join(',')}`)
  check('aria-label includes shortcut', /Ctrl\+=/.test(toolbarState.zoomInAria), toolbarState.zoomInAria)

  // Rotate right: first page bitmap flips to landscape
  await evalIn(send, `document.querySelector('[data-testid="pdf-rotate-right"]').click()`)
  let rot = { w: 0, h: 1 }
  for (let i = 0; i < 15; i++) {
    await sleep(1000)
    rot = await evalIn(send, `(() => { const i2 = ${FIRST_IMG}; return { w: i2.naturalWidth, h: i2.naturalHeight } })()`)
    if (rot.w > rot.h) break
  }
  check('rotate right: page becomes landscape', rot.w > rot.h, `natural ${rot.w}x${rot.h}`)

  await evalIn(send, `document.querySelector('[data-testid="pdf-rotate-left"]').click()`)
  for (let i = 0; i < 15; i++) {
    await sleep(1000)
    rot = await evalIn(send, `(() => { const i2 = ${FIRST_IMG}; return { w: i2.naturalWidth, h: i2.naturalHeight } })()`)
    if (rot.h > rot.w) break
  }
  check('rotate left: restored to portrait', rot.h > rot.w, `natural ${rot.w}x${rot.h}`)

  // Fit width: zoom to 150% first, then fit-width should bring page back to container width
  await evalIn(send, WHEEL_FN(-100))
  await sleep(300)
  await evalIn(send, `document.querySelector('[data-testid="pdf-fit-width"]').click()`)
  await sleep(400)
  const fitW = await evalIn(send, `(() => {
    const sc = ${SCROLLER};
    const i2 = ${FIRST_IMG};
    return {
      inner: sc.clientWidth - 32,
      visual: i2.getBoundingClientRect().width,
      pressed: document.querySelector('[data-testid="pdf-fit-width"]').getAttribute('aria-pressed'),
    };
  })()`)
  check(
    'fit width: page fills container width',
    fitW.pressed === 'true' && Math.abs(fitW.visual - fitW.inner) < 4,
    `visual=${Math.round(fitW.visual)} inner=${fitW.inner}`,
  )

  // Fit page: whole page fits inside the viewport (width AND height)
  await evalIn(send, `document.querySelector('[data-testid="pdf-fit-page"]').click()`)
  await sleep(400)
  const fitP = await evalIn(send, `(() => {
    const sc = ${SCROLLER};
    const r = ${FIRST_IMG}.getBoundingClientRect();
    return {
      w: r.width, h: r.height,
      innerW: sc.clientWidth - 32, innerH: sc.clientHeight - 32,
      pressed: document.querySelector('[data-testid="pdf-fit-page"]').getAttribute('aria-pressed'),
    };
  })()`)
  check(
    'fit page: whole page fits in viewport',
    fitP.pressed === 'true' && fitP.h <= fitP.innerH + 2 && fitP.w <= fitP.innerW + 2,
    `page ${Math.round(fitP.w)}x${Math.round(fitP.h)} vs inner ${fitP.innerW}x${fitP.innerH}`,
  )

  // Two-page layout: pages 1 & 2 share a row
  await evalIn(send, `document.querySelector('[data-testid="pdf-layout-two"]').click()`)
  await sleep(500)
  const twoUp = await evalIn(send, `(() => {
    const cells = document.querySelectorAll('[data-page-num]');
    const r1 = cells[0].getBoundingClientRect(), r2 = cells[1].getBoundingClientRect();
    return { sameRow: Math.abs(r1.top - r2.top) < 2, ordered: r2.left > r1.left + 10 };
  })()`)
  check('two-page layout: pages 1&2 side by side', twoUp.sameRow && twoUp.ordered, JSON.stringify(twoUp))

  await evalIn(send, `document.querySelector('[data-testid="pdf-layout-single"]').click()`)
  await sleep(500)
  const singleUp = await evalIn(send, `(() => {
    const cells = document.querySelectorAll('[data-page-num]');
    const r1 = cells[0].getBoundingClientRect(), r2 = cells[1].getBoundingClientRect();
    return { stacked: r2.top > r1.top + 10 };
  })()`)
  check('single layout restored: pages stacked', singleUp.stacked, JSON.stringify(singleUp))

  // Page jump: type 5 + Enter -> page 5 aligned to top of viewport
  await evalIn(send, `(() => {
    const input = document.querySelector('[data-testid="pdf-page-input"]');
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '5');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return true;
  })()`)
  await sleep(400)
  const jump = await evalIn(send, `(() => {
    const sc = ${SCROLLER};
    const cRect = document.querySelector('[data-page-num="5"]').getBoundingClientRect();
    return {
      value: document.querySelector('[data-testid="pdf-page-input"]').value,
      scrollTop: Math.round(sc.scrollTop),
      topDelta: Math.abs(cRect.top - sc.getBoundingClientRect().top - 16),
    };
  })()`)
  check('page jump to 5', jump.value === '5' && jump.scrollTop > 0 && jump.topDelta < 6, JSON.stringify(jump))

  await evalIn(send, `document.querySelector('[data-testid="pdf-prev-page"]').click()`)
  await sleep(300)
  const prevVal = await evalIn(send, `document.querySelector('[data-testid="pdf-page-input"]').value`)
  check('prev page button -> page 4', prevVal === '4', `value=${prevVal}`)

  await evalIn(send, `document.querySelector('[data-testid="pdf-next-page"]').click()`)
  await sleep(300)
  const nextVal = await evalIn(send, `document.querySelector('[data-testid="pdf-page-input"]').value`)
  check('next page button -> page 5', nextVal === '5', `value=${nextVal}`)

  // Hover tooltip (real CDP mouse move): name + shortcut + description
  const tipTarget = await evalIn(send, `(() => {
    const b = document.querySelector('[data-testid="pdf-zoom-in"]').getBoundingClientRect();
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
  })()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 400 })
  await sleep(150)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tipTarget.x, y: tipTarget.y })
  await sleep(250)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tipTarget.x + 1, y: tipTarget.y })
  await sleep(1000)
  const tipText = await evalIn(send, `(() => {
    const t = document.querySelector('[role="tooltip"], [data-radix-popper-content-wrapper]');
    return t ? t.textContent : '';
  })()`)
  check('hover tooltip shows shortcut + description', /Ctrl\+=/.test(tipText) && tipText.length > 10, tipText.slice(0, 80))

  const shot3 = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(shotDir, 'pdf-verify-3-toolbar.png'), Buffer.from(shot3.result.data, 'base64'))

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
  process.exitCode = failures === 0 ? 0 : 1
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  try {
    execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' })
  } catch {
    /* ignore */
  }
  await sleep(500)
  process.exit(process.exitCode ?? 1)
}
