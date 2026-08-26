import assert from 'node:assert/strict'
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
const sourceProfile = path.join(process.env.APPDATA ?? '', 'wps-agent-editor')
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-opencodego-collaboration-'))
const DEEPSEEK_MODEL = 'deepseek-v4-flash'
const MIMO_MODEL = 'mimo-v2.5'
const ALLOWED_MODELS = new Set([DEEPSEEK_MODEL, MIMO_MODEL])
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

for (const buildFile of [
  path.join(root, 'out', 'main', 'main.js'),
  path.join(root, 'out', 'renderer', 'index.html'),
]) {
  assert.ok(fs.existsSync(buildFile), `Missing build output: ${buildFile}`)
}

function copyEncryptedConfiguration() {
  for (const name of ['auth.json', 'custom-providers.json', 'provider-base-urls.json', 'Local State']) {
    const source = path.join(sourceProfile, name)
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(profilePath, name))
  }
}

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
  const deadline = Date.now() + 30_000
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

async function waitFor(cdp, expression, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await evaluate(cdp, expression)) return
    } catch {
      // Navigation briefly invalidates the page execution context.
    }
    await sleep(75)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function stopElectron(process) {
  if (!process || process.exitCode !== null) return
  const exited = new Promise((resolve) => process.once('exit', resolve))
  process.kill()
  await Promise.race([exited, sleep(5_000)])
}

copyEncryptedConfiguration()

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
  await cdp.send('Page.enable')
  await waitFor(cdp, 'Boolean(window.api)', 'application preload')

  const configuredProvider = await evaluate(cdp, `(async () => {
    const [auth, customProviders] = await Promise.all([
      window.api.auth.getAll(),
      window.api.customProvider.list(),
    ])
    if (auth['opencode-go']?.configured === true) {
      return { id: 'opencode-go', source: 'bundled', hasRequiredModels: true }
    }
    const legacy = customProviders.find((provider) => {
      const name = String(provider.name ?? '').toLowerCase().replace(/[\\s_-]+/g, '')
      const endpoint = String(provider.baseURL ?? '').replace(/\\/+$/, '').toLowerCase()
      return name === 'opencodego'
        && endpoint === 'https://opencode.ai/zen/go/v1'
        && auth[provider.id]?.configured === true
    })
    if (!legacy) return null
    const modelIds = new Set((legacy.models ?? []).map((model) => model.id))
    return {
      id: legacy.id,
      source: 'legacy-custom',
      hasRequiredModels: modelIds.has(${JSON.stringify(DEEPSEEK_MODEL)})
        && modelIds.has(${JSON.stringify(MIMO_MODEL)}),
    }
  })()`)

  assert.ok(configuredProvider, 'No configured OpenCode Go API key was found')
  assert.equal(configuredProvider.hasRequiredModels, true, 'OpenCode Go does not list both required models')

  const agents = [
    {
      id: `verify-opencodego-deepseek-${Date.now()}`,
      name: 'DeepSeek V4 Flash Lead',
      role: 'Propose a concise answer and synthesize the final consensus',
      systemPrompt: 'Participate in a two-model collaboration. Be concise. Do not call document tools.',
      providerId: configuredProvider.id,
      model: DEEPSEEK_MODEL,
      color: '#2563eb',
      enabled: true,
    },
    {
      id: `verify-opencodego-mimo-${Date.now()}`,
      name: 'MiMo V2.5 Reviewer',
      role: 'Review the lead model output',
      systemPrompt: 'Review the previous model output. Be concise. Do not call document tools.',
      providerId: configuredProvider.id,
      model: MIMO_MODEL,
      color: '#059669',
      enabled: true,
    },
  ]

  await evaluate(cdp, `(async () => {
    for (const agent of ${JSON.stringify(agents)}) await window.api.agent.save(agent)
    return true
  })()`)
  await evaluate(cdp, `(() => {
    window.__opencodeGoCollaborationEvents = []
    window.__opencodeGoCollaborationUnsubscribe = window.api.agent.onEvent((event) => {
      window.__opencodeGoCollaborationEvents.push(event)
    })
    return true
  })()`)

  const result = await evaluate(cdp, `window.api.agent.runTask(
    ${JSON.stringify(agents.map((agent) => agent.id))},
    'Run a two-model verification. The lead proposes the token GO-COLLAB. The reviewer checks it. The final lead returns one concise consensus line. Do not use document tools.'
  )`)
  const events = await evaluate(cdp, 'window.__opencodeGoCollaborationEvents')

  assert.ok(Array.isArray(result), `OpenCode Go collaboration failed: ${String(result?.error ?? 'unknown error')}`)
  assert.equal(result.length, 2, 'Expected one retained result for each selected Agent')
  assert.ok(result.every((item) => item.providerId === configuredProvider.id), 'A result left OpenCode Go')
  assert.deepEqual(new Set(result.map((item) => item.model)), ALLOWED_MODELS)
  assert.ok(result.every((item) => String(item.response ?? '').trim().length > 0), 'A model returned an empty response')

  const starts = events.filter((event) => event.type === 'agent-start')
  assert.deepEqual(
    starts.map((event) => event.model),
    [DEEPSEEK_MODEL, MIMO_MODEL, DEEPSEEK_MODEL],
    'Unexpected model request sequence',
  )
  assert.ok(starts.every((event) => event.providerId === configuredProvider.id), 'A request left OpenCode Go')
  assert.ok(starts.every((event) => ALLOWED_MODELS.has(event.model)), 'A third model was requested')
  assert.equal(events.filter((event) => event.type === 'handoff').length, 2, 'Expected two model handoffs')
  assert.equal(events.at(-1)?.type, 'run-complete', 'Collaboration did not complete')

  console.log(JSON.stringify({
    package: 'OpenCode Go',
    providerConfiguration: configuredProvider.source,
    requestModels: starts.map((event) => event.model),
    handoffs: 2,
    completed: true,
    usedOtherModels: false,
  }, null, 2))
} finally {
  try {
    if (cdp) await evaluate(cdp, 'window.__opencodeGoCollaborationUnsubscribe?.()')
  } catch {
    // The isolated profile is removed below even if renderer cleanup fails.
  }
  cdp?.close()
  await stopElectron(child)
  fs.rmSync(profilePath, { recursive: true, force: true })
}
