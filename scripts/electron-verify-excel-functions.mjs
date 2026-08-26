import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const ExcelJS = require('exceljs')
const electronPath = require('electron')
const root = process.cwd()
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-excel-functions-profile-'))
const samplePath = path.join(os.tmpdir(), `wps-excel-functions-${process.pid}.xlsx`)
const screenshotPath = path.join(root, '.cache', 'electron-verify-excel-functions.png')
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const providerId = `custom-excel-e2e-${process.pid}`
const agentId = `excel-e2e-agent-${process.pid}`

const VERIFIED_LABELS = {
  'zh-CN': '已验证',
  en: 'Verified',
  ja: '検証済み',
  es: 'Verificada',
  pt: 'Verificada',
  de: 'Verifiziert',
  fr: 'Vérifiée',
  ru: 'Проверено',
  ar: 'تم التحقق',
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => error
        ? reject(error)
        : resolve(typeof address === 'object' && address ? address.port : 0))
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
    } catch {}
    await sleep(100)
  }
  throw new Error('Timed out waiting for Electron renderer')
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const pending = new Map()
    let nextId = 1
    socket.addEventListener('open', () => resolve({
      send(method, params = {}) {
        return new Promise((resolveCall, rejectCall) => {
          const id = nextId++
          pending.set(id, { resolveCall, rejectCall })
          socket.send(JSON.stringify({ id, method, params }))
        })
      },
      close() { socket.close() },
    }))
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      const call = pending.get(message.id)
      if (!call) return
      pending.delete(message.id)
      if (message.error) call.rejectCall(new Error(message.error.message))
      else call.resolveCall(message)
    })
    socket.addEventListener('error', reject)
  })
}

async function evaluate(send, expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (response.result.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text)
  }
  return response.result.result.value
}

async function waitFor(send, expression, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(send, expression)
      if (value) return value
    } catch {
      // Reloading temporarily invalidates the JavaScript execution context.
    }
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

function check(label, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  assert.ok(condition, `${label}${detail ? `: ${detail}` : ''}`)
}

