import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { spawn } from 'node:child_process'

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

const port = 9342
const child = spawn(electronPath, [`--remote-debugging-port=${port}`, root], {
  cwd: root,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', (b) => process.stdout.write(b))
child.stderr.on('data', (b) => process.stdout.write(b))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
        if (/PdfViewer|toHex|无法|Error|error|PDF/i.test(vals)) {
          console.log('[console]', vals.slice(0, 350))
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
  await sleep(5000)
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = list.find((t) => String(t.url).includes('out/renderer'))
  const { send } = await connect(page.webSocketDebuggerUrl)
  await send('Runtime.enable')
  await send('Console.enable')

  const res = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(() => {
      return (async () => {
        const filePath = ${JSON.stringify(samplePdf)};
        const name = ${JSON.stringify(sample)};
        const homeBtn = [...document.querySelectorAll('button')].find(b => b.title === '主目录');
        if (homeBtn) homeBtn.click();
        await new Promise(r => setTimeout(r, 600));
        const desk = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === 'Desktop');
        if (desk) { desk.click(); await new Promise(r => setTimeout(r, 1000)); }
        let btn = [...document.querySelectorAll('button')].find(b => (b.textContent||'').includes(name));
        if (!btn) {
          const rootEl = document.getElementById('root');
          const k = Object.keys(rootEl).find(x => x.startsWith('__reactContainer') || x.startsWith('__reactFiber'));
          const q = [rootEl[k]]; const seen = new Set();
          while (q.length) {
            const n = q.shift(); if (!n || seen.has(n)) continue; seen.add(n);
            if (n.memoizedProps && typeof n.memoizedProps.onOpenFile === 'function') {
              n.memoizedProps.onOpenFile(filePath); btn = true; break;
            }
            if (n.child) q.push(n.child); if (n.sibling) q.push(n.sibling);
          }
        } else btn.click();
        // PDFs can be large; wait longer
        await new Promise(r => setTimeout(r, 20000));
        const text = document.body.innerText;
        const pageImgs = [...document.querySelectorAll('img')].filter(img => /第\\s*\\d+\\s*页/.test(img.alt || ''));
        return {
          titleBar: text.split('\\n')[0],
          editorReady: text.includes('本地离线编辑中'),
          hasError: text.includes('无法加载 PDF'),
          hasToHex: text.includes('toHex'),
          hasSumPrecise: text.includes('sumPrecise'),
          loading: text.includes('加载 PDF'),
          pageImgCount: pageImgs.length,
          imgCount: document.querySelectorAll('img').length,
          snippet: text.slice(0, 300),
        };
      })();
    })()`,
  })
  console.log(JSON.stringify(res.result, null, 2))
} catch (e) {
  console.error(e)
} finally {
  child.kill()
  await sleep(300)
  process.exit(0)
}
