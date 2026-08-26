import { createRequire } from 'node:module'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronPath = require('electron')
const rendererEntry = path.join(root, 'out', 'renderer', 'index.html')
const artifactDir = path.join(root, '.cache')
const screenshotPath = path.join(artifactDir, 'electron-verify-text.png')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close((error) => {
        if (error) reject(error)
        else if (port) resolve(port)
        else reject(new Error('Could not allocate a CDP port'))
      })
    })
  })
}

async function waitForRenderer(port, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find(
        (target) =>
          target.type === 'page' &&
          (String(target.url).includes('out/renderer') ||
            String(target.url).includes('index.html')),
      )
      if (page?.webSocketDebuggerUrl) return page
    } catch (error) {
      lastError = error
    }
    await sleep(200)
  }

  throw new Error(`Renderer CDP target did not appear: ${String(lastError ?? 'timeout')}`)
}

function connectCdp(wsUrl, onEvent) {
  if (!globalThis.WebSocket) {
    throw new Error('This verifier requires Node 22+ (global WebSocket support)')
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1
    let opened = false

    const send = (method, params = {}) =>
      new Promise((resolveCall, rejectCall) => {
        if (ws.readyState !== WebSocket.OPEN) {
          rejectCall(new Error(`CDP socket is not open for ${method}`))
          return
        }

        const id = nextId++
        const timer = setTimeout(() => {
          pending.delete(id)
          rejectCall(new Error(`CDP command timed out: ${method}`))
        }, 20_000)

        pending.set(id, {
          resolve: (message) => {
            clearTimeout(timer)
            if (message.error) {
              rejectCall(new Error(`${method}: ${message.error.message}`))
            } else {
              resolveCall(message)
            }
          },
        })
        ws.send(JSON.stringify({ id, method, params }))
      })

    ws.addEventListener('open', () => {
      opened = true
      resolve({ send, close: () => ws.close() })
    })

    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id)
        pending.delete(message.id)
        entry.resolve(message)
      } else if (message.method) {
        onEvent(message)
      }
    })

    ws.addEventListener('error', (event) => {
      if (!opened) reject(new Error(`CDP WebSocket error: ${String(event.message ?? event)}`))
    })

    ws.addEventListener('close', () => {
      for (const entry of pending.values()) {
        entry.resolve({ error: { message: 'CDP socket closed' } })
      }
      pending.clear()
    })
  })
}

function describeException(exceptionDetails) {
  return (
    exceptionDetails?.exception?.description ||
    exceptionDetails?.text ||
    JSON.stringify(exceptionDetails)
  )
}

async function evaluate(send, expression) {
  const message = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (message.result.exceptionDetails) {
    throw new Error(describeException(message.result.exceptionDetails))
  }
  return message.result.result?.value
}

