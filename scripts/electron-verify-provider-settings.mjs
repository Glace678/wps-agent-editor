import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createServer } from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronPath = require('electron')
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-provider-settings-verify-'))
const screenshotPath = path.join(root, '.cache', 'electron-verify-provider-settings.png')
const qwenSearchScreenshotPath = path.join(root, '.cache', 'electron-verify-provider-qwen-search.png')
const xiaomiSearchScreenshotPath = path.join(root, '.cache', 'electron-verify-provider-xiaomi-search.png')
const volcengineSearchScreenshotPath = path.join(root, '.cache', 'electron-verify-provider-volcengine-search.png')
const customModelsScreenshotPath = path.join(root, '.cache', 'electron-verify-custom-provider-models.png')
const agentConfigScreenshotPath = path.join(root, '.cache', 'electron-verify-agent-config-theme.png')
const providerSwitchLayoutScreenshotPath = path.join(root, '.cache', 'electron-verify-provider-switch-layout.png')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = pages.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // Electron has not enabled the inspector endpoint yet.
    }
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
          pending.set(id, { resolve: resolveCall, reject: rejectCall })
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
      if (message.error) call.reject(new Error(message.error.message))
      else call.resolve(message)
    })
    socket.addEventListener('error', reject)
  })
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', {
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

async function waitFor(cdp, expression, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression)) return
    await sleep(40)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function readProviderSwitch(cdp, providerId) {
  return evaluate(cdp, `(() => {
    const track = document.querySelector(${JSON.stringify(`[data-testid=provider-enable-${providerId}]`)})
    const thumb = track?.querySelector('[data-provider-switch-thumb], span')
    if (!track || !thumb) return { exists: false }
    const trackRect = track.getBoundingClientRect()
    const thumbRect = thumb.getBoundingClientRect()
    return {
      exists: true,
      role: track.getAttribute('role'),
      checked: track.getAttribute('aria-checked'),
      backgroundColor: getComputedStyle(track).backgroundColor,
      trackCenter: trackRect.left + trackRect.width / 2,
      thumbCenter: thumbRect.left + thumbRect.width / 2,
    }
  })()`)
}

async function resizeProviderList(cdp, targetWidth) {
  await evaluate(cdp, `(() => {
    const list = document.querySelector('[data-testid=provider-list]')
    const resizer = document.querySelector('[data-testid=provider-list-resizer]')
    if (!list || !resizer) return false
    const listRect = list.getBoundingClientRect()
    const resizerRect = resizer.getBoundingClientRect()
    const startX = resizerRect.left + resizerRect.width / 2
    const endX = startX + ${targetWidth} - listRect.width
    const pointer = {
      bubbles: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
    }
    resizer.dispatchEvent(new PointerEvent('pointerdown', {
      ...pointer,
      buttons: 1,
      clientX: startX,
    }))
    document.dispatchEvent(new PointerEvent('pointermove', {
      ...pointer,
      buttons: 1,
      clientX: endX,
    }))
    document.dispatchEvent(new PointerEvent('pointerup', {
      ...pointer,
      buttons: 0,
      clientX: endX,
    }))
    return true
  })()`)
  await waitFor(
    cdp,
    `Math.abs(document.querySelector('[data-testid=provider-list]').getBoundingClientRect().width - ${targetWidth}) < 1`,
    `provider list resized to ${targetWidth}px`,
  )
}

async function readProviderSwitchLayout(cdp, providerId) {
  return evaluate(cdp, `(() => {
    const list = document.querySelector('[data-testid=provider-list]')
    const resizer = document.querySelector('[data-testid=provider-list-resizer]')
    const line = resizer?.firstElementChild
    const option = document.querySelector(${JSON.stringify(`[data-testid=provider-option-${providerId}]`)})
    const providerSwitch = document.querySelector(${JSON.stringify(`[data-testid=provider-enable-${providerId}]`)})
    if (!list || !line || !option || !providerSwitch) return null
    const listRect = list.getBoundingClientRect()
    const lineRect = line.getBoundingClientRect()
    const optionRect = option.getBoundingClientRect()
    const switchRect = providerSwitch.getBoundingClientRect()
    return {
      listLeft: listRect.left,
      listRight: listRect.right,
      listWidth: listRect.width,
      lineLeft: lineRect.left,
      optionRight: optionRect.right,
      switchLeft: switchRect.left,
      switchRight: switchRect.right,
      switchToLineGap: lineRect.left - switchRect.right,
    }
  })()`)
}

function isNeutralCssColor(value) {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? []
  return channels.length === 3 && Math.max(...channels) - Math.min(...channels) <= 15
}

async function stopElectron(process) {
  if (!process || process.exitCode !== null) return
  const exited = new Promise((resolve) => process.once('exit', resolve))
  process.kill()
  await Promise.race([exited, sleep(5_000)])
}

async function startModelsServer() {
  const server = createServer((request, response) => {
    if (
      request.method === 'GET'
      && request.url === '/v1/models'
      && request.headers.authorization === 'Bearer custom-provider-test-key'
    ) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        object: 'list',
        data: [
          { id: 'custom-alpha' },
          { id: 'custom-beta', name: 'Custom Beta' },
        ],
      }))
      return
    }
    response.writeHead(request.url === '/v1/models' ? 401 : 404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'Not found' } }))
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object', 'model test server must expose a TCP address')
  return {
    server,
    baseURL: `http://127.0.0.1:${address.port}/v1`,
  }
}

