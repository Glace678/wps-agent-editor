import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = process.cwd()
const electronPath = require('electron')
const sampleDoc = path.join(os.homedir(), 'Desktop', '12122.docx')
const port = 9335

const child = spawn(electronPath, [`--remote-debugging-port=${port}`, root], {
  cwd: root,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', (b) => process.stdout.write(b))
child.stderr.on('data', (b) => process.stdout.write(b))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function cdpEvaluate(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let nextId = 1
    const pending = new Map()
    const send = (method, params) =>
      new Promise((res, rej) => {
        const id = nextId++
        pending.set(id, { res, rej })
        ws.send(JSON.stringify({ id, method, params }))
      })

    ws.addEventListener('open', async () => {
      try {
        await send('Runtime.enable')
        const evalRes = await send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        })
        resolve(evalRes)
        ws.close()
      } catch (e) {
        reject(e)
      }
    })
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res } = pending.get(msg.id)
        pending.delete(msg.id)
        res(msg)
      }
    })
    ws.addEventListener('error', reject)
    setTimeout(() => reject(new Error('timeout')), 20000)
  })
}

try {
  await sleep(6000)
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = list.find(
    (t) => String(t.url).includes('out/renderer') || String(t.url).includes('index.html'),
  )
  console.log('target', page && { title: page.title, url: page.url })
  if (!page) throw new Error('renderer page not found')

  const expression = `(() => {
    const sample = ${JSON.stringify(sampleDoc)};
    const dir = ${JSON.stringify(path.dirname(sampleDoc))};
    return (async () => {
      const api = window.api;
      const info = {
        hasApi: !!api,
        keys: api ? Object.keys(api) : [],
        platform: api && api.platform,
        href: location.href,
      };
      if (!api) return info;
      try {
        const list = await api.file.list(dir);
        info.listCount = list.length;
        info.officeCount = list.filter((e) => !e.isDirectory && /\\.(docx|xlsx|xls|doc)$/i.test(e.name)).length;
        info.extensions = [...new Set(list.filter(e => !e.isDirectory).map(e => e.extension))];
        info.sampleListed = list.some((e) => e.path === sample || e.name === ${JSON.stringify(path.basename(sampleDoc))});
        await api.file.open(sample);
        const r = await api.lw.readFile(sample);
        info.readB64 = r.data.length;
        const ext = sample.split('.').pop().toLowerCase();
        info.kind = ['docx','doc','odt'].includes(ext) ? 'word'
          : ['xlsx','xls','csv','ods'].includes(ext) ? 'excel' : 'unknown';
      } catch (e) {
        info.error = String(e && e.message || e);
        info.stack = e && e.stack;
      }
      return info;
    })();
  })()`

  const result = await cdpEvaluate(page.webSocketDebuggerUrl, expression)
  console.log('RESULT', JSON.stringify(result.result, null, 2))
} catch (e) {
  console.error('PROBE ERROR', e)
} finally {
  child.kill()
  setTimeout(() => process.exit(0), 300)
}