async function waitFor(send, expression, label, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs
  let lastValue
  while (Date.now() < deadline) {
    lastValue = await evaluate(send, expression)
    if (lastValue) return lastValue
    await sleep(120)
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`)
}

function utf8Bom(text) {
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])
}

async function waitForFileBytes(filePath, expected, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs
  let actual = Buffer.alloc(0)
  while (Date.now() < deadline) {
    actual = fs.readFileSync(filePath)
    if (actual.equals(expected)) return actual
    await sleep(100)
  }
  return actual
}

const results = []
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail })
  const marker = pass ? 'PASS' : 'FAIL'
  console.log(`[${marker}] ${name}${detail ? `: ${detail}` : ''}`)
}

if (!fs.existsSync(rendererEntry)) {
  console.error('Built renderer is missing. Run `npm run build` before this verifier.')
  process.exit(1)
}

const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-text-editor-verify-profile-'))
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-text-editor-verify-'))
const fixturePath = path.join(fixtureDir, 'notepad-verification.txt')
const siblingPath = path.join(fixtureDir, 'must-not-change.txt')
const initialText = 'alpha beta alpha\r\nsecond line\r\n中文 café\r\nfinal alpha'
const initialBytes = utf8Bom(initialText)
const siblingBytes = Buffer.from('SENTINEL: this sibling file must remain byte-for-byte unchanged.\n')
fs.writeFileSync(fixturePath, initialBytes)
fs.writeFileSync(siblingPath, siblingBytes)

const rendererExceptions = []
const rendererConsoleErrors = []
let child = null
let cdp = null

try {
  const port = await getFreePort()
  let bridgePort = await getFreePort()
  while (bridgePort === port) bridgePort = await getFreePort()
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
        WPS_ALLOW_MULTI_INSTANCE: '1',
        WPS_BRIDGE_PORT: String(bridgePort),
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )

  child.stdout.on('data', (chunk) => process.stdout.write(`[electron] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[electron] ${chunk}`))

  const page = await waitForRenderer(port)
  cdp = await connectCdp(page.webSocketDebuggerUrl, (message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      rendererExceptions.push(describeException(message.params.exceptionDetails))
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      rendererConsoleErrors.push(
        (message.params.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? '')
          .join(' '),
      )
    }
  })
  const { send } = cdp
  await send('Runtime.enable')
  await send('Console.enable')
  await send('Page.enable')

  await waitFor(
    send,
    `document.getElementById('root')?.childElementCount > 0`,
    'the React application to render',
  )

  const openResult = await evaluate(
    send,
    `(async () => {
      const filePath = ${JSON.stringify(fixturePath)};
      await window.api.file.open(filePath);

      // The production app currently exposes no test-only store API. Reuse the same
      // FileManager callback that a real file-tree click invokes.
      const root = document.getElementById('root');
      const rootKeys = root ? Object.keys(root) : [];
      const key = rootKeys.find(
        (name) => name.startsWith('__reactContainer') || name.startsWith('__reactFiber'),
      );
       const container = key ? root[key] : null;
       const queue = container ? [
         container.current,
         container.stateNode?.current,
         container._internalRoot?.current,
         container,
       ].filter(Boolean) : [];
      const seen = new Set();
      while (queue.length) {
        const fiber = queue.shift();
        if (!fiber || seen.has(fiber)) continue;
        seen.add(fiber);
        const props = fiber.memoizedProps;
        if (props && typeof props.onOpenFile === 'function') {
          await props.onOpenFile(filePath);
          return { opened: true };
        }
        if (fiber.child) queue.push(fiber.child);
        if (fiber.sibling) queue.push(fiber.sibling);
      }
      return {
        opened: false,
        reason: 'FileManager onOpenFile callback not found',
        reactKey: key || null,
        visited: seen.size,
        rootKeys,
      };
    })()`,
  )
  check(
    'fixture opened through the production FileManager path',
    openResult?.opened,
    openResult?.opened ? '' : JSON.stringify(openResult),
  )

  await waitFor(
    send,
    `(() => Boolean(
      document.querySelector('[data-testid="text-editor-input"]') ||
      document.querySelector('[data-testid="notepad-editor"] textarea') ||
      document.querySelector('textarea[aria-label="文本编辑器"]') ||
      document.querySelector('textarea[aria-label="Text editor"]')
    ))()`,
    'the text editor textarea',
  )

  const layout = await evaluate(
    send,
    `(() => {
      const editor =
        document.querySelector('[data-testid="text-editor-input"]') ||
        document.querySelector('[data-testid="notepad-editor"] textarea') ||
        document.querySelector('textarea[aria-label="文本编辑器"]') ||
        document.querySelector('textarea[aria-label="Text editor"]');
      const root =
        document.querySelector('[data-testid="text-editor"]') ||
        document.querySelector('[data-testid="notepad-editor"]') ||
        editor?.closest('[data-text-editor]') ||
        editor?.parentElement;
      const all = [...(root?.querySelectorAll('*') ?? [])];
      const fileMenu = root?.querySelector('[data-testid="notepad-menu-file"]');
      const editMenu = root?.querySelector('[data-testid="notepad-menu-edit"]');
      const viewMenu = root?.querySelector('[data-testid="notepad-menu-view"]');
      const menuBar =
        root?.querySelector('[data-testid="text-editor-menubar"], [role="menubar"]') ||
        fileMenu?.parentElement;
      const status =
        root?.querySelector('[data-testid="text-editor-statusbar"], [data-notepad-statusbar]') ||
        all.find((element) =>
          /(?:Ln|行)\s*\d+/i.test(element.textContent || '') &&
          /(?:Col|列)\s*\d+/i.test(element.textContent || '') &&
          /UTF-/i.test(element.textContent || ''),
        );
      const rect = (element) => {
        if (!element) return null;
        const value = element.getBoundingClientRect();
        return { top: value.top, right: value.right, bottom: value.bottom, left: value.left,
          width: value.width, height: value.height };
      };
      return {
        fileNameVisible: (root?.innerText || '').includes(${JSON.stringify(path.basename(fixturePath))}),
        menus: { file: Boolean(fileMenu), edit: Boolean(editMenu), view: Boolean(viewMenu) },
        hasStatus: Boolean(status),
        statusText: status?.textContent?.trim() || '',
        editorValue: editor?.value,
        editorRect: rect(editor),
        menuRect: rect(menuBar),
        statusRect: rect(status),
        rootRect: rect(root),
      };
    })()`,
  )

  check('Notepad chrome shows the current file name', layout.fileNameVisible)
  check(
    'Notepad menu row exposes File, Edit, and View',
    layout.menus.file && layout.menus.edit && layout.menus.view,
    JSON.stringify(layout.menus),
  )
  check('status bar is present', layout.hasStatus, layout.statusText)
  check(
    'UTF-8 BOM fixture decoded without a visible BOM',
    layout.editorValue === initialText.replace(/\r\n/g, '\n'),
    JSON.stringify(layout.editorValue),
  )
  check(
    'menu, editor, and status bar are vertically ordered without overlap',
    Boolean(
      layout.menuRect &&
        layout.editorRect &&
        layout.statusRect &&
        layout.menuRect.bottom <= layout.editorRect.top + 1 &&
        layout.editorRect.bottom <= layout.statusRect.top + 1,
    ),
    JSON.stringify({ menu: layout.menuRect, editor: layout.editorRect, status: layout.statusRect }),
  )
  check(
    'editor occupies a usable center surface',
    Boolean(layout.editorRect && layout.editorRect.width >= 300 && layout.editorRect.height >= 160),
    JSON.stringify(layout.editorRect),
  )

  const formattingChrome = await evaluate(
    send,
    `(async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const press = (element) => {
        const init = {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerType: 'mouse',
        };
        element?.dispatchEvent(new PointerEvent('pointerdown', init));
        element?.dispatchEvent(new PointerEvent('pointerup', init));
      };
      const leave = (element) => element?.dispatchEvent(new PointerEvent('pointerout', {
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
        relatedTarget: document.body,
      }));
      const move = (element) => element?.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerType: 'mouse',
      }));
      const menuTexts = () => [...document.querySelectorAll('[role="menuitem"]')]
        .map((element) => (element.textContent || '').trim());

      const heading = document.querySelector('[data-testid="notepad-heading-menu"]');
      press(heading);
      await delay(100);
      const headingItems = menuTexts();
      press(heading);
      await delay(100);

      const list = document.querySelector('[data-testid="notepad-list-menu"]');
      press(list);
      await delay(100);
      const listItems = menuTexts();
      press(list);
      await delay(100);

      const commandbar = document.querySelector('[data-testid="notepad-commandbar"]');
      const toolbar = commandbar?.querySelector('[role="toolbar"]');
      const centerOffset = () => {
        const commandRect = commandbar?.getBoundingClientRect();
        const toolbarRect = toolbar?.getBoundingClientRect();
        if (!commandRect || !toolbarRect) return null;
        return Math.abs(
          (commandRect.left + commandRect.right) / 2 -
          (toolbarRect.left + toolbarRect.right) / 2
        );
      };
      const wideOffset = centerOffset();
      const oldStyle = commandbar?.getAttribute('style');
      if (commandbar) commandbar.style.width = '680px';
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const narrowOffset = centerOffset();
      if (commandbar) {
        if (oldStyle === null) commandbar.removeAttribute('style');
        else commandbar.setAttribute('style', oldStyle);
      }

      move(heading);
      await delay(200);
      const visibleTooltip = () => document.querySelector(
        '[data-radix-popper-content-wrapper] > [data-side][data-state]',
      );
      const earlyTooltipVisible = Boolean(visibleTooltip());
      await delay(350);
      const tooltip = visibleTooltip();
      const tooltipStyle = tooltip ? getComputedStyle(tooltip) : null;
      const headingTooltip = {
        earlyTooltipVisible,
        visible: Boolean(tooltip),
        text: [...(tooltip?.childNodes || [])]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent || '')
          .join('')
          .trim(),
        label: heading?.getAttribute('aria-label') || '',
        background: tooltipStyle?.backgroundColor || '',
        borderRadius: tooltipStyle?.borderRadius || '',
        borderWidth: tooltipStyle?.borderWidth || '',
        boxShadow: tooltipStyle?.boxShadow || '',
      };
      leave(heading);

      return { headingItems, listItems, wideOffset, narrowOffset, headingTooltip };
    })()`,
  )
  check(
    'clicking Heading opens its formatting menu',
    formattingChrome.headingItems.some((text) => /^(正文|Paragraph)$/.test(text)) &&
      formattingChrome.headingItems.some((text) => /^(标题 1|Heading 1)$/.test(text)),
    JSON.stringify(formattingChrome.headingItems),
  )
  check(
    'clicking List opens its formatting menu',
    formattingChrome.listItems.some((text) => /^(项目符号列表|Bulleted list)$/.test(text)) &&
      formattingChrome.listItems.some((text) => /^(编号列表|Numbered list)$/.test(text)),
    JSON.stringify(formattingChrome.listItems),
  )
  check(
    'formatting toolbar remains centered as the command bar resizes',
    formattingChrome.wideOffset <= 1 && formattingChrome.narrowOffset <= 1,
    JSON.stringify({ wide: formattingChrome.wideOffset, narrow: formattingChrome.narrowOffset }),
  )
  check(
    'Notepad toolbar tooltip waits for the short hover delay',
    !formattingChrome.headingTooltip.earlyTooltipVisible && formattingChrome.headingTooltip.visible,
    JSON.stringify(formattingChrome.headingTooltip),
  )
  check(
    'Heading dropdown exposes its meaning in the toolbar tooltip',
    formattingChrome.headingTooltip.text === formattingChrome.headingTooltip.label,
    JSON.stringify(formattingChrome.headingTooltip),
  )
  check(
    'Notepad toolbar tooltip matches the Excel gray surface and outline',
      formattingChrome.headingTooltip.background === 'rgb(102, 102, 102)' &&
      formattingChrome.headingTooltip.borderRadius === '2px' &&
      formattingChrome.headingTooltip.borderWidth === '0px' &&
      (formattingChrome.headingTooltip.boxShadow === 'none' ||
        formattingChrome.headingTooltip.boxShadow.startsWith('rgba(0, 0, 0, 0)')),
    JSON.stringify(formattingChrome.headingTooltip),
  )

  const findFlow = await evaluate(
    send,
    `(async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const editor =
        document.querySelector('[data-testid="text-editor-input"]') ||
        document.querySelector('[data-testid="notepad-editor"] textarea') ||
        document.querySelector('textarea[aria-label="文本编辑器"]') ||
        document.querySelector('textarea[aria-label="Text editor"]');
      const shortcut = (key, code, extra = {}) => {
        const target = document.activeElement || editor || document.body;
        const init = { key, code, bubbles: true, cancelable: true, ...extra };
        target.dispatchEvent(new KeyboardEvent('keydown', init));
        target.dispatchEvent(new KeyboardEvent('keyup', init));
      };
      const setInput = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const findInput = () =>
        document.querySelector('[data-testid="text-find-input"]') ||
        document.querySelector('input[aria-label*="查找"], input[aria-label*="Find" i]') ||
        document.querySelector('input[placeholder*="查找"], input[placeholder*="Find" i]');

      editor.focus();
      editor.setSelectionRange(0, 0);
      shortcut('f', 'KeyF', { ctrlKey: true });
      await delay(100);
      const input = findInput();
      if (!input) return { opened: false };
      const focusedWhenOpened = document.activeElement === input;
      setInput(input, 'alpha');
      await delay(100);
      shortcut('Enter', 'Enter');
      await delay(80);
      const first = {
        start: editor.selectionStart,
        end: editor.selectionEnd,
        text: editor.value.slice(editor.selectionStart, editor.selectionEnd),
      };
      shortcut('Enter', 'Enter');
      await delay(80);
      const next = {
        start: editor.selectionStart,
        end: editor.selectionEnd,
        text: editor.value.slice(editor.selectionStart, editor.selectionEnd),
      };
      shortcut('Enter', 'Enter', { shiftKey: true });
      await delay(80);
      const previous = {
        start: editor.selectionStart,
        end: editor.selectionEnd,
        text: editor.value.slice(editor.selectionStart, editor.selectionEnd),
      };
      shortcut('Escape', 'Escape');
      await delay(100);
      return {
        opened: true,
        focused: focusedWhenOpened,
        first,
        next,
        previous,
        closed: !findInput(),
      };
    })()`,
  )

  check('Ctrl+F opens and focuses Find', findFlow.opened && findFlow.focused)
  check('Enter finds the requested text', findFlow.first?.text === 'alpha', JSON.stringify(findFlow.first))
  check(
    'Enter advances to a different match',
    findFlow.next?.text === 'alpha' && findFlow.next?.start !== findFlow.first?.start,
    JSON.stringify(findFlow.next),
  )
  check(
    'Shift+Enter navigates to the previous match',
    findFlow.previous?.text === 'alpha' && findFlow.previous?.start === findFlow.first?.start,
    JSON.stringify(findFlow.previous),
  )
  check('Escape closes Find', findFlow.closed)

  const replaceFlow = await evaluate(
    send,
    `(async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const editor =
        document.querySelector('[data-testid="text-editor-input"]') ||
        document.querySelector('[data-testid="notepad-editor"] textarea') ||
        document.querySelector('textarea[aria-label="文本编辑器"]') ||
        document.querySelector('textarea[aria-label="Text editor"]');
      const shortcut = (key, code, extra = {}) => {
        const target = document.activeElement || editor || document.body;
        const init = { key, code, bubbles: true, cancelable: true, ...extra };
        target.dispatchEvent(new KeyboardEvent('keydown', init));
        target.dispatchEvent(new KeyboardEvent('keyup', init));
      };
      const setInput = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      editor.focus();
      shortcut('h', 'KeyH', { ctrlKey: true });
      await delay(120);
      const findInput =
        document.querySelector('[data-testid="text-find-input"]') ||
        document.querySelector('input[aria-label*="查找"], input[aria-label*="Find" i]') ||
        document.querySelector('input[placeholder*="查找"], input[placeholder*="Find" i]');
      const replaceInput =
        document.querySelector('[data-testid="text-replace-input"]') ||
        document.querySelector('input[aria-label*="替换"], input[aria-label*="Replace" i]') ||
        document.querySelector('input[placeholder*="替换"], input[placeholder*="Replace" i]');
      if (!findInput || !replaceInput) {
        return { opened: false, find: Boolean(findInput), replace: Boolean(replaceInput) };
      }
      setInput(findInput, 'alpha');
      setInput(replaceInput, 'omega');
      await delay(100);
      const replaceAll = [...document.querySelectorAll('button, [role="button"], [role="menuitem"]')]
        .find((element) => /^(全部替换|Replace all)$/i.test(
          (element.getAttribute('aria-label') || element.textContent || '').trim(),
        ));
      replaceAll?.click();
      await delay(120);
      shortcut('Escape', 'Escape');
      return {
        opened: true,
        hasReplaceAll: Boolean(replaceAll),
        value: editor.value,
        alphaCount: (editor.value.match(/alpha/g) || []).length,
        omegaCount: (editor.value.match(/omega/g) || []).length,
      };
    })()`,
  )

  check('Ctrl+H opens Find and Replace', replaceFlow.opened, JSON.stringify(replaceFlow))
  check('Replace all command is exposed', replaceFlow.hasReplaceAll)
  check(
    'Replace all updates every match in the editor',
    replaceFlow.alphaCount === 0 && replaceFlow.omegaCount === 3,
    JSON.stringify({ alpha: replaceFlow.alphaCount, omega: replaceFlow.omegaCount }),
  )
  check(
    'find/replace remains in memory until Save',
    fs.readFileSync(fixturePath).equals(initialBytes),
  )

  const wrapFlow = await evaluate(
    send,
    `(async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const editor =
        document.querySelector('[data-testid="text-editor-input"]') ||
        document.querySelector('[data-testid="notepad-editor"] textarea') ||
        document.querySelector('textarea[aria-label="文本编辑器"]') ||
        document.querySelector('textarea[aria-label="Text editor"]');
      const state = () => ({
        wrap: editor.getAttribute('wrap'),
        whiteSpace: getComputedStyle(editor).whiteSpace,
        overflowX: getComputedStyle(editor).overflowX,
      });
      const before = state();
      const view = document.querySelector('[data-testid="notepad-menu-view"]');
      view?.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerType: 'mouse',
      }));
      await delay(100);
      const wrapItem = document.querySelector('[data-testid="notepad-word-wrap-menu-item"]');
      wrapItem?.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerType: 'mouse',
      }));
      wrapItem?.click();
      await delay(100);
      return {
        hasView: Boolean(view),
        hasWrapItem: Boolean(wrapItem),
        menuItems: [...document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')]
          .map((element) => (element.textContent || '').trim()),
        before,
        after: state(),
      };
    })()`,
  )

  check('View menu exposes Word wrap', wrapFlow.hasView && wrapFlow.hasWrapItem, JSON.stringify(wrapFlow))
  check(
    'Word wrap changes the editing surface behavior',
    JSON.stringify(wrapFlow.before) !== JSON.stringify(wrapFlow.after),
    JSON.stringify({ before: wrapFlow.before, after: wrapFlow.after }),
  )

  const zoomFlow = await evaluate(
    send,
    `(async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const editor =
        document.querySelector('[data-testid="text-editor-input"]') ||
        document.querySelector('[data-testid="notepad-editor"] textarea') ||
        document.querySelector('textarea[aria-label="文本编辑器"]') ||
        document.querySelector('textarea[aria-label="Text editor"]');
      const shortcut = (key, code, extra = {}) => {
        const target = document.activeElement || editor || document.body;
        const init = { key, code, bubbles: true, cancelable: true, ...extra };
        target.dispatchEvent(new KeyboardEvent('keydown', init));
        target.dispatchEvent(new KeyboardEvent('keyup', init));
      };
      const snapshot = () => ({
        documentZoom: document.querySelector('.document-zoom-root')?.getAttribute('data-document-zoom'),
        editorZoom: document.querySelector('[data-testid="text-editor"]')?.getAttribute('data-zoom'),
        bodyText: document.body.innerText,
      });
      editor.focus();
      shortcut('0', 'Digit0', { ctrlKey: true });
      await delay(80);
      const reset = snapshot();
      shortcut('+', 'Equal', { ctrlKey: true, shiftKey: true });
      await delay(100);
      const increased = snapshot();
      shortcut('0', 'Digit0', { ctrlKey: true });
      await delay(80);
      const final = snapshot();
      return { reset, increased, final };
    })()`,
  )
  const resetZoom = Number(zoomFlow.reset.editorZoom ?? zoomFlow.reset.documentZoom)
  const increasedZoom = Number(zoomFlow.increased.editorZoom ?? zoomFlow.increased.documentZoom)
  const finalZoom = Number(zoomFlow.final.editorZoom ?? zoomFlow.final.documentZoom)
  check('Ctrl+Plus increases text-document zoom', increasedZoom > resetZoom, `${resetZoom} -> ${increasedZoom}`)
  check('zoom feedback/status shows 110%', /110\s*%/.test(zoomFlow.increased.bodyText))
  check('Ctrl+0 resets text-document zoom', finalZoom === 1, String(finalZoom))

  const statusFlow = await evaluate(
    send,
    `(async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const editor =
        document.querySelector('[data-testid="text-editor-input"]') ||
        document.querySelector('[data-testid="notepad-editor"] textarea') ||
        document.querySelector('textarea[aria-label="文本编辑器"]') ||
        document.querySelector('textarea[aria-label="Text editor"]');
       const secondLineColumn3 = editor.value.indexOf('\\n') + 3;
      editor.focus();
      editor.setSelectionRange(secondLineColumn3, secondLineColumn3);
      editor.dispatchEvent(new Event('select', { bubbles: true }));
      editor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await delay(100);
      const root =
        document.querySelector('[data-testid="text-editor"]') ||
        document.querySelector('[data-testid="notepad-editor"]') ||
        editor.parentElement;
      const all = [...(root?.querySelectorAll('*') ?? [])];
      const status =
        root?.querySelector('[data-testid="text-editor-statusbar"], [data-notepad-statusbar]') ||
        all.find((element) =>
          /(?:Ln|行)\s*\d+/i.test(element.textContent || '') &&
          /(?:Col|列)\s*\d+/i.test(element.textContent || '') &&
          /UTF-/i.test(element.textContent || ''),
        );
      return { text: status?.textContent?.replace(/\s+/g, ' ').trim() || '' };
    })()`,
  )
  check(
    'status bar tracks line 2, column 3',
    /(?:Ln\s*2[^\d]+Col\s*3|行\s*2[^\d]+列\s*3|第\s*2\s*行[^\d]+第?\s*3\s*列)/i.test(
      statusFlow.text,
    ),
    statusFlow.text,
  )
  check('status bar reports encoding', /UTF-8/i.test(statusFlow.text), statusFlow.text)
  check('status bar reports zoom', /100\s*%/.test(statusFlow.text), statusFlow.text)

  const finalText = 'Saved safely\r\nSecond line\r\n中文 café'
  const finalBytes = utf8Bom(finalText)
  const saveFlow = await evaluate(
    send,
    `(async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const editor =
        document.querySelector('[data-testid="text-editor-input"]') ||
        document.querySelector('[data-testid="notepad-editor"] textarea') ||
        document.querySelector('textarea[aria-label="文本编辑器"]') ||
        document.querySelector('textarea[aria-label="Text editor"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(editor, ${JSON.stringify(finalText)});
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      await delay(80);
      editor.focus();
      const init = { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true };
      editor.dispatchEvent(new KeyboardEvent('keydown', init));
      editor.dispatchEvent(new KeyboardEvent('keyup', init));
      await delay(120);
      return { value: editor.value };
    })()`,
  )
  const savedBytes = await waitForFileBytes(fixturePath, finalBytes)
  check(
    'controlled editor accepted the final save fixture',
    saveFlow.value === finalText.replace(/\r\n/g, '\n'),
    JSON.stringify(saveFlow.value),
  )
  check(
    'Ctrl+S writes the exact UTF-8 BOM + CRLF bytes to the selected file',
    savedBytes.equals(finalBytes),
    `expected ${finalBytes.length} bytes, received ${savedBytes.length}`,
  )
  check(
    'saving the text document leaves a sibling file untouched',
    fs.readFileSync(siblingPath).equals(siblingBytes),
  )

  fs.mkdirSync(artifactDir, { recursive: true })
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  })
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, 'base64'))
  check('verification screenshot captured', fs.statSync(screenshotPath).size > 0, screenshotPath)

  check(
    'no uncaught renderer exception occurred',
    rendererExceptions.length === 0,
    rendererExceptions.join(' | '),
  )
  if (rendererConsoleErrors.length) {
    console.warn('\nRenderer console errors (reported, not automatically failed):')
    for (const error of rendererConsoleErrors) console.warn(`- ${error}`)
  }
} catch (error) {
  check('verifier completed', false, error instanceof Error ? error.stack : String(error))
} finally {
  cdp?.close()
  child?.kill()
  await sleep(300)
  fs.rmSync(fixtureDir, { recursive: true, force: true })
  fs.rmSync(profilePath, { recursive: true, force: true })
}

const failures = results.filter((result) => !result.pass)
console.log(`\nText editor verification: ${results.length - failures.length}/${results.length} passed`)
if (failures.length) {
  console.log('Failed checks:')
  for (const failure of failures) console.log(`- ${failure.name}`)
  process.exitCode = 1
}
