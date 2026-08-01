import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronPath = require('electron')
const rendererEntry = path.join(root, 'out', 'renderer', 'index.html')
const screenshotPath = path.join(root, '.cache', 'electron-verify-code-editor.png')
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-code-editor-profile-'))
const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-code-editor-fixture-'))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const fixtures = [
  {
    name: 'syntax.c',
    label: 'C',
    expectedOutput: '7',
    source: '#include <stdio.h>\nint main(void) { const int value = 7; printf("%d\\n", value); return 0; }\n',
  },
  {
    name: 'syntax.cpp',
    label: 'C++',
    expectedOutput: 'C++',
    source: '#include <iostream>\nclass Greeter { public: void run() { std::cout << "C++"; } };\nint main() { Greeter greeter; greeter.run(); return 0; }\n',
  },
  {
    name: 'Syntax.java',
    label: 'Java',
    expectedOutput: 'Java',
    source: 'public class Syntax { public static void main(String[] args) { System.out.println("Java"); } }\n',
  },
  {
    name: 'syntax.py',
    label: 'Python',
    expectedOutput: 'Python',
    source: "language: str = 'Python'\nprint(language)\n",
  },
  {
    name: 'syntax.ts',
    label: 'TypeScript',
    expectedOutput: 'Hello Monaco',
    source: "const language: string = 'Monaco';\nfunction greet(name: string): string { return `Hello ${name}`; }\nconsole.log(greet(language));\n",
  },
]

for (const fixture of fixtures) {
  fixture.filePath = path.join(fixturePath, fixture.name)
  fs.writeFileSync(fixture.filePath, fixture.source, 'utf8')
}

function getFreePort() {
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
    } catch {
      // Electron has not enabled its inspector endpoint yet.
    }
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
          const timer = setTimeout(() => {
            pending.delete(id)
            rejectCall(new Error(`CDP command timed out: ${method}`))
          }, 30_000)
          pending.set(id, { resolveCall, rejectCall, timer })
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
      clearTimeout(call.timer)
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

async function waitFor(send, expression, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let lastValue
  while (Date.now() < deadline) {
    lastValue = await evaluate(send, expression)
    if (lastValue) return lastValue
    await sleep(80)
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`)
}

async function openFile(send, filePath) {
  return evaluate(send, `(async () => {
    const filePath = ${JSON.stringify(filePath)};
    await window.api.file.open(filePath);
    const root = document.getElementById('root');
    const rootKey = Object.keys(root || {}).find((name) =>
      name.startsWith('__reactContainer') || name.startsWith('__reactFiber'));
    const container = rootKey ? root[rootKey] : null;
    const queue = [container?.current, container?.stateNode?.current,
      container?._internalRoot?.current, container].filter(Boolean);
    const seen = new Set();
    while (queue.length) {
      const fiber = queue.shift();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      if (typeof fiber.memoizedProps?.onOpenFile === 'function') {
        await fiber.memoizedProps.onOpenFile(filePath);
        return true;
      }
      if (fiber.child) queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }
    return false;
  })()`)
}

async function pressKey(send, { key, code, keyCode, modifiers = 0 }) {
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode, modifiers,
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode, modifiers,
  })
}

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass: Boolean(pass) })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? `: ${detail}` : ''}`)
}

let child
let cdp
const rendererErrors = []

