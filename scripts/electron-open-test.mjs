/**
 * Minimal Electron harness: load production renderer, open a sample docx via store, dump console.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronPath = require('electron')

const sampleDoc =
  [
    path.join(os.homedir(), 'Desktop', '12122.docx'),
    path.join(os.homedir(), 'OneDrive', 'Desktop', '论文.docx'),
  ].find((p) => fs.existsSync(p))

const harness = path.join(root, 'scripts', '_electron-harness.cjs')
fs.writeFileSync(
  harness,
  `
const { app, BrowserWindow } = require('electron');
const path = require('path');
const root = ${JSON.stringify(root)};
const sample = ${JSON.stringify(sampleDoc)};

// Register same handlers as production by requiring compiled main pieces is hard;
// instead load the real app entry.
process.env.SMOKE_SAMPLE = sample || '';

app.whenReady().then(async () => {
  // Load production main by requiring out/main - but it creates its own window.
  // So we just require the built main which starts the app.
});
`,
)

// Simpler: run electron on project; use executeJavaScript via remote debugging
const port = 9333
const child = spawn(
  electronPath,
  [`--remote-debugging-port=${port}`, root],
  {
    cwd: root,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)

let out = ''
child.stdout.on('data', (b) => {
  out += b
  process.stdout.write(b)
})
child.stderr.on('data', (b) => {
  out += b
  process.stdout.write(b)
})

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function cdp(method, params = {}) {
  // discover ws url
  const res = await fetch(`http://127.0.0.1:${port}/json`)
  const list = await res.json()
  const page = list.find((x) => x.type === 'page') || list[0]
  if (!page) throw new Error('no page target')
  const wsUrl = page.webSocketDebuggerUrl
  const { default: WebSocket } = await import('ws').catch(() => ({ default: null }))
  if (!WebSocket) {
    // fallback: use HTTP only for version
    return { wsUrl, list }
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let id = 0
    ws.on('open', () => {
      id++
      ws.send(JSON.stringify({ id, method, params }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.id === id) {
        ws.close()
        resolve(msg)
      }
    })
    ws.on('error', reject)
    setTimeout(() => reject(new Error('cdp timeout')), 10000)
  })
}

;(async () => {
  try {
    await sleep(5000)
    const res = await fetch(`http://127.0.0.1:${port}/json/list`)
    const list = await res.json()
    console.log('\n=== CDP targets ===')
    console.log(list.map((t) => ({ type: t.type, title: t.title, url: t.url })))

    // Use Runtime.evaluate via raw websocket without ws package if possible
    const page = list.find((t) => String(t.url).includes('renderer') || t.type === 'page')
    if (!page?.webSocketDebuggerUrl) {
      console.log('No debugger URL')
    } else {
      // Prefer global WebSocket in Node 22+
      const WS = globalThis.WebSocket
      if (!WS) {
        console.log('No WebSocket in this Node; dumping logs only')
      } else {
        const result = await new Promise((resolve, reject) => {
          const ws = new WS(page.webSocketDebuggerUrl)
          let nextId = 1
          const pending = new Map()
          ws.addEventListener('open', () => {
            const send = (method, params) => {
              const id = nextId++
              return new Promise((res2, rej2) => {
                pending.set(id, { res2, rej2 })
                ws.send(JSON.stringify({ id, method, params }))
              })
            }
            ;(async () => {
              await send('Runtime.enable')
              const expr = `
                (async () => {
                  const api = window.api;
                  const info = {
                    hasApi: !!api,
                    hasLw: !!(api && api.lw),
                    platform: api && api.platform,
                    sample: ${JSON.stringify(sampleDoc)},
                  };
                  try {
                    if (api && ${JSON.stringify(sampleDoc)}) {
                      const p = ${JSON.stringify(sampleDoc)};
                      await api.file.open(p);
                      // set zustand store if available via react is hard; call path used by FileManager
                      // try to find by dispatching through exposed API only
                      info.openResult = 'opened-ipc';
                      // read file via lw
                      const r = await api.lw.readFile(p);
                      info.readBytes = r.data ? r.data.length : 0;
                      info.readOk = true;
                    }
                  } catch (e) {
                    info.error = String(e && e.message || e);
                  }
                  return info;
                })()
              `
              const evalRes = await send('Runtime.evaluate', {
                expression: expr,
                awaitPromise: true,
                returnByValue: true,
              })
              resolve(evalRes)
              ws.close()
            })().catch(reject)
          })
          ws.addEventListener('message', (ev) => {
            const msg = JSON.parse(ev.data)
            if (msg.id && pending.has(msg.id)) {
              const { res2 } = pending.get(msg.id)
              pending.delete(msg.id)
              res2(msg)
            }
          })
          ws.addEventListener('error', reject)
          setTimeout(() => reject(new Error('ws timeout')), 15000)
        })
        console.log('\n=== evaluate result ===')
        console.log(JSON.stringify(result, null, 2))
      }
    }
  } catch (e) {
    console.error('smoke error', e)
  } finally {
    child.kill()
    setTimeout(() => process.exit(0), 500)
  }
})()
