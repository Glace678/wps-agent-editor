import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = process.cwd()
const electronPath = require('electron')
const sampleDoc = path.join(os.homedir(), 'Desktop', 'B24040418欧寅圣实验一.doc')
if (!fs.existsSync(sampleDoc)) {
  console.error('sample missing', sampleDoc)
  process.exit(1)
}

const port = 19341
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-agent-doc-verify-'))
const screenshotPath = path.join(os.tmpdir(), 'wps-agent-word-fidelity.png')
const lastPageScreenshotPath = path.join(os.tmpdir(), 'wps-agent-word-fidelity-last-page.png')
let exitCode = 0
const child = spawn(electronPath, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profilePath}`,
  root,
], {
  cwd: root,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', (b) => process.stdout.write(b))
child.stderr.on('data', (b) => process.stdout.write(b))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForDebugTarget(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) return await response.json()
    } catch {
      // Electron is still starting.
    }
    await sleep(250)
  }
  throw new Error('Timed out waiting for the Electron debug target')
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let nextId = 1
    const pending = new Map()
    const send = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = nextId++
        pending.set(id, { res, rej })
        ws.send(JSON.stringify({ id, method, params }))
      })
    ws.addEventListener('open', () => resolve({ send }))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.method === 'Runtime.consoleAPICalled') {
        const vals = (msg.params.args || []).map((a) => a.value ?? a.description).join(' ')
        if (/WordEditor|Lightweight|兼容|Error|error|无法/i.test(vals)) {
          console.log('[console]', vals.slice(0, 300))
        }
      }
      if (msg.id && pending.has(msg.id)) {
        const { res } = pending.get(msg.id)
        pending.delete(msg.id)
        res(msg)
      }
    })
    ws.addEventListener('error', reject)
  })
}

try {
  const list = await waitForDebugTarget()
  const page = list.find((t) => String(t.url).includes('out/renderer'))
  if (!page) throw new Error('Renderer debug target was not found')
  const { send } = await connect(page.webSocketDebuggerUrl)
  await send('Runtime.enable')
  await send('Console.enable')
  await send('Page.enable')

  const res = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(() => {
      return (async () => {
        const filePath = ${JSON.stringify(sampleDoc)};
        const name = ${JSON.stringify(path.basename(sampleDoc))};
        const homeBtn = [...document.querySelectorAll('button')].find(b => b.title === '主目录');
        if (homeBtn) homeBtn.click();
        await new Promise(r => setTimeout(r, 600));
        const desk = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === 'Desktop');
        if (desk) { desk.click(); await new Promise(r => setTimeout(r, 900)); }
        const btn = [...document.querySelectorAll('button')].find(b => (b.textContent||'').includes(name));
        if (!btn) {
          const rootEl = document.getElementById('root');
          const k = Object.keys(rootEl).find(x => x.startsWith('__reactContainer') || x.startsWith('__reactFiber'));
          const q = [rootEl[k]]; const seen = new Set();
          let opened = false;
          while (q.length && !opened) {
            const n = q.shift(); if (!n || seen.has(n)) continue; seen.add(n);
            if (n.memoizedProps && typeof n.memoizedProps.onOpenFile === 'function') {
              n.memoizedProps.onOpenFile(filePath); opened = true;
            }
            if (n.child) q.push(n.child); if (n.sibling) q.push(n.sibling);
          }
          if (!opened) return { ok: false, reason: 'not found' };
        } else btn.click();
        await new Promise(r => setTimeout(r, 12000));
        const text = document.body.innerText;
        const pages = [...document.querySelectorAll('.superdoc-page[data-page-index]')];
        const firstPage = pages[0] || null;
        const firstPageRect = firstPage?.getBoundingClientRect() || null;
        const images = firstPage
          ? [...firstPage.querySelectorAll('img')].map((image) => {
              const rect = image.getBoundingClientRect();
              return {
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                srcPrefix: String(image.currentSrc || image.src || '').slice(0, 48),
              };
            }).filter((image) => image.width > 1 && image.height > 1)
          : [];
        const tables = [...document.querySelectorAll('table, [data-node-type="table"]')];
        const overflowingTables = tables.filter((table) => {
              const ownerPage = table.closest('.superdoc-page[data-page-index]');
              if (!ownerPage) return false;
              const pageRect = ownerPage.getBoundingClientRect();
              const rect = table.getBoundingClientRect();
              if (rect.width <= 1 || pageRect.width <= 1) return false;
              return rect.left < pageRect.left - 1 || rect.right > pageRect.right + 1;
            }).length;
        return {
          ok: true,
          titleBar: text.split('\\n')[0],
          editorReady: text.includes('本地离线编辑中'),
          hasCompatNotice: text.includes('内置兼容层') || text.includes('旧版 .doc'),
          hasUnsupported: text.includes('暂不支持'),
          hasError: text.includes('无法加载 Word'),
          pageCount: pages.length,
          imageCountOnFirstPage: images.length,
          images,
          tableCount: tables.length,
          overflowingTables,
          firstPage: firstPageRect && {
            width: Math.round(firstPageRect.width),
            height: Math.round(firstPageRect.height),
          },
          snippet: text.slice(0, 400),
        };
      })();
    })()`,
  })
  console.log(JSON.stringify(res.result, null, 2))
  const metrics = res.result?.result?.value
  if (
    !metrics?.ok
    || metrics.hasError
    || metrics.pageCount < 1
    || metrics.tableCount < 1
    || metrics.imageCountOnFirstPage < 1
    || metrics.overflowingTables !== 0
  ) {
    throw new Error(`Word fidelity assertions failed: ${JSON.stringify(metrics)}`)
  }

  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  if (screenshot.result?.data) {
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, 'base64'))
    console.log(JSON.stringify({ screenshotPath }))
  }

  const lastPage = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const viewport = [...document.querySelectorAll('.super-editor-container')]
        .find((element) => element.scrollHeight > element.clientHeight + 1);
      if (!viewport) return { ok: false, reason: 'scroll viewport missing' };
      viewport.scrollTop = viewport.scrollHeight;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const allImages = [...document.querySelectorAll('.superdoc-page img')]
        .filter((image) => {
          const rect = image.getBoundingClientRect();
          return rect.width > 1 && rect.height > 1;
        });
      const targetImage = allImages
        .map((image) => ({ image, area: image.getBoundingClientRect().width * image.getBoundingClientRect().height }))
        .sort((left, right) => left.area - right.area)[0]?.image || null;
      targetImage?.scrollIntoView({ block: 'center' });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const viewportRect = viewport.getBoundingClientRect();
      const visibleImages = allImages
        .map((image) => {
          const rect = image.getBoundingClientRect();
          return { width: Math.round(rect.width), height: Math.round(rect.height), top: rect.top, bottom: rect.bottom };
        })
        .filter((image) => image.width > 1 && image.height > 1 && image.bottom > viewportRect.top && image.top < viewportRect.bottom);
      return {
        ok: true,
        allImageCount: allImages.length,
        visibleImageCount: visibleImages.length,
        hasSignatureSizedImage: visibleImages.some((image) => image.width < 150 && image.height < 100),
        visibleImages,
      };
    })()`,
  })
  const lastPageMetrics = lastPage.result?.result?.value
  console.log(JSON.stringify({ lastPage: lastPageMetrics }, null, 2))
  if (!lastPageMetrics?.ok || !lastPageMetrics.hasSignatureSizedImage) {
    throw new Error(`Last-page image assertion failed: ${JSON.stringify(lastPageMetrics)}`)
  }

  const lastPageScreenshot = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  if (lastPageScreenshot.result?.data) {
    fs.writeFileSync(lastPageScreenshotPath, Buffer.from(lastPageScreenshot.result.data, 'base64'))
    console.log(JSON.stringify({ lastPageScreenshotPath }))
  }
} catch (e) {
  console.error(e)
  exitCode = 1
} finally {
  child.kill()
  await sleep(300)
  fs.rmSync(profilePath, { recursive: true, force: true })
  process.exit(exitCode)
}
