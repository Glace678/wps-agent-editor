/**
 * Verify the "最近" (Recent) tab context menu feature end to end:
 *  V1  right-click a recent row -> custom context menu with all 8 items
 *  V2  文件信息 dialog shows 上次修改/创建时间/大小/类型 (MM-DD short dates)
 *  V3  删除打开记录 removes the row and persists to recent-files.json
 *  V4  missing file -> 文件信息 shows "文件不存在" notice dialog
 *  V5  API: rename round-trip updates disk + recent list
 *  V6  API: history snapshot on open/save, restore brings old content back
 *  V7  API: delete moves file to recycle bin and drops the recent entry
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))
const electronPath = require('electron')
const artifactDir = path.join(root, '.cache', 'verify-recent-menu')
fs.mkdirSync(artifactDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close((e) => (e ? reject(e) : resolve(p))) })
  })
}
function connectCdp(wsUrl, onEvent = () => {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1
    let opened = false
    const send = (method, params = {}) => new Promise((res, rej) => {
      if (socket.readyState !== WebSocket.OPEN) return rej(new Error(`socket closed for ${method}`))
      const id = nextId++
      const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)) }, 20000)
      pending.set(id, { resolve: (m) => { clearTimeout(timer); m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m) } })
      socket.send(JSON.stringify({ id, method, params }))
    })
    socket.addEventListener('open', () => { opened = true; resolve({ send, close: () => socket.close() }) })
    socket.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p.resolve(m) }
      else if (m.method) onEvent(m)
    })
    socket.addEventListener('error', (ev) => { if (!opened) reject(new Error(`ws error ${ev.message ?? ev}`)) })
    socket.addEventListener('close', () => { for (const p of pending.values()) p.resolve({ error: { message: 'socket closed' } }); pending.clear() })
  })
}
async function findPage(debugPort, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && (String(t.url).includes('out/renderer') || String(t.url).includes('index.html')))
      if (page?.webSocketDebuggerUrl) return page
    } catch {}
    await sleep(250)
  }
  return null
}
async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails?.exception?.description || r.result.exceptionDetails?.text || 'evaluate failed')
  return r.result.result?.value
}
async function waitFor(send, expression, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let lastValue, lastError
  while (Date.now() < deadline) {
    try { lastValue = await evaluate(send, expression); if (lastValue) return lastValue; lastError = null }
    catch (e) { lastError = e }
    await sleep(150)
  }
  throw new Error(`timeout: ${label}; last=${JSON.stringify(lastValue)}${lastError ? `; err=${lastError.message}` : ''}`)
}
async function screenshot(send, name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(artifactDir, name), Buffer.from(shot.result.data, 'base64'))
}
async function centerOf(send, expression, label) {
  const point = await evaluate(send, `(() => {
    const el = ${expression}
    if (!(el instanceof HTMLElement)) return null
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
  if (!point) throw new Error(`${label}: element not found/visible`)
  return point
}
async function leftClick(send, expression, label) {
  const p = await centerOf(send, expression, label)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 })
}
async function doubleClick(send, expression, label) {
  const p = await centerOf(send, expression, label)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 2 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 2 })
}

async function hover(send, expression, label) {
  const p = await centerOf(send, expression, label)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
}
async function rightClick(send, expression, label) {
  const p = await centerOf(send, expression, label)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', buttons: 0, clickCount: 1 })
}

const recentRowExpr = (name) => `[...document.querySelectorAll('[data-recent-file-index]')].find((row) => row.textContent.includes(${JSON.stringify(name)}))`
const recentSelectExpr = (name) => `(${recentRowExpr(name)}).querySelector('[data-recent-file-select]')`

const results = []
function record(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---------- fixtures ----------
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-recent-menu-'))
const realFile = path.join(fixtureDir, '验证文档.txt')
fs.writeFileSync(realFile, 'ORIGINAL CONTENT v1\n', 'utf8')
// give the file distinct old-looking mtime? keep natural; dates render as current MM-DD
const missingFile = path.join(fixtureDir, 'missing.docx')
const sacrificial = path.join(fixtureDir, 'to-delete.txt')
fs.writeFileSync(sacrificial, 'delete me\n', 'utf8')

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-recent-menu-profile-'))
fs.writeFileSync(path.join(profile, 'recent-files.json'), JSON.stringify([
  { path: realFile, name: path.basename(realFile), openedAt: Date.now() - 60_000 },
  { path: missingFile, name: path.basename(missingFile), openedAt: Date.now() - 120_000 },
  { path: sacrificial, name: path.basename(sacrificial), openedAt: Date.now() - 180_000 },
], null, 2))

// ---------- launch ----------
const debugPort = await getFreePort()
const bridgePort = await getFreePort()
const child = spawn(electronPath, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, root], {
  cwd: root,
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    WPS_ALLOW_MULTI_INSTANCE: '1',
    WPS_BRIDGE_PORT: String(bridgePort),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
const log = []
child.stdout.on('data', (c) => log.push(String(c)))
child.stderr.on('data', (c) => log.push(String(c)))

try {
  const page = await findPage(debugPort, 30000)
  if (!page) throw new Error(`no renderer; log tail: ${log.join('').slice(-500)}`)
  const cdp = await connectCdp(page.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await waitFor(cdp.send, `document.readyState === 'complete' && Boolean(document.getElementById('root')?.childElementCount)`, 'boot', 30000)
  await sleep(1500)

  // switch to the Recent tab (zh default: 最近)
  await waitFor(cdp.send, `[...document.querySelectorAll('[role="tab"]')].length >= 2`, 'tabs render', 20000)
  await leftClick(cdp.send, `[...document.querySelectorAll('[role="tab"]')].find((el) => /最近|Recent/i.test(el.textContent))`, 'recent tab')
  await waitFor(cdp.send, `Boolean(${recentRowExpr(path.basename(realFile))})`, 'recent rows', 15000)

  const openedAtBeforeClick = await evaluate(cdp.send, `(async () => (await window.api.file.getRecent()).find((file) => file.path === ${JSON.stringify(realFile)})?.openedAt)()`)
  await leftClick(cdp.send, recentRowExpr(path.basename(realFile)), 'single-click recent row')
  await sleep(350)
  const singleClickState = await evaluate(cdp.send, `(async () => ({
    openedAt: (await window.api.file.getRecent()).find((file) => file.path === ${JSON.stringify(realFile)})?.openedAt,
    selected: document.querySelectorAll('[data-recent-file-index][aria-selected="true"]').length,
  }))()`)
  record(
    'V0 single click selects one file without opening it',
    singleClickState?.selected === 1 && singleClickState?.openedAt === openedAtBeforeClick,
    `selected=${singleClickState?.selected} opened=${singleClickState?.openedAt !== openedAtBeforeClick}`,
  )

  await doubleClick(cdp.send, recentRowExpr(path.basename(realFile)), 'double-click recent row')
  const openedAtAfterDoubleClick = await waitFor(
    cdp.send,
    `(async () => {
      const openedAt = (await window.api.file.getRecent()).find((file) => file.path === ${JSON.stringify(realFile)})?.openedAt
      return openedAt > ${JSON.stringify(openedAtBeforeClick)} && openedAt
    })()`,
    'double-click opens recent file',
    8000,
  )
  record('V0b double click opens the file', openedAtAfterDoubleClick > openedAtBeforeClick)

  // ---------- V1: context menu opens with all items ----------
  await rightClick(cdp.send, recentRowExpr(path.basename(realFile)), 'recent row right-click')
  await waitFor(cdp.send, `Boolean(document.querySelector('[data-testid="recent-file-context-menu"]'))`, 'context menu open', 8000)
  const menuItems = await evaluate(cdp.send, `[...document.querySelectorAll('[data-testid="recent-file-context-menu"] [role="menuitem"]')].map((el) => el.textContent.trim())`)
  const expected = ['打开', '分享', '重命名', '文件信息', '历史版本', '打开文件位置', '删除打开记录', '删除文件']
  const missingItems = expected.filter((label) => !menuItems.includes(label))
  await screenshot(cdp.send, 'v1-context-menu.png')
  record('V1 context menu items', missingItems.length === 0, missingItems.length ? `missing: ${missingItems.join(',')} got: ${menuItems.join('|')}` : menuItems.join(' | '))

  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor(cdp.send, `!document.querySelector('[data-testid="recent-file-context-menu"]')`, 'single menu closed', 5000)
  const checkboxIdleBeforeHover = await evaluate(
    cdp.send,
    `(() => {
      const checkbox = ${recentSelectExpr(path.basename(missingFile))}
      const square = checkbox?.firstElementChild || checkbox
      const squareStyle = getComputedStyle(square)
      const hitAreaStyle = getComputedStyle(checkbox)
      const rect = checkbox.getBoundingClientRect()
      return {
        opacity: squareStyle.opacity,
        pointerEvents: hitAreaStyle.pointerEvents,
        hitArea: { width: Math.round(rect.width), height: Math.round(rect.height) },
      }
    })()`,
  )
  const themeColors = await evaluate(cdp.send, `(() => {
    const checkbox = ${recentSelectExpr(path.basename(missingFile))}
    const square = checkbox?.firstElementChild || checkbox
    const wasDark = document.documentElement.classList.contains('dark')
    document.documentElement.classList.remove('dark')
    const light = getComputedStyle(square)
    const lightColors = { border: light.borderColor, background: light.backgroundColor }
    document.documentElement.classList.add('dark')
    const dark = getComputedStyle(square)
    const darkColors = { border: dark.borderColor, background: dark.backgroundColor }
    document.documentElement.classList.toggle('dark', wasDark)
    return { lightColors, darkColors }
  })()`)
  await rightClick(cdp.send, recentRowExpr(path.basename(missingFile)), 'unselected recent row right-click')
  await sleep(350)
  const unselectedMenuSuppressed = !(await evaluate(
    cdp.send,
    `Boolean(document.querySelector('[data-testid=\"recent-file-context-menu\"]'))`,
  ))
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
  await sleep(200)
  await hover(cdp.send, recentRowExpr(path.basename(missingFile)), 'hover missing row')
  const checkboxVisibleOnHover = await waitFor(
    cdp.send,
    `(() => {
      const checkbox = ${recentSelectExpr(path.basename(missingFile))}
      const square = checkbox?.firstElementChild || checkbox
      return getComputedStyle(square).opacity === '1' && '1'
    })()`,
    'checkbox visible on row hover',
    2000,
  )
  await leftClick(cdp.send, recentSelectExpr(path.basename(missingFile)), 'select missing row checkbox')
  await leftClick(cdp.send, recentSelectExpr(path.basename(sacrificial)), 'select sacrificial row checkbox')
  const selectedCount = await waitFor(
    cdp.send,
    `document.querySelectorAll('[data-recent-file-index][aria-selected="true"]').length === 3 && 3`,
    'three recent rows selected by checkboxes',
    5000,
  )
  const themeAware = Boolean(themeColors?.lightColors?.border && themeColors?.darkColors?.border)
  await rightClick(cdp.send, recentRowExpr(path.basename(realFile)), 'multi-selected recent row right-click')
  await waitFor(cdp.send, `Boolean(document.querySelector('[data-testid="recent-file-context-menu"]'))`, 'multi-select context menu open', 8000)
  const multiMenuItems = await evaluate(cdp.send, `[...document.querySelectorAll('[data-testid="recent-file-context-menu"] [role="menuitem"]')].map((el) => el.textContent.trim())`)
  await screenshot(cdp.send, 'v1b-checkbox-multi-menu.png')
  record(
    'V1b checkboxes multi-select with the single-file menu',
      checkboxIdleBeforeHover?.opacity === '1'
      && checkboxVisibleOnHover === '1'
      && checkboxIdleBeforeHover?.pointerEvents !== 'none'
      && checkboxIdleBeforeHover?.hitArea?.width >= 20
      && checkboxIdleBeforeHover?.hitArea?.height >= 20
      && unselectedMenuSuppressed && themeAware && selectedCount === 3
      && JSON.stringify(multiMenuItems) === JSON.stringify(menuItems),
    `idle=${checkboxIdleBeforeHover?.opacity} hover=${checkboxVisibleOnHover} pointerEvents=${checkboxIdleBeforeHover?.pointerEvents} unselectedMenu=${unselectedMenuSuppressed} theme=${themeAware} colors=${JSON.stringify(themeColors)} selected=${selectedCount}`,
  )
  // ---------- V2: file info dialog ----------
  await leftClick(cdp.send, `document.querySelector('[data-testid="recent-menu-info"]')`, 'file info item')
  await waitFor(cdp.send, `Boolean(document.querySelector('[data-testid="file-info-dialog"]'))`, 'info dialog', 8000)
  const infoText = await evaluate(cdp.send, `document.querySelector('[data-testid="file-info-dialog"]').textContent`)
  const hasLabels = ['上次修改', '创建时间', '大小', '类型', '位置'].every((s) => infoText.includes(s))
  const hasShortDate = /\d{2}-\d{2}/.test(infoText)
  const hasSize = /\d+(\.\d+)? (B|KB|MB|GB)/.test(infoText)
  const hasType = infoText.includes('.txt')
  await screenshot(cdp.send, 'v2-file-info.png')
  record('V2 file info dialog', hasLabels && hasShortDate && hasSize && hasType,
    `labels=${hasLabels} shortDate=${hasShortDate} size=${hasSize} type=${hasType}`)
  // close via Escape
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor(cdp.send, `!document.querySelector('[data-testid="file-info-dialog"]')`, 'info dialog closed', 5000)

  // ---------- V4: missing file -> notice dialog ----------
  await rightClick(cdp.send, recentRowExpr(path.basename(missingFile)), 'missing row right-click')
  await waitFor(cdp.send, `Boolean(document.querySelector('[data-testid="recent-file-context-menu"]'))`, 'menu for missing file', 8000)
  await leftClick(cdp.send, `document.querySelector('[data-testid="recent-menu-info"]')`, 'file info (missing)')
  await waitFor(cdp.send, `Boolean(document.querySelector('[data-testid="message-dialog"]'))`, 'notice dialog', 8000)
  const noticeText = await evaluate(cdp.send, `document.querySelector('[data-testid="message-dialog"]').textContent`)
  await screenshot(cdp.send, 'v4-missing-file-notice.png')
  record('V4 missing file notice', noticeText.includes('文件不存在'), noticeText.slice(0, 80))
  await leftClick(cdp.send, `[...document.querySelectorAll('[data-testid="message-dialog"] button')].find((b) => b.textContent.trim() === '确定')`, 'notice OK')
  await waitFor(cdp.send, `!document.querySelector('[data-testid="message-dialog"]')`, 'notice closed', 5000)

  // ---------- V3: remove record ----------
  await rightClick(cdp.send, recentRowExpr(path.basename(missingFile)), 'missing row right-click 2')
  await waitFor(cdp.send, `Boolean(document.querySelector('[data-testid="recent-file-context-menu"]'))`, 'menu again', 8000)
  await leftClick(cdp.send, `document.querySelector('[data-testid="recent-menu-remove-record"]')`, 'remove record')
  await waitFor(cdp.send, `!(${recentRowExpr(path.basename(missingFile))})`, 'row removed', 8000)
  await sleep(400)
  const persisted = JSON.parse(fs.readFileSync(path.join(profile, 'recent-files.json'), 'utf8'))
  const stillThere = persisted.some((f) => f.path === missingFile)
  await screenshot(cdp.send, 'v3-after-remove.png')
  record('V3 remove record', !stillThere, `store now has ${persisted.length} entries`)

  // ---------- V5: rename API round-trip ----------
  const renameResult = await evaluate(cdp.send, `window.api.file.rename(${JSON.stringify(realFile)}, '验证文档-改名.txt')`)
  const renamedPath = renameResult?.newPath
  const renamedOnDisk = renamedPath && fs.existsSync(renamedPath) && !fs.existsSync(realFile)
  const recentUpdated = (renameResult?.recent || []).some((f) => f.name === '验证文档-改名.txt')
  // invalid name must be rejected
  const badRename = await evaluate(cdp.send, `window.api.file.rename(${JSON.stringify(renamedPath)}, 'a:b.txt')`)
  // rename back
  await evaluate(cdp.send, `window.api.file.rename(${JSON.stringify(renamedPath)}, ${JSON.stringify(path.basename(realFile))})`)
  record('V5 rename API', Boolean(renameResult?.success && renamedOnDisk && recentUpdated && badRename?.errorCode === 'invalid-name'),
    `success=${renameResult?.success} disk=${renamedOnDisk} recent=${recentUpdated} invalidCode=${badRename?.errorCode}`)

  // ---------- V5b: reserved device names / trailing dot rejected ----------
  const nulRename = await evaluate(cdp.send, `window.api.file.rename(${JSON.stringify(realFile)}, 'NUL.txt')`)
  const dotRename = await evaluate(cdp.send, `window.api.file.rename(${JSON.stringify(realFile)}, 'foo.')`)
  record('V5b reserved/trailing-dot names rejected',
    nulRename?.errorCode === 'invalid-name' && dotRename?.errorCode === 'invalid-name',
    `NUL.txt=${nulRename?.errorCode} 'foo.'=${dotRename?.errorCode}`)

  // ---------- V6: history snapshot + restore ----------
  await evaluate(cdp.send, `window.api.file.open(${JSON.stringify(realFile)})`)         // snapshot of v1
  await sleep(600)
  await evaluate(cdp.send, `window.api.lw.saveText(${JSON.stringify(realFile)}, 'CHANGED CONTENT v2', 'utf-8')`)
  const versions = await evaluate(cdp.send, `window.api.file.historyList(${JSON.stringify(realFile)})`)
  let restoredOk = false
  if (Array.isArray(versions) && versions.length > 0) {
    const restore = await evaluate(cdp.send, `window.api.file.historyRestore(${JSON.stringify(realFile)}, ${JSON.stringify(versions[0].id)})`)
    const content = fs.readFileSync(realFile, 'utf8')
    restoredOk = Boolean(restore?.success) && content.includes('ORIGINAL CONTENT v1')
  }
  record('V6 history snapshot+restore', restoredOk, `versions=${Array.isArray(versions) ? versions.length : 'n/a'}`)

  // ---------- V6b: version history follows a rename ----------
  const migrated = await evaluate(cdp.send, `(async () => {
    const renamed = await window.api.file.rename(${JSON.stringify(realFile)}, '验证文档-迁移.txt')
    if (!renamed.success) return { ok: false, why: 'rename failed' }
    const list = await window.api.file.historyList(renamed.newPath)
    await window.api.file.rename(renamed.newPath, ${JSON.stringify(path.basename(realFile))})
    return { ok: list.length > 0, count: list.length }
  })()`)
  record('V6b history migrates on rename', Boolean(migrated?.ok), `versions after rename=${migrated?.count ?? migrated?.why}`)

  // ---------- V7b: directory delete is refused ----------
  const dirDelete = await evaluate(cdp.send, `window.api.file.delete(${JSON.stringify(fixtureDir)})`)
  record('V7b directory delete refused', dirDelete?.success === false && fs.existsSync(fixtureDir), `success=${dirDelete?.success}`)

  // ---------- V7: delete to recycle bin ----------
  const deleteResult = await evaluate(cdp.send, `window.api.file.delete(${JSON.stringify(sacrificial)})`)
  const goneFromDisk = !fs.existsSync(sacrificial)
  const goneFromRecent = !(deleteResult?.recent || []).some((f) => f.path === sacrificial)
  record('V7 delete file', Boolean(deleteResult?.success && goneFromDisk && goneFromRecent),
    `success=${deleteResult?.success} disk=${goneFromDisk} recent=${goneFromRecent}`)

  cdp.close()
} catch (e) {
  record('harness', false, String(e))
} finally {
  try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
  await sleep(1200)
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch {}
  try { fs.rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch {}
}

fs.writeFileSync(path.join(artifactDir, 'results.json'), JSON.stringify(results, null, 2))
const failed = results.filter((r) => !r.pass)
console.log(`\nVERIFY DONE: ${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exitCode = 2
