import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronPath = require('electron')
const rendererEntry = path.join(root, 'out', 'renderer', 'index.html')
const mainEntry = path.join(root, 'out', 'main', 'main.js')
const artifactDir = path.join(root, '.cache')
const screenshotPath = path.join(artifactDir, 'electron-verify-language-menu-ar.png')
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-language-menu-verify-'))
const storageKey = 'wps-agent-language'
const expectedLanguages = ['zh-CN', 'en', 'ja', 'es', 'pt', 'de', 'fr', 'ru', 'ar']
const expectedFontPreviews = {
  'zh-CN': '海浪的声音平静了我的心灵。',
  en: 'The sound of ocean waves calms my soul.',
  ja: '海の波の音が私の心を落ち着かせます。',
  es: 'El sonido de las olas del mar me calma el alma.',
  pt: 'O som das ondas do oceano acalma minha alma.',
  de: 'Das Rauschen der Wellen des Ozeans beruhigt meine Seele.',
  fr: 'Les sons des vagues de l’océan apaisent mon âme.',
  ru: 'Звуки океана успокаивают меня.',
  ar: 'صوت أمواج المحيط يهدئ روحي.',
}
const fontPreviewFixturePath = path.join(profilePath, 'notepad-font-preview.txt')
const expectedFirstShortcutLabels = {
  'zh-CN': '新建',
  en: 'Create a new document / workbook',
  ja: '新しい文書／ブックを作成',
  es: 'Crear un documento / libro nuevo',
  pt: 'Criar um documento / uma pasta de trabalho',
  de: 'Neues Dokument / neue Arbeitsmappe erstellen',
  fr: 'Créer un document / classeur',
  ru: 'Создать документ / книгу',
  ar: 'إنشاء مستند / مصنف جديد',
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function check(name, condition, detail = '') {
  const marker = condition ? 'PASS' : 'FAIL'
  console.log(`[${marker}] ${name}${!condition && detail ? `: ${detail}` : ''}`)
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
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
          target.type === 'page'
          && (String(target.url).includes('out/renderer')
            || String(target.url).includes('index.html')),
      )
      if (page?.webSocketDebuggerUrl) return page
    } catch (error) {
      lastError = error
    }
    await sleep(200)
  }

  throw new Error(`Electron renderer target did not appear: ${String(lastError ?? 'timeout')}`)
}

function connectCdp(wsUrl, onEvent) {
  if (!globalThis.WebSocket) {
    throw new Error('This verifier requires Node 22+ (global WebSocket support)')
  }

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1
    let opened = false

    const send = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
      if (socket.readyState !== WebSocket.OPEN) {
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
          if (message.error) rejectCall(new Error(`${method}: ${message.error.message}`))
          else resolveCall(message)
        },
      })
      socket.send(JSON.stringify({ id, method, params }))
    })

    socket.addEventListener('open', () => {
      opened = true
      resolve({ send, close: () => socket.close() })
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id)
        pending.delete(message.id)
        request.resolve(message)
      } else if (message.method) {
        onEvent(message)
      }
    })
    socket.addEventListener('error', (event) => {
      if (!opened) reject(new Error(`CDP WebSocket error: ${String(event.message ?? event)}`))
    })
    socket.addEventListener('close', () => {
      for (const request of pending.values()) {
        request.resolve({ error: { message: 'CDP socket closed' } })
      }
      pending.clear()
    })
  })
}

function describeException(exceptionDetails) {
  return exceptionDetails?.exception?.description
    || exceptionDetails?.text
    || JSON.stringify(exceptionDetails)
}

async function evaluate(send, expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (response.result.exceptionDetails) {
    throw new Error(describeException(response.result.exceptionDetails))
  }
  return response.result.result?.value
}

async function waitFor(send, expression, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let lastValue
  let lastError
  while (Date.now() < deadline) {
    try {
      lastValue = await evaluate(send, expression)
      if (lastValue) return lastValue
      lastError = null
    } catch (error) {
      lastError = error
    }
    await sleep(120)
  }
  throw new Error(
    `Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`
      + `${lastError ? `; last error: ${lastError.message}` : ''}`,
  )
}

