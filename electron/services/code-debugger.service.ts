import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import { normalizePath } from './file.service'
import type {
  DebugBreakpoint,
  DebugCommand,
  DebugEvent,
  DebugStartResult,
  DebugVariable,
} from '../../src/types/code'

const require = createRequire(import.meta.url)

type DebugEventSink = (event: DebugEvent) => void

let eventSink: DebugEventSink | null = null
let activeSession: DebugSession | null = null

export function setDebugEventSink(sink: DebugEventSink | null): void {
  eventSink = sink
}

function emit(event: DebugEvent): void {
  eventSink?.(event)
}

export function hasActiveDebugSession(): boolean {
  return activeSession !== null
}

interface DebugSession {
  kind: 'node' | 'python'
  filePath: string
  stop(): void
  sendCommand(command: DebugCommand): void
  evaluate(expression: string, id: string): void
}

function extensionOf(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase()
}

function pickPythonCommand(): string[] {
  if (process.platform === 'win32') {
    return ['python', 'py']
  }
  return ['python3', 'python']
}

function probeCommand(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(command, ['--version'], { timeout: 5000 }, (error) => {
      resolve(!error)
    })
  })
}

export async function startDebugSession(
  inputPath: string,
  breakpoints: DebugBreakpoint[],
): Promise<DebugStartResult> {
  stopDebugSession()
  const filePath = normalizePath(inputPath)
  const extension = extensionOf(filePath)
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat || !stat.isFile()) {
    return { ok: false, error: 'failed' }
  }

  try {
    if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'].includes(extension)) {
      const session = await createNodeSession(filePath, breakpoints)
      if (!session) return { ok: false, error: 'failed' }
      activeSession = session
      emit({ event: 'started', kind: 'node' })
      return { ok: true, kind: 'node' }
    }
    if (['py', 'pyw'].includes(extension)) {
      const session = await createPythonSession(filePath, breakpoints)
      if (!session) return { ok: false, error: 'failed' }
      activeSession = session
      emit({ event: 'started', kind: 'python' })
      return { ok: true, kind: 'python' }
    }
    return { ok: false, error: 'unsupported' }
  } catch (error) {
    stopDebugSession()
    emit({ event: 'error', message: error instanceof Error ? error.message : String(error) })
    return { ok: false, error: 'failed' }
  }
}

export function stopDebugSession(): void {
  activeSession?.stop()
  activeSession = null
}

export function sendDebugCommand(command: DebugCommand): void {
  activeSession?.sendCommand(command)
}

export function evaluateDebugExpression(expression: string, id: string): void {
  if (!activeSession || !expression.trim()) return
  activeSession.evaluate(expression, id)
}

/* ------------------------------------------------------------------ */
/* Node.js / TypeScript 鈥?real CDP debugging over WebSocket            */
/* ------------------------------------------------------------------ */

interface NodeSession extends DebugSession {
  kind: 'node'
  child: ChildProcessWithoutNullStreams
  ws: WebSocket
}

