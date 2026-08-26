import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const root = process.cwd()
const port = Number(process.env.WPS_COLLAB_VERIFY_PORT || 9374)
const profilePath = path.join(os.tmpdir(), `wps-collaboration-profile-${process.pid}`)
const screenshotPath = path.join(root, '.cache', 'electron-verify-collaboration-config.png')
const confirmationScreenshotPath = path.join(root, '.cache', 'electron-verify-agent-delete-confirm.png')
const unrelatedFilePath = path.join(profilePath, 'unrelated-document.txt')
const unrelatedFileContents = 'This file must remain unchanged when one Agent is deleted.'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const providerId = 'opencode-go'
const agents = [
  {
    id: 'verify-deepseek-v4-flash',
    name: 'DeepSeek V4 Flash Lead',
    role: 'Lead',
    systemPrompt: 'Lead the collaboration.',
    providerId,
    model: 'deepseek-v4-flash',
    color: '#2563eb',
    enabled: true,
  },
  {
    id: 'verify-mimo-v2-5',
    name: 'MiMo V2.5 Reviewer',
    role: 'Reviewer',
    systemPrompt: 'Review the lead output.',
    providerId,
    model: 'mimo-v2.5',
    color: '#059669',
    enabled: true,
  },
]

for (const buildFile of [
  path.join(root, 'out', 'main', 'main.js'),
  path.join(root, 'out', 'renderer', 'index.html'),
]) {
  if (!fs.existsSync(buildFile)) throw new Error(`Missing build output: ${buildFile}`)
}

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
    socket.addEventListener('open', () => resolve({ socket, send }))
    socket.addEventListener('error', reject)
    socket.addEventListener('close', () => {
      for (const { reject: rejectSend } of pending.values()) rejectSend(new Error('DevTools connection closed'))
      pending.clear()
    })
    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data)
      if (!payload.id || !pending.has(payload.id)) return
      const request = pending.get(payload.id)
      pending.delete(payload.id)
      if (payload.error) request.reject(new Error(payload.error.message))
      else request.resolve(payload)
    })
  })
}

async function waitForRenderer() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const renderer = targets.find((target) => String(target.url).includes('out/renderer'))
      if (renderer) return renderer
    } catch {}
    await sleep(200)
  }
  throw new Error('Electron renderer target did not appear')
}

async function evaluate(send, expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (response.result.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text)
  }
  return response.result.result.value
}