async function clickElement(send, selector, label) {
  const point = await evaluate(send, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!(element instanceof HTMLElement)) return null
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }
  })()`)
  check(`${label} has a clickable bounding box`, Boolean(point), JSON.stringify(point))
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
  })
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

async function openLanguageMenu(send) {
  await clickElement(
    send,
    '[data-testid="language-menu-trigger"]',
    'Language trigger',
  )
  await waitFor(
    send,
    `Boolean(document.querySelector('[data-testid="language-menu"]'))`,
    'the language menu to open',
  )
}

async function closeLanguageMenu(send) {
  await clickElement(
    send,
    '[data-testid="language-menu-trigger"]',
    'Open language trigger',
  )
  await waitFor(
    send,
    `!document.querySelector('[data-testid="language-menu"]')`,
    'the language menu to close',
  )
}

async function selectLanguage(send, code) {
  await openLanguageMenu(send)
  await clickElement(
    send,
    `[data-testid="language-option-${code}"]`,
    `${code} option`,
  )
  await waitFor(
    send,
    `document.documentElement.lang === ${JSON.stringify(code)}
      && localStorage.getItem(${JSON.stringify(storageKey)}) === ${JSON.stringify(code)}
      && !document.querySelector('[data-testid="language-menu"]')`,
    `${code} to become active and persist`,
  )
}

async function inspectActiveLanguage(send, code) {
  const expectedDirection = code === 'ar' ? 'rtl' : 'ltr'
  const state = await evaluate(send, `(() => {
    const trigger = document.querySelector('[data-testid="language-menu-trigger"]')
    const theme = document.querySelector('[data-testid="theme-toggle"]')
    return {
      htmlLanguage: document.documentElement.lang,
      htmlDirection: document.documentElement.dir,
      bodyDirection: document.body.dir,
      storedLanguage: localStorage.getItem(${JSON.stringify(storageKey)}),
      triggerLabel: trigger?.getAttribute('aria-label') || '',
      triggerTitle: trigger?.getAttribute('title') || '',
      themeLabel: theme?.getAttribute('aria-label') || '',
    }
  })()`)

  check(`${code} updates the document language`, state.htmlLanguage === code, JSON.stringify(state))
  check(
    `${code} applies ${expectedDirection.toUpperCase()} document direction`,
    state.htmlDirection === expectedDirection,
    JSON.stringify(state),
  )
  check(
    `${code} preserves the physical three-column body layout`,
    state.bodyDirection === 'ltr',
    JSON.stringify(state),
  )
  check(`${code} is stored in localStorage`, state.storedLanguage === code, JSON.stringify(state))
  check(
    `${code} localizes the language trigger accessibly`,
    Boolean(state.triggerLabel) && state.triggerTitle === state.triggerLabel,
    JSON.stringify(state),
  )
  check(`${code} leaves the theme control accessible`, Boolean(state.themeLabel), JSON.stringify(state))
  return state
}

async function inspectMenuSelection(send, code) {
  await openLanguageMenu(send)
  const menu = await evaluate(send, `(() => {
    const root = document.querySelector('[data-testid="language-menu"]')
    const options = [...document.querySelectorAll('[data-testid^="language-option-"]')]
    const rect = root?.getBoundingClientRect()
    return {
      label: root?.getAttribute('aria-label') || '',
      visible: Boolean(rect && rect.width > 0 && rect.height > 0),
      options: options.map((option) => ({
        code: option.getAttribute('data-testid')?.replace('language-option-', '') || '',
        language: option.getAttribute('lang') || '',
        direction: option.getAttribute('dir') || '',
        role: option.getAttribute('role') || '',
        checked: option.getAttribute('aria-checked'),
        text: option.textContent?.trim() || '',
      })),
    }
  })()`)

  const codes = menu.options.map((option) => option.code)
  const selected = menu.options.filter((option) => option.checked === 'true')
  check(`${code} language menu is visible`, menu.visible, JSON.stringify(menu))
  check(`${code} language menu has an accessible label`, Boolean(menu.label), JSON.stringify(menu))
  check(
    'Language menu exposes all 9 languages in the expected order',
    JSON.stringify(codes) === JSON.stringify(expectedLanguages),
    JSON.stringify(codes),
  )
  check(
    'Every language option is a labelled radio item',
    menu.options.every(
      (option) => option.role === 'menuitemradio'
        && option.language === option.code
        && Boolean(option.text),
    ),
    JSON.stringify(menu.options),
  )
  check(
    'Only Arabic is marked RTL in the language list',
    menu.options.every(
      (option) => option.direction === (option.code === 'ar' ? 'rtl' : 'ltr'),
    ),
    JSON.stringify(menu.options),
  )
  check(
    `${code} is the sole checked language option`,
    selected.length === 1 && selected[0].code === code,
    JSON.stringify(selected),
  )
  return menu
}

async function inspectShortcutTranslation(send, code) {
  await clickElement(
    send,
    '[data-testid="open-shortcut-settings-empty"]',
    `${code} shortcut settings trigger`,
  )
  await waitFor(
    send,
    `Boolean(document.querySelector('[data-testid="shortcut-settings-panel"]'))`,
    `${code} shortcut settings panel`,
  )
  const commandLabel = await evaluate(send, `document
    .querySelector('[data-shortcut-id="file.new"] td:first-child div:first-child')
    ?.textContent?.trim() || ''`)
  check(
    `${code} localizes shortcut command names`,
    commandLabel === expectedFirstShortcutLabels[code],
    JSON.stringify(commandLabel),
  )
  await clickElement(
    send,
    'section[role="dialog"] header button',
    `${code} shortcut settings close`,
  )
  await waitFor(
    send,
    `!document.querySelector('[data-testid="shortcut-settings-panel"]')`,
    `${code} shortcut settings panel to close`,
  )
}

async function inspectLocalizedFonts(send, code) {
  const result = await evaluate(send, `window.api.lw.listFonts(${JSON.stringify(code)})
    .then((faces) => ({
      count: faces.length,
      hasDisplayNames: faces.every((face) => Boolean(face.displayName && face.faceName)),
    }))`)
  check(`${code} font enumeration returns localized display metadata`,
    result.count > 0 && result.hasDisplayNames,
    JSON.stringify(result))
}

async function openFontPreviewFixture(send) {
  const result = await evaluate(send, `(async () => {
    const filePath = ${JSON.stringify(fontPreviewFixturePath)};
    await window.api.file.open(filePath);
    const root = document.getElementById('root');
    const key = root && Object.keys(root).find(
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
    return { opened: false, visited: seen.size };
  })()`)
  check('Font-preview fixture opens in Notepad', result?.opened, JSON.stringify(result))
  await waitFor(
    send,
    `Boolean(document.querySelector('[data-testid="notepad-settings-button"]'))`,
    'the Notepad settings button',
  )
}

async function inspectFontPreview(send, code) {
  await clickElement(
    send,
    '[data-testid="notepad-settings-button"]',
    `${code} Notepad settings`,
  )
  await waitFor(
    send,
    `Boolean(document.querySelector('[data-testid="notepad-font-preview"]'))`,
    `${code} font preview`,
  )
  const state = await evaluate(send, `(() => {
    const preview = document.querySelector('[data-testid="notepad-font-preview"]');
    const rect = preview?.getBoundingClientRect();
    return {
      text: preview?.textContent?.trim() || '',
      language: preview?.getAttribute('lang') || '',
      direction: preview?.getAttribute('dir') || '',
      visible: Boolean(rect && rect.width > 0 && rect.height > 0),
    };
  })()`)
  const expectedDirection = code === 'ar' ? 'rtl' : 'ltr'
  check(
    `${code} uses the Windows Notepad font-preview text`,
    state.text === expectedFontPreviews[code],
    JSON.stringify(state),
  )
  check(
    `${code} font preview exposes its language and direction`,
    state.language === code && state.direction === expectedDirection && state.visible,
    JSON.stringify(state),
  )
  await clickElement(
    send,
    'section[role="dialog"] header button',
    `${code} Notepad settings close`,
  )
  await waitFor(
    send,
    `!document.querySelector('[data-testid="notepad-font-preview"]')`,
    `${code} font preview to close`,
  )
}

async function captureScreenshot(send) {
  fs.mkdirSync(artifactDir, { recursive: true })
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  })
  const buffer = Buffer.from(screenshot.result.data, 'base64')
  fs.writeFileSync(screenshotPath, buffer)
  check('Language menu visual-check PNG is nonempty', buffer.length > 10_000, `${buffer.length} bytes`)
  console.log(`[PASS] screenshot saved: ${screenshotPath}`)
}

async function reloadAndWait(send, expectedLanguage) {
  const previousTimeOrigin = await evaluate(send, 'performance.timeOrigin')
  await send('Page.reload', { ignoreCache: true })
  await waitFor(
    send,
    `performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin)}
      && document.readyState === 'complete'
      && Boolean(document.querySelector('[data-testid="language-menu-trigger"]'))
      && document.documentElement.lang === ${JSON.stringify(expectedLanguage)}
      && localStorage.getItem(${JSON.stringify(storageKey)}) === ${JSON.stringify(expectedLanguage)}`,
    `${expectedLanguage} to survive a full renderer reload`,
    20_000,
  )
}

for (const entry of [mainEntry, rendererEntry]) {
  if (!fs.existsSync(entry)) {
    throw new Error(`Built Electron output is missing: ${entry}. Run npm run build first.`)
  }
}
fs.writeFileSync(fontPreviewFixturePath, 'Font preview verification\n', 'utf8')

const rendererExceptions = []
const localizedTriggerLabels = new Map()
const localizedMenuLabels = new Map()
let child = null
let cdp = null

try {
  const port = Number(process.env.WPS_LANGUAGE_VERIFY_PORT) || await getFreePort()
  child = spawn(
    electronPath,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`, root],
    {
      cwd: root,
      env: {
        ...process.env,
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
  })
  const { send } = cdp
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.bringToFront')

  await waitFor(
    send,
    `Boolean(document.querySelector('[data-testid="language-menu-trigger"]'))`,
    'the language trigger to render',
  )

  const controls = await evaluate(send, `(() => {
    const language = document.querySelector('[data-testid="language-menu-trigger"]')
    const theme = document.querySelector('[data-testid="theme-toggle"]')
    return {
      adjacent: language?.nextElementSibling === theme,
      languageWidth: language?.getBoundingClientRect().width || 0,
      languageHeight: language?.getBoundingClientRect().height || 0,
    }
  })()`)
  check('Language icon is directly beside the theme toggle', controls.adjacent, JSON.stringify(controls))
  check(
    'Language icon has a usable 28px control target',
    controls.languageWidth >= 27.5 && controls.languageHeight >= 27.5,
    JSON.stringify(controls),
  )

  await evaluate(send, `(() => {
    localStorage.setItem(${JSON.stringify(storageKey)}, 'zh-CN')
    return true
  })()`)
  await reloadAndWait(send, 'zh-CN')

  for (const code of expectedLanguages) {
    await selectLanguage(send, code)
    const state = await inspectActiveLanguage(send, code)
    localizedTriggerLabels.set(code, state.triggerLabel)
    const menu = await inspectMenuSelection(send, code)
    localizedMenuLabels.set(code, menu.label)
    if (code === 'ar') await captureScreenshot(send)
    await closeLanguageMenu(send)
    await inspectShortcutTranslation(send, code)
    if (code === 'ar') await inspectLocalizedFonts(send, code)
  }

  check(
    'All 9 languages update the trigger label',
    new Set(localizedTriggerLabels.values()).size === expectedLanguages.length,
    JSON.stringify(Object.fromEntries(localizedTriggerLabels)),
  )
  check(
    'All 9 languages expose a localized menu label',
    localizedMenuLabels.size === expectedLanguages.length
      && [...localizedMenuLabels.values()].every(Boolean)
      && new Set(localizedMenuLabels.values()).size > 1,
    JSON.stringify(Object.fromEntries(localizedMenuLabels)),
  )

  await openFontPreviewFixture(send)
  for (const code of expectedLanguages) {
    await selectLanguage(send, code)
    await inspectFontPreview(send, code)
  }

  await reloadAndWait(send, 'ar')
  await inspectActiveLanguage(send, 'ar')
  await inspectMenuSelection(send, 'ar')
  await closeLanguageMenu(send)
  check('Arabic selection and RTL state survive a renderer reload', true)

  await selectLanguage(send, 'en')
  await reloadAndWait(send, 'en')
  await inspectActiveLanguage(send, 'en')
  await inspectMenuSelection(send, 'en')
  await closeLanguageMenu(send)
  check('English selection and LTR state survive a renderer reload', true)

  check(
    'Language switching produced no uncaught renderer exceptions',
    rendererExceptions.length === 0,
    JSON.stringify(rendererExceptions),
  )
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  cdp?.close()
  child?.kill()
  await sleep(600)
  try {
    fs.rmSync(profilePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
  } catch {}
}
