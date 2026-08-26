import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const root = process.cwd()
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-attachment-profile-'))
const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-attachment-files-'))
const screenshotPath = path.join(root, '.cache', 'electron-verify-agent-attachments.png')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const fixtures = {
  browse: path.join(fixturePath, 'browse-note.md'),
  recent: path.join(fixturePath, 'recent-note.txt'),
  tab: path.join(fixturePath, 'active-script.py'),
}
fs.writeFileSync(fixtures.browse, '# Browse attachment\n', 'utf8')
fs.writeFileSync(fixtures.recent, 'Recent attachment\n', 'utf8')
fs.writeFileSync(fixtures.tab, 'print("Tab attachment")\n', 'utf8')

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => {
        if (error) reject(error)
        else resolve(typeof address === 'object' && address ? address.port : 0)
      })
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

function connectCdp(url, onEvent) {
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
      if (!message.id) {
        onEvent(message)
        return
      }
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
    throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text)
  }
  return response.result.result.value
}

async function waitFor(send, expression, label, timeout = 20_000) {
  const deadline = Date.now() + timeout
  let value
  while (Date.now() < deadline) {
    value = await evaluate(send, expression)
    if (value) return value
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}; last value=${JSON.stringify(value)}`)
}

function check(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

async function createAgent(send) {
  await evaluate(send, 'document.querySelector("[data-testid=agent-new]")?.click()')
  await waitFor(send, 'Boolean(document.querySelector("[data-testid=agent-config-dialog-body]"))', 'agent dialog')
  await waitFor(send, `(() => {
    const dialog = document.querySelector('[role=dialog]');
    const buttons = [...dialog.querySelectorAll('button')];
    return buttons.at(-1) && !buttons.at(-1).disabled;
  })()`, 'enabled agent save button')
  await evaluate(send, `(() => {
    const dialog = document.querySelector('[role=dialog]');
    const input = dialog.querySelector('input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Attachment tester');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const buttons = dialog.querySelectorAll('button');
    buttons.item(buttons.length - 1).click();
  })()`)
  await waitFor(send, '!document.querySelector("[data-testid=agent-config-dialog-body]")', 'agent dialog close')
  await waitFor(send, 'Boolean(document.querySelector("[data-testid=agent-composer]"))', 'agent composer')
}

async function dragAttachment(send, sourceExpression) {
  return evaluate(send, `(() => {
    const source = ${sourceExpression};
    const target = document.querySelector('[data-testid=agent-composer]');
    if (!source || !target) return { ok: false, source: Boolean(source), target: Boolean(target) };
    const dataTransfer = new DataTransfer();
    const init = { bubbles: true, cancelable: true, dataTransfer };
    source.dispatchEvent(new DragEvent('dragstart', init));
    target.dispatchEvent(new DragEvent('dragenter', init));
    target.dispatchEvent(new DragEvent('dragover', init));
    target.dispatchEvent(new DragEvent('drop', init));
    source.dispatchEvent(new DragEvent('dragend', init));
    return {
      ok: true,
      types: [...dataTransfer.types],
      chips: [...document.querySelectorAll('[data-agent-attachment-chip]')]
        .map((node) => node.getAttribute('data-agent-attachment-chip')),
    };
  })()`)
}

let child
let cdp
const rendererErrors = []
try {
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
  const port = await getFreePort()
  child = spawn(electronPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`, root], {
    cwd: root,
    env: {
      ...process.env,
      WPS_ALLOW_MULTI_INSTANCE: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      WPS_BRIDGE_PORT: String(port + 3000),
    },
    stdio: 'ignore',
    windowsHide: process.env.WPS_VERIFY_NATIVE_PICKER !== '1',
  })

  const page = await waitForPage(port)
  cdp = await connectCdp(page.webSocketDebuggerUrl, (message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      rendererErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text)
    }
  })
  const { send } = cdp
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await waitFor(send, 'document.getElementById("root")?.childElementCount > 0', 'React app')
  await waitFor(send, 'Boolean(localStorage.getItem("last-browse-dir"))', 'initial browse directory')
  await sleep(500)
  const previousTimeOrigin = await evaluate(send, 'performance.timeOrigin')
  await evaluate(send, `(() => {
    localStorage.setItem('last-browse-dir', ${JSON.stringify(fixturePath)});
    location.reload();
    return true;
  })()`)
  await waitFor(send, `performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin)}`, 'renderer reload')
  await waitFor(send, 'document.getElementById("root")?.childElementCount > 0', 'reloaded React app')
  await sleep(1000)
  const browseDebug = await evaluate(send, `(async () => ({
    savedDirectory: localStorage.getItem('last-browse-dir'),
    visibleDirectory: document.querySelector('.text-primary.truncate')?.textContent || null,
    listedFiles: (await window.api.file.list(${JSON.stringify(fixturePath)})).map((entry) => entry.path),
    renderedFiles: [...document.querySelectorAll('[data-agent-attachment-path]')]
      .map((node) => node.getAttribute('data-agent-attachment-path')),
  }))()`)
  check(
    browseDebug.savedDirectory === fixturePath
      && browseDebug.visibleDirectory === fixturePath
      && Object.values(fixtures).every((filePath) => browseDebug.renderedFiles.includes(filePath)),
    'Attachment fixtures are visible in the Browse file list',
  )
  await waitFor(
    send,
    `[...document.querySelectorAll('[data-agent-attachment-path]')]
      .some((node) => node.getAttribute('data-agent-attachment-path') === ${JSON.stringify(fixtures.browse)})`,
    'browse attachment row',
  )
  await createAgent(send)

  const browseResult = await dragAttachment(
    send,
    `[...document.querySelectorAll('button[data-agent-attachment-path]')]
      .find((node) => node.getAttribute('data-agent-attachment-path') === ${JSON.stringify(fixtures.browse)})`,
  )
  const browseAttached = await waitFor(
    send,
    `[...document.querySelectorAll('[data-agent-attachment-chip]')]
      .some((node) => node.getAttribute('data-agent-attachment-chip') === ${JSON.stringify(fixtures.browse)})`,
    'Browse attachment chip',
  )
  check(browseResult.ok && browseAttached, 'Browse file can be dragged into the Agent composer')

  const recentOpened = await evaluate(send, `(() => {
    const row = [...document.querySelectorAll('button[data-agent-attachment-path]')]
      .find((node) => node.getAttribute('data-agent-attachment-path') === ${JSON.stringify(fixtures.recent)});
    row?.click();
    return Boolean(row);
  })()`)
  check(recentOpened, 'Recent fixture opens through the Browse file row')
  await waitFor(
    send,
    `[...document.querySelectorAll('[data-document-tab-id]')]
      .some((node) => node.getAttribute('data-agent-attachment-path') === ${JSON.stringify(fixtures.recent)})`,
    'recent fixture document tab',
  )
  await evaluate(send, `(() => {
    const fileManager = document.querySelector('aside');
    const tabs = [...fileManager.querySelectorAll('button[role=tab]')];
    const recentTab = tabs.at(1);
    recentTab?.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true,
    }));
    recentTab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    recentTab?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
    recentTab?.click();
  })()`)
  await waitFor(
    send,
    `[...document.querySelectorAll('[data-recent-file-index]')]
      .some((node) => node.getAttribute('data-agent-attachment-path') === ${JSON.stringify(fixtures.recent)})`,
    'Recent file row',
  )
  const recentResult = await dragAttachment(
    send,
    `[...document.querySelectorAll('[data-recent-file-index]')]
      .find((node) => node.getAttribute('data-agent-attachment-path') === ${JSON.stringify(fixtures.recent)})`,
  )
  const recentAttached = await waitFor(
    send,
    `[...document.querySelectorAll('[data-agent-attachment-chip]')]
      .some((node) => node.getAttribute('data-agent-attachment-chip') === ${JSON.stringify(fixtures.recent)})`,
    'Recent attachment chip',
  )
  check(recentResult.ok && recentAttached, 'Recent file can be dragged into the Agent composer')

  const tabOpened = await evaluate(send, `(() => {
    const fileManager = document.querySelector('aside');
    const browseTab = [...fileManager.querySelectorAll('button[role=tab]')].at(0);
    browseTab?.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, pointerId: 2, isPrimary: true,
    }));
    browseTab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    browseTab?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
    browseTab?.click();
    return true;
  })()`)
  await waitFor(
    send,
    `[...document.querySelectorAll('button[data-agent-attachment-path]')]
      .some((node) => node.getAttribute('data-agent-attachment-path') === ${JSON.stringify(fixtures.tab)})`,
    'Tab fixture Browse row',
  )
  const clickedTabFixture = await evaluate(send, `(() => {
    const row = [...document.querySelectorAll('button[data-agent-attachment-path]')]
      .find((node) => node.getAttribute('data-agent-attachment-path') === ${JSON.stringify(fixtures.tab)});
    row?.click();
    return Boolean(row);
  })()`)
  check(tabOpened && clickedTabFixture, 'Tab fixture opens through the application')
  await waitFor(
    send,
    `[...document.querySelectorAll('[data-document-tab-id]')]
      .some((node) => node.getAttribute('data-agent-attachment-path') === ${JSON.stringify(fixtures.tab)})`,
    'top document tab',
  )
  const tabResult = await dragAttachment(
    send,
    `[...document.querySelectorAll('[data-document-tab-id]')]
      .find((node) => node.getAttribute('data-agent-attachment-path') === ${JSON.stringify(fixtures.tab)})`,
  )
  const tabAttached = await waitFor(
    send,
    `[...document.querySelectorAll('[data-agent-attachment-chip]')]
      .some((node) => node.getAttribute('data-agent-attachment-chip') === ${JSON.stringify(fixtures.tab)})`,
    'Tab attachment chip',
  )
  check(tabResult.ok && tabAttached, 'Top document tab can be dragged into the Agent composer')

  const composerState = await evaluate(send, `(() => ({
    plusButton: Boolean(document.querySelector('[data-testid=agent-add-attachment]')),
    nativePickerApi: typeof window.api.file.selectAttachments === 'function',
    chipCount: document.querySelectorAll('[data-agent-attachment-chip]').length,
    sendEnabled: !document.querySelector('[data-testid=agent-composer] button[aria-label] + input + button')?.disabled,
    composerRect: (() => {
      const rect = document.querySelector('[data-testid=agent-composer]').getBoundingClientRect();
      return { width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    })(),
  }))()`)
  check(composerState.plusButton && composerState.nativePickerApi, 'Plus button is connected to the native multi-file picker API')
  check(composerState.chipCount === 3, 'All three attachment sources remain visible in the composer')
  check(composerState.composerRect.width > 250 && composerState.composerRect.bottom <= 900, 'Attachment composer stays inside the Agent sidebar')

  await evaluate(send, `document.querySelector('[data-agent-attachment-chip] button')?.click()`)
  const remaining = await waitFor(
    send,
    'document.querySelectorAll("[data-agent-attachment-chip]").length === 2 ? 2 : 0',
    'attachment removal',
  )
  check(remaining === 2, 'An attachment can be removed before sending')

  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  const image = Buffer.from(screenshot.result.data, 'base64')
  fs.writeFileSync(screenshotPath, image)
  check(image.length > 10_000, `Attachment UI screenshot is nonempty (${image.length} bytes)`)
  check(rendererErrors.length === 0, `No renderer exceptions were reported (${rendererErrors.length})`)
  console.log(`PASS screenshot saved to ${screenshotPath}`)

  if (process.env.WPS_VERIFY_NATIVE_PICKER === '1') {
    await evaluate(send, `(() => {
      document.querySelector('[data-testid=agent-add-attachment]')?.click();
      return true;
    })()`)
    await sleep(1_500)
    const pickerState = await evaluate(send, `(() => ({
      buttonDisabled: document.querySelector('[data-testid=agent-add-attachment]')?.disabled,
      errorVisible: Boolean(document.querySelector('[data-testid=agent-composer] [role=alert]')),
    }))()`)
    console.log(`READY native attachment picker state=${JSON.stringify(pickerState)} childExit=${child.exitCode}`)
    await sleep(8_500)
  }
} finally {
  cdp?.close()
  child?.kill()
  await sleep(300)
  fs.rmSync(profilePath, { recursive: true, force: true })
  fs.rmSync(fixturePath, { recursive: true, force: true })
}
