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
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-agent-cache-verify-'))
const screenshotPath = path.join(root, '.cache', 'electron-verify-agent-cache-ui.png')
const runId = `cache-verify-${Date.now().toString(36)}`
const roundCount = Number(process.env.WPS_CACHE_ROUNDS ?? 12)
const threshold = 0.95
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const allVariants = [
  { label: 'disabled', reasoning: { kind: 'disabled' } },
  { label: 'low', reasoning: { kind: 'effort', value: 'low' } },
  { label: 'high', reasoning: { kind: 'effort', value: 'high' } },
  { label: 'max', reasoning: { kind: 'effort', value: 'max' } },
]
const requestedVariants = new Set(
  String(process.env.WPS_CACHE_VARIANTS ?? '').split(',').map((value) => value.trim()).filter(Boolean),
)
const variants = requestedVariants.size > 0
  ? allVariants.filter((variant) => requestedVariants.has(variant.label))
  : allVariants

assert.ok(Number.isInteger(roundCount) && roundCount >= 4 && roundCount <= 50, 'WPS_CACHE_ROUNDS must be 4-50')
assert.ok(variants.length > 0, 'WPS_CACHE_VARIANTS did not match a supported reasoning variant')

function findOpenCodeGoProvider() {
  const configPath = path.join(sourceProfile, 'custom-providers.json')
  assert.ok(fs.existsSync(configPath), 'No custom provider configuration was found')
  const providers = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  assert.ok(Array.isArray(providers), 'Custom provider configuration is invalid')
  const provider = providers.find((candidate) => {
    const normalized = String(candidate?.name ?? '').toLowerCase().replace(/[\s_-]+/g, '')
    return normalized.includes('opencodego')
  })
  assert.ok(provider, 'Open Code Go is not configured in the application')
  assert.equal(provider.defaultModel, 'deepseek-v4-flash', 'Open Code Go default model is not DeepSeek v4 flash')
  return provider
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

async function evaluateWithTimeout(cdp, expression, timeoutMs = 120_000) {
  return Promise.race([
    evaluate(cdp, expression),
    sleep(timeoutMs).then(() => { throw new Error('Timed out waiting for model response') }),
  ])
}

async function waitFor(cdp, expression, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await evaluate(cdp, expression)) return
    } catch {
      // Navigation briefly invalidates the page execution context.
    }
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function stopElectron(process) {
  if (!process || process.exitCode !== null) return
  const exited = new Promise((resolve) => process.once('exit', resolve))
  process.kill()
  await Promise.race([exited, sleep(5_000)])
}

function aggregate(samples) {
  const cacheReadTokens = samples.reduce((sum, sample) => sum + sample.cacheReadTokens, 0)
  const cacheMissTokens = samples.reduce((sum, sample) => sum + sample.cacheMissTokens, 0)
  return {
    requests: samples.reduce((sum, sample) => sum + sample.requests, 0),
    cacheReadTokens,
    cacheMissTokens,
    hitRate: cacheReadTokens / (cacheReadTokens + cacheMissTokens),
    minRequestHitRate: Math.min(...samples.map((sample) => sample.hitRate)),
    maxRequestHitRate: Math.max(...samples.map((sample) => sample.hitRate)),
  }
}

