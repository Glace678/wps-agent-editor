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
const emptyTableScreenshotPath = path.join(root, '.cache', 'electron-verify-notepad-empty-table.png')
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

const scrollbarFixtures = [
  { name: 'scrollbar-medium.py', lines: 80 },
  { name: 'scrollbar-long.py', lines: 800 },
].map((fixture) => ({
  ...fixture,
  filePath: path.join(fixturePath, fixture.name),
  source: Array.from({ length: fixture.lines }, (_, index) => `value_${index + 1} = ${index + 1}`).join('\n'),
}))
for (const fixture of scrollbarFixtures) {
  fs.writeFileSync(fixture.filePath, fixture.source, 'utf8')
}

const markdownFixture = {
  name: 'notes.md',
  filePath: path.join(fixturePath, 'notes.md'),
  source: [
    '# Notes',
    '',
    'Before table body.',
    '',
    '<table class="notepad-md-table">',
    '<thead><tr><th>Column 1</th><th>Column 2</th><th>Column 3</th><th>Column 4</th></tr></thead>',
    '<tbody><tr><td>Original cell</td><td>Content 1</td><td>Content 2</td><td>Content 3</td></tr><tr><td>Content 4</td><td>Content 5</td><td>Content 6</td><td>Content 7</td></tr><tr><td>Content 8</td><td>Content 9</td><td>Content 10</td><td>Content 11</td></tr><tr><td>Content 12</td><td>Content 13</td><td>Content 14</td><td>Content 15</td></tr></tbody>',
    '</table>',
    '',
    '| Pipe A | Pipe B |',
    '| --- | --- |',
    '| Pipe 1 | Pipe 2 |',
    '',
    'Non-code panel visibility fixture.',
    'Second soft line stays adjacent.',
    '',
  ].join('\n'),
}
fs.writeFileSync(markdownFixture.filePath, markdownFixture.source, 'utf8')

const textFixture = {
  name: 'notes.txt',
  filePath: path.join(fixturePath, 'notes.txt'),
  source: [
    'Plain-text panel visibility fixture.',
    '',
    '<table class="notepad-md-table">',
    '<tbody><tr><td>Text A</td><td>Text B</td></tr></tbody>',
    '</table>',
    '',
    'Plain-text tail.',
    '',
  ].join('\n'),
}
fs.writeFileSync(textFixture.filePath, textFixture.source, 'utf8')

const emptyTableFixtures = [
  { name: 'empty-table.md', filePath: path.join(fixturePath, 'empty-table.md') },
  { name: 'empty-table.txt', filePath: path.join(fixturePath, 'empty-table.txt') },
]
for (const fixture of emptyTableFixtures) fs.writeFileSync(fixture.filePath, '', 'utf8')

const notepadScrollbarFixtures = [
  {
    name: 'scrollbar-notes.txt',
    filePath: path.join(fixturePath, 'scrollbar-notes.txt'),
    source: Array.from({ length: 400 }, (_, index) => `TXT scroll line ${index + 1}`).join('\n'),
  },
  {
    name: 'scrollbar-notes.md',
    filePath: path.join(fixturePath, 'scrollbar-notes.md'),
    source: [
      '# Markdown scrollbar',
      '',
      '<table class="notepad-md-table"><tbody><tr><td>Scroll fixture</td></tr></tbody></table>',
      '',
      ...Array.from({ length: 300 }, (_, index) => `Markdown scroll line ${index + 1}`),
      '',
    ].join('\n'),
  },
]
for (const fixture of notepadScrollbarFixtures) {
  fs.writeFileSync(fixture.filePath, fixture.source, 'utf8')
}

const tableInsertionFixtures = [
  {
    name: 'insert-at-caret.md',
    filePath: path.join(fixturePath, 'insert-at-caret.md'),
    source: [
      '# Insert at caret',
      '',
      ...Array.from({ length: 260 }, (_, index) => `Markdown insertion line ${index + 1}`),
      '',
    ].join('\n'),
    anchor: 'Markdown insertion line 180',
    after: 'Markdown insertion line 181',
    formattedAnchor: 'Markdown insertion line 220',
    formattedAfter: 'Markdown insertion line 221',
  },
  {
    name: 'insert-at-caret.txt',
    filePath: path.join(fixturePath, 'insert-at-caret.txt'),
    source: [
      'TXT insertion header',
      '',
      '<table class="notepad-md-table"><tbody><tr><td>Existing table</td></tr></tbody></table>',
      '',
      ...Array.from({ length: 260 }, (_, index) => `TXT insertion line ${index + 1}`),
      '',
    ].join('\n'),
    anchor: 'TXT insertion line 180',
    after: 'TXT insertion line 181',
  },
]
for (const fixture of tableInsertionFixtures) {
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

async function waitForFileText(filePath, predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs
  let value = ''
  while (Date.now() < deadline) {
    value = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
    if (predicate(value)) return value
    await sleep(80)
  }
  throw new Error(`Timed out waiting for saved Markdown content; last value: ${JSON.stringify(value)}`)
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

async function insertNotepadTable(send, rows, columns) {
  return evaluate(send, `(() => {
    const bar = document.querySelector('[data-testid=notepad-commandbar]');
    const key = Object.keys(bar || {}).find((name) => name.startsWith('__reactFiber'));
    let fiber = key ? bar[key] : null;
    while (fiber) {
      if (typeof fiber.memoizedProps?.onInsertTable === 'function') {
        fiber.memoizedProps.onInsertTable(${rows}, ${columns});
        return true;
      }
      fiber = fiber.return;
    }
    return false;
  })()`)
}

async function setNotepadView(send, view) {
  return evaluate(send, `(() => {
    const bar = document.querySelector('[data-testid=notepad-commandbar]');
    const key = Object.keys(bar || {}).find((name) => name.startsWith('__reactFiber'));
    let fiber = key ? bar[key] : null;
    while (fiber) {
      if (typeof fiber.memoizedProps?.onMarkdownView === 'function') {
        fiber.memoizedProps.onMarkdownView(${JSON.stringify(view)});
        return true;
      }
      fiber = fiber.return;
    }
    return false;
  })()`)
}

async function clickPoint(send, point) {
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    clickCount: 1,
    x: point.x,
    y: point.y,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
    x: point.x,
    y: point.y,
  })
}

async function dragPoint(send, start, end) {
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    buttons: 1,
    clickCount: 1,
    x: start.x,
    y: start.y,
  })
  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      button: 'left',
      buttons: 1,
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
    })
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    buttons: 0,
    clickCount: 1,
    x: end.x,
    y: end.y,
  })
}

