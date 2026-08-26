import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))
const electronPath = require('electron')
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-renderer-boundary-'))
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
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function waitForPage(port) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // Electron has not opened the debugger endpoint yet.
    }
    await sleep(100)
  }
  throw new Error('Timed out waiting for Electron renderer')
}

async function stopElectron(child) {
  if (!child || child.exitCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill()
  await Promise.race([exited, sleep(5_000)])
}

let frameRequests = 0
const probeServer = http.createServer((request, response) => {
  if (request.url?.startsWith('/frame')) {
    frameRequests += 1
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<script>parent.postMessage(typeof window.api, "*")</script>')
    return
  }
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.end('cross-origin response without CORS headers')
})
await new Promise((resolve, reject) => {
  probeServer.once('error', reject)
  probeServer.listen(0, '127.0.0.1', resolve)
})
const probeAddress = probeServer.address()
assert.ok(typeof probeAddress === 'object' && probeAddress)
const probeOrigin = `http://127.0.0.1:${probeAddress.port}`

let child
let cdp
const output = []
try {
  const debugPort = await getFreePort()
  const bridgePort = await getFreePort()
  child = spawn(electronPath, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profilePath}`,
    root,
  ], {
    cwd: root,
    env: {
      ...process.env,
      WPS_ALLOW_MULTI_INSTANCE: '1',
      WPS_BRIDGE_PORT: String(bridgePort),
      WPS_TEST_USER_DATA_DIR: profilePath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout.on('data', (chunk) => output.push(String(chunk)))
  child.stderr.on('data', (chunk) => output.push(String(chunk)))

  const page = await waitForPage(debugPort)
  cdp = await connectCdp(page.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await waitFor(cdp, "document.readyState === 'complete' && Boolean(document.getElementById('root')?.childElementCount)", 'application boot')

  assert.equal(await evaluate(cdp, 'typeof window.api'), 'object', 'trusted main frame must receive the preload API')
  assert.equal(
    await evaluate(cdp, "window.api.file.getHome().then((value) => typeof value === 'string' && value.length > 0)"),
    true,
    'trusted file IPC must remain usable',
  )

  const csp = await evaluate(cdp, "document.querySelector('meta[http-equiv=Content-Security-Policy]')?.content ?? ''")
  assert.match(csp, /default-src 'self'/)
  assert.match(csp, /object-src 'none'/)
  assert.match(csp, /frame-src 'none'/)
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/)

  await evaluate(cdp, `new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.src = ${JSON.stringify(`${probeOrigin}/frame`)}
    document.body.appendChild(frame)
    setTimeout(resolve, 500)
  })`)
  assert.equal(frameRequests, 0, 'CSP must block remote frames before they load')

  const originalUrl = await evaluate(cdp, 'location.href')
  await evaluate(cdp, "location.assign('file:///C:/wps-renderer-boundary-denied.html'); true")
  await sleep(500)
  assert.equal(await evaluate(cdp, 'location.href'), originalUrl, 'foreign top-level navigation must be blocked')
  assert.equal(
    await evaluate(cdp, "window.open('data:text/html,denied', '_blank') === null"),
    true,
    'non-http(s) popups must be denied',
  )

  console.log('PASS Electron renderer privilege boundary')
} catch (error) {
  const logTail = output.join('').slice(-2_000)
  if (logTail) console.error(logTail)
  throw error
} finally {
  cdp?.close()
  await stopElectron(child)
  await new Promise((resolve) => probeServer.close(resolve))
  try {
    fs.rmSync(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // Windows can release the Electron profile shortly after process exit.
  }
}
