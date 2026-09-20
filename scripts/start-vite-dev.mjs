import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createConnection } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const tauriConfig = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const devServerUrl = new URL(tauriConfig.build.devUrl)
const DEFAULT_HOST = process.env.TAURI_DEV_HOST || devServerUrl.hostname
const DEFAULT_PORT = Number(devServerUrl.port)
const IDENTITY_PATH = '/__wps_agent_editor_dev_server'
const IDENTITY_APP = 'wps-agent-editor'
const PROBE_TIMEOUT_MS = 800
const STARTUP_GRACE_MS = 3_000
const STARTUP_RETRY_MS = 200

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = realpathSync.native(resolve(scriptDirectory, '..'))
const expectedRootHash = createHash('sha256')
  .update(normalizeProjectRoot(projectRoot))
  .digest('hex')

function normalizeProjectRoot(value) {
  const normalized = value.replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function readServerTarget(args) {
  let host = DEFAULT_HOST
  let port = DEFAULT_PORT

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]

    if (argument === '--host') {
      const value = args[index + 1]
      if (value && !value.startsWith('-')) {
        host = value
        index += 1
      } else {
        host = '0.0.0.0'
      }
      continue
    }

    if (argument.startsWith('--host=')) {
      host = argument.slice('--host='.length) || '0.0.0.0'
      continue
    }

    if (argument === '--port' || argument === '-p') {
      port = Number(args[index + 1])
      index += 1
      continue
    }

    if (argument.startsWith('--port=')) {
      port = Number(argument.slice('--port='.length))
    }
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid Vite port: ${String(port)}`)
  }

  const probeHost = ['0.0.0.0', '::', '[::]'].includes(host) ? '127.0.0.1' : host
  return { host, port, probeHost }
}

function formatUrlHost(host) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

async function readIdentity(host, port) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  try {
    const response = await fetch(
      `http://${formatUrlHost(host)}:${port}${IDENTITY_PATH}`,
      {
        cache: 'no-store',
        signal: controller.signal,
      },
    )

    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function canConnect(host, port) {
  return new Promise((resolveConnection) => {
    const socket = createConnection({ host, port })
    let settled = false

    const finish = (isOpen) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolveConnection(isOpen)
    }

    socket.setTimeout(PROBE_TIMEOUT_MS)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function isExpectedServer(identity) {
  return (
    identity?.app === IDENTITY_APP && identity?.rootHash === expectedRootHash
  )
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function inspectPort(host, port) {
  if (isExpectedServer(await readIdentity(host, port))) {
    return 'same-project'
  }

  if (!(await canConnect(host, port))) {
    return 'free'
  }

  const deadline = Date.now() + STARTUP_GRACE_MS
  while (Date.now() < deadline) {
    await delay(STARTUP_RETRY_MS)
    if (isExpectedServer(await readIdentity(host, port))) {
      return 'same-project'
    }
  }

  return 'occupied'
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function main() {
  const forwardedArgs = process.argv.slice(2)
  const { port, probeHost } = readServerTarget(forwardedArgs)
  const portState = await inspectPort(probeHost, port)

  if (portState === 'same-project') {
    console.log(
      `[dev:web] Reusing this project's existing Vite server at http://${formatUrlHost(probeHost)}:${port}.`,
    )
    return
  }

  if (portState === 'occupied') {
    throw new Error(
      `Port ${port} is already used by another process. It was left running because it could not be verified as this project's Vite server.`,
    )
  }

  const require = createRequire(import.meta.url)
  const vitePackage = require.resolve('vite/package.json')
  const viteExecutable = resolve(dirname(vitePackage), 'bin/vite.js')
  const viteProcess = spawn(process.execPath, [viteExecutable, ...forwardedArgs], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })

  let stopping = false
  let requestedExitCode = 0
  let forceStopTimer
  const parentPid = process.ppid

  const stop = (exitCode) => {
    if (stopping) return
    stopping = true
    requestedExitCode = exitCode
    clearInterval(parentWatcher)

    if (viteProcess.exitCode !== null || viteProcess.signalCode !== null) {
      process.exit(requestedExitCode)
    }

    viteProcess.kill('SIGTERM')
    forceStopTimer = setTimeout(() => {
      if (viteProcess.exitCode === null && viteProcess.signalCode === null) {
        viteProcess.kill('SIGKILL')
      }
    }, 2_000)
    forceStopTimer.unref()
  }

  const parentWatcher = setInterval(() => {
    if (parentPid > 1 && !isProcessRunning(parentPid)) {
      console.log('[dev:web] Parent process exited; stopping Vite.')
      stop(0)
    }
  }, 1_000)
  parentWatcher.unref()

  process.once('SIGINT', () => stop(130))
  process.once('SIGTERM', () => stop(143))
  process.once('SIGHUP', () => stop(129))

  viteProcess.once('error', (error) => {
    clearInterval(parentWatcher)
    console.error(`[dev:web] Failed to start Vite: ${error.message}`)
    process.exit(1)
  })

  viteProcess.once('exit', (code, signal) => {
    clearInterval(parentWatcher)
    if (forceStopTimer) clearTimeout(forceStopTimer)

    if (stopping) {
      process.exit(requestedExitCode)
    }

    if (typeof code === 'number') {
      process.exit(code)
    }

    console.error(`[dev:web] Vite exited after signal ${signal || 'unknown'}.`)
    process.exit(1)
  })
}

main().catch((error) => {
  console.error(`[dev:web] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
