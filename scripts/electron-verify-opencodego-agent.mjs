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
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-opencodego-agent-verify-'))
const fixtureDir = path.join(profilePath, 'fixture')
const fixturePath = path.join(fixtureDir, 'opencodego-agent-verification.py')
const marker = `OPENCODEGO_READ_${Date.now().toString(36).toUpperCase()}`
const original = 'ORIGINAL_FUNCTION_RESULT'
const replacement = 'UPDATED_BY_OPENCODEGO'
const agentId = `opencodego-verification-${Date.now()}`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
  assert.ok(provider.id && provider.defaultModel, 'Open Code Go provider metadata is incomplete')
  return provider
}

function copyEncryptedConfiguration() {
  // Chromium's Local State contains the OS-protected encryption state required
  // for safeStorage to decrypt the copied auth store in this isolated profile.
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

async function waitForDiskChange() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const content = fs.readFileSync(fixturePath, 'utf8')
    if (content.includes(replacement) && !content.includes(original)) return content
    await sleep(100)
  }
  throw new Error('Timed out waiting for the Agent edit to be saved to disk')
}

async function stopElectron(process) {
  if (!process || process.exitCode !== null) return
  const exited = new Promise((resolve) => process.once('exit', resolve))
  process.kill()
  await Promise.race([exited, sleep(5_000)])
}

const provider = findOpenCodeGoProvider()
copyEncryptedConfiguration()
fs.mkdirSync(fixtureDir, { recursive: true })
fs.writeFileSync(
  fixturePath,
  [
    '# Open Code Go Agent verification fixture',
    `# MARKER: ${marker}`,
    '',
    'def verification_value():',
    `    return "${original}"`,
    '',
  ].join('\n'),
  'utf8',
)

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

  const currentUrl = await evaluate(cdp, 'location.href')
  const fixtureUrl = new URL(currentUrl)
  fixtureUrl.searchParams.set('openFile', fixturePath)
  await cdp.send('Page.navigate', { url: fixtureUrl.toString() })
  await waitFor(
    cdp,
    "document.querySelector('[data-testid=code-editor-root]')?.getAttribute('data-code-editor-root') !== null",
    'opened Python code editor',
    45_000,
  )
  await waitFor(cdp, "Boolean(document.querySelector('.monaco-editor .view-lines'))", 'Monaco editor')

  const authState = await evaluate(
    cdp,
    `window.api.auth.getAll().then((auth) => auth[${JSON.stringify(provider.id)}] ?? null)`,
  )
  assert.equal(authState?.configured, true, 'Open Code Go API key is not configured')

  const agent = {
    id: agentId,
    name: 'Open Code Go Verification Agent',
    role: 'Verify opened-code read and edit operations',
    systemPrompt: [
      'You are controlling the currently opened code file through document tools.',
      'For content questions, call read_document before answering.',
      'For requested edits, call replace_text with the exact strings.',
      'Tool calls must use the fenced tool JSON format from the tool instructions.',
      'After tool results arrive, continue until you can give a final answer without a tool block.',
    ].join(' '),
    providerId: provider.id,
    model: provider.defaultModel,
    reasoning: { kind: 'effort', value: 'high' },
    color: '#22c55e',
    enabled: true,
  }
  await evaluate(cdp, `window.api.agent.save(${JSON.stringify(agent)}).then(() => true)`)

  const readResult = await evaluate(
    cdp,
    `window.api.agent.chat(${JSON.stringify(agentId)}, [{
      role: 'user',
      content: 'Use read_document to inspect the currently opened file. Reply with only the exact value after MARKER:. Do not guess.'
    }], ${JSON.stringify(`${agentId}-read`)})`,
  )
  assert.ok(!readResult?.error, 'Open Code Go read request failed')
  assert.ok(
    readResult.toolCalls?.some((call) => call.tool === 'read_document' && call.result?.success === true),
    'Open Code Go did not read the opened file through read_document',
  )
  assert.ok(
    String(readResult.response ?? '').includes(marker),
    'Open Code Go did not use the opened file content in its final reply',
  )

  const editResult = await evaluate(
    cdp,
    `window.api.agent.chat(${JSON.stringify(agentId)}, [{
      role: 'user',
      content: ${JSON.stringify(`Use replace_text to replace ${original} with ${replacement} in the currently opened file. After the tool succeeds, reply DONE.`)}
    }], ${JSON.stringify(`${agentId}-edit`)})`,
  )
  assert.ok(!editResult?.error, 'Open Code Go edit request failed')
  assert.ok(
    editResult.toolCalls?.some((call) => call.tool === 'replace_text'
      && call.result?.success === true
      && call.result?.changed === true),
    'Open Code Go did not modify the opened file through replace_text',
  )

  await evaluate(cdp, "window.api.appMenu.perform('save').then(() => true)")
  const diskContent = await waitForDiskChange()
  assert.ok(diskContent.includes(marker), 'Saving the Agent edit damaged unrelated file content')

  console.log(JSON.stringify({
    provider: provider.name,
    model: provider.defaultModel,
    configured: true,
    openedCodeRead: true,
    conversationalReplyUsedFileContent: true,
    openedCodeModified: true,
    modificationSavedToDisk: true,
  }, null, 2))
} finally {
  try {
    if (cdp) await evaluate(cdp, `window.api.agent.delete(${JSON.stringify(agentId)}).then(() => true)`)
  } catch {
    // The isolated verification profile is removed below even if cleanup IPC fails.
  }
  cdp?.close()
  await stopElectron(child)
  fs.rmSync(profilePath, { recursive: true, force: true })
}