async function stopModelsServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

let child
let cdp
async function verifyProviderSettings() {
  const port = await getFreePort()
  child = spawn(electronPath, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`], {
    cwd: root,
    env: { ...process.env, WPS_ALLOW_MULTI_INSTANCE: '1' },
    stdio: 'ignore',
  })
  const page = await waitForPage(port)
  cdp = await connectCdp(page.webSocketDebuggerUrl)

  await waitFor(cdp, "Boolean(document.querySelector('button[aria-label] .lucide-key'))", 'provider settings button')
  const providerListOpenedAt = Date.now()
  await evaluate(cdp, `(() => {
    document.querySelector('button[aria-label] .lucide-key')?.closest('button')?.click()
    return true
  })()`)
  await waitFor(
    cdp,
    "document.querySelectorAll('[data-testid=provider-list] [data-testid^=provider-option-]').length >= 186",
    'immediate provider list',
    1_000,
  )
  const providerListOpenMs = Date.now() - providerListOpenedAt
  const initialProviderList = await evaluate(cdp, `(() => {
    const list = document.querySelector('[data-testid=provider-list]')
    const rect = list?.getBoundingClientRect()
    return {
      count: list?.querySelectorAll('[data-testid^=provider-option-]').length ?? 0,
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
    }
  })()`)
  assert.ok(providerListOpenMs < 1_000, `provider list should open immediately, received ${providerListOpenMs}ms`)
  assert.ok(initialProviderList.count >= 186, 'all 185 bundled providers and local Ollama must exist on first paint')
  assert.ok(initialProviderList.width >= 168 && initialProviderList.height > 200,
    `provider list must be visibly laid out: ${JSON.stringify(initialProviderList)}`)
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=provider-option-zhipuai]'))", 'provider catalog', 30_000)

  const catalog = await evaluate(cdp, `window.api.provider.list().then((providers) => {
    const openai = providers.find((provider) => provider.id === 'openai')
    const bundled = providers.filter((provider) => !provider.isCustom && provider.id !== 'ollama').slice(0, 185)
    return {
      first: openai?.models[0]?.id,
      hasImage: openai?.models.some((model) => model.id === 'gpt-image-2'),
      hasEmbedding: openai?.models.some((model) => model.id === 'text-embedding-3-large'),
      bundledCount: bundled.length,
      bundledModelCount: bundled.reduce((count, provider) => count + provider.models.length, 0),
      missingDocumentation: bundled.filter((provider) => !provider.doc).map((provider) => provider.id),
      openCodeGoDocumentation: bundled.find((provider) => provider.id === 'opencode-go')?.doc,
    }
  })`)
  assert.equal(catalog.hasImage, false, 'OpenAI image models must be filtered')
  assert.equal(catalog.hasEmbedding, false, 'OpenAI embedding models must be filtered')
  assert.notEqual(catalog.first, 'gpt-image-2', 'the first OpenAI model must be a chat model')
  assert.equal(catalog.bundledCount, 185, 'the complete bundled provider directory must always be available')
  assert.ok(catalog.bundledModelCount >= 5_556, 'bundled provider model metadata must not be cleared')
  assert.deepEqual(catalog.missingDocumentation, [], 'every bundled provider must retain its documentation link')
  assert.equal(
    catalog.openCodeGoDocumentation,
    'https://opencode.ai/docs/go',
    'OpenCode Go must use its dedicated documentation link',
  )

  await evaluate(cdp, `(() => {
    const option = document.querySelector('[data-testid=provider-option-zhipuai]')
    option.scrollIntoView({ block: 'center' })
    option.click()
    return true
  })()`)
  await waitFor(cdp, "document.querySelector('[data-testid=provider-documentation]')?.href.includes('docs.bigmodel.cn')", 'Zhipu API documentation')

  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-testid=provider-api-key]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      .set.call(input, 'provider-switch-test-key')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('[data-testid=provider-save-key]').click()
    return true
  })()`)
  await waitFor(
    cdp,
    "window.api.auth.getAll().then((auth) => auth.zhipuai?.configured === true)",
    'configured provider credential',
  )
  await waitFor(
    cdp,
    "document.querySelector('[data-testid=provider-list] [data-testid^=provider-option-]')?.getAttribute('data-testid') === 'provider-option-zhipuai'",
    'configured provider promoted to the top',
  )
  await waitFor(
    cdp,
    "Boolean(document.querySelector('[data-testid=provider-enable-zhipuai]'))",
    'Zhipu provider enable switch',
  )
  const initialZhipuSwitch = await readProviderSwitch(cdp, 'zhipuai')
  assert.equal(initialZhipuSwitch.exists, true, 'a configured provider must expose its enable switch')
  assert.equal(initialZhipuSwitch.role, 'switch', 'provider enable control must use switch semantics')
  assert.equal(initialZhipuSwitch.checked, 'false', 'a newly configured provider starts disabled')
  assert.ok(
    isNeutralCssColor(initialZhipuSwitch.backgroundColor),
    `a disabled provider switch needs a gray track, received ${initialZhipuSwitch.backgroundColor}`,
  )
  assert.ok(
    initialZhipuSwitch.thumbCenter < initialZhipuSwitch.trackCenter,
    'a disabled provider switch thumb must start on the left',
  )
  assert.equal(
    await evaluate(cdp, "Boolean(document.querySelector('[data-testid=provider-enable-openai]'))"),
    false,
    'providers without an API key must not expose an enable switch',
  )

  const initialSwitchLayout = await readProviderSwitchLayout(cdp, 'zhipuai')
  assert.ok(initialSwitchLayout, 'configured provider switch layout must be measurable')
  for (const targetWidth of [168, 336, 224]) {
    await resizeProviderList(cdp, targetWidth)
    const resizedLayout = await readProviderSwitchLayout(cdp, 'zhipuai')
    assert.ok(resizedLayout, `provider switch layout must exist at ${targetWidth}px`)
    assert.ok(
      resizedLayout.optionRight <= resizedLayout.listRight + 0.5,
      `provider row must stay inside the resized list at ${targetWidth}px: ${JSON.stringify(resizedLayout)}`,
    )
    assert.ok(
      resizedLayout.switchLeft >= resizedLayout.listLeft
        && resizedLayout.switchRight <= resizedLayout.lineLeft,
      `provider switch must stay fully to the left of the resizer at ${targetWidth}px: ${JSON.stringify(resizedLayout)}`,
    )
    assert.ok(
      Math.abs(resizedLayout.switchToLineGap - initialSwitchLayout.switchToLineGap) < 1,
      `provider switch must follow the resizer with a stable trailing gap at ${targetWidth}px: ${JSON.stringify({ initialSwitchLayout, resizedLayout })}`,
    )
    if (targetWidth === 168) {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      fs.mkdirSync(path.dirname(providerSwitchLayoutScreenshotPath), { recursive: true })
      fs.writeFileSync(providerSwitchLayoutScreenshotPath, screenshot.result.data, 'base64')
    }
  }
  const resetIconPaint = await evaluate(cdp, `(() => {
    const icon = document.querySelector('[data-testid=provider-reset-base-url-icon]')
    return Array.from(icon?.querySelectorAll('path') ?? []).map((path) => ({
      fillAttribute: path.getAttribute('fill'),
      computedFill: getComputedStyle(path).fill,
      computedStroke: getComputedStyle(path).stroke,
    }))
  })()`)
  assert.equal(resetIconPaint.length, 2, 'restore-default icon must contain its arc and arrowhead')
  assert.ok(
    resetIconPaint.every((path) => path.fillAttribute === 'none' && path.computedFill === 'none'),
    `restore-default icon must remain unfilled in dark mode: ${JSON.stringify(resetIconPaint)}`,
  )
  if (process.env.WPS_PROVIDER_LAYOUT_ONLY === '1') {
    console.log(`PASS provider switch follows the resizer at minimum and maximum widths\n${providerSwitchLayoutScreenshotPath}`)
    return
  }

  await evaluate(cdp, "document.querySelector('[data-testid=provider-enable-zhipuai]').click(); true")
  await waitFor(
    cdp,
    `(() => {
      const track = document.querySelector('[data-testid=provider-enable-zhipuai]')
      const thumb = track?.querySelector('[data-provider-switch-thumb], span')
      if (!track || !thumb || track.getAttribute('aria-checked') !== 'true') return false
      const trackRect = track.getBoundingClientRect()
      const thumbRect = thumb.getBoundingClientRect()
      return getComputedStyle(track).backgroundColor === 'rgb(34, 197, 94)'
        && thumbRect.left + thumbRect.width / 2 > trackRect.left + trackRect.width / 2
    })()`,
    'enabled green Zhipu provider switch with its thumb on the right',
  )

  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-testid=provider-search]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Alibaba')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await waitFor(
    cdp,
    `Boolean(document.querySelector('[data-testid=provider-option-alibaba]'))
      && !document.querySelector('[data-testid=provider-option-zhipuai]')`,
    'provider search inside provider settings',
  )
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-testid=provider-search]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'qwen')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await waitFor(
    cdp,
    `(() => {
      const ids = Array.from(document.querySelectorAll('[data-testid=provider-list] [data-testid^=provider-option-]'))
        .map((option) => option.getAttribute('data-testid')?.replace('provider-option-', ''))
      return ['alibaba', 'alibaba-cn', 'alibaba-coding-plan', 'alibaba-coding-plan-cn',
        'alibaba-token-plan', 'alibaba-token-plan-cn'].every((id) => ids.includes(id))
        && !ids.includes('zhipuai')
    })()`,
    'Qwen provider associations',
  )
  const qwenMatchHint = await evaluate(cdp, `(() => {
    const hint = document.querySelector('[data-testid=provider-match-alibaba-coding-plan]')
    const summary = document.querySelector('[data-testid=provider-search-summary]')
    return {
      text: hint?.textContent ?? '',
      title: hint?.getAttribute('title') ?? '',
      summary: summary?.textContent ?? '',
    }
  })()`)
  assert.ok(qwenMatchHint.text.includes('Qwen3'), 'Qwen search should expose a matching model hint')
  assert.ok(qwenMatchHint.title.includes('Qwen3'), 'matching model names should be available to assistive tooling')
  assert.match(qwenMatchHint.summary, /\d+/, 'Qwen search should summarize provider and model matches')
  const qwenSearchScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.mkdirSync(path.dirname(qwenSearchScreenshotPath), { recursive: true })
  fs.writeFileSync(qwenSearchScreenshotPath, qwenSearchScreenshot.result.data, 'base64')
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-testid=provider-search]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '通义千问')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await waitFor(
    cdp,
    "Boolean(document.querySelector('[data-testid=provider-option-alibaba]')) && !document.querySelector('[data-testid=provider-option-zhipuai]')",
    'Chinese Qwen provider association',
  )
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-testid=provider-search]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '小米')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await waitFor(
    cdp,
    `(() => {
      const ids = Array.from(document.querySelectorAll('[data-testid=provider-list] [data-testid^=provider-option-]'))
        .map((option) => option.getAttribute('data-testid')?.replace('provider-option-', ''))
      return ['xiaomi', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-sgp']
        .every((id) => ids.includes(id))
        && !ids.includes('zhipuai')
        && Boolean(document.querySelector('[data-testid=provider-search-summary]'))
    })()`,
    'Chinese Xiaomi and MiMo provider associations',
  )
  const xiaomiSearchState = await evaluate(cdp, `(() => {
    const options = Array.from(document.querySelectorAll('[data-testid=provider-list] [data-testid^=provider-option-]'))
    const firstIds = options.slice(0, 4)
      .map((option) => option.getAttribute('data-testid')?.replace('provider-option-', ''))
    return {
      count: options.length,
      firstIds,
      hint: document.querySelector('[data-testid=provider-match-xiaomi]')?.textContent ?? '',
      summary: document.querySelector('[data-testid=provider-search-summary]')?.textContent ?? '',
    }
  })()`)
  assert.ok(xiaomiSearchState.count >= 4, 'Xiaomi search must return official endpoints')
  assert.deepEqual(
    xiaomiSearchState.firstIds,
    ['xiaomi', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-sgp'],
    'official Xiaomi endpoints must lead the suggestion list',
  )
  assert.match(xiaomiSearchState.hint, /MiMo/i, 'Xiaomi search should expose a MiMo model hint')
  assert.match(xiaomiSearchState.summary, /\d+/, 'Xiaomi search summary should report all provider matches')
  const xiaomiSearchScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(xiaomiSearchScreenshotPath, xiaomiSearchScreenshot.result.data, 'base64')
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-testid=provider-search]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '豆包')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await waitFor(
    cdp,
    "Boolean(document.querySelector('[data-testid=provider-option-volcengine]'))",
    'official Volcengine services for a Doubao search',
  )
  const volcengineSearchState = await evaluate(cdp, `(() => {
    const options = Array.from(document.querySelectorAll('[data-testid=provider-list] [data-testid^=provider-option-]'))
      .slice(0, 3)
    return {
      ids: options.map((option) => option.getAttribute('data-testid')?.replace('provider-option-', '')),
      icons: options.map((option) => {
        const icon = option.querySelector('img')
        return icon ? { complete: icon.complete, naturalWidth: icon.naturalWidth, src: icon.src } : null
      }),
    }
  })()`)
  assert.deepEqual(
    volcengineSearchState.ids,
    ['volcengine', 'volcengine-agent-plan', 'volcengine-coding-plan'],
    'official Volcengine services must lead a Doubao search',
  )
  assert.ok(
    volcengineSearchState.icons.every((icon) => icon?.complete && icon.naturalWidth > 0),
    `official Volcengine logos must render as images: ${JSON.stringify(volcengineSearchState.icons)}`,
  )
  const volcengineSearchScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(volcengineSearchScreenshotPath, volcengineSearchScreenshot.result.data, 'base64')
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-testid=provider-search]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'provider-that-does-not-exist')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await waitFor(
    cdp,
    "Boolean(document.querySelector('[data-testid=provider-search-empty]')) && !document.querySelector('[data-testid^=provider-option-]')",
    'provider search empty state',
  )
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-testid=provider-search]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)

  await evaluate(cdp, `(() => {
    const option = document.querySelector('[data-testid=provider-option-alibaba]')
    option.scrollIntoView({ block: 'center' })
    option.click()
    return true
  })()`)
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=provider-api-key]'))", 'Alibaba provider settings')
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-testid=provider-api-key]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      .set.call(input, 'provider-exclusive-switch-test-key')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('[data-testid=provider-save-key]').click()
    return true
  })()`)
  await waitFor(
    cdp,
    "window.api.auth.getAll().then((auth) => auth.alibaba?.configured === true)",
    'second configured provider credential',
  )
  await waitFor(
    cdp,
    `Array.from(document.querySelectorAll(
      '[data-testid=provider-list] [data-testid^=provider-option-]',
    )).slice(0, 2).map((option) => option.getAttribute('data-testid')).join(',')
      === 'provider-option-alibaba,provider-option-zhipuai'`,
    'configured provider group ordering',
  )
  assert.deepEqual(
    await evaluate(cdp, `Array.from(document.querySelectorAll(
      '[data-testid=provider-list] [data-testid^=provider-option-]',
    )).slice(0, 2).map((option) => option.getAttribute('data-testid'))`),
    ['provider-option-alibaba', 'provider-option-zhipuai'],
    'configured providers must remain in a stable group at the top of the list',
  )
  await waitFor(
    cdp,
    "Boolean(document.querySelector('[data-testid=provider-enable-alibaba]'))",
    'Alibaba provider enable switch',
  )
  const initialAlibabaSwitch = await readProviderSwitch(cdp, 'alibaba')
  assert.equal(initialAlibabaSwitch.checked, 'false', 'the second configured provider starts disabled')
  assert.ok(
    initialAlibabaSwitch.thumbCenter < initialAlibabaSwitch.trackCenter,
    'the second configured provider switch thumb must start on the left',
  )

  await evaluate(cdp, "document.querySelector('[data-testid=provider-enable-alibaba]').click(); true")
  await waitFor(
    cdp,
    `(() => {
      const read = (id) => {
        const track = document.querySelector('[data-testid=provider-enable-' + id + ']')
        const thumb = track?.querySelector('[data-provider-switch-thumb], span')
        if (!track || !thumb) return null
        const trackRect = track.getBoundingClientRect()
        const thumbRect = thumb.getBoundingClientRect()
        return {
          checked: track.getAttribute('aria-checked'),
          color: getComputedStyle(track).backgroundColor,
          thumbCenter: thumbRect.left + thumbRect.width / 2,
          trackCenter: trackRect.left + trackRect.width / 2,
        }
      }
      const zhipu = read('zhipuai')
      const alibaba = read('alibaba')
      return alibaba?.checked === 'true'
        && alibaba.color === 'rgb(34, 197, 94)'
        && alibaba.thumbCenter > alibaba.trackCenter
        && zhipu?.checked === 'false'
        && zhipu.thumbCenter < zhipu.trackCenter
    })()`,
    'exclusive Alibaba provider switch activation',
  )

  await evaluate(cdp, `(() => {
    const dialog = document.querySelector('[role=dialog]')
    const headerButtons = dialog?.firstElementChild?.querySelectorAll('button')
    headerButtons?.[headerButtons.length - 1]?.click()
    return true
  })()`)
  await waitFor(cdp, "!document.querySelector('[role=dialog]')", 'provider settings close before persistence check')
  await evaluate(cdp, `(() => {
    document.querySelector('button[aria-label] .lucide-key')?.closest('button')?.click()
    return true
  })()`)
  await waitFor(
    cdp,
    `document.querySelector('[data-testid=provider-enable-alibaba]')?.getAttribute('aria-checked') === 'true'
      && document.querySelector('[data-testid=provider-enable-zhipuai]')?.getAttribute('aria-checked') === 'false'`,
    'active provider persistence after reopening settings',
  )
  const reopenedAlibabaSwitch = await readProviderSwitch(cdp, 'alibaba')
  assert.equal(reopenedAlibabaSwitch.backgroundColor, 'rgb(34, 197, 94)')
  assert.ok(
    reopenedAlibabaSwitch.thumbCenter > reopenedAlibabaSwitch.trackCenter,
    'the persisted active provider switch thumb must remain on the right',
  )
  await evaluate(cdp, `(() => {
    document.querySelector('[data-testid=provider-option-zhipuai]').click()
    return true
  })()`)
  await waitFor(cdp, "document.querySelector('[data-testid=provider-documentation]')?.href.includes('docs.bigmodel.cn')", 'restored Zhipu provider details')

  const layout = await evaluate(cdp, `(() => {
    const url = document.querySelector('[data-testid=provider-base-url]').getBoundingClientRect()
    const key = document.querySelector('[data-testid=provider-api-key]').getBoundingClientRect()
    return {
      doc: document.querySelector('[data-testid=provider-documentation]').href,
      width: url.width,
      height: url.height,
      aboveKey: url.bottom < key.top,
    }
  })()`)
  assert.match(layout.doc, /^https:\/\/docs\.bigmodel\.cn\/cn\/api\/introduction/)
  assert.ok(layout.width >= 350, `Base URL input should be wide, received ${layout.width}px`)
  assert.ok(layout.height >= 40, `Base URL input should be tall, received ${layout.height}px`)
  assert.equal(layout.aboveKey, true, 'Base URL input must be above the API key')
  assert.equal(
    await evaluate(cdp, "document.querySelector('[data-testid=provider-reset-base-url]')?.disabled"),
    true,
    'restore default must remain visible and disabled while the input matches the default URL',
  )

  const defaultURL = 'https://open.bigmodel.cn/api/paas/v4'
  const temporaryURL = 'https://open.bigmodel.cn/alternate/v1/chat/completions?key=do-not-persist'
  const normalizedTemporaryURL = 'https://open.bigmodel.cn/alternate/v1'
  const crossOriginRejected = await evaluate(cdp, `window.api.provider
    .setBaseURL('zhipuai', 'https://proxy.example.com/v1')
    .then(() => false, (error) => String(error).includes('PROVIDER_BASE_URL_ORIGIN_MISMATCH'))`)
  assert.equal(crossOriginRejected, true, 'a built-in provider key must never be redirected to another origin')
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-testid=provider-base-url]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(temporaryURL)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await waitFor(
    cdp,
    "Boolean(document.querySelector('[data-testid=provider-reset-base-url]:not(:disabled)'))",
    'restore default after editing the URL',
  )

  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-testid=provider-base-url]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(defaultURL)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await waitFor(
    cdp,
    "document.querySelector('[data-testid=provider-reset-base-url]')?.disabled === true",
    'disabled restore default after typing the default URL',
  )

  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-testid=provider-base-url]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(temporaryURL)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=provider-reset-base-url]'))", 'restore default before saving')
  await evaluate(cdp, "document.querySelector('[data-testid=provider-reset-base-url]').click(); true")
  await waitFor(
    cdp,
    `document.querySelector('[data-testid=provider-base-url]')?.value === ${JSON.stringify(defaultURL)}
      && document.querySelector('[data-testid=provider-reset-base-url]')?.disabled === true`,
    'default URL restored before saving',
  )

  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-testid=provider-base-url]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(temporaryURL)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await waitFor(
    cdp,
    `document.querySelector('[data-testid=provider-base-url]')?.value === ${JSON.stringify(temporaryURL)}
      && document.querySelector('[data-testid=provider-reset-base-url]')?.disabled === false`,
    'custom URL ready to save',
  )
  await evaluate(cdp, "document.querySelector('[data-testid=provider-save-base-url]').click(); true")
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=provider-base-url-saved]'))", 'saved Base URL')
  assert.equal(
    await evaluate(cdp, "window.api.provider.get('zhipuai').then((provider) => provider.api)"),
    normalizedTemporaryURL,
    'a full chat endpoint must be normalized before it is returned by provider IPC',
  )

  const protocolURLs = await evaluate(cdp, `(async () => {
    await window.api.provider.setBaseURL('anthropic', 'https://api.anthropic.com/v1/messages')
    await window.api.provider.setBaseURL(
      'google',
      'https://generativelanguage.googleapis.com/v1alpha/models/gemini-test:generateContent?key=do-not-persist',
    )
    const [anthropic, google] = await Promise.all([
      window.api.provider.get('anthropic'),
      window.api.provider.get('google'),
    ])
    return { anthropic: anthropic.api, google: google.api }
  })()`)
  assert.equal(protocolURLs.anthropic, 'https://api.anthropic.com')
  assert.equal(protocolURLs.google, 'https://generativelanguage.googleapis.com/v1alpha')

  const storePath = path.join(profilePath, 'provider-base-urls.json')
  const storeContents = fs.readFileSync(storePath, 'utf8')
  assert.equal(storeContents.includes('do-not-persist'), false, 'URL query API keys must not be persisted')

  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
  fs.writeFileSync(screenshotPath, screenshot.result.data, 'base64')

  await evaluate(cdp, "document.querySelector('[data-testid=provider-delete-key]').click(); true")
  await waitFor(
    cdp,
    "window.api.auth.getAll().then((auth) => auth.zhipuai === undefined)",
    'provider credential removed with API key',
  )
  await waitFor(
    cdp,
    "document.querySelector('[data-testid=provider-list] [data-testid^=provider-option-]')?.getAttribute('data-testid') === 'provider-option-alibaba'",
    'provider removed from the promoted group with its API key',
  )

  await evaluate(cdp, "document.querySelector('[data-testid=provider-reset-base-url]').click(); true")
  await waitFor(
    cdp,
    `window.api.provider.get('zhipuai').then((provider) => (
      provider.isApiOverridden === false
        && document.querySelector('[data-testid=provider-base-url]')?.value === ${JSON.stringify(defaultURL)}
        && document.querySelector('[data-testid=provider-reset-base-url]')?.disabled === true
    ))`,
    'saved custom URL restored in the input',
  )
  const equivalentDefault = await evaluate(cdp, `(async () => {
    await window.api.provider.setBaseURL('zhipuai', ${JSON.stringify(`${defaultURL}/chat/completions`)})
    return window.api.provider.get('zhipuai')
  })()`)
  assert.equal(equivalentDefault.api, defaultURL)
  assert.equal(
    equivalentDefault.isApiOverridden,
    false,
    'an address that normalizes to the default must not be stored as an override',
  )
  await evaluate(cdp, `Promise.all([
    window.api.provider.setBaseURL('anthropic', ''),
    window.api.provider.setBaseURL('google', ''),
  ])`)

  let createdCustomProviderId = ''
  const modelsServer = await startModelsServer()
  try {
    await evaluate(cdp, "document.querySelector('[data-testid=add-custom-provider]')?.click(); true")
    await waitFor(cdp, "Boolean(document.querySelector('[data-testid=custom-provider-base-url]'))", 'custom provider form')

    await evaluate(cdp, `(() => {
      const setValue = (selector, value) => {
        const input = document.querySelector(selector)
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      setValue('[data-testid=custom-provider-base-url]', ${JSON.stringify(modelsServer.baseURL)})
      setValue('[data-testid=custom-provider-api-key]', 'custom-provider-test-key')
      document.querySelector('[data-testid=custom-provider-test-connection]').click()
      return true
    })()`)
    await waitFor(
      cdp,
      "document.querySelectorAll('[data-testid=custom-provider-model-option]').length === 2",
      'automatically opened custom model list',
    )

    const detectedModels = await evaluate(cdp, `Array.from(document.querySelectorAll('[data-testid=custom-provider-model-option]'))
      .map((option) => option.textContent.trim())`)
    assert.deepEqual(detectedModels, ['custom-alpha', 'Custom Beta'])

    const customModelsScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.mkdirSync(path.dirname(customModelsScreenshotPath), { recursive: true })
    fs.writeFileSync(customModelsScreenshotPath, customModelsScreenshot.result.data, 'base64')

    if (!await evaluate(cdp, "Boolean(document.querySelector('[data-testid=custom-provider-model-option]'))")) {
      await evaluate(cdp, "document.querySelector('[data-testid=custom-provider-model-picker]').click(); true")
      await waitFor(
        cdp,
        "document.querySelectorAll('[data-testid=custom-provider-model-option]').length === 2",
        'reopened custom model list after capture',
      )
    }
    await evaluate(cdp, `Array.from(document.querySelectorAll('[data-testid=custom-provider-model-option]'))
      .find((option) => option.textContent.includes('Custom Beta'))?.click(); true`)
    await waitFor(
      cdp,
      "document.querySelector('[data-testid=custom-provider-model-picker]')?.textContent.includes('custom-beta')",
      'custom model selection',
    )
    await evaluate(cdp, "document.querySelector('[data-testid=custom-provider-create]').click(); true")
    await waitFor(cdp, "!document.querySelector('[data-testid=custom-provider-base-url]')", 'custom provider creation')

    const customProvider = await evaluate(cdp, `Promise.all([window.api.provider.list(), window.api.auth.getAll()]).then(([providers, auth]) => {
      const provider = providers.find((item) => item.isCustom && item.api === ${JSON.stringify(modelsServer.baseURL)})
      return {
        id: provider?.id,
        models: provider?.models.map((model) => model.id),
        configured: provider ? auth[provider.id]?.configured : false,
      }
    })`)
    assert.deepEqual(customProvider.models, ['custom-alpha', 'custom-beta'])
    assert.equal(customProvider.configured, true, 'custom provider API key must be saved after creation')
    assert.equal(typeof customProvider.id, 'string', 'custom provider must expose its persisted id')
    createdCustomProviderId = customProvider.id
    await waitFor(
      cdp,
      `Array.from(document.querySelectorAll('[data-testid=provider-list] [data-testid^=provider-option-]'))
        .slice(0, 2).map((option) => option.getAttribute('data-testid')).join(',')
        === ${JSON.stringify(`provider-option-alibaba,provider-option-${createdCustomProviderId}`)}`,
      'configured providers grouped at the top',
    )
  } finally {
    await stopModelsServer(modelsServer.server)
  }

  await evaluate(cdp, `(() => {
    const option = document.querySelector(${JSON.stringify(`[data-testid=provider-option-${createdCustomProviderId}]`)})
    option.scrollIntoView({ block: 'center' })
    option.click()
    return true
  })()`)
  await waitFor(
    cdp,
    `document.querySelector('[data-testid=provider-documentation]')?.href === ${JSON.stringify(modelsServer.baseURL)}`,
    'custom provider fallback link',
  )
  const customProviderLink = await evaluate(cdp, `(() => {
    const link = document.querySelector('[data-testid=provider-documentation]')
    return {
      href: link.href,
      text: link.textContent.trim(),
      target: link.target,
      rel: link.rel,
    }
  })()`)
  assert.equal(customProviderLink.text, modelsServer.baseURL, 'custom provider link text must stay visible')
  assert.equal(customProviderLink.target, '_blank', 'custom provider links must open outside the current page')
  assert.match(customProviderLink.rel, /noopener/)
  assert.match(customProviderLink.rel, /noreferrer/)

  await evaluate(cdp, "document.querySelector('[data-testid=provider-delete-key]').click(); true")
  await waitFor(
    cdp,
    `Promise.all([
      window.api.auth.getAll().then((auth) => auth[${JSON.stringify(createdCustomProviderId)}] === undefined),
      Promise.resolve(document.querySelector('[data-testid=provider-list] [data-testid^=provider-option-]')
        ?.getAttribute('data-testid') === 'provider-option-alibaba'),
    ]).then((states) => states.every(Boolean))`,
    'unconfigured custom provider removed from the configured group',
  )

  await evaluate(cdp, `(() => {
    document.querySelector('[data-testid=provider-base-url]')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    return true
  })()`)
  assert.equal(
    await evaluate(cdp, "Boolean(document.querySelector('[role=dialog]'))"),
    true,
    'clicking inside provider settings must keep the dialog open',
  )

  await evaluate(cdp, `(() => {
    document.querySelector('[role=dialog]')?.parentElement
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    return true
  })()`)
  await waitFor(cdp, "!document.querySelector('[role=dialog]')", 'provider settings backdrop dismissal')

  await evaluate(cdp, `(() => {
    if (!document.documentElement.classList.contains('dark')) {
      document.querySelector('[data-testid=theme-toggle]')?.click()
    }
    return true
  })()`)
  await waitFor(cdp, "document.documentElement.classList.contains('dark')", 'dark application theme')
  await evaluate(cdp, "document.querySelector('[data-testid=agent-new]').click(); true")
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=agent-provider-label]'))", 'Agent configuration dialog')
  assert.equal(
    await evaluate(cdp, "document.querySelector('[data-testid=agent-provider-label]').textContent.trim()"),
    'LLM Provider',
    'LLM Provider label must not show a loading/configuring message',
  )
  await waitFor(
    cdp,
    "document.querySelector('[data-testid=agent-provider-select]')?.disabled === false",
    'loaded Agent provider selection',
  )
  assert.match(
    await evaluate(cdp, "document.querySelector('[data-testid=agent-provider-select]').textContent"),
    /ollama/i,
    'Agent provider selection must keep the available local provider',
  )
  assert.equal(
    await evaluate(cdp, `Boolean(
      document.querySelector('[data-testid=agent-config-dialog-body] input[type=number]')
    )`),
    false,
    'Agent configuration must not expose temperature controls',
  )

  await evaluate(cdp, "document.querySelector('[data-testid=agent-provider-select]').click(); true")
  await waitFor(cdp, "document.activeElement?.matches('[data-testid=agent-provider-search]')", 'focused Agent provider search')
  assert.deepEqual(
    await evaluate(cdp, `Array.from(document.querySelectorAll('[data-testid^=agent-provider-option-]'))
      .map((option) => option.getAttribute('data-testid'))`),
    ['agent-provider-option-ollama', 'agent-provider-option-alibaba'],
    'Agent provider picker must contain local providers and providers with a saved API key',
  )
  const searchLayout = await evaluate(cdp, `(() => {
    const menu = document.querySelector('[data-testid=agent-provider-menu]')
    const search = document.querySelector('[data-testid=agent-provider-search]')
    const options = document.querySelector('[data-testid^=agent-provider-option-]')
    return {
      searchTop: search.getBoundingClientRect().top,
      optionTop: options.getBoundingClientRect().top,
      menuTop: menu.getBoundingClientRect().top,
      triggerWidth: document.querySelector('[data-testid=agent-provider-select]').getBoundingClientRect().width,
      menuWidth: menu.getBoundingClientRect().width,
    }
  })()`)
  assert.ok(searchLayout.searchTop >= searchLayout.menuTop, 'provider search must stay inside the top of the popup')
  assert.ok(searchLayout.searchTop < searchLayout.optionTop, 'provider search must appear above every option')
  assert.ok(Math.abs(searchLayout.triggerWidth - searchLayout.menuWidth) < 1, 'provider popup must align to its trigger width')

  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-testid=agent-provider-search]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'alibaba')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await waitFor(
    cdp,
    "document.querySelectorAll('[data-testid^=agent-provider-option-]').length === 1 && Boolean(document.querySelector('[data-testid=agent-provider-option-alibaba]'))",
    'filtered Agent provider search',
  )
  await evaluate(cdp, "document.querySelector('[data-testid=agent-provider-option-alibaba]').click(); true")
  await waitFor(
    cdp,
    "!document.querySelector('[data-testid=agent-provider-menu]') && document.querySelector('[data-testid=agent-provider-select]')?.textContent.toLowerCase().includes('alibaba')",
    'Agent provider selection from filtered results',
  )

  await evaluate(cdp, "document.querySelector('[data-testid=agent-provider-select]').click(); true")
  await waitFor(cdp, "document.activeElement?.matches('[data-testid=agent-provider-search]')", 'refocused Agent provider search')
  await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-testid=agent-provider-search]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'does-not-exist')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await waitFor(cdp, "!document.querySelector('[data-testid^=agent-provider-option-]')", 'empty Agent provider search')
  assert.match(
    await evaluate(cdp, "document.querySelector('[data-testid=agent-provider-menu]').textContent"),
    /No matching providers|没有找到匹配的模型服务商/,
    'Agent provider search must expose its empty state',
  )

  const readProviderTheme = () => `(() => {
    const triggerStyle = getComputedStyle(document.querySelector('[data-testid=agent-provider-select]'))
    const menuStyle = getComputedStyle(document.querySelector('[data-testid=agent-provider-menu]'))
    return {
      triggerBackground: triggerStyle.backgroundColor,
      triggerColor: triggerStyle.color,
      menuBackground: menuStyle.backgroundColor,
      menuColor: menuStyle.color,
    }
  })()`
  const darkProviderSelect = await evaluate(cdp, readProviderTheme())
  assert.ok(darkProviderSelect.triggerBackground.includes('rgb('), 'provider trigger needs dark background')
  assert.ok(darkProviderSelect.triggerColor.includes('rgb('), 'provider trigger needs foreground color')
  assert.ok(darkProviderSelect.menuBackground.includes('rgb('), 'provider popup needs dark background')

  const agentConfigScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.mkdirSync(path.dirname(agentConfigScreenshotPath), { recursive: true })
  fs.writeFileSync(agentConfigScreenshotPath, agentConfigScreenshot.result.data, 'base64')

  await evaluate(cdp, "document.querySelector('[data-testid=theme-toggle]').click(); true")
  await waitFor(cdp, "!document.documentElement.classList.contains('dark')", 'light application theme')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
  await waitFor(
    cdp,
    "getComputedStyle(document.querySelector('[data-testid=agent-provider-select]')).backgroundColor === 'rgb(255, 255, 255)'",
    'light Agent provider trigger transition',
  )
  const lightProviderSelect = await evaluate(cdp, readProviderTheme())
  assert.ok(lightProviderSelect.triggerBackground.includes('rgb('), 'provider trigger needs light background')
  assert.ok(lightProviderSelect.triggerColor.includes('rgb('), 'provider trigger needs light foreground color')
  assert.ok(lightProviderSelect.menuBackground.includes('rgb('), 'provider popup needs white background')

  console.log(`PASS provider list opened in ${providerListOpenMs}ms; API-key filtering, provider-list search, documentation, editable Base URL, custom model discovery, persistence, searchable Agent provider picker, theme switching, and backdrop dismissal\n${screenshotPath}\n${qwenSearchScreenshotPath}\n${xiaomiSearchScreenshotPath}\n${volcengineSearchScreenshotPath}\n${customModelsScreenshotPath}\n${agentConfigScreenshotPath}`)
}

try {
  await verifyProviderSettings()
} finally {
  cdp?.close()
  await stopElectron(child)
  try {
    fs.rmSync(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // Windows can release the Electron profile shortly after the process exits.
  }
}