async function dragNotepadScrollbar(send, selector) {
  const selectorJson = JSON.stringify(selector)
  const before = await evaluate(send, `(() => {
    const editor = document.querySelector(${selectorJson});
    const handles = Array.from(document.querySelectorAll('[role=separator][aria-orientation=vertical]'));
    const handle = handles[1];
    const rightPanel = document.querySelector('[data-panel=agent-assistant]');
    if (!editor || !handle || !rightPanel || editor.scrollHeight <= editor.clientHeight) return null;
    editor.scrollTop = 0;
    const rect = editor.getBoundingClientRect();
    const handleRect = handle.getBoundingClientRect();
    const scrollbarWidth = editor.offsetWidth - editor.clientWidth;
    const thumbHeight = Math.max(24, editor.clientHeight * editor.clientHeight / editor.scrollHeight);
    const x = rect.right - Math.max(2, scrollbarWidth / 2);
    const startY = rect.top + thumbHeight / 2;
    const maxTravel = Math.max(1, editor.clientHeight - thumbHeight);
    const endY = startY + Math.min(180, maxTravel * 0.55);
    return {
      start: { x, y: startY },
      end: { x, y: endY },
      hitEditor: document.elementFromPoint(x, startY) === editor,
      editorRight: rect.right,
      handleLeft: handleRect.left,
      scrollbarWidth,
      rightPanelWidth: rightPanel.getBoundingClientRect().width,
    };
  })()`)
  if (!before) throw new Error(`Missing scrollable notepad editor for ${selector}`)

  await dragPoint(send, before.start, before.end)
  const after = await waitFor(
    send,
    `(() => {
      const editor = document.querySelector(${selectorJson});
      const rightPanel = document.querySelector('[data-panel=agent-assistant]');
      if (!editor || !rightPanel || editor.scrollTop <= 20) return null;
      return {
        scrollTop: editor.scrollTop,
        rightPanelWidth: rightPanel.getBoundingClientRect().width,
      };
    })()`,
    `native scrollbar drag for ${selector}`,
  )
  return { before, after }
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
  await evaluate(send, "localStorage.setItem('wps-code-editor-font-size', '28'); true")
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
      const panel = document.querySelector('[data-testid=bottom-panel]');
      return panel?.textContent.includes('Hello Monaco') ? panel.textContent : '';
    })()`,
    'TypeScript run output',
    30_000,
  )
  check('Run Code executes TypeScript and captures stdout', output.includes('Hello Monaco'))

  const bottomPanelLayout = await evaluate(send, `(() => {
    const panel = document.querySelector('[data-testid=bottom-panel]');
    const fileManager = document.querySelector('[data-panel=file-manager]');
    const documentEditor = document.querySelector('[data-panel=document-editor]');
    const agentAssistant = document.querySelector('[data-panel=agent-assistant]');
    if (!panel || !fileManager || !documentEditor || !agentAssistant) return null;
    const toRect = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    return {
      panel: toRect(panel),
      fileManager: toRect(fileManager),
      documentEditor: toRect(documentEditor),
      agentAssistant: toRect(agentAssistant),
      panelInsideDocumentEditor: documentEditor.contains(panel),
      tabs: ['problems', 'output', 'debug-console', 'terminal'].map((tab) =>
        Boolean(panel.querySelector('[data-testid=bottom-tab-' + tab + ']'))),
    };
  })()`)
  check('bottom panel is rendered inside the document editor column',
    bottomPanelLayout?.panelInsideDocumentEditor === true,
    JSON.stringify(bottomPanelLayout))
  check('bottom panel keeps Problems, Output, Debug Console and Terminal together',
    bottomPanelLayout?.tabs.every(Boolean),
    JSON.stringify(bottomPanelLayout))
  check('bottom panel stays between the file manager and Agent assistant',
    bottomPanelLayout
      && bottomPanelLayout.panel.left >= bottomPanelLayout.documentEditor.left
      && bottomPanelLayout.panel.right <= bottomPanelLayout.documentEditor.right
      && bottomPanelLayout.panel.left >= bottomPanelLayout.fileManager.right
      && bottomPanelLayout.panel.right <= bottomPanelLayout.agentAssistant.left,
    JSON.stringify(bottomPanelLayout))
  check('sidebars remain full-height while the bottom panel is open',
    bottomPanelLayout
      && Math.abs(bottomPanelLayout.fileManager.bottom - bottomPanelLayout.panel.bottom) < 1
      && Math.abs(bottomPanelLayout.agentAssistant.bottom - bottomPanelLayout.panel.bottom) < 1,
    JSON.stringify(bottomPanelLayout))

  check('Markdown file opened through the application', await openFile(send, markdownFixture.filePath))
  const markdownPanelState = await waitFor(
    send,
    `(() => {
      const textEditor = document.querySelector('[data-testid=text-editor]');
      const input = document.querySelector('[data-testid=text-editor-input]');
      const panel = document.querySelector('[data-testid=bottom-panel]');
      const rect = panel?.getBoundingClientRect();
      const panelVisible = Boolean(panel && panel.getClientRects().length > 0
        && rect.width > 0.5 && rect.height > 0.5);
      if (!textEditor || panelVisible || !input?.value.includes('Non-code panel visibility fixture')) return null;
      return {
        panelHidden: !panelVisible,
        panelMounted: Boolean(panel),
        codeEditorHidden: !document.querySelector('[data-testid=code-editor-root]'),
      };
    })()`,
    'Markdown editor with hidden bottom panel',
  )
  check('switching to a non-code file immediately hides the bottom panel',
    markdownPanelState.panelHidden
      && markdownPanelState.panelMounted
      && markdownPanelState.codeEditorHidden,
    JSON.stringify(markdownPanelState))

  const openedFormattedMarkdown = await evaluate(send, `(() => {
    const bar = document.querySelector('[data-testid=notepad-commandbar]');
    const key = Object.keys(bar || {}).find((name) => name.startsWith('__reactFiber'));
    let fiber = key ? bar[key] : null;
    while (fiber) {
      if (typeof fiber.memoizedProps?.onMarkdownView === 'function') {
        fiber.memoizedProps.onMarkdownView('formatted');
        return true;
      }
      fiber = fiber.return;
    }
    return false;
  })()`)
  check('Markdown fixture switched to formatted table editing', openedFormattedMarkdown)
  await waitFor(
    send,
    `Boolean(document.querySelector('[data-testid=text-editor-formatted-view] td[contenteditable=true]'))`,
    'editable Markdown table cell',
  )

  const markdownCellPoint = await evaluate(send, `(async () => {
    const cell = document.querySelector('[data-testid=text-editor-formatted-view] tbody td');
    cell.scrollIntoView({ block: 'center', inline: 'center' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = cell.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`)
  await clickPoint(send, markdownCellPoint)
  const markdownCellReady = await evaluate(send, `(() => {
    const cell = document.querySelector('[data-testid=text-editor-formatted-view] tbody td');
    if (!cell || document.activeElement !== cell) return false;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(cell);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  })()`)
  check('Markdown table cell receives a real pointer focus before editing', markdownCellReady)
  await send('Input.insertText', { text: 'Edited cell' })
  await waitFor(
    send,
    `document.querySelector('[data-testid=text-editor-formatted-view] tbody td')?.textContent === 'Edited cell'`,
    'edited Markdown table cell',
  )

  const cellHeightBeforeEnter = await evaluate(send, `(() => {
    const cell = document.querySelector('[data-testid=text-editor-formatted-view] tbody td');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    return cell.getBoundingClientRect().height;
  })()`)
  await pressKey(send, { key: 'Enter', code: 'Enter', keyCode: 13 })
  await send('Input.insertText', { text: '111' })
  await pressKey(send, { key: 'Enter', code: 'Enter', keyCode: 13 })
  await send('Input.insertText', { text: '1' })
  const multilineCellState = await waitFor(
    send,
    `(() => {
      const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
      const cell = preview?.querySelector('tbody td');
      const singleLineCell = preview?.querySelector('tbody td:nth-child(2)');
      if (!cell || !singleLineCell) return null;
      const cellStyle = getComputedStyle(cell);
      const singleStyle = getComputedStyle(singleLineCell);
      return {
        text: cell.innerText,
        textContent: cell.textContent,
        html: cell.innerHTML,
        expectedLines: cell.innerText.includes('Edited cell\\n111\\n1'),
        height: cell.getBoundingClientRect().height,
        fontSize: parseFloat(cellStyle.fontSize),
        singleLineFontSize: parseFloat(singleStyle.fontSize),
        lineHeight: parseFloat(cellStyle.lineHeight),
      };
    })()`,
    'multiline Markdown table cell',
  )
  check(
    'Enter inserts line breaks inside a cell and expands its table row',
    multilineCellState.expectedLines
      && multilineCellState.height > cellHeightBeforeEnter + multilineCellState.lineHeight * 1.5,
    JSON.stringify({ before: cellHeightBeforeEnter, after: multilineCellState }),
  )
  check(
    'numeric lines keep the configured table font size at different row heights',
    multilineCellState.fontSize > 0
      && Math.abs(multilineCellState.fontSize - multilineCellState.singleLineFontSize) < 0.05,
    JSON.stringify(multilineCellState),
  )

  const tallRowOutsidePoint = await evaluate(send, `(async () => {
    const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
    const row = preview?.querySelector('tbody tr');
    const table = row?.closest('table');
    if (!preview || !row || !table) return null;
    row.scrollIntoView({ block: 'center', inline: 'nearest' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rowRect = row.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    return {
      x: Math.min(previewRect.right - 8, tableRect.right + 18),
      y: rowRect.top + rowRect.height / 2,
    };
  })()`)
  await clickPoint(send, tallRowOutsidePoint)
  const tallRowCaretSize = await waitFor(
    send,
    `(() => {
      const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
      const selected = preview?.querySelector('tbody tr[data-notepad-row-insert-after=true]');
      const normal = preview?.querySelector('tbody tr:nth-child(2)');
      const lastCell = selected?.lastElementChild;
      if (!selected || !normal || !lastCell) return null;
      return {
        selectedRowHeight: selected.getBoundingClientRect().height,
        normalRowHeight: normal.getBoundingClientRect().height,
        caretHeight: parseFloat(getComputedStyle(lastCell, '::after').height),
      };
    })()`,
    'tall table row outside insertion caret size',
  )
  check(
    'outside insertion caret stays at one normal table-row height on a tall row',
    tallRowCaretSize.selectedRowHeight > tallRowCaretSize.normalRowHeight
      && tallRowCaretSize.caretHeight <= tallRowCaretSize.normalRowHeight
      && tallRowCaretSize.caretHeight < tallRowCaretSize.selectedRowHeight - 4,
    JSON.stringify(tallRowCaretSize),
  )

  const rowOutsidePoint = await evaluate(send, `(async () => {
    const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
    const row = preview?.querySelectorAll('tbody tr')[1];
    const table = row?.closest('table');
    if (!preview || !row || !table) return null;
    row.scrollIntoView({ block: 'center', inline: 'nearest' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rowRect = row.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    return {
      x: Math.min(previewRect.right - 8, tableRect.right + 18),
      y: rowRect.top + rowRect.height / 2,
      rowsBefore: table.rows.length,
    };
  })()`)
  check('table row exposes clickable whitespace on its outside edge', Boolean(rowOutsidePoint))
  await clickPoint(send, rowOutsidePoint)
  const rowOutsideCaret = await waitFor(
    send,
    `(() => {
      const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
      const row = preview?.querySelector('tr[data-notepad-row-insert-after=true]');
      return Boolean(preview && row && document.activeElement === preview);
    })()`,
    'table row outside insertion caret',
  )
  check('clicking beside a table row selects an outside row insertion point', rowOutsideCaret)
  await pressKey(send, { key: 'Enter', code: 'Enter', keyCode: 13 })
  const insertedOutsideRow = await waitFor(
    send,
    `(() => {
      const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
      const table = preview?.querySelector('table');
      const selected = table?.querySelector('tr[data-notepad-row-insert-after=true]');
      if (!table || !selected || table.rows.length !== ${rowOutsidePoint.rowsBefore + 1}) return null;
      return {
        rows: table.rows.length,
        cells: selected.cells.length,
        editable: Array.from(selected.cells).every((cell) => cell.isContentEditable),
      };
    })()`,
    'new table row from outside Enter',
  )
  check(
    'Enter at a row outside edge creates a complete editable table row below it',
    insertedOutsideRow.cells === 4 && insertedOutsideRow.editable,
    JSON.stringify(insertedOutsideRow),
  )

  // Let the deferred table-history commit run before focus moves to Markdown body text.
  await sleep(550)
  const markdownOutsidePoint = await evaluate(send, `(async () => {
    const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
    const paragraph = Array.from(preview.querySelectorAll('p'))
      .find((item) => item.textContent.includes('Non-code panel visibility fixture'));
    paragraph.scrollIntoView({ block: 'center', inline: 'nearest' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = paragraph.getBoundingClientRect();
    return { x: rect.left + Math.min(12, rect.width / 2), y: rect.top + rect.height / 2 };
  })()`)
  await clickPoint(send, markdownOutsidePoint)
  const markdownOutsideState = await waitFor(
    send,
    `(() => {
      const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
      const input = document.querySelector('[data-testid=text-editor-input]');
      const paragraph = Array.from(preview?.querySelectorAll('p') ?? [])
        .find((item) => item.textContent.includes('Non-code panel visibility fixture'));
      const editable = paragraph?.matches('[contenteditable=true]')
        ? paragraph
        : paragraph?.closest('[contenteditable=true]') ?? paragraph?.querySelector('[contenteditable=true]');
      const inputRect = input?.getBoundingClientRect();
      const syntaxVisible = Boolean(input && inputRect && inputRect.width > 0.5 && inputRect.height > 0.5);
      const previewRect = preview?.getBoundingClientRect();
      const formattedVisible = Boolean(preview && previewRect && previewRect.width > 0.5 && previewRect.height > 0.5);
      const focused = Boolean(editable && (document.activeElement === editable || editable.contains(document.activeElement)));
      if (!formattedVisible || syntaxVisible || !editable?.isContentEditable || !focused) return null;
      return {
        formattedVisible,
        syntaxMounted: Boolean(input),
        syntaxVisible,
        rawSourceVisible: Boolean(syntaxVisible && input.value.includes('<table class="notepad-md-table">')),
        editable: editable.isContentEditable,
        focused,
        cell: preview.querySelector('tbody td')?.textContent,
      };
    })()`,
    'editable Markdown body without leaving formatted view',
  )

  const markdownBodyCaretReady = await evaluate(send, `(() => {
    const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
    const paragraph = Array.from(preview.querySelectorAll('p'))
      .find((item) => item.textContent.includes('Non-code panel visibility fixture'));
    const editable = paragraph.matches('[contenteditable=true]')
      ? paragraph
      : paragraph.closest('[contenteditable=true]') ?? paragraph.querySelector('[contenteditable=true]');
    editable.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return document.activeElement === editable || editable.contains(document.activeElement);
  })()`)
  check('clicked Markdown body accepts a caret', markdownBodyCaretReady)

  await send('Input.insertText', { text: 'Outside edit A' })
  const markdownFirstOutsideEdit = await waitFor(
    send,
    `(() => {
      const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
      const paragraph = Array.from(preview?.querySelectorAll('p') ?? [])
        .find((item) => item.textContent.includes('Outside edit ANon-code panel visibility fixture'));
      const editable = paragraph?.matches('[contenteditable=true]')
        ? paragraph
        : paragraph?.closest('[contenteditable=true]') ?? paragraph?.querySelector('[contenteditable=true]');
      return Boolean(preview && !document.querySelector('[data-testid=text-editor-input]')
        && paragraph && editable?.isContentEditable
        && (document.activeElement === editable || editable.contains(document.activeElement))
        && preview.querySelector('tbody td')?.innerText === 'Edited cell\\n111\\n1');
    })()`,
    'first formatted Markdown body edit',
  )
  await send('Input.insertText', { text: '-B: ' })
  const markdownSecondOutsideEdit = await waitFor(
    send,
    `(() => {
      const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
      const paragraph = Array.from(preview?.querySelectorAll('p') ?? [])
        .find((item) => item.textContent.includes('Outside edit A-B: Non-code panel visibility fixture'));
      const editable = paragraph?.closest('[contenteditable=true]');
      return Boolean(preview && !document.querySelector('[data-testid=text-editor-input]')
        && paragraph?.isContentEditable && editable
        && (document.activeElement === editable || editable.contains(document.activeElement))
        && preview.querySelector('tbody td')?.innerText === 'Edited cell\\n111\\n1');
    })()`,
    'second consecutive formatted Markdown body edit',
  )
  check(
    'table and body remain editable together without exposing Markdown table source',
    markdownFirstOutsideEdit
      && markdownSecondOutsideEdit
      && markdownOutsideState.formattedVisible
      && !markdownOutsideState.syntaxMounted
      && !markdownOutsideState.rawSourceVisible
      && markdownOutsideState.cell === 'Edited cell\n111\n1',
    JSON.stringify(markdownOutsideState),
  )

  check('formatted Markdown edits requested a save', await evaluate(
    send,
    `window.api.appMenu.perform('save').then(() => true)`,
  ))
  const savedMarkdown = await waitForFileText(
    markdownFixture.filePath,
    (value) => value.includes('<td>Edited cell<br>111<br>1</td>')
      && value.includes('<tr><td><br></td><td><br></td><td><br></td><td><br></td></tr>')
      && value.includes('Outside edit A-B: Non-code panel visibility fixture.'),
  )
  const savedTableCount = (savedMarkdown.match(/<table\b/gi) ?? []).length
  check(
    'saved Markdown preserves the edited table and formatted body text together',
    savedTableCount === 1
      && savedMarkdown.includes('# Notes\n\nBefore table body.')
      && savedMarkdown.includes('<td>Edited cell<br>111<br>1</td>')
      && savedMarkdown.includes('<tr><td><br></td><td><br></td><td><br></td><td><br></td></tr>')
      && !savedMarkdown.includes('Original cell')
      && savedMarkdown.includes([
        '</table>',
        '',
        '| Pipe A | Pipe B |',
        '| --- | --- |',
        '| Pipe 1 | Pipe 2 |',
        '',
        'Outside edit A-B: Non-code panel visibility fixture.',
        'Second soft line stays adjacent.',
      ].join('\n')),
    JSON.stringify({ savedTableCount, savedMarkdown }),
  )

  const emptyMarkdownFixture = emptyTableFixtures[0]
  check('empty Markdown fixture opened through the application', await openFile(send, emptyMarkdownFixture.filePath))
  await waitFor(
    send,
    `document.querySelector('[data-testid=text-editor-input]')?.value === ''`,
    'empty Markdown editor',
  )
  check('3 x 4 Markdown table inserted through the editor command', await insertNotepadTable(send, 3, 4))
  const emptyMarkdownTable = await waitFor(
    send,
    `(() => {
      const table = document.querySelector('[data-testid=text-editor-formatted-view] table');
      if (!table || table.rows.length !== 3) return null;
      const rows = Array.from(table.rows);
      const cells = rows.flatMap((row) => Array.from(row.cells));
      return {
        rows: rows.length,
        columns: rows[0]?.cells.length ?? 0,
        headers: table.querySelectorAll('th').length,
        allCellsEmpty: cells.every((cell) => cell.textContent === ''),
        rowHeights: rows.map((row) => row.getBoundingClientRect().height),
        backgrounds: rows.map((row) => getComputedStyle(row.cells[0]).backgroundColor),
      };
    })()`,
    'empty 3 x 4 Markdown table',
  )
  check(
    'new Markdown table is a uniform empty grid with the selected dimensions',
    emptyMarkdownTable.rows === 3
      && emptyMarkdownTable.columns === 4
      && emptyMarkdownTable.headers === 0
      && emptyMarkdownTable.allCellsEmpty
      && emptyMarkdownTable.rowHeights.every((height) => height >= 24)
      && new Set(emptyMarkdownTable.backgrounds).size === 1,
    JSON.stringify(emptyMarkdownTable),
  )
  fs.mkdirSync(path.dirname(emptyTableScreenshotPath), { recursive: true })
  const emptyTableScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(emptyTableScreenshotPath, emptyTableScreenshot.result.data, 'base64')
  check('empty Markdown table screenshot captured', fs.statSync(emptyTableScreenshotPath).size > 10_000, emptyTableScreenshotPath)
  check('empty Markdown table save requested', await evaluate(send, `window.api.appMenu.perform('save').then(() => true)`))
  const savedEmptyMarkdown = await waitForFileText(
    emptyMarkdownFixture.filePath,
    (value) => value.includes('<tbody><tr><td><br></td>'),
  )
  check(
    'saved Markdown table contains no generated labels or content placeholders',
    !savedEmptyMarkdown.includes('<thead>')
      && !savedEmptyMarkdown.includes('<th>')
      && !/Column|Content|列\s*\d|内容/.test(savedEmptyMarkdown),
    JSON.stringify(savedEmptyMarkdown),
  )
  const markdownPartialRowDrag = await evaluate(send, `(() => {
    const table = document.querySelector('[data-testid=text-editor-formatted-view] table');
    const startRow = table?.rows[table.rows.length - 1];
    const endRow = table?.rows[1];
    const startCell = startRow?.cells[startRow.cells.length - 1]?.getBoundingClientRect();
    const endCell = endRow?.cells[0]?.getBoundingClientRect();
    if (!startCell || !endCell) return null;
    return {
      start: { x: startCell.right - 6, y: startCell.top + startCell.height / 2 },
      end: { x: endCell.left + 6, y: endCell.top + endCell.height / 2 },
    };
  })()`)
  await dragPoint(send, markdownPartialRowDrag.start, markdownPartialRowDrag.end)
  const markdownPartialSelection = await waitFor(
    send,
    `(() => {
      const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
      const table = preview?.querySelector('table');
      const rows = Array.from(table?.querySelectorAll('tr[data-notepad-row-selected=true]') ?? []);
      return table ? {
        selectedRows: rows.length,
        tableSelected: table.getAttribute('data-notepad-table-selected') === 'true',
      } : null;
    })()`,
    'partial Markdown table row drag selection',
  )
  check(
    'right-to-left drag selects only the requested Markdown rows',
    markdownPartialSelection.selectedRows === 2 && !markdownPartialSelection.tableSelected,
    JSON.stringify(markdownPartialSelection),
  )
  await pressKey(send, { key: 'Delete', code: 'Delete', keyCode: 46 })
  const markdownPartialDelete = await waitFor(
    send,
    `(() => {
      const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
      const table = preview?.querySelector('table');
      const input = document.querySelector('[data-testid=text-editor-input]');
      return table ? {
        rows: table.rows.length,
        hasSyntax: Boolean(input),
        selectedRows: table.querySelectorAll('tr[data-notepad-row-selected=true]').length,
      } : null;
    })()`,
    'partial Markdown row delete',
  )
  check(
    'Delete removes only selected Markdown rows and keeps the table',
    markdownPartialDelete.rows === 1
      && !markdownPartialDelete.hasSyntax
      && markdownPartialDelete.selectedRows === 0,
    JSON.stringify(markdownPartialDelete),
  )
  const markdownPreviewFocusStyle = await evaluate(send, `(() => {
    const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
    if (!preview) return null;
    preview.focus({ preventScroll: true });
    const style = getComputedStyle(preview);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  })()`)
  check(
    'formatted preview has no browser focus frame after row deletion',
    markdownPreviewFocusStyle.outlineStyle === 'none'
      || markdownPreviewFocusStyle.outlineWidth === '0px',
    JSON.stringify(markdownPreviewFocusStyle),
  )
  const markdownTableDrag = await evaluate(send, `(() => {
    const table = document.querySelector('[data-testid=text-editor-formatted-view] table');
    const row = table?.rows[table.rows.length - 1];
    const first = row?.cells[0]?.getBoundingClientRect();
    const last = row?.cells[row.cells.length - 1]?.getBoundingClientRect();
    if (!first || !last) return null;
    return {
      start: { x: last.right - 6, y: last.top + last.height / 2 },
      end: { x: first.left + 6, y: first.top + first.height / 2 },
    };
  })()`)
  await dragPoint(send, markdownTableDrag.start, markdownTableDrag.end)
  const selectedMarkdownTable = await waitFor(
    send,
    `(() => {
      const table = document.querySelector('[data-testid=text-editor-formatted-view] table[data-notepad-table-selected=true]');
      if (!table) return null;
      return {
        selected: table.getAttribute('aria-selected'),
        outline: getComputedStyle(table).outlineStyle,
      };
    })()`,
    'right-to-left Markdown table drag selection',
  )
  check(
    'right-to-left drag selects the complete Markdown table',
    selectedMarkdownTable.selected === 'true' && selectedMarkdownTable.outline !== 'none',
    JSON.stringify(selectedMarkdownTable),
  )
  await pressKey(send, { key: 'Delete', code: 'Delete', keyCode: 46 })
  await waitFor(
    send,
    `(() => {
      const input = document.querySelector('[data-testid=text-editor-input]');
      return input && !input.value.includes('<table') && !document.querySelector('[data-testid=text-editor-formatted-view]');
    })()`,
    'Markdown table deletion after drag selection',
  )
  check('Delete removes the selected Markdown table', true)
  check('deleted Markdown table save requested', await evaluate(send, `window.api.appMenu.perform('save').then(() => true)`))
  const deletedEmptyMarkdown = await waitForFileText(
    emptyMarkdownFixture.filePath,
    (value) => !/<table\b/i.test(value),
  )
  check('saved Markdown no longer contains the deleted table', !/<table\b/i.test(deletedEmptyMarkdown))

  const emptyTextFixture = emptyTableFixtures[1]
  check('empty TXT fixture opened through the application', await openFile(send, emptyTextFixture.filePath))
  await waitFor(
    send,
    `document.querySelector('[data-testid=text-editor-input]')?.value === ''`,
    'empty TXT editor',
  )
  check('2 x 3 TXT table inserted through the editor command', await insertNotepadTable(send, 2, 3))
  const emptyTextTable = await waitFor(
    send,
    `(() => {
      const table = document.querySelector('[data-testid=text-editor-formatted-view] table');
      if (!table || table.rows.length !== 2) return null;
      const cells = Array.from(table.rows).flatMap((row) => Array.from(row.cells));
      return {
        rows: table.rows.length,
        columns: table.rows[0]?.cells.length ?? 0,
        headers: table.querySelectorAll('th').length,
        allCellsEmpty: cells.every((cell) => cell.textContent === ''),
      };
    })()`,
    'empty 2 x 3 TXT table',
  )
  check(
    'new TXT table is empty and uses the selected dimensions',
    emptyTextTable.rows === 2
      && emptyTextTable.columns === 3
      && emptyTextTable.headers === 0
      && emptyTextTable.allCellsEmpty,
    JSON.stringify(emptyTextTable),
  )
  check('empty TXT table save requested', await evaluate(send, `window.api.appMenu.perform('save').then(() => true)`))
  const savedEmptyText = await waitForFileText(
    emptyTextFixture.filePath,
    (value) => value.includes('<tbody><tr><td><br></td>'),
  )
  check(
    'saved TXT table contains no generated labels or content placeholders',
    !savedEmptyText.includes('<thead>')
      && !savedEmptyText.includes('<th>')
      && !/Column|Content|列\s*\d|内容/.test(savedEmptyText),
    JSON.stringify(savedEmptyText),
  )
  const textTableDrag = await evaluate(send, `(() => {
    const table = document.querySelector('[data-testid=text-editor-formatted-view] table');
    const firstRow = table?.rows[0];
    const lastRow = table?.rows[table.rows.length - 1];
    const first = firstRow?.cells[0]?.getBoundingClientRect();
    const last = lastRow?.cells[lastRow.cells.length - 1]?.getBoundingClientRect();
    if (!first || !last) return null;
    return {
      start: { x: last.right - 6, y: last.top + last.height / 2 },
      end: { x: first.left + 6, y: first.top + first.height / 2 },
    };
  })()`)
  await dragPoint(send, textTableDrag.start, textTableDrag.end)
  await waitFor(
    send,
    `Boolean(document.querySelector('[data-testid=text-editor-formatted-view] table[data-notepad-table-selected=true]'))`,
    'right-to-left TXT table drag selection',
  )
  check('right-to-left drag selects the complete TXT table', true)
  await pressKey(send, { key: 'Backspace', code: 'Backspace', keyCode: 8 })
  await waitFor(
    send,
    `(() => {
      const input = document.querySelector('[data-testid=text-editor-input]');
      return input && !input.value.includes('<table') && !document.querySelector('[data-testid=text-editor-formatted-view]');
    })()`,
    'TXT table deletion after drag selection',
  )
  check('Backspace removes the selected TXT table', true)

  const markdownInsertionFixture = tableInsertionFixtures[0]
  check('long Markdown insertion fixture opened', await openFile(send, markdownInsertionFixture.filePath))
  await waitFor(
    send,
    `document.querySelector('[data-testid=text-editor-input]')?.value.includes(${JSON.stringify(markdownInsertionFixture.after)})`,
    'long Markdown insertion editor',
  )
  const markdownCaretSetup = await evaluate(send, `(() => {
    const input = document.querySelector('[data-testid=text-editor-input]');
    const anchor = ${JSON.stringify(markdownInsertionFixture.anchor)};
    if (!input) return null;
    const offset = input.value.indexOf(anchor) + anchor.length;
    if (offset < anchor.length) return null;
    input.focus();
    input.setSelectionRange(offset, offset);
    input.scrollTop = Math.max(0, input.scrollHeight * 0.68);
    input.dispatchEvent(new Event('select', { bubbles: true }));
    return { offset, scrollTop: input.scrollTop };
  })()`)
  check(
    'Markdown syntax caret prepared in the middle of the file',
    markdownCaretSetup?.offset > 0 && markdownCaretSetup.scrollTop > 20,
    JSON.stringify(markdownCaretSetup),
  )
  check('Markdown table inserted at the active syntax caret', await insertNotepadTable(send, 2, 2))
  const markdownInsertedViewport = await waitFor(
    send,
    `(() => {
      const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
      const table = preview?.querySelector('table');
      const cell = table?.querySelector('td');
      if (!preview || !table || !cell) return null;
      const viewport = preview.getBoundingClientRect();
      const rect = table.getBoundingClientRect();
      return {
        scrollTop: preview.scrollTop,
        visible: rect.top >= viewport.top && rect.bottom <= viewport.bottom,
        rows: table.rows.length,
        columns: table.rows[0]?.cells.length ?? 0,
      };
    })()`,
    'Markdown inserted table viewport anchor',
  )
  check(
    'Markdown insertion keeps the new middle table visible instead of jumping to the file start',
    markdownInsertedViewport.scrollTop > 20
      && markdownInsertedViewport.visible
      && markdownInsertedViewport.rows === 2
      && markdownInsertedViewport.columns === 2,
    JSON.stringify(markdownInsertedViewport),
  )
  check('Markdown insertion fixture switched back to syntax', await setNotepadView(send, 'syntax'))
  const markdownInsertionOrder = await waitFor(
    send,
    `(() => {
      const value = document.querySelector('[data-testid=text-editor-input]')?.value;
      if (!value) return null;
      return {
        anchor: value.indexOf(${JSON.stringify(markdownInsertionFixture.anchor)}),
        table: value.indexOf('<table'),
        after: value.indexOf(${JSON.stringify(markdownInsertionFixture.after)}),
      };
    })()`,
    'Markdown middle insertion source order',
  )
  check(
    'Markdown table source is inserted between the requested adjacent lines',
    markdownInsertionOrder.anchor < markdownInsertionOrder.table
      && markdownInsertionOrder.table < markdownInsertionOrder.after,
    JSON.stringify(markdownInsertionOrder),
  )
  check('Markdown insertion fixture returned to formatted view', await setNotepadView(send, 'formatted'))
  const formattedMarkdownCaret = await waitFor(
    send,
    `(() => {
      const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
      const anchor = ${JSON.stringify(markdownInsertionFixture.formattedAnchor)};
      if (!preview) return null;
      const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.data.includes(anchor)) node = walker.nextNode();
      if (!node) return null;
      const region = node.parentElement?.closest('[data-notepad-markdown-region]');
      if (!region) return null;
      region.focus({ preventScroll: true });
      const range = document.createRange();
      range.setStart(node, node.data.indexOf(anchor) + anchor.length);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const viewport = preview.getBoundingClientRect();
      const caretRect = range.getBoundingClientRect();
      preview.scrollTop += caretRect.top - viewport.top - preview.clientHeight / 2;
      return { scrollTop: preview.scrollTop };
    })()`,
    'formatted Markdown caret setup',
  )
  check(
    'Markdown formatted caret prepared after the first table',
    formattedMarkdownCaret.scrollTop > 20,
    JSON.stringify(formattedMarkdownCaret),
  )
  await sleep(80)
  await evaluate(send, `(() => {
    document.querySelector('[data-testid=notepad-table-menu]')?.focus();
    window.getSelection()?.removeAllRanges();
    return true;
  })()`)
  check('second Markdown table inserted from the remembered formatted caret', await insertNotepadTable(send, 1, 2))
  const formattedMarkdownInsertion = await waitFor(
    send,
    `(() => {
      const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
      const tables = Array.from(preview?.querySelectorAll('table') ?? []);
      if (!preview || tables.length !== 2) return null;
      const table = tables[1];
      const viewport = preview.getBoundingClientRect();
      const rect = table.getBoundingClientRect();
      return {
        scrollTop: preview.scrollTop,
        visible: rect.top >= viewport.top && rect.bottom <= viewport.bottom,
        rows: table.rows.length,
        columns: table.rows[0]?.cells.length ?? 0,
      };
    })()`,
    'formatted Markdown second insertion',
  )
  check(
    'second Markdown table stays at the formatted caret and remains visible',
    formattedMarkdownInsertion.scrollTop > 20
      && formattedMarkdownInsertion.visible
      && formattedMarkdownInsertion.rows === 1
      && formattedMarkdownInsertion.columns === 2,
    JSON.stringify(formattedMarkdownInsertion),
  )
  check('Markdown double-insertion fixture switched back to syntax', await setNotepadView(send, 'syntax'))
  const formattedMarkdownOrder = await waitFor(
    send,
    `(() => {
      const value = document.querySelector('[data-testid=text-editor-input]')?.value;
      if (!value) return null;
      const firstTable = value.indexOf('<table');
      return {
        anchor: value.indexOf(${JSON.stringify(markdownInsertionFixture.formattedAnchor)}),
        table: value.indexOf('<table', firstTable + 1),
        after: value.indexOf(${JSON.stringify(markdownInsertionFixture.formattedAfter)}),
      };
    })()`,
    'formatted Markdown second insertion source order',
  )
  check(
    'formatted Markdown table source is inserted between the requested adjacent lines',
    formattedMarkdownOrder.anchor < formattedMarkdownOrder.table
      && formattedMarkdownOrder.table < formattedMarkdownOrder.after,
    JSON.stringify(formattedMarkdownOrder),
  )

  const textInsertionFixture = tableInsertionFixtures[1]
  check('long TXT insertion fixture opened', await openFile(send, textInsertionFixture.filePath))
  check('TXT insertion fixture switched to formatted view', await setNotepadView(send, 'formatted'))
  await waitFor(
    send,
    `document.querySelector('[data-testid=text-editor-formatted-view]')?.textContent.includes(${JSON.stringify(textInsertionFixture.after)})`,
    'long formatted TXT insertion editor',
  )
  const textCaretSetup = await evaluate(send, `(() => {
    const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
    const anchor = ${JSON.stringify(textInsertionFixture.anchor)};
    if (!preview) return null;
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.data.includes(anchor)) node = walker.nextNode();
    if (!node) return null;
    const region = node.parentElement?.closest('[data-notepad-text-region]');
    if (!region) return null;
    region.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(node, node.data.indexOf(anchor) + anchor.length);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const viewport = preview.getBoundingClientRect();
    const caretRect = range.getBoundingClientRect();
    preview.scrollTop += caretRect.top - viewport.top - preview.clientHeight / 2;
    return { scrollTop: preview.scrollTop, caretTop: range.getBoundingClientRect().top };
  })()`)
  check(
    'TXT formatted caret prepared in the middle of the file',
    textCaretSetup?.scrollTop > 20,
    JSON.stringify(textCaretSetup),
  )
  await sleep(80)
  await evaluate(send, `(() => {
    document.querySelector('[data-testid=notepad-table-menu]')?.focus();
    window.getSelection()?.removeAllRanges();
    return true;
  })()`)
  check('TXT table inserted from the remembered formatted caret', await insertNotepadTable(send, 2, 3))
  const textInsertedViewport = await waitFor(
    send,
    `(() => {
      const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
      const tables = Array.from(preview?.querySelectorAll('table') ?? []);
      const table = tables.find((candidate) =>
        Array.from(candidate.querySelectorAll('th, td')).every((cell) => cell.textContent === ''));
      const cell = table?.querySelector('td');
      if (!preview || !table || !cell || tables.length !== 2) return null;
      const viewport = preview.getBoundingClientRect();
      const rect = table.getBoundingClientRect();
      return {
        count: tables.length,
        scrollTop: preview.scrollTop,
        visible: rect.top >= viewport.top && rect.bottom <= viewport.bottom,
        rows: table.rows.length,
        columns: table.rows[0]?.cells.length ?? 0,
      };
    })()`,
    'TXT inserted table viewport anchor',
  )
  check(
    'TXT formatted insertion stays at the selected middle position and remains visible',
    textInsertedViewport.count === 2
      && textInsertedViewport.scrollTop > 20
      && textInsertedViewport.visible
      && textInsertedViewport.rows === 2
      && textInsertedViewport.columns === 3,
    JSON.stringify(textInsertedViewport),
  )
  check('TXT insertion fixture switched back to syntax', await setNotepadView(send, 'syntax'))
  const textInsertionOrder = await waitFor(
    send,
    `(() => {
      const value = document.querySelector('[data-testid=text-editor-input]')?.value;
      if (!value) return null;
      const firstTable = value.indexOf('<table');
      return {
        anchor: value.indexOf(${JSON.stringify(textInsertionFixture.anchor)}),
        table: value.indexOf('<table', firstTable + 1),
        after: value.indexOf(${JSON.stringify(textInsertionFixture.after)}),
      };
    })()`,
    'TXT middle insertion source order',
  )
  check(
    'TXT table source is inserted between the requested adjacent lines',
    textInsertionOrder.anchor < textInsertionOrder.table
      && textInsertionOrder.table < textInsertionOrder.after,
    JSON.stringify(textInsertionOrder),
  )

  const scrollbarTextFixture = notepadScrollbarFixtures[0]
  check('long TXT scrollbar fixture opened', await openFile(send, scrollbarTextFixture.filePath))
  await waitFor(
    send,
    `document.querySelector('[data-testid=text-editor-input]')?.value.includes('TXT scroll line 400')`,
    'long TXT editor',
  )
  const txtScrollbarDrag = await dragNotepadScrollbar(send, '[data-testid=text-editor-input]')
  check(
    'TXT scrollbar receives the pointer and drags without resizing Agent assistant',
    txtScrollbarDrag.before.hitEditor
      && txtScrollbarDrag.before.scrollbarWidth > 0
      && txtScrollbarDrag.before.handleLeft >= txtScrollbarDrag.before.editorRight - 0.5
      && txtScrollbarDrag.after.scrollTop > 20
      && Math.abs(txtScrollbarDrag.after.rightPanelWidth - txtScrollbarDrag.before.rightPanelWidth) < 0.5,
    JSON.stringify(txtScrollbarDrag),
  )

  const scrollbarMarkdownFixture = notepadScrollbarFixtures[1]
  check('long Markdown scrollbar fixture opened', await openFile(send, scrollbarMarkdownFixture.filePath))
  check('long Markdown fixture switched to formatted view', await setNotepadView(send, 'formatted'))
  await waitFor(
    send,
    `(() => {
      const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
      return preview && preview.scrollHeight > preview.clientHeight && preview.textContent.includes('Markdown scroll line 300');
    })()`,
    'long formatted Markdown editor',
  )
  const markdownScrollbarDrag = await dragNotepadScrollbar(send, '[data-testid=text-editor-formatted-view]')
  check(
    'Markdown scrollbar receives the pointer and drags without resizing Agent assistant',
    markdownScrollbarDrag.before.hitEditor
      && markdownScrollbarDrag.before.scrollbarWidth > 0
      && markdownScrollbarDrag.before.handleLeft >= markdownScrollbarDrag.before.editorRight - 0.5
      && markdownScrollbarDrag.after.scrollTop > 20
      && Math.abs(markdownScrollbarDrag.after.rightPanelWidth - markdownScrollbarDrag.before.rightPanelWidth) < 0.5,
    JSON.stringify(markdownScrollbarDrag),
  )

  const rightResizeStart = await evaluate(send, `(() => {
    const handles = Array.from(document.querySelectorAll('[role=separator][aria-orientation=vertical]'));
    const handle = handles[1];
    const panel = document.querySelector('[data-panel=agent-assistant]');
    if (!handle || !panel) return null;
    const rect = handle.getBoundingClientRect();
    return {
      start: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      width: panel.getBoundingClientRect().width,
    };
  })()`)
  await dragPoint(send, rightResizeStart.start, {
    x: rightResizeStart.start.x - 30,
    y: rightResizeStart.start.y,
  })
  const resizedAgentWidth = await waitFor(
    send,
    `(() => {
      const width = document.querySelector('[data-panel=agent-assistant]')?.getBoundingClientRect().width;
      return width > ${rightResizeStart.width + 20} ? width : null;
    })()`,
    'Agent assistant divider drag after scrollbar checks',
  )
  check('Agent assistant divider remains independently draggable', resizedAgentWidth > rightResizeStart.width + 20)

  check('plain text file opened through the application', await openFile(send, textFixture.filePath))
  const textPanelState = await waitFor(
    send,
    `(() => {
      const input = document.querySelector('[data-testid=text-editor-input]');
      const formatted = document.querySelector('[data-testid=text-editor-formatted-view]');
      const panel = document.querySelector('[data-testid=bottom-panel]');
      const rect = panel?.getBoundingClientRect();
      const panelVisible = Boolean(panel && panel.getClientRects().length > 0
        && rect.width > 0.5 && rect.height > 0.5);
      const textLoaded = input?.value.includes('Plain-text panel visibility fixture')
        || formatted?.textContent.includes('Plain-text panel visibility fixture');
      if (panelVisible || !textLoaded) return null;
      return {
        panelHidden: !panelVisible,
        panelMounted: Boolean(panel),
        formatted: Boolean(formatted),
      };
    })()`,
    'plain text editor with hidden bottom panel',
  )
  check('switching between non-code file types keeps the bottom panel hidden',
    textPanelState.panelHidden && textPanelState.panelMounted,
    JSON.stringify(textPanelState))

  check('plain text fixture switched to formatted table editing', await evaluate(send, `(() => {
    const bar = document.querySelector('[data-testid=notepad-commandbar]');
    const key = Object.keys(bar || {}).find((name) => name.startsWith('__reactFiber'));
    let fiber = key ? bar[key] : null;
    while (fiber) {
      if (typeof fiber.memoizedProps?.onMarkdownView === 'function') {
        fiber.memoizedProps.onMarkdownView('formatted');
        return true;
      }
      fiber = fiber.return;
    }
    return false;
  })()`))
  await waitFor(
    send,
    `Boolean(document.querySelector('[data-testid=text-editor-formatted-view] tbody td[contenteditable=true]'))`,
    'editable plain-text table cell',
  )
  const textRowOutsidePoint = await evaluate(send, `(async () => {
    const preview = document.querySelector('[data-testid=text-editor-formatted-view]');
    const row = preview?.querySelector('tbody tr');
    const table = row?.closest('table');
    if (!preview || !row || !table) return null;
    row.scrollIntoView({ block: 'center', inline: 'nearest' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rowRect = row.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    return {
      x: Math.min(previewRect.right - 8, tableRect.right + 18),
      y: rowRect.top + rowRect.height / 2,
      rowsBefore: table.rows.length,
    };
  })()`)
  await clickPoint(send, textRowOutsidePoint)
  await waitFor(
    send,
    `Boolean(document.querySelector('[data-testid=text-editor-formatted-view] tr[data-notepad-row-insert-after=true]'))`,
    'plain-text table outside insertion caret',
  )
  await pressKey(send, { key: 'Enter', code: 'Enter', keyCode: 13 })
  const insertedTextRow = await waitFor(
    send,
    `(() => {
      const table = document.querySelector('[data-testid=text-editor-formatted-view] table');
      const selected = table?.querySelector('tr[data-notepad-row-insert-after=true]');
      if (!table || !selected || table.rows.length !== ${textRowOutsidePoint.rowsBefore + 1}) return null;
      return { rows: table.rows.length, cells: selected.cells.length };
    })()`,
    'new plain-text table row from outside Enter',
  )
  check(
    'TXT row outside edge Enter creates a same-width row',
    insertedTextRow.cells === 2,
    JSON.stringify(insertedTextRow),
  )
  check('formatted TXT row insertion requested a save', await evaluate(
    send,
    `window.api.appMenu.perform('save').then(() => true)`,
  ))
  const savedText = await waitForFileText(
    textFixture.filePath,
    (value) => value.includes('<tr><td><br></td><td><br></td></tr>'),
  )
  check(
    'saved TXT preserves the row created from the table outside edge',
    savedText.includes('<tr><td>Text A</td><td>Text B</td></tr>')
      && savedText.includes('<tr><td><br></td><td><br></td></tr>')
      && savedText.includes('Plain-text tail.'),
    JSON.stringify({ savedText }),
  )

  const typeScriptFixture = fixtures[fixtures.length - 1]
  check('TypeScript file reopened through the application', await openFile(send, typeScriptFixture.filePath))
  const restoredPanel = await waitFor(
    send,
    `(() => {
      const editor = document.querySelector('[data-testid=code-editor-root]');
      const panel = document.querySelector('[data-testid=bottom-panel]');
      if (!editor?.textContent.includes('TypeScript') || !panel?.textContent.includes('Hello Monaco')) return null;
      return panel.textContent;
    })()`,
    'restored code bottom panel',
  )
  check('switching back to program code restores the open bottom panel and output',
    restoredPanel.includes('Hello Monaco'))

  const measureFixedScrollbar = async (fixture) => {
    check(`${fixture.lines}-line scrollbar fixture opened`, await openFile(send, fixture.filePath))
    return waitFor(
      send,
      `(() => {
        const thumb = document.querySelector('[data-testid=code-fixed-scrollbar-thumb]');
        const track = document.querySelector('[data-testid=code-fixed-scrollbar]');
        const view = document.querySelector('.monaco-editor .view-lines');
        if (!thumb || !track || track.hidden || !view?.textContent.includes('value_1')) return null;
        const thumbRect = thumb.getBoundingClientRect();
        const trackRect = track.getBoundingClientRect();
        return {
          thumbHeight: thumbRect.height,
          thumbTop: thumbRect.top,
          thumbBottom: thumbRect.bottom,
          trackTop: trackRect.top,
          trackBottom: trackRect.bottom,
          nativeThumbOpacity: [...document.querySelectorAll('.monaco-editor .scrollbar.vertical > .slider')]
            .map((element) => getComputedStyle(element).opacity),
        };
      })()`,
      `${fixture.lines}-line fixed scrollbar`,
    )
  }

  const mediumScrollbar = await measureFixedScrollbar(scrollbarFixtures[0])
  const longScrollbar = await measureFixedScrollbar(scrollbarFixtures[1])
  check('different code lengths use the same vertical scrollbar thumb height',
    Math.abs(mediumScrollbar.thumbHeight - 48) < 0.2
      && Math.abs(longScrollbar.thumbHeight - 48) < 0.2
      && Math.abs(mediumScrollbar.thumbHeight - longScrollbar.thumbHeight) < 0.05,
    JSON.stringify({ mediumScrollbar, longScrollbar }))
  check('the Monaco variable-height thumb is hidden behind the fixed scrollbar',
    mediumScrollbar.nativeThumbOpacity.every((opacity) => Number(opacity) === 0)
      && longScrollbar.nativeThumbOpacity.every((opacity) => Number(opacity) === 0),
    JSON.stringify({ medium: mediumScrollbar.nativeThumbOpacity, long: longScrollbar.nativeThumbOpacity }))

  const scrollbarBottomPoint = await evaluate(send, `(() => {
    const track = document.querySelector('[data-testid=code-fixed-scrollbar]');
    const rect = track.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.bottom - 2 };
  })()`)
  await clickPoint(send, scrollbarBottomPoint)
  const scrollbarAtBottom = await waitFor(
    send,
    `(() => {
      const thumb = document.querySelector('[data-testid=code-fixed-scrollbar-thumb]');
      const track = document.querySelector('[data-testid=code-fixed-scrollbar]');
      const lastLineVisible = document.querySelector('.monaco-editor .view-lines')?.textContent.includes('value_800');
      if (!thumb || !track || !lastLineVisible) return null;
      return {
        bottomGap: track.getBoundingClientRect().bottom - thumb.getBoundingClientRect().bottom,
        thumbHeight: thumb.getBoundingClientRect().height,
      };
    })()`,
    'fixed scrollbar at the bottom',
  )
  check('clicking the fixed scrollbar reaches the last code line without changing its height',
    Math.abs(scrollbarAtBottom.bottomGap) < 0.2 && Math.abs(scrollbarAtBottom.thumbHeight - 48) < 0.2,
    JSON.stringify(scrollbarAtBottom))

  check('TypeScript file reopened after fixed scrollbar checks', await openFile(send, typeScriptFixture.filePath))
  await waitFor(
    send,
    `document.querySelector('.monaco-editor .view-lines')?.textContent.includes('Hello')`,
    'TypeScript editor after fixed scrollbar checks',
  )

  const fontMeasure = `(() => {
    const viewLine = document.querySelector('.monaco-editor .view-line');
    const editor = document.querySelector('.monaco-editor');
    const minimap = document.querySelector('.monaco-editor .minimap');
    const host = document.querySelector('[data-testid=monaco-editor-host]').getBoundingClientRect();
    const editorRect = editor?.getBoundingClientRect();
    const minimapRect = minimap?.getBoundingClientRect();
    const editorScale = editor?.offsetWidth ? editorRect.width / editor.offsetWidth : 0;
    const minimapScale = minimap?.offsetWidth ? minimapRect.width / minimap.offsetWidth : 0;
    const computedFontSize = viewLine ? parseFloat(getComputedStyle(viewLine).fontSize) : 0;
    return {
      fontSize: computedFontSize * editorScale,
      lineHeight: viewLine ? viewLine.getBoundingClientRect().height : 0,
      editorScale,
      minimapScale,
      minimapWidth: minimapRect?.width ?? 0,
      hostWidth: host.width,
      innerWidth,
    };
  })()`
  await evaluate(send, "document.querySelector('.monaco-editor textarea')?.focus(); true")
  const fontBefore = await evaluate(send, fontMeasure)
  check('code editor ignores a stored old size and starts at the 14px default',
    Math.abs(fontBefore.fontSize - 14) < 0.05, JSON.stringify(fontBefore))
  check('legacy code font size persistence is cleared',
    await evaluate(send, "localStorage.getItem('wps-code-editor-font-size')") === null)

  await pressKey(send, { key: '+', code: 'Equal', keyCode: 187, modifiers: 2 })
  await sleep(300)
  const fontPlus = await evaluate(send, fontMeasure)
  check('Ctrl+Plus grows the complete code view',
    Math.abs(fontPlus.fontSize - 15) < 0.1 && fontPlus.editorScale > fontBefore.editorScale,
    JSON.stringify({ before: fontBefore, after: fontPlus }))
  check('Ctrl+Plus grows the minimap with the code',
    fontPlus.minimapScale > fontBefore.minimapScale
      && Math.abs(fontPlus.minimapScale - fontPlus.editorScale) < 0.02,
    JSON.stringify({ before: fontBefore, after: fontPlus }))

  await pressKey(send, { key: '0', code: 'Digit0', keyCode: 48, modifiers: 2 })
  await sleep(300)
  const fontReset = await evaluate(send, fontMeasure)
  check('Ctrl+0 restores the default code zoom',
    Math.abs(fontReset.fontSize - 14) < 0.05 && Math.abs(fontReset.editorScale - 1) < 0.02,
    JSON.stringify(fontReset))

  await pressKey(send, { key: '-', code: 'Minus', keyCode: 189, modifiers: 2 })
  await sleep(300)
  const fontMinus = await evaluate(send, fontMeasure)
  check('Ctrl+Minus shrinks the complete code view',
    Math.abs(fontMinus.fontSize - 13) < 0.1 && fontMinus.editorScale < fontBefore.editorScale,
    JSON.stringify({ before: fontBefore, after: fontMinus }))
  check('Ctrl+Minus shrinks the minimap with the code',
    fontMinus.minimapScale < fontBefore.minimapScale
      && Math.abs(fontMinus.minimapScale - fontMinus.editorScale) < 0.02,
    JSON.stringify({ before: fontBefore, after: fontMinus }))
  check('code font zoom does not resize the window',
    fontMinus.innerWidth === fontBefore.innerWidth
      && Math.abs(fontMinus.hostWidth - fontBefore.hostWidth) < 0.02,
    JSON.stringify({ before: fontBefore, after: fontMinus }))
  check('code font line height scales with the font',
    Math.abs(fontMinus.lineHeight - fontMinus.fontSize * (22 / 14)) < 1.5,
    `fontSize=${fontMinus.fontSize} lineHeight=${fontMinus.lineHeight}`)

  await pressKey(send, { key: '0', code: 'Digit0', keyCode: 48, modifiers: 2 })
  await sleep(300)

  const dispatchWheel = (deltaY) => evaluate(send, `(() => {
    const host = document.querySelector('[data-testid=monaco-editor-host]');
    host.dispatchEvent(new WheelEvent('wheel', {
      deltaX: 0, deltaY: ${deltaY}, ctrlKey: true, bubbles: true, cancelable: true,
    }));
    return true;
  })()`)
  await dispatchWheel(-100)
  await sleep(300)
  const fontWheelUp = await evaluate(send, fontMeasure)
  check('Ctrl+wheel up grows the code view and minimap',
    Math.abs(fontWheelUp.fontSize - 15) < 0.1
      && fontWheelUp.minimapScale > fontBefore.minimapScale,
    JSON.stringify({ before: fontBefore, after: fontWheelUp }))

  await dispatchWheel(100)
  await sleep(300)
  const fontWheelDown = await evaluate(send, fontMeasure)
  check('Ctrl+wheel down returns the code view and minimap to default',
    Math.abs(fontWheelDown.fontSize - 14) < 0.05
      && Math.abs(fontWheelDown.minimapScale - 1) < 0.02,
    JSON.stringify({ before: fontWheelUp, after: fontWheelDown }))

  await pressKey(send, { key: '+', code: 'Equal', keyCode: 187, modifiers: 2 })
  await sleep(200)
  check('switching to another code file resets the zoom', await openFile(send, fixtures[0].filePath))
  await waitFor(
    send,
    `document.querySelector('[data-testid=code-editor-root]')?.textContent.includes('C')
      && document.querySelector('.monaco-editor .view-lines')?.textContent.includes('include')`,
    'default zoom after switching code files',
  )
  const fontAfterFileSwitch = await evaluate(send, fontMeasure)
  check('newly opened code uses the 14px default size',
    Math.abs(fontAfterFileSwitch.fontSize - 14) < 0.05
      && Math.abs(fontAfterFileSwitch.editorScale - 1) < 0.02,
    JSON.stringify(fontAfterFileSwitch))

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