function isDebugScriptUrl(url: string, scriptPath: string): boolean {
  if (!url) return false
  const normalized = url.replace(/^file:\/\//, '').replace(/^\/+/, '')
  const candidates = [
    scriptPath,
    scriptPath.replace(/\\/g, '/'),
  ]
  return candidates.some((candidate) => {
    const c = candidate.replace(/^[a-zA-Z]:/, '').replace(/\\/g, '/')
    return normalized.replace(/^[a-zA-Z]:/, '').replace(/\\/g, '/') === c
  })
}

function bootCodeFor(scriptPath: string): string {
  return [
    'global.__wpsDebugRequire = require;',
    `global.__wpsDebugScriptPath = process.argv[1] || ${JSON.stringify(scriptPath)};`,
    'global.__wpsDebugRequire(global.__wpsDebugScriptPath);',
  ].join('\n')
}

async function createNodeSession(
  filePath: string,
  breakpoints: DebugBreakpoint[],
): Promise<DebugSession | null> {
  const { default: WebSocket } = await import('ws')

  // Transpile TypeScript / JSX / ESM so the script can run inside a CommonJS boot.
  const extension = extensionOf(filePath)
  let code = await fs.readFile(filePath, 'utf8')
  let scriptPath = filePath
  if (['ts', 'tsx', 'mjs', 'jsx'].includes(extension)) {
    let transpiled = code
    try {
      const esbuild = require('esbuild')
      const loader = extension === 'tsx' ? 'tsx' : extension === 'jsx' ? 'jsx' : extension === 'ts' ? 'ts' : 'js'
      transpiled = esbuild.transformSync(code, { loader, format: 'cjs' }).code
    } catch (error) {
      emit({ event: 'error', message: `Transpile failed: ${error instanceof Error ? error.message : String(error)}` })
      return null
    }
    const tempRoot = await fs.mkdtemp(path.join(await import('node:os').then((os) => os.tmpdir()), 'wps-debug-run-'))
    const name = path.basename(filePath).replace(/\.(ts|tsx|mjs|jsx)$/i, '.js')
    scriptPath = path.join(tempRoot, name)
    await fs.writeFile(scriptPath, transpiled, 'utf8')
  }

  const child = spawn(process.execPath, ['--inspect-brk=0', '-e', bootCodeFor(scriptPath), scriptPath], {
    cwd: path.dirname(filePath),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const stderrInterface = createInterface({ input: child.stderr })
  const stdoutInterface = createInterface({ input: child.stdout })
  stdoutInterface.on('line', (line) => {
    emit({ event: 'output', kind: 'stdout', text: `${line}\n` })
  })
  stderrInterface.on('line', (line) => {
    if (/ws:\/\/[^\s]+/.test(line)) return
    emit({ event: 'output', kind: 'stderr', text: `${line}\n` })
  })

  let started = false
  let stopped = false
  let resumeAfterBreakpoints: (() => void) | null = null
  let wsUrl = ''

  const waitForWsUrl = new Promise<string>((resolve) => {
    const matcher = (line: string) => {
      const match = /ws:\/\/[^\s]+/.exec(line)
      if (!match) return
      stderrInterface.off('line', matcher)
      resolve(match[0])
    }
    stderrInterface.on('line', matcher)
  })

  try {
    wsUrl = await Promise.race([
      waitForWsUrl,
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Inspector did not start.')), 10_000)),
    ])
  } catch {
    emit({ event: 'error', message: 'The Node debugger failed to start.' })
    child.kill()
    stdoutInterface.close()
    stderrInterface.close()
    return null
  }

  let ws: WebSocket
  let wsConnected = false
  try {
    ws = new WebSocket(wsUrl)
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve())
      ws.on('error', () => reject(new Error('Inspector connection failed.')))
    })
    wsConnected = true
  } catch {
    emit({ event: 'error', message: 'Could not connect to the Node debugger.' })
    child.kill()
    stdoutInterface.close()
    stderrInterface.close()
    return null
  }

  let commandId = 0
  let armed = false
  let brkPauseArrived = false
  let setupFailed = false
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const cdp = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => new Promise((resolve, reject) => {
    const id = ++commandId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

  const mapFile = (url: string): string => (isDebugScriptUrl(url, scriptPath) ? filePath : url)

  const collectVariables = async (frame: { scopeChain?: Array<{ type: string; object?: { objectId?: string } }> }) => {
    const variables: DebugVariable[] = []
    const localScope = frame.scopeChain?.find((scope) => scope.type === 'local')
    if (localScope?.object?.objectId) {
      try {
        const props = await cdp('Runtime.getProperties', {
          objectId: localScope.object.objectId,
          ownProperties: true,
        }) as { result?: Array<{ name: string; value?: { value?: unknown; description?: string }; unserializableValue?: unknown; objectId?: string; description?: string }> }
        for (const prop of props.result ?? []) {
          if (String(prop.name).startsWith('_')) continue
          let value: string
          if (prop.value !== undefined && prop.value !== null) {
            value = typeof prop.value.value === 'object'
              ? JSON.stringify(prop.value.value)
              : String(prop.value.value ?? prop.value.description ?? '')
          } else if (prop.unserializableValue !== undefined) {
            value = String(prop.unserializableValue)
          } else if (prop.objectId) {
            value = prop.description ?? '(Object)'
          } else {
            value = 'undefined'
          }
          variables.push({ name: String(prop.name), value })
        }
      } catch {
        // ignore
      }
    }
    return variables
  }

  const onPaused = async (params: {
    reason?: string
    callFrames?: Array<{
      callFrameId: string
      functionName: string
      url: string
      location: { lineNumber: number; columnNumber: number }
      scopeChain?: Array<{ type: string; object?: { objectId?: string } }>
    }>
  }) => {
    const frames = params.callFrames ?? []
    if (frames.length === 0) {
      // Internal pause (end of script) 鈥?resume silently.
      void cdp('Debugger.resume').catch(() => {})
      return
    }
    if (!armed) {
      // Break-on-start pause 鈥?hold until breakpoints are armed.
      brkPauseArrived = true
      if (armed) void cdp('Debugger.resume').catch(() => {})
      return
    }
    const variables = await collectVariables(frames[0])
    emit({
      event: 'paused',
      reason: params.reason ?? 'breakpoint',
      frames: frames.map((frame, index) => ({
        index,
        name: frame.functionName || '(anonymous)',
        file: mapFile(frame.url),
        line: frame.location.lineNumber + 1,
        column: frame.location.columnNumber + 1,
      })),
      variables,
    })
  }

  ws.on('message', (data: Buffer) => {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(String(data)) as Record<string, unknown>
    } catch {
      return
    }
    if (typeof message.id === 'number' && pending.has(message.id)) {
      const entry = pending.get(message.id)!
      pending.delete(message.id)
      if (message.error) {
        entry.reject(new Error(String((message.error as { message?: string }).message ?? 'CDP error')))
      } else {
        entry.resolve(message.result)
      }
      return
    }
    const method = String(message.method ?? '')
    if (method === 'Debugger.paused') {
      void onPaused(message.params as Parameters<typeof onPaused>[0])
    } else if (method === 'Debugger.resumed') {
      emit({ event: 'resumed' })
    } else if (method === 'Debugger.breakpointResolved') {
      const location = (message.params as { location?: { lineNumber?: number } })?.location
      emit({
        event: 'breakpoint-verified',
        file: filePath,
        line: (location?.lineNumber ?? -1) + 1,
      })
    } else if (method === 'Runtime.exceptionThrown') {
      const details = (message.params as { exceptionDetails?: { exception?: { description?: string }; text?: string } })?.exceptionDetails
      const text = details?.exception?.description ?? details?.text ?? 'Uncaught exception'
      emit({ event: 'output', kind: 'stderr', text: `${text}\n` })
    }
  })

  try {
    await cdp('Debugger.enable')
    await cdp('Runtime.enable')
    const urlForms = [
      pathToFileURL(scriptPath).href,
      scriptPath.replace(/\\/g, '/'),
      scriptPath,
    ]
    for (const bp of breakpoints) {
      for (const url of urlForms) {
        await cdp('Debugger.setBreakpointByUrl', {
          lineNumber: bp.line - 1,
          url,
        }).catch(() => {})
      }
    }
    armed = true
    if (brkPauseArrived) void cdp('Debugger.resume').catch(() => {})
  } catch (error) {
    setupFailed = true
    emit({ event: 'error', message: error instanceof Error ? error.message : String(error) })
  }

  child.on('error', (error) => {
    if (!stopped) emit({ event: 'error', message: String(error.message) })
  })
  child.on('exit', (code) => {
    if (activeSession && activeSession.filePath === filePath) {
      emit({ event: 'exit', code })
      activeSession = null
    }
    stdoutInterface.close()
    stderrInterface.close()
    try {
      ws.close()
    } catch {
      // ignore
    }
  })

  const session: NodeSession = {
    kind: 'node',
    filePath,
    child,
    ws,
    stop() {
      stopped = true
      try {
        ws.close()
      } catch {
        // ignore
      }
      const killer = setTimeout(() => child.kill(), 400)
      killer.unref()
    },
    sendCommand(command) {
      const mapping: Record<DebugCommand, string> = {
        continue: 'Debugger.resume',
        'step-over': 'Debugger.stepOver',
        'step-into': 'Debugger.stepInto',
        'step-out': 'Debugger.stepOut',
      }
      void cdp(mapping[command]).catch(() => {})
    },
    evaluate(expression, id) {
      void cdp('Runtime.evaluate', {
        expression,
        includeCommandLineAPI: true,
        silent: true,
      }).then((result) => {
        const evaluated = result as { result?: { value?: unknown; description?: string }; exceptionDetails?: { exception?: { description?: string }; text?: string } }
        if (evaluated.exceptionDetails) {
          emit({
            event: 'eval-result',
            id,
            error: evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text ?? 'Evaluation failed',
          })
        } else {
          const value = evaluated.result?.value ?? evaluated.result?.description ?? '(undefined)'
          emit({ event: 'eval-result', id, result: typeof value === 'object' ? JSON.stringify(value) : String(value) })
        }
      }).catch((error) => {
        emit({ event: 'eval-result', id, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }

  return setupFailed ? null : session
}
}

/* ------------------------------------------------------------------ */
/* Python 鈥?drive the standard library pdb debugger over a pipe       */
/* ------------------------------------------------------------------ */

type PdbLastCommand =
  | 'start'
  | 'set-break'
  | 'continue'
  | 'step'
  | 'vars'
  | 'eval'
  | 'none'

interface PdbPausedState {
  reason: string
  frames: Array<{ index: number; name: string; file: string; line: number; column: number }>
}

interface PythonSession extends DebugSession {
  kind: 'python'
  child: ChildProcessWithoutNullStreams
  pendingLines: string[]
  lastCommand: PdbLastCommand
  breakIndex: number
  pendingPaused: PdbPausedState | null
  pendingEval: { id: string } | null
  breakpointSet: Set<string>
}

/** pdb prefixes the current frame with '>' e.g. "> C:\\path\\prog.py(5)add()" */
const PDB_CURRENT_LINE = /^>(.*?)\((\d+)\)/
const PDB_ACK_LINE = /Breakpoint\s+\d+\s+at|Error in argument/
const PDB_RETURN_LINE = /^--Return--/
const PDB_FINISHED_LINE = /The program finished/

function pdbBreakpointKey(file: string, line: number): string {
  const normalized = process.platform === 'win32' ? file.toLowerCase() : file
  return `${normalized}:${line}`
}

function pdbCurrentFrame(lines: string[]): { file: string; line: number; name: string } | null {
  for (const line of lines) {
    const match = PDB_CURRENT_LINE.exec(line.trim())
    if (!match) continue
    return {
      file: match[1].trim(),
      line: Number(match[2]),
      name: line.includes('()') ? '<module>' : line.slice(line.lastIndexOf('(') + 1, line.lastIndexOf(')')).split('(')[0] || '<module>',
    }
  }
  return null
}

function programOutputOf(lines: string[]): string {
  return lines
    .filter((line) => !PDB_CURRENT_LINE.test(line.trim()) && !line.trim().startsWith('->'))
    .join('\n')
}

function sendPdbVarsQuery(session: PythonSession): void {
  session.lastCommand = 'vars'
  try {
    session.child.stdin.write('p {k: repr(v) for k, v in list(locals().items())}\n')
  } catch {
    session.lastCommand = 'none'
  }
}

function quitPdb(session: PythonSession): void {
  try {
    session.child.stdin.write('quit\n')
  } catch {
    // Already closed
  }
}

async function createPythonSession(
  filePath: string,
  breakpoints: DebugBreakpoint[],
): Promise<DebugSession | null> {
  const commands = pickPythonCommand()
  let pythonCommand: string | null = null
  for (const command of commands) {
    if (await probeCommand(command)) {
      pythonCommand = command
      break
    }
  }
  if (!pythonCommand) return null
  const child = spawn(pythonCommand, ['-u', '-m', 'pdb', filePath], {
    cwd: path.dirname(filePath),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const session: PythonSession = {
    kind: 'python',
    filePath,
    child,
    pendingLines: [],
    lastCommand: 'none',
    breakIndex: 0,
    pendingPaused: null,
    pendingEval: null,
    breakpointSet: new Set(),
    stop() {
      quitPdb(session)
      const killer = setTimeout(() => child.kill(), 800)
      killer.unref()
    },
    sendCommand(command) {
      const mapping: Record<DebugCommand, string> = {
        continue: 'continue',
        'step-over': 'next',
        'step-into': 'step',
        'step-out': 'return',
      }
      session.lastCommand = mapping[command] as PdbLastCommand
      try {
        child.stdin.write(`${mapping[command]}\n`)
      } catch {
        // Ignore
      }
    },
    evaluate(expression, id) {
      session.lastCommand = 'eval'
      session.pendingEval = { id }
      try {
        child.stdin.write(`p ${expression}\n`)
      } catch {
        emit({ event: 'eval-result', id, error: 'Debugger is not responding.' })
        session.lastCommand = 'none'
        session.pendingEval = null
      }
    },
  }

  let rawBuffer = ''
  const onData = (chunk: string) => {
    rawBuffer += chunk
    let promptIndex = rawBuffer.indexOf('(Pdb) ')
    while (promptIndex !== -1) {
      const prefix = rawBuffer.slice(0, promptIndex)
      rawBuffer = rawBuffer.slice(promptIndex + '(Pdb) '.length)
      const lines = prefix.split(/\r?\n/).filter((line) => line.length > 0)
      if (lines.length > 0) session.pendingLines.push(...lines)
      onPrompt()
      promptIndex = rawBuffer.indexOf('(Pdb) ')
    }
  }

  const onPrompt = () => {
    const raw = session.pendingLines
    session.pendingLines = []
    console.log('[pdb] prompt, lastCommand=' + session.lastCommand, JSON.stringify(raw))

    if (session.lastCommand === 'start') {
      session.breakIndex = 0
      if (breakpoints.length === 0) {
        session.lastCommand = 'continue'
        child.stdin.write('continue\n')
        return
      }
      session.lastCommand = 'set-break'
      const first = breakpoints[0]
      session.breakpointSet.add(pdbBreakpointKey(first.file, first.line))
      child.stdin.write(`break ${first.file}:${first.line}\n`)
      return
    }

    if (session.lastCommand === 'set-break') {
      // Skip empty echo prompts until the ack arrives.
      if (!raw.some((line) => PDB_ACK_LINE.test(line))) return
      session.breakIndex += 1
      if (session.breakIndex < breakpoints.length) {
        const next = breakpoints[session.breakIndex]
        session.breakpointSet.add(pdbBreakpointKey(next.file, next.line))
        child.stdin.write(`break ${next.file}:${next.line}\n`)
        return
      }
      session.lastCommand = 'continue'
      child.stdin.write('continue\n')
      return
    }

    if (session.lastCommand === 'vars') {
      if (raw.length === 0) return
      const paused = session.pendingPaused
      session.pendingPaused = null
      session.lastCommand = 'none'
      const body = raw
        .filter((line) => !PDB_CURRENT_LINE.test(line.trim()) && !line.trim().startsWith('->'))
        .join('\n')
        .trim()
      const variables: DebugVariable[] = []
      if (paused && body) {
        variables.push({ name: 'locals', value: body.slice(0, 8000) })
      }
      if (paused) {
        emit({
          event: 'paused',
          reason: paused.reason,
          frames: paused.frames,
          variables,
        })
      }
      return
    }

    if (session.lastCommand === 'eval') {
      if (raw.length === 0) return
      const pending = session.pendingEval
      session.pendingEval = null
      session.lastCommand = 'none'
      const body = raw
        .filter((line) => !PDB_CURRENT_LINE.test(line.trim()) && !line.trim().startsWith('->'))
        .join('\n')
        .trim()
      emit({
        event: 'eval-result',
        id: pending?.id ?? '',
        result: body || '(no value)',
      })
      return
    }

    const isFinished = raw.some((line) => PDB_FINISHED_LINE.test(line))
    const isReturn = raw.some((line) => PDB_RETURN_LINE.test(line.trim()))
    const current = pdbCurrentFrame(raw)

    if (session.lastCommand === 'continue' || session.lastCommand === 'step') {
      if (!current && !isFinished) return
      if (isFinished) {
        const output = programOutputOf(raw)
        if (output) emit({ event: 'output', kind: 'stdout', text: `${output}\n` })
        emit({ event: 'output', kind: 'stdout', text: 'The program finished.\n' })
        emit({ event: 'exit', code: 0 })
        quitPdb(session)
        session.lastCommand = 'none'
        return
      }
      const frames = current
        ? [{
            index: 0,
            name: current.name,
            file: current.file,
            line: current.line,
            column: 1,
          }]
        : []
      if (session.lastCommand === 'continue') {
        const key = pdbBreakpointKey(current!.file, current!.line)
        const hitBreakpoint = session.breakpointSet.has(key)
        console.log('[pdb] continue key=' + key + ' hit=' + hitBreakpoint + ' set=' + JSON.stringify([...session.breakpointSet]))
        const output = programOutputOf(raw)
        if (hitBreakpoint) {
          if (output) emit({ event: 'output', kind: 'stdout', text: `${output}\n` })
          session.pendingPaused = { reason: 'breakpoint', frames }
          sendPdbVarsQuery(session)
          return
        }
        // Program terminated without hitting a breakpoint (e.g. an exception).
        if (output) emit({ event: 'output', kind: 'stderr', text: `${output}\n` })
        emit({ event: 'exit', code: 1 })
        quitPdb(session)
        session.lastCommand = 'none'
        return
      }
      const output = programOutputOf(raw)
      if (output) emit({ event: 'output', kind: 'stdout', text: `${output}\n` })
      session.pendingPaused = { reason: isReturn ? 'step-out' : 'step', frames }
      sendPdbVarsQuery(session)
      return
    }

    session.lastCommand = 'none'
  }

  child.stdout.on('data', (chunk) => onData(String(chunk)))
  child.stdout.on('end', () => {
    if (activeSession && activeSession.filePath === filePath) {
      emit({ event: 'exit', code: null })
      activeSession = null
    }
  })
  child.on('error', (error) => {
    emit({ event: 'error', message: String(error.message) })
  })

  session.lastCommand = 'start'

  return session
}
