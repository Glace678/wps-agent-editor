import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')
const root = process.cwd()
const electronPath = require('electron')
const desktop = path.join(os.homedir(), 'Desktop')
const sampleDocx = path.join(desktop, '12122.docx')
const sampleDoc = path.join(desktop, 'B24040418欧寅圣实验一.doc')
const sampleXlsx = path.join(desktop, '_smoke_test.xlsx')

// create minimal xlsx
const wb = XLSX.utils.book_new()
const ws = XLSX.utils.aoa_to_sheet([
  ['Name', 'Score'],
  ['Alice', 95],
  ['Bob', 88],
])
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
XLSX.writeFile(wb, sampleXlsx)

const port = 9337
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
        if (/WordEditor|ExcelEditor|Lightweight|Error|error|无法|暂不|superdoc/i.test(vals)) {
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

async function openViaUi(send, filePath) {
  const name = path.basename(filePath)
  const dir = path.dirname(filePath)
  return send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(() => {
      return (async () => {
        const api = window.api;
        const filePath = ${JSON.stringify(filePath)};
        const dir = ${JSON.stringify(dir)};
        const name = ${JSON.stringify(name)};
        // navigate UI to folder by listing: click home not enough for arbitrary path
        // Use fiber-less approach: find FileManager buttons after forcing directory via repeated clicks is hard.
        // Direct approach: monkeypatch by clicking if file visible, else use store-less open:
        // 1) set current dir by selecting folder is dialog.
        // Instead invoke openFile flow through simulated custom:
        await api.file.open(filePath);
        // Find React setState for editor by locating useEditorStore — expose via temporary assignment:
        // Walk all button texts after loading dir into file manager:
        // Trigger FileManager loadDir by dispatching a synthetic path into breadcrumb is not available.
        // Use: locate zustand store from webpack - not available.
        // PRACTICAL: dispatch click after manually injecting into localStorage and... 
        // Best approach that works with current app: use querySelector after navigating Desktop only.

        // Load Desktop into manager: click 主目录 then Desktop (only works for Desktop files)
        const homeBtn = [...document.querySelectorAll('button')].find(b => b.title === '主目录');
        if (homeBtn) homeBtn.click();
        await new Promise(r => setTimeout(r, 500));
        // If path is under Desktop, open Desktop folder
        if (dir.toLowerCase().endsWith('desktop')) {
          const desk = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === 'Desktop');
          if (desk) { desk.click(); await new Promise(r => setTimeout(r, 800)); }
        }
        let btn = [...document.querySelectorAll('button')].find(b => (b.textContent||'').includes(name));
        if (!btn) {
          // force open by creating a temporary link using editor store:
          // Access zustand through React DevTools hook
          const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
          // fallback: call setCurrentFile via internal module — use event
          // Direct DOM hack: the App uses useEditorStore — we can import? no.
          // Use history and location? no.
          // FINAL HACK: find fiber with setCurrentFile in pendingProps/memoizedProps closures
          function walk(fiber, visit) {
            const seen = new Set();
            const q = [fiber];
            while (q.length) {
              const n = q.shift();
              if (!n || seen.has(n)) continue;
              seen.add(n);
              visit(n);
              if (n.child) q.push(n.child);
              if (n.sibling) q.push(n.sibling);
            }
          }
          const rootEl = document.getElementById('root');
          const k = Object.keys(rootEl).find(x => x.startsWith('__reactContainer') || x.startsWith('__reactFiber'));
          let opened = false;
          walk(rootEl[k], (n) => {
            if (opened) return;
            const props = n.memoizedProps;
            if (props && typeof props.onOpenFile === 'function') {
              props.onOpenFile(filePath);
              opened = true;
            }
            if (props && typeof props.onOpen === 'function' && props.files) {
              // RecentFiles
            }
          });
          if (!opened) {
            // try hook state from FileManager by searching for setCurrentFile string in function source — impossible.
            return { ok: false, reason: 'file button not found and fiber open failed', name };
          }
          await new Promise(r => setTimeout(r, 3500));
          return {
            ok: true,
            mode: 'fiber',
            text: document.body.innerText.slice(0, 400),
            hasUnsupported: document.body.innerText.includes('暂不支持'),
            hasWordError: document.body.innerText.includes('无法加载 Word'),
            hasExcelError: document.body.innerText.includes('无法加载表格'),
            hasLoadingWord: document.body.innerText.includes('加载 Word'),
            hasLoadingExcel: document.body.innerText.includes('加载表格'),
            editorReady: document.body.innerText.includes('本地离线编辑中'),
            titleBar: document.body.innerText.split('\\n')[0],
          };
        }
        btn.click();
        await new Promise(r => setTimeout(r, 3500));
        return {
          ok: true,
          mode: 'click',
          text: document.body.innerText.slice(0, 400),
          hasUnsupported: document.body.innerText.includes('暂不支持'),
          hasWordError: document.body.innerText.includes('无法加载 Word'),
          hasExcelError: document.body.innerText.includes('无法加载表格'),
          hasLoadingWord: document.body.innerText.includes('加载 Word'),
          hasLoadingExcel: document.body.innerText.includes('加载表格'),
          editorReady: document.body.innerText.includes('本地离线编辑中'),
          titleBar: document.body.innerText.split('\\n')[0],
        };
      })();
    })()`,
  })
}

try {
  await sleep(5000)
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = list.find((t) => String(t.url).includes('out/renderer'))
  const { send } = await connect(page.webSocketDebuggerUrl)
  await send('Runtime.enable')
  await send('Console.enable')

  for (const file of [sampleDocx, sampleDoc, sampleXlsx]) {
    console.log('\n==== TEST', file, 'exists', fs.existsSync(file))
    const res = await openViaUi(send, file)
    console.log(JSON.stringify(res.result, null, 2))
    await sleep(1000)
  }
} catch (e) {
  console.error(e)
} finally {
  child.kill()
  try { fs.unlinkSync(sampleXlsx) } catch {}
  await sleep(300)
  process.exit(0)
}