try {
  if (!fs.existsSync(rendererEntry)) throw new Error('Built renderer is missing; run npm run build first')
  const port = await getFreePort()
  child = spawn(electronPath, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`], {
    cwd: root,
    env: {
      ...process.env,
      WPS_ALLOW_MULTI_INSTANCE: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    stdio: 'ignore',
    windowsHide: true,
  })

  const page = await waitForPage(port)
  cdp = await connectCdp(page.webSocketDebuggerUrl, (message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      rendererErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text)
    }
  })
  const { send } = cdp
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await waitFor(send, "document.getElementById('root')?.childElementCount > 0", 'React application')
  await waitFor(send, "localStorage.getItem('last-browse-dir')", 'initial file manager directory')

  const previousTimeOrigin = await evaluate(send, 'performance.timeOrigin')
  await evaluate(send, `(() => {
    localStorage.setItem('last-browse-dir', ${JSON.stringify(fixturePath)});
    location.reload();
    return true;
  })()`)
  await waitFor(send, `performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin)}`, 'renderer reload')
  await waitFor(send, "document.getElementById('root')?.childElementCount > 0", 'reloaded React application')
  const visibleCodeFiles = await waitFor(
    send,
    `(() => {
      const names = [...document.querySelectorAll('button')]
        .map((button) => button.textContent?.trim())
        .filter(Boolean);
      const expected = ${JSON.stringify(fixtures.map((fixture) => fixture.name))};
      return expected.every((name) => names.includes(name)) ? names : null;
    })()`,
    'source files in the Browse tab',
  )
  check(
    'file manager Browse tab lists C, C++, Java, TypeScript and Python files',
    fixtures.every((fixture) => visibleCodeFiles.includes(fixture.name)),
    JSON.stringify(visibleCodeFiles),
  )

  for (const fixture of fixtures) {
    check(`${fixture.label} file opened through the application`, await openFile(send, fixture.filePath))
    await waitFor(
      send,
      `document.querySelector('[data-testid=code-editor-root]')?.textContent.includes(${JSON.stringify(fixture.label)})
        && document.querySelector('.monaco-editor .view-lines')?.textContent.includes(${JSON.stringify(fixture.source.split(/\W+/).find((word) => word.length > 5))})`,
      `${fixture.label} Monaco model`,
      30_000,
    )
    const colors = await waitFor(
      send,
      `(() => {
        const colors = [...document.querySelectorAll('.monaco-editor .view-line span')]
          .filter((node) => node.textContent.trim())
          .map((node) => getComputedStyle(node).color);
        const unique = [...new Set(colors)];
        return unique.length >= 2 ? unique : null;
      })()`,
      `${fixture.label} syntax token colors`,
    )
    check(`${fixture.label} syntax highlighting uses multiple token colors`, colors.length >= 2, colors.join(', '))

    if (fixture.label !== 'TypeScript') {
      const run = await evaluate(send, `window.api.lw.runCode(${JSON.stringify(fixture.filePath)})`)
      if (run.errorCode === 'runtime-missing') {
        console.log(`[SKIP] ${fixture.label} compiler/runtime is not installed on this machine`)
      } else {
        check(`${fixture.label} Run Code compiles or executes the source`,
          run.success && run.stdout.includes(fixture.expectedOutput),
          JSON.stringify({ command: run.command, exitCode: run.exitCode, stdout: run.stdout, stderr: run.stderr }))
      }
    }
  }

  const layout = await evaluate(send, `(() => {
    const root = document.querySelector('[data-testid=code-editor-root]').getBoundingClientRect();
    const editor = document.querySelector('[data-testid=monaco-editor-host]').getBoundingClientRect();
    return { rootWidth: root.width, rootHeight: root.height, editorWidth: editor.width,
      editorHeight: editor.height, text: document.querySelector('.view-lines').textContent };
  })()`)
  check('code editor occupies a stable visible work area', layout.editorWidth > 500 && layout.editorHeight > 300, JSON.stringify(layout))
  check('TypeScript source is visibly rendered', layout.text.includes('greet') && layout.text.includes('console'))

  await evaluate(send, "document.querySelector('[data-testid=code-run-button]').click(); true")
  const output = await waitFor(
    send,
    `(() => {
      const panel = document.querySelector('[data-testid=code-bottom-panel]');
      return panel?.textContent.includes('Hello Monaco') ? panel.textContent : '';
    })()`,
    'TypeScript run output',
    30_000,
  )
  check('Run Code executes TypeScript and captures stdout', output.includes('Hello Monaco'))

  await evaluate(send, `(() => {
    const target = document.querySelector('.monaco-editor .view-lines');
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: innerWidth - 2, clientY: innerHeight - 2,
    }));
    return true;
  })()`)
  await waitFor(send, "Boolean(document.querySelector('[data-code-context-menu]'))", 'code context menu')
  const menu = await evaluate(send, `(() => {
    const element = document.querySelector('[data-code-context-menu]');
    const rect = element.getBoundingClientRect();
    return { count: element.querySelectorAll('[role=menuitem]').length, text: element.textContent,
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      viewportWidth: innerWidth, viewportHeight: innerHeight };
  })()`)
  check('VS Code-style context menu exposes the requested commands',
    menu.count >= 20 && menu.text.includes('Ctrl+Alt+N') && menu.text.includes('F12')
      && menu.text.includes('Ctrl+Shift+R'), `${menu.count} commands`)
  check('context menu remains inside a resized viewport',
    menu.left >= 0 && menu.top >= 0 && menu.right <= menu.viewportWidth && menu.bottom <= menu.viewportHeight,
    JSON.stringify(menu))

  await evaluate(send, `(() => {
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 1, clientY: 1 }));
    document.querySelector('.monaco-editor textarea')?.focus();
    return true;
  })()`)
  await pressKey(send, { key: 'i', code: 'KeyI', keyCode: 73, modifiers: 2 })
  await waitFor(send, "Boolean(document.querySelector('[data-testid=code-inline-chat]'))", 'isolated Ctrl+I inline chat')
  check('Ctrl+I is isolated to code inline chat', true)

  await evaluate(send, `(() => {
    document.querySelector('[data-testid=code-inline-chat] button:last-of-type')?.click();
    const target = document.querySelector('.monaco-editor .view-lines');
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: rect.left + 420, clientY: rect.top + 120,
    }));
    return true;
  })()`)
  await waitFor(send, "Boolean(document.querySelector('[data-code-context-menu]'))", 'context menu for screenshot')

  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(screenshotPath, screenshot.result.data, 'base64')
  check('verification screenshot captured', fs.statSync(screenshotPath).size > 10_000, screenshotPath)
  const unexpectedRendererErrors = rendererErrors.filter((message) => !String(message).startsWith('Canceled: Canceled'))
  check('renderer completed without unexpected uncaught exceptions',
    unexpectedRendererErrors.length === 0, unexpectedRendererErrors.join(' | '))
} catch (error) {
  check('code editor verifier completed', false, error instanceof Error ? error.stack : String(error))
} finally {
  cdp?.close()
  child?.kill()
  await sleep(400)
  fs.rmSync(profilePath, { recursive: true, force: true })
  fs.rmSync(fixturePath, { recursive: true, force: true })
}

const failures = results.filter((result) => !result.pass)
console.log(`\nCode editor verification: ${results.length - failures.length}/${results.length} passed`)
if (failures.length) process.exitCode = 1
