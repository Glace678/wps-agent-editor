/**
 * Behavioral: across every app language, the Excel number-format dropdown must
 * be detected as a format picker, get its localized search placeholder, size
 * itself from visible row labels (no hidden-submenu inflation; previously
 * 347-360px, ru 520px), and never clip a visible row.
 */
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const ExcelJS = require('exceljs')
const electronPath = require('electron')
const root = process.cwd()
const artifactDir = path.join(root, '.cache')
const profilePath = path.join(os.tmpdir(), `wps-format-picker-profile-${process.pid}`)
const samplePath = path.join(os.tmpdir(), `wps-format-picker-${process.pid}.xlsx`)
const port = Number(process.env.WPS_FORMAT_VERIFY_PORT || 9373)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Expected localized format-search placeholders (from src/lib/i18n/locales). */
const FORMAT_PLACEHOLDERS = {
  'zh-CN': '搜索格式',
  en: 'Search format',
  ja: '書式を検索',
  es: 'Buscar formato',
  fr: 'Rechercher un format',
  de: 'Format suchen',
  pt: 'Pesquisar formato',
  ru: 'Поиск формата',
  ar: 'ابحث عن التنسيق',
}
const SCREENSHOT_LANGS = new Set(['zh-CN', 'ru'])

const expectedBuildFiles = [
  path.join(root, 'out', 'main', 'main.js'),
  path.join(root, 'out', 'renderer', 'index.html'),
]
for (const buildFile of expectedBuildFiles) {
  if (!fs.existsSync(buildFile)) {
    throw new Error(`Built Electron output is missing: ${buildFile}. Run npm run build first.`)
  }
}

fs.mkdirSync(artifactDir, { recursive: true })
fs.mkdirSync(profilePath, { recursive: true })
const workbook = new ExcelJS.Workbook()
workbook.addWorksheet('format check').getCell('A1').value = 'format check'
await workbook.xlsx.writeFile(samplePath)

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1

    const send = (method, params = {}) => new Promise((resolveSend, rejectSend) => {
      const id = nextId++
      pending.set(id, { resolve: resolveSend, reject: rejectSend })
      socket.send(JSON.stringify({ id, method, params }))
    })

    socket.addEventListener('open', () => resolve({ send, socket }))
    socket.addEventListener('error', reject)
    socket.addEventListener('close', () => {
      for (const { reject: rejectSend } of pending.values()) {
        rejectSend(new Error('DevTools connection closed'))
      }
      pending.clear()
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id || !pending.has(message.id)) return
      const request = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message)
    })
  })
}

async function findRendererTarget() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const target = targets.find((item) => String(item.url).includes('out/renderer'))
      if (target) return target
    } catch {}
    await sleep(250)
  }
  throw new Error('Electron renderer target did not appear')
}

async function evaluate(send, expression, awaitPromise = false) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  })
  if (response.result.exceptionDetails) {
    throw new Error(
      response.result.exceptionDetails.exception?.description
        || response.result.exceptionDetails.text,
    )
  }
  return response.result.result.value
}

async function waitFor(send, expression, timeout = 25_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      if (await evaluate(send, expression)) return
    } catch {}
    await sleep(200)
  }
  throw new Error(`Timed out waiting for: ${expression}`)
}

function check(name, condition, detail = '') {
  const marker = condition ? 'PASS' : 'FAIL'
  console.log(`[${marker}] ${name}${detail ? `: ${detail}` : ''}`)
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
}

let child
let socket
try {
  child = spawn(
    electronPath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profilePath}`,
      root,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        WPS_BRIDGE_PORT: process.env.WPS_BRIDGE_PORT || String(port + 4000),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  child.stdout.on('data', (buffer) => process.stdout.write(buffer))
  child.stderr.on('data', (buffer) => process.stdout.write(buffer))

  const target = await findRendererTarget()
  let send
  ;({ send, socket } = await connect(target.webSocketDebuggerUrl))
  await send('Runtime.enable')
  await send('Page.enable')

  for (const [lang, expectedPlaceholder] of Object.entries(FORMAT_PLACEHOLDERS)) {
    await evaluate(send, `(() => {
      localStorage.setItem('wps-agent-language', ${JSON.stringify(lang)})
      localStorage.setItem('notepad-last-file', ${JSON.stringify(samplePath)})
      localStorage.removeItem('notepad-startup-behavior')
      location.reload()
      return true
    })()`)
    await waitFor(send, `Boolean(
      document.querySelector('[data-testid="excel-editor-shell"] .fortune-toolbar')
      && document.querySelectorAll('.fortune-toolbar-combo-button').length >= 2
    )`)
    await sleep(1000)

    const report = await evaluate(send, `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const buttons = [...document.querySelectorAll('.fortune-toolbar-combo-button')]
      for (const button of buttons) {
        button.click()
        await sleep(350)
        const popup = document.querySelector('.fortune-toolbar-combo-popup[data-excel-picker-kind]')
        if (popup && popup.dataset.excelPickerKind === 'format') {
          const input = popup.querySelector('.excel-toolbar-picker-search-input')
          const rows = [...popup.querySelectorAll('.fortune-toolbar-select-option')]
            .filter((option) => !option.closest('.toolbar-item-sub-menu'))
          const clipped = rows
            .filter((option) => option.scrollWidth > option.clientWidth + 1)
            .map((option) => ({
              text: (option.textContent || '').trim().slice(0, 60),
              scrollWidth: option.scrollWidth,
              clientWidth: option.clientWidth,
            }))
          return {
            found: true,
            width: popup.getBoundingClientRect().width,
            strategy: popup.dataset.excelPickerWidthStrategy,
            placeholder: input ? input.placeholder : null,
            rowCount: rows.length,
            clipped,
          }
        }
        document.body.click()
        await sleep(200)
      }
      return { found: false }
    })()`, true)

    check(`[${lang}] format picker detected`, report.found, JSON.stringify(report))
    check(
      `[${lang}] localized format search placeholder`,
      report.placeholder === expectedPlaceholder,
      `expected ${JSON.stringify(expectedPlaceholder)}, got ${JSON.stringify(report.placeholder)}`,
    )
    check(
      `[${lang}] width is content-fit (no hidden-submenu inflation)`,
      report.width >= 120 && report.width <= 300,
      `width=${report.width}`,
    )
    check(
      `[${lang}] no visible row is clipped`,
      report.clipped.length === 0,
      JSON.stringify(report.clipped),
    )

    if (SCREENSHOT_LANGS.has(lang)) {
      const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
      const buffer = Buffer.from(screenshot.result.data, 'base64')
      const file = path.join(artifactDir, `electron-verify-excel-format-picker-${lang}.png`)
      fs.writeFileSync(file, buffer)
      console.log(`[PASS] screenshot saved: ${file}`)
    }
    await evaluate(send, 'document.body.click(), true')
    await sleep(150)
  }
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  socket?.close()
  child?.kill()
  await sleep(500)
  try { fs.rmSync(samplePath, { force: true }) } catch {}
  try { fs.rmSync(profilePath, { recursive: true, force: true }) } catch {}
}
