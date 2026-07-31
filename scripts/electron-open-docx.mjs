import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = process.cwd()
const electronPath = require('electron')
const sampleName = '12122.docx'
const desktop = path.join(os.homedir(), 'Desktop')
const port = 9336

const child = spawn(electronPath, [`--remote-debugging-port=${port}`, root], {
  cwd: root,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const logs = []
const onLog = (b) => {
  const s = b.toString()
  logs.push(s)
  process.stdout.write(s)
}
child.stdout.on('data', onLog)
child.stderr.on('data', onLog)

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
    ws.addEventListener('open', () => resolve({ ws, send }))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.method === 'Runtime.consoleAPICalled') {
        const vals = (msg.params.args || []).map((a) => a.value ?? a.description).join(' ')
        console.log('[console]', msg.params.type, vals)
      }
      if (msg.id && pending.has(msg.id)) {
        const { res } = pending.get(msg.id)
        pending.delete(msg.id)
        res(msg)
      }
    })
    ws.addEventListener('error', reject)
    setTimeout(() => reject(new Error('connect timeout')), 15000)
  })
}

try {
  await sleep(5000)
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = list.find((t) => String(t.url).includes('out/renderer'))
  if (!page) throw new Error('no renderer')

  const { send } = await connect(page.webSocketDebuggerUrl)
  await send('Runtime.enable')
  await send('Console.enable')
  await send('DOM.enable')

  // Navigate file manager to Desktop and open sample docx by reusing app APIs + zustand if exposed.
  // We monkey-patch by calling open through a custom event if needed.
  // Instead: use DOM — click 主目录, then find Desktop folder, then file.
  const step1 = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(() => {
      return (async () => {
        const api = window.api;
        const desktop = ${JSON.stringify(desktop)};
        const sample = ${JSON.stringify(path.join(desktop, sampleName))};
        // load desktop into file manager store by calling list and triggering React is hard;
        // dispatch click on folder open is flaky. Directly set editor by finding React props — skip.
        // Use a hidden path: FileManager openFile logic:
        await api.file.open(sample);
        // Try to update zustand store via module graph is not available.
        // Dispatch a custom approach: set location hash and use DOM text content.
        // Fallback: call SuperDoc path by writing into a global bridge.
        window.__smokeOpen = sample;
        // Find buttons containing filename
        const buttons = [...document.querySelectorAll('button')];
        const hit = buttons.find(b => (b.textContent || '').includes(${JSON.stringify(sampleName)}));
        if (hit) {
          hit.click();
          return { clicked: true, text: hit.textContent };
        }
        // If not visible (not on Desktop), open Desktop folder first
        // Click 打开文件夹 is dialog — skip. Use Home then navigate.
        // Programmatically update file store through React fiber search
        function findZustandSetters(root) {
          const queue = [root];
          const seen = new Set();
          while (queue.length) {
            const node = queue.shift();
            if (!node || seen.has(node)) continue;
            seen.add(node);
            const props = node.memoizedProps || node.pendingProps;
            if (props && typeof props === 'object') {
              // look for onOpenFile
            }
            if (node.child) queue.push(node.child);
            if (node.sibling) queue.push(node.sibling);
            if (node.alternate) queue.push(node.alternate);
          }
        }
        // Direct store mutation: zustand stores are in module scope. Expose via React internals:
        const rootEl = document.getElementById('root');
        const key = Object.keys(rootEl).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
        const fiber = rootEl[key];
        let found = null;
        const q = [fiber];
        const seen = new Set();
        while (q.length && !found) {
          const n = q.shift();
          if (!n || seen.has(n)) continue;
          seen.add(n);
          try {
            const state = n.memoizedState;
            // walk hooks
            let h = state;
            let guard = 0;
            while (h && guard++ < 50) {
              const qv = h.queue;
              // not reliable
              h = h.next;
            }
            const ms = n.memoizedState;
            if (ms && ms.element) {
              // skip
            }
          } catch {}
          if (n.child) q.push(n.child);
          if (n.sibling) q.push(n.sibling);
        }

        // last resort: inject a minimal open by recreating LightweightDocumentEditor conditions —
        // push history state and force set via localStorage event for a temporary bridge.
        localStorage.setItem('__smoke_file', sample);
        return {
          clicked: false,
          buttonCount: buttons.length,
          sampleNamesOnPage: buttons.map(b => b.textContent).filter(t => /docx|xlsx|pdf|txt/i.test(t||'')).slice(0, 20),
          bodySnippet: document.body.innerText.slice(0, 500),
        };
      })();
    })()`,
  })
  console.log('STEP1', JSON.stringify(step1.result, null, 2))

  // Navigate file manager to desktop using Home button then... actually list Desktop by invoking
  // the same IPC and manually rendering isn't possible. Click "主目录" then find Desktop.
  const nav = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(() => {
      return (async () => {
        const api = window.api;
        const desktop = ${JSON.stringify(desktop)};
        const sample = ${JSON.stringify(path.join(desktop, sampleName))};
        // Load desktop directory into UI by finding setCurrentDir via buttons:
        // click folder button with title 打开文件夹 no.
        // Use: get home, list, we need setEntries - not exposed.
        // HACK: dispatch click on path breadcrumb after forcing store via electron webFrame? 
        // Better HACK: use React 18 setState through internal fiber for FileManager is complex.
        // Simplest path for smoke: dynamically import is not available.
        
        // Create a temporary floating open by replacing center panel content? too invasive.

        // Use Mutation: patch window and fire a custom event that we add... not in app.

        // Click 主目录 (Home)
        const homeBtn = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === '主目录');
        if (homeBtn) homeBtn.click();
        await new Promise(r => setTimeout(r, 800));
        // Click Desktop directory if present
        const deskBtn = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === 'Desktop' || (b.textContent||'').includes('Desktop'));
        if (deskBtn) deskBtn.click();
        await new Promise(r => setTimeout(r, 1000));
        // OneDrive Desktop name?
        let fileBtn = [...document.querySelectorAll('button')].find(b => (b.textContent||'').includes(${JSON.stringify(sampleName)}));
        if (!fileBtn) {
          // try open Desktop from home listing
          const candidates = [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(Boolean).slice(0, 40);
          return { stage: 'after-home', candidates, hasDesktop: !!deskBtn };
        }
        fileBtn.click();
        await new Promise(r => setTimeout(r, 3000));
        return {
          stage: 'opened',
          body: document.body.innerText.slice(0, 800),
          hasUnsupported: document.body.innerText.includes('暂不支持'),
          hasLoadingWord: document.body.innerText.includes('加载 Word'),
          hasWordError: document.body.innerText.includes('无法加载 Word'),
          hasLightweight: document.body.innerText.includes('轻量'),
        };
      })();
    })()`,
  })
  console.log('NAV', JSON.stringify(nav.result, null, 2))

  await sleep(2000)
  const final = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `({
      text: document.body.innerText.slice(0, 1200),
      hasUnsupported: document.body.innerText.includes('暂不支持'),
      hasWordError: document.body.innerText.includes('无法加载 Word'),
      hasLoading: document.body.innerText.includes('加载'),
      title: document.title,
    })`,
  })
  console.log('FINAL', JSON.stringify(final.result, null, 2))
} catch (e) {
  console.error('ERR', e)
} finally {
  child.kill()
  await sleep(300)
  process.exit(0)
}
