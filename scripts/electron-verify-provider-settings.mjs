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
try {
  const port = await getFreePort()
  child = spawn(electronPath, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${profilePath}`], {
    cwd: root,
    env: { ...process.env, WPS_ALLOW_MULTI_INSTANCE: '1' },
    stdio: 'ignore',
  })
  const page = await waitForPage(port)
  cdp = await connectCdp(page.webSocketDebuggerUrl)

  await waitFor(cdp, "Boolean(document.querySelector('button[aria-label] .lucide-key'))", 'provider settings button')
  await evaluate(cdp, `(() => {
    document.querySelector('button[aria-label] .lucide-key')?.closest('button')?.click()
    return true
  })()`)
  await waitFor(cdp, "Boolean(document.querySelector('[data-testid=provider-option-zhipuai]'))", 'provider catalog', 30_000)

  const catalog = await evaluate(cdp, `window.api.provider.list().then((providers) => {
    const openai = providers.find((provider) => provider.id === 'openai')
    return {
      first: openai?.models[0]?.id,
      hasImage: openai?.models.some((model) => model.id === 'gpt-image-2'),
      hasEmbedding: openai?.models.some((model) => model.id === 'text-embedding-3-large'),
    }
  })`)
  assert.equal(catalog.hasImage, false, 'OpenAI image models must be filtered')
  assert.equal(catalog.hasEmbedding, false, 'OpenAI embedding models must be filtered')
  assert.notEqual(catalog.first, 'gpt-image-2', 'the first OpenAI model must be a chat model')

  await evaluate(cdp, "document.querySelector('[data-testid=provider-option-zhipuai]').click(); true")
  await waitFor(cdp, "document.querySelector('[data-testid=provider-documentation]')?.href.includes('docs.bigmodel.cn')", 'Zhipu API documentation')

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
  const temporaryURL = 'https://proxy.example.com/v1/chat/completions?key=do-not-persist'
  const normalizedTemporaryURL = 'https://proxy.example.com/v1'
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

  const modelsServer = await startModelsServer()
  try {
    await evaluate(cdp, "document.querySelector('[data-testid=provider-option-zhipuai]')?.closest('[role=dialog]')?.querySelector('button:last-child')?.click(); true")
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
        models: provider?.models.map((model) => model.id),
        configured: provider ? auth[provider.id]?.configured : false,
      }
    })`)
    assert.deepEqual(customProvider.models, ['custom-alpha', 'custom-beta'])
    assert.equal(customProvider.configured, true, 'custom provider API key must be saved after creation')
  } finally {
    await stopModelsServer(modelsServer.server)
  }

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

  console.log(`PASS provider documentation, editable Base URL, custom model discovery, persistence, and backdrop dismissal\n${screenshotPath}`)
} finally {
  cdp?.close()
  await stopElectron(child)
  try {
    fs.rmSync(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // Windows can release the Electron profile shortly after the process exits.
  }
}
