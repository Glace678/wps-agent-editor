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
const sampleXlsx = path.join(desktop, '_smoke_test.xlsx')

const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([
    ['Name', 'Score'],
    ['Alice', 95],
    ['Bob', 88],
  ]),
  'Sheet1',
)
XLSX.writeFile(wb, sampleXlsx)

const port = 9340
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
        if (/WordEditor|ExcelEditor|Lightweight|Error|error|185|无法|暂不|解析成功/i.test(vals)) {
          console.log('[console]', vals.slice(0, 280))
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

async function openFile(send, filePath) {
  const name = path.basename(filePath)
  return send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(() => {
      return (async () => {
        const filePath = ${JSON.stringify(filePath)};
        const name = ${JSON.stringify(name)};
        const homeBtn = [...document.querySelectorAll('button')].find(b => b.title === '主目录');
        if (homeBtn) homeBtn.click();
        await new Promise(r => setTimeout(r, 500));
        const desk = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === 'Desktop');
        if (desk) { desk.click(); await new Promise(r => setTimeout(r, 900)); }
        let btn = [...document.querySelectorAll('button')].find(b => (b.textContent||'').includes(name));
        if (!btn) {
          // fiber fallback
          const rootEl = document.getElementById('root');
          const k = Object.keys(rootEl).find(x => x.startsWith('__reactContainer') || x.startsWith('__reactFiber'));
          let opened = false;
          const q = [rootEl[k]];
          const seen = new Set();
          while (q.length && !opened) {
            const n = q.shift();
            if (!n || seen.has(n)) continue;
            seen.add(n);
            const props = n.memoizedProps;
            if (props && typeof props.onOpenFile === 'function') {
              props.onOpenFile(filePath);
              opened = true;
            }
            if (n.child) q.push(n.child);
            if (n.sibling) q.push(n.sibling);
          }
          if (!opened) return { ok: false, reason: 'not found' };
        } else {
          btn.click();
        }
        await new Promise(r => setTimeout(r, 4000));
        const text = document.body.innerText;
        return {
          ok: true,
          titleBar: text.split('\\n')[0],
          editorReady: text.includes('本地离线编辑中'),
          hasUnsupported: text.includes('暂不支持'),
          hasWordError: text.includes('无法加载 Word'),
          hasExcelError: text.includes('无法加载表格'),
          hasReact185: text.includes('Minified React error #185') || false,
          bodyLen: text.length,
          snippet: text.slice(0, 250),
        };
      })();
    })()`,
  })
}

try {
  await sleep(5000)
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = list.find((t) => String(t.url).includes('out/renderer'))
  if (!page) throw new Error('no renderer page')
  const { send } = await connect(page.webSocketDebuggerUrl)
  await send('Runtime.enable')
  await send('Console.enable')

  console.log('\n==== DOCX ====')
  console.log(JSON.stringify((await openFile(send, sampleDocx)).result, null, 2))

  console.log('\n==== XLSX ====')
  console.log(JSON.stringify((await openFile(send, sampleXlsx)).result, null, 2))
} catch (e) {
  console.error(e)
} finally {
  child.kill()
  try { fs.unlinkSync(sampleXlsx) } catch {}
  await sleep(400)
  process.exit(0)
}