async function verifyCacheBadge(cdp, agentName) {
  await evaluate(cdp, 'location.reload(); true')
  await waitFor(cdp, 'Boolean(window.api?.agent?.chat)', 'reloaded application preload')
  await waitFor(
    cdp,
    `[...document.querySelectorAll('button')].some((button) => button.textContent.includes(${JSON.stringify(agentName)}))`,
    'cache verification Agent row',
  )
  await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('button')]
      .find((button) => button.textContent.includes(${JSON.stringify(agentName)}));
    row.click();
    return true;
  })()`)
  await waitFor(cdp, 'Boolean(document.querySelector("[data-testid=agent-message-input]"))', 'Agent message input')

  for (let round = 1; round <= 2; round += 1) {
    const marker = `UI_CACHE_ACK_${round}`
    const before = await evaluate(cdp, 'document.querySelectorAll("[data-testid=agent-cache-rate]").length')
    await evaluate(cdp, 'document.querySelector("[data-testid=agent-message-input]").focus(); true')
    await cdp.send('Input.insertText', {
      text: `UI cache verification turn ${round}. Reply exactly ${marker}.`,
    })
    await waitFor(cdp, '!document.querySelector("[data-testid=agent-send]").disabled', 'enabled Agent send button')
    await evaluate(cdp, 'document.querySelector("[data-testid=agent-send]").click(); true')
    await waitFor(
      cdp,
      `document.querySelectorAll('[data-testid=agent-cache-rate]').length > ${before}`,
      `cache badge for UI round ${round}`,
      120_000,
    )
  }

  const badge = await evaluate(cdp, `(() => {
    const badges = [...document.querySelectorAll('[data-testid=agent-cache-rate]')];
    const value = badges.at(-1);
    return { text: value.textContent.trim(), title: value.title };
  })()`)
  const rate = Number.parseFloat(badge.text)
  assert.ok(Number.isFinite(rate) && rate >= threshold * 100, `UI cache badge fell below 95%: ${badge.text}`)
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.result.data, 'base64'))
  console.log(`UI badge ${badge.text}: ${badge.title}`)
  console.log(`UI screenshot ${screenshotPath}`)
}

const provider = findOpenCodeGoProvider()
copyEncryptedConfiguration()

let child
let cdp
const agentIds = []
const report = []
try {
  const port = await getFreePort()
  child = spawn(electronPath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profilePath}`,
    root,
  ], {
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
  cdp = await connectCdp(page.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await waitFor(cdp, 'Boolean(window.api?.agent?.chat)', 'application preload')

  const authState = await evaluate(
    cdp,
    `window.api.auth.getAll().then((auth) => auth[${JSON.stringify(provider.id)}] ?? null)`,
  )
  assert.equal(authState?.configured, true, 'Open Code Go API key is not configured')

  for (const variant of variants) {
    const agentId = `${runId}-${variant.label}`
    const conversationId = `${agentId}-conversation`
    agentIds.push(agentId)
    const agent = {
      id: agentId,
      name: `Cache Verification ${variant.label}`,
      role: 'Verify prompt cache behavior',
      systemPrompt: 'Reply with exactly the marker requested by the user. Do not call document tools.',
      providerId: provider.id,
      model: 'deepseek-v4-flash',
      reasoning: variant.reasoning,
      color: '#0f766e',
      enabled: true,
    }
    await evaluate(cdp, `window.api.agent.save(${JSON.stringify(agent)}).then(() => true)`)

    if (process.env.WPS_VERIFY_CACHE_UI === '1' && variant === variants[0]) {
      await verifyCacheBadge(cdp, agent.name)
    }

    const messages = []
    const samples = []
    for (let round = 1; round <= roundCount; round += 1) {
      const marker = `${variant.label.toUpperCase()}_ACK_${round}`
      messages.push({
        role: 'user',
        content: `Conversation cache verification turn ${round}. Reply exactly ${marker}.`,
      })
      const result = await evaluateWithTimeout(
        cdp,
        `window.api.agent.chat(${JSON.stringify(agentId)}, ${JSON.stringify(messages)}, ${JSON.stringify(conversationId)})`,
      )
      assert.ok(!result?.error, `${variant.label} round ${round} failed: ${result?.error ?? 'unknown error'}`)
      assert.equal(result.toolCalls?.length, 0, `${variant.label} round ${round} unexpectedly called a tool`)
      assert.ok(String(result.response ?? '').includes(marker), `${variant.label} round ${round} returned the wrong marker`)
      assert.equal(result.cacheUsage?.measured, true, `${variant.label} round ${round} did not expose provider cache metrics`)

      const usage = result.cacheUsage
      samples.push(usage)
      messages.push({ role: 'assistant', content: String(result.response) })
      console.log([
        variant.label.padEnd(8),
        `${String(round).padStart(2)}/${roundCount}`,
        `hit=${(usage.hitRate * 100).toFixed(2)}%`,
        `read=${usage.cacheReadTokens}`,
        `miss=${usage.cacheMissTokens}`,
      ].join(' '))
    }

    const steadyState = aggregate(samples.slice(1))
    report.push({
      reasoning: variant.label,
      coldStart: samples[0],
      steadyState,
      rounds: samples,
    })
  }

  const failed = report.filter((entry) => (
    entry.steadyState.hitRate < threshold
      || entry.steadyState.minRequestHitRate < threshold
  ))
  console.log(JSON.stringify({
    provider: provider.name,
    model: 'deepseek-v4-flash',
    roundsPerReasoningVariant: roundCount,
    coldStartRoundsExcluded: 1,
    acceptanceThreshold: threshold,
    variants: report.map(({ reasoning, coldStart, steadyState }) => ({
      reasoning,
      coldStartHitRate: coldStart.hitRate,
      ...steadyState,
    })),
  }, null, 2))
  assert.deepEqual(
    failed.map((entry) => entry.reasoning),
    [],
    `One or more warm cache rates fell below 95% for: ${failed.map((entry) => entry.reasoning).join(', ')}`,
  )
} finally {
  if (cdp) {
    for (const agentId of agentIds) {
      try {
        await evaluate(cdp, `window.api.agent.delete(${JSON.stringify(agentId)}).then(() => true)`)
      } catch {
        // The isolated profile is removed below even if cleanup IPC fails.
      }
    }
  }
  cdp?.close()
  await stopElectron(child)
  fs.rmSync(profilePath, { recursive: true, force: true })
}