async function pressEnter(send, selector) {
  await evaluate(send, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) throw new Error('Element not found: ' + ${JSON.stringify(selector)})
    element.focus()
    return true
  })()`)
  const key = {
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
}

async function clickElement(send, selector) {
  const point = await evaluate(send, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) throw new Error('Element not found: ' + ${JSON.stringify(selector)})
    element.scrollIntoView({ block: 'center', inline: 'center' })
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
}

async function waitFor(send, expression, timeout = 15_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(send, expression)) return
    await sleep(150)
  }
  throw new Error(`Timed out waiting for ${expression}`)
}

function check(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

let child
let socket
try {
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
  fs.mkdirSync(profilePath, { recursive: true })
  fs.writeFileSync(path.join(profilePath, 'agents.json'), JSON.stringify(agents, null, 2))
  fs.writeFileSync(unrelatedFilePath, unrelatedFileContents)
  child = spawn(electronPath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profilePath}`,
    root,
  ], {
    cwd: root,
    env: {
      ...process.env,
      WPS_ALLOW_MULTI_INSTANCE: '1',
      WPS_TEST_USER_DATA_DIR: profilePath,
      WPS_BRIDGE_PORT: String(port + 4000),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const renderer = await waitForRenderer()
  let send
  ;({ socket, send } = await connect(renderer.webSocketDebuggerUrl))
  await send('Runtime.enable')
  await send('Page.enable')
  await waitFor(send, 'Boolean(document.querySelector("[data-testid=agent-new]"))')

  await evaluate(send, 'document.querySelector("[data-testid=collaboration-open]")?.click()')
  await waitFor(send, 'Boolean(document.querySelector("[data-testid=collaboration-task-input]"))')

  const state = await evaluate(send, `(() => {
    const task = document.querySelector('[data-testid=collaboration-task-input]')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(task, 'Compare the document and produce a reviewed final draft.')
    task.dispatchEvent(new Event('input', { bubbles: true }))
    const checkboxes = [...document.querySelectorAll('input[data-testid^=collaboration-agent-]')]
    const start = document.querySelector('[data-testid=collaboration-start]')
    return {
      checkboxCount: checkboxes.length,
      selected: checkboxes.filter((checkbox) => checkbox.checked).length,
      startEnabled: !start.disabled,
      modelLabels: checkboxes.map((checkbox) => checkbox.closest('label')?.textContent ?? ''),
    }
  })()`)
  check(state.checkboxCount === 2, `two selectable agents are shown (${state.checkboxCount})`)
  check(state.selected === 2, `enabled agents are selected by default (${state.selected})`)
  check(state.startEnabled, 'collaboration can start after entering a task')
  check(
    state.modelLabels.every((label) => /opencode/i.test(label))
      && state.modelLabels.some((label) => /deepseek/i.test(label))
      && state.modelLabels.some((label) => /mimo/i.test(label)),
    'the dialog keeps both OpenCode Go model selections distinct',
  )

  const actionLayout = await evaluate(send, `(() => {
    const row = document.querySelector('[data-testid=collaboration-agent-row-${agents[0].id}]')
    const actions = document.querySelector('[data-testid=collaboration-agent-actions-${agents[0].id}]')
    const rowRect = row.getBoundingClientRect()
    const actionsRect = actions.getBoundingClientRect()
    return {
      actionCount: document.querySelectorAll('button[data-testid^=collaboration-agent-actions-]').length,
      rightInset: Math.round(rowRect.right - actionsRect.right),
      actionsRightOfCenter: actionsRect.left > rowRect.left + rowRect.width / 2,
    }
  })()`)
  check(actionLayout.actionCount === 2, 'each Agent row has an actions button')
  check(actionLayout.actionsRightOfCenter && actionLayout.rightInset <= 16, 'the actions button is aligned at the far right of its Agent row')

  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const image = Buffer.from(screenshot.result.data, 'base64')
  fs.writeFileSync(screenshotPath, image)
  check(image.length > 10_000, `collaboration dialog screenshot is nonempty (${image.length} bytes)`)
  console.log(`PASS screenshot saved to ${screenshotPath}`)

  await clickElement(send, `[data-testid=collaboration-agent-actions-${agents[0].id}]`)
  await waitFor(send, `Boolean(document.querySelector('[data-testid=collaboration-agent-delete-${agents[0].id}]'))`)
  check(
    await evaluate(send, `document.querySelectorAll('[data-testid=collaboration-agent-delete-${agents[0].id}]').length === 1`),
    'the extensible actions menu currently exposes one delete command',
  )
  await pressEnter(send, `[data-testid=collaboration-agent-delete-${agents[0].id}]`)
  await waitFor(send, 'Boolean(document.querySelector("[data-testid=agent-delete-confirm-dialog]"))')
  check(
    await evaluate(send, `document.querySelector('[data-testid=agent-delete-confirm-dialog]')?.textContent.includes(${JSON.stringify(agents[0].name)})`),
    'the secondary confirmation names the Agent being deleted',
  )

  const confirmationScreenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const confirmationImage = Buffer.from(confirmationScreenshot.result.data, 'base64')
  fs.writeFileSync(confirmationScreenshotPath, confirmationImage)
  check(confirmationImage.length > 10_000, `delete confirmation screenshot is nonempty (${confirmationImage.length} bytes)`)

  await evaluate(send, `document.querySelector('[data-testid=agent-delete-confirm-dialog] button:not([data-testid=agent-confirm-delete-button])')?.click()`)
  await waitFor(send, '!document.querySelector("[data-testid=agent-delete-confirm-dialog]")')
  check(
    await evaluate(send, `Boolean(document.querySelector('[data-testid=collaboration-agent-row-${agents[0].id}]'))`),
    'canceling the confirmation keeps the Agent configuration',
  )

  await clickElement(send, `[data-testid=collaboration-agent-actions-${agents[0].id}]`)
  await waitFor(send, `Boolean(document.querySelector('[data-testid=collaboration-agent-delete-${agents[0].id}]'))`)
  await pressEnter(send, `[data-testid=collaboration-agent-delete-${agents[0].id}]`)
  await waitFor(send, 'Boolean(document.querySelector("[data-testid=agent-confirm-delete-button]"))')
  await evaluate(send, `document.querySelector('[data-testid=agent-confirm-delete-button]')?.click()`)
  await waitFor(send, `!document.querySelector('[data-testid=collaboration-agent-row-${agents[0].id}]')`)

  check(
    await evaluate(send, `document.querySelectorAll('[data-testid^=collaboration-agent-row-]').length === 1`),
    'confirming removes only the selected Agent row',
  )
  check(
    await evaluate(send, `document.querySelector('[data-testid=collaboration-root-agent]')?.textContent.includes(${JSON.stringify(agents[1].name)})`),
    'deleting the current Root Agent automatically selects the remaining Agent',
  )

  await evaluate(send, 'document.querySelector("[data-testid=collaboration-root-agent]")?.click()')
  await waitFor(send, 'Boolean(document.querySelector("[data-testid=collaboration-root-agent-menu]"))')
  check(
    await evaluate(send, `!document.querySelector('[data-testid=collaboration-root-agent-option-${agents[0].id}]')
      && Boolean(document.querySelector('[data-testid=collaboration-root-agent-option-${agents[1].id}]'))`),
    'the deleted Agent is also removed from the Root Agent menu',
  )

  const storedAgents = JSON.parse(fs.readFileSync(path.join(profilePath, 'agents.json'), 'utf8'))
  check(storedAgents.length === 1 && storedAgents[0].id === agents[1].id, 'the Agent store deletes exactly one configuration')
  check(fs.readFileSync(unrelatedFilePath, 'utf8') === unrelatedFileContents, 'unrelated files are not modified')
} finally {
  socket?.close()
  child?.kill()
  await sleep(300)
  try { fs.rmSync(profilePath, { recursive: true, force: true }) } catch {}
}