function assistantResponse(content) {
  return JSON.stringify({
    id: `chatcmpl-excel-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'excel-e2e-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  })
}

let requestCount = 0
const mockServer = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url?.endsWith('/models')) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: [{ id: 'excel-e2e-model' }] }))
    return
  }
  if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
    response.writeHead(404)
    response.end()
    return
  }
  request.resume()
  request.on('end', () => {
    requestCount += 1
    let content
    if (requestCount === 1) {
      content = '```tool\n{"tool":"search_excel_functions","args":{"query":"sum","category":"aggregate-statistical","limit":5}}\n```'
    } else if (requestCount === 2) {
      content = '```tool\n{"tool":"read_document","args":{}}\n```'
    } else if (requestCount === 3) {
      content = '```tool\n{"tool":"read_excel_range","args":{"sheet":"Sheet1","range":"A2:C4"}}\n```'
    } else if (requestCount === 4) {
      content = '```tool\n{"tool":"set_excel_formula","args":{"sheet":"Sheet1","target":"D2:D4","formula":"=SUM(A2:C2)"}}\n```'
    } else if (requestCount === 5 || requestCount === 7) {
      content = '```tool\n{"tool":"read_excel_range","args":{"sheet":"Sheet1","range":"D2:D4"}}\n```'
    } else {
      content = 'The Excel formulas were written and verified.'
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(assistantResponse(content))
  })
})

const workbook = new ExcelJS.Workbook()
const worksheet = workbook.addWorksheet('Sheet1')
worksheet.addRow(['A', 'B', 'C', 'Total'])
worksheet.addRow([1, 2, 3])
worksheet.addRow([4, 5, 6])
worksheet.addRow([7, 8, 9])
await workbook.xlsx.writeFile(samplePath)

async function typeFormulaBar(send, value) {
  const point = await evaluate(send, `(() => {
    const input = document.querySelector('#luckysheet-functionbox-cell');
    if (!input) return null;
    const rect = input.getBoundingClientRect();
    return { x: rect.left + Math.min(40, rect.width / 2), y: rect.top + rect.height / 2 };
  })()`)
  if (!point) throw new Error('Excel formula bar is unavailable')
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 })
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await send('Input.insertText', { text: value })
}

function keyFormulaBar(key) {
  return `(() => {
    const input = document.querySelector('#luckysheet-functionbox-cell');
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
    return input?.textContent ?? null;
  })()`
}

let child
let cdp
try {
  const mockPort = await getFreePort()
  await new Promise((resolve, reject) => {
    mockServer.once('error', reject)
    mockServer.listen(mockPort, '127.0.0.1', resolve)
  })
  const debugPort = await getFreePort()
  child = spawn(electronPath, [
    root,
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profilePath}`,
  ], {
    cwd: root,
    env: {
      ...process.env,
      WPS_ALLOW_MULTI_INSTANCE: '1',
      WPS_BRIDGE_PORT: String(debugPort + 4000),
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    stdio: 'ignore',
    windowsHide: true,
  })

  const page = await waitForPage(debugPort)
  cdp = await connectCdp(page.webSocketDebuggerUrl)
  const { send } = cdp
  await send('Runtime.enable')
  await send('Page.enable')
  await evaluate(send, `(() => {
    localStorage.setItem('wps-agent-language', 'zh-CN');
    localStorage.setItem('notepad-last-file', ${JSON.stringify(samplePath)});
    localStorage.removeItem('notepad-startup-behavior');
    location.reload();
    return true;
  })()`)
  await waitFor(send, `Boolean(document.querySelector('[data-testid="excel-editor-shell"] #luckysheet-functionbox-cell'))`, 'Excel formula bar')

  await typeFormulaBar(send, '=SUM')
  const verifiedPopup = await waitFor(send, `(() => {
    const popup = document.querySelector('[data-testid="excel-function-suggestions"]');
    const first = popup?.querySelector('[role="option"]');
    return popup && first ? { name: first.querySelector('.excel-function-suggestion-name')?.textContent,
      badge: first.querySelector('.is-verified')?.textContent } : null;
  })()`, 'verified formula suggestion')
  check('verified catalog functions are placed first', verifiedPopup.name === 'SUM', JSON.stringify(verifiedPopup))
  check('verified badge is localized', verifiedPopup.badge === '已验证', JSON.stringify(verifiedPopup))
  const insertedFormula = await evaluate(send, keyFormulaBar('Enter'))
  check('Enter inserts the selected English function name', insertedFormula === '=SUM(', insertedFormula)
  await evaluate(send, keyFormulaBar('Escape'))

  await typeFormulaBar(send, '=ACOS')
  const unverifiedPopup = await waitFor(send, `(() => {
    const option = document.querySelector('[data-testid="excel-function-suggestions"] [role="option"]');
    return option ? { name: option.querySelector('.excel-function-suggestion-name')?.textContent,
      badge: option.querySelector('.is-unverified')?.textContent } : null;
  })()`, 'unverified Fortune function')
  check('Fortune Sheet functions outside the 100 remain searchable', unverifiedPopup.name === 'ACOS', JSON.stringify(unverifiedPopup))
  check('functions outside the compatibility catalog are marked unverified', unverifiedPopup.badge === '未验证')
  await evaluate(send, keyFormulaBar('Escape'))
  await evaluate(send, keyFormulaBar('Escape'))

  await typeFormulaBar(send, '=条件求和')
  const localizedSearch = await waitFor(send, `document.querySelector('[data-testid="excel-function-suggestions"] .excel-function-suggestion-name')?.textContent`, 'localized description search')
  check('localized descriptions search the verified catalog', localizedSearch === 'SUMIF', String(localizedSearch))
  await evaluate(send, keyFormulaBar('Escape'))
  await evaluate(send, keyFormulaBar('Escape'))

  // Confirm the verified badge localizes under every supported application language.
  for (const [language, label] of Object.entries(VERIFIED_LABELS)) {
    await evaluate(send, `localStorage.setItem('wps-agent-language', ${JSON.stringify(language)}); location.reload(); true`)
    await waitFor(send, `Boolean(document.querySelector('[data-testid="excel-editor-shell"] #luckysheet-functionbox-cell'))`, `${language} Excel formula bar`)
    await typeFormulaBar(send, '=SUM')
    const badge = await waitFor(send, `document.querySelector('[data-testid="excel-function-suggestions"] .is-verified')?.textContent`, `${language} verified badge`)
    check(`${language} formula metadata`, badge === label, String(badge))
    await evaluate(send, keyFormulaBar('Escape'))
    await evaluate(send, keyFormulaBar('Escape'))
  }

  await evaluate(send, `localStorage.setItem('wps-agent-language', 'zh-CN'); location.reload(); true`)
  await waitFor(send, `Boolean(document.querySelector('[data-testid="excel-editor-shell"] #luckysheet-functionbox-cell'))`, 'reloaded Chinese Excel editor')
  await evaluate(send, `document.documentElement.classList.add('dark'); true`)
  await typeFormulaBar(send, '=SUM')
  const darkBackground = await waitFor(send, `(() => {
    const popup = document.querySelector('[data-testid="excel-function-suggestions"]');
    return popup ? getComputedStyle(popup).backgroundColor : null;
  })()`, 'dark formula suggestions')
  check('formula suggestions use a dark-theme surface', !['rgb(255, 255, 255)', '#ffffff'].includes(darkBackground), darkBackground)
  await evaluate(send, keyFormulaBar('Escape'))
  await evaluate(send, keyFormulaBar('Escape'))
  await evaluate(send, `document.documentElement.classList.remove('dark'); true`)

  const agentResult = await evaluate(send, `(async () => {
    await window.api.customProvider.save({
      id: ${JSON.stringify(providerId)}, name: 'Excel E2E Provider',
      baseURL: ${JSON.stringify(`http://127.0.0.1:${mockPort}/v1`)},
      defaultModel: 'excel-e2e-model', models: [{ id: 'excel-e2e-model', name: 'excel-e2e-model' }],
      protocol: 'openai-compatible', createdAt: Date.now()
    });
    await window.api.auth.set(${JSON.stringify(providerId)}, 'local-e2e-key');
    await window.api.agent.save({
      id: ${JSON.stringify(agentId)}, name: 'Excel E2E Agent', role: 'Excel tester',
      systemPrompt: 'Use the requested Excel tools.', providerId: ${JSON.stringify(providerId)},
      model: 'excel-e2e-model', color: '#16a34a', enabled: true
    });
    return window.api.agent.chat(${JSON.stringify(agentId)}, [{ role: 'user', content: 'Write totals to D2:D4 and verify them.' }], 'excel-e2e-write', 'excel-e2e-write-run');
  })()`)
  check('Agent executes catalog query, workbook/range reads, formula write, and reread', agentResult.toolCalls?.length === 5, JSON.stringify(agentResult.toolCalls))
  const summaryResult = agentResult.toolCalls[1]?.result
  const writeResult = agentResult.toolCalls[3]?.result
  const readResult = agentResult.toolCalls[4]?.result
  check('Agent workbook read identifies the active sheet', summaryResult?.workbook?.activeSheet === 'Sheet1', JSON.stringify(summaryResult))
  check('Agent formula write reports the exact changed count', writeResult?.success && writeResult.changedCells === 3, JSON.stringify(writeResult))
  check('Agent formula write returns the actual filled formulas', writeResult?.actualFormulaCount === 3
    && writeResult.actualFormulas?.map((item) => item.formula).join('|') === '=SUM(A2:C2)|=SUM(A3:C3)|=SUM(A4:C4)', JSON.stringify(writeResult))
  check('Agent reread returns adjusted formulas', readResult?.cells?.map((cell) => cell.formula).join('|') === '=SUM(A2:C2)|=SUM(A3:C3)|=SUM(A4:C4)', JSON.stringify(readResult))
  check('Agent reread returns calculated display values', readResult?.cells?.map((cell) => String(cell.display)).join('|') === '6|15|24', JSON.stringify(readResult))

  await evaluate(send, `window.api.appMenu.perform('save')`)
  await sleep(2_000)
  await evaluate(send, `location.reload(); true`)
  await waitFor(send, `Boolean(document.querySelector('[data-testid="excel-editor-shell"] #luckysheet-functionbox-cell'))`, 'saved workbook reopened')
  const reopenResult = await evaluate(send, `window.api.agent.chat(${JSON.stringify(agentId)}, [{ role: 'user', content: 'Read D2:D4 after reopening.' }], 'excel-e2e-reopen', 'excel-e2e-reopen-run')`)
  const reopenedRange = reopenResult.toolCalls?.[0]?.result
  check('saved formulas survive an application reopen', reopenedRange?.cells?.map((cell) => cell.formula).join('|') === '=SUM(A2:C2)|=SUM(A3:C3)|=SUM(A4:C4)', JSON.stringify(reopenedRange))

  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, 'base64'))
  console.log(`Screenshot: ${screenshotPath}`)
} finally {
  cdp?.close()
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill()
    await Promise.race([exited, sleep(5_000)])
  }
  await new Promise((resolve) => mockServer.close(resolve))
  try {
    fs.rmSync(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (error) {
    console.warn(`Could not remove temporary profile: ${error.message}`)
  }
  fs.rmSync(samplePath, { force: true })
}
