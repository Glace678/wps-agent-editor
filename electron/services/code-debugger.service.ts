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
/* Node.js / TypeScript 鈥?CDP inspector session inside a child process */
/* ------------------------------------------------------------------ */

const NODE_CHILD_CODE = [
  "'use strict';",
  'const inspector = require(\'node:inspector\');',
  'const readline = require(\'node:readline\');',
  'const { pathToFileURL } = require(\'node:url\');',
  'const session = new inspector.Session();',
  'const post = (method, params) => new Promise((resolve, reject) => {',
  '  session.post(method, params, (err, result) => err ? reject(err) : resolve(result));',
  '});',
  'const send = (msg) => process.stdout.write(JSON.stringify(msg) + \'\\n\');',
  'let sourceUrl = \'\';',
  'let filePath = \'\';',
  'let breakpoints = [];',
  'function argText(arg) {',
  '  if (arg && arg.value !== undefined) {',
  '    if (arg.value !== null && typeof arg.value === \'object\') {',
  '      try { return JSON.stringify(arg.value); } catch (e) { return String(arg.value); }',
  '    }',
  '    return String(arg.value);',
  '  }',
  '  if (arg && arg.unserializableValue !== undefined) return String(arg.unserializableValue);',
  '  if (arg && arg.description !== undefined) return String(arg.description);',
  '  return \'[object]\';',
  '}',
  'function propText(prop) {',
  '  if (prop.value !== undefined && prop.value !== null) {',
  '    if (typeof prop.value === \'object\') {',
  '      try { return JSON.stringify(prop.value); } catch (e) { return String(prop.value); }',
  '    }',
  '    return String(prop.value);',
  '  }',
  '  if (prop.unserializableValue !== undefined) return String(prop.unserializableValue);',
  '  if (prop.objectId) return prop.description !== undefined ? String(prop.description) : \'(Object)\';',
  '  return prop.value === undefined ? \'undefined\' : String(prop.value);',
  '}',
  'async function collectVariables(params) {',
  '  const frames = (params.callFrames || []).map((frame) => ({',
  '    index: frame.callFrameId,',
  '    name: frame.functionName || \'(anonymous)\',',
  '    file: frame.url || \'\',',
  '    line: frame.location.lineNumber + 1,',
  '    column: frame.location.columnNumber + 1,',
  '  }));',
  '  const variables = [];',
  '  const top = (params.callFrames || [])[0];',
  '  if (top) {',
  '    const localScope = top.scopeChain.find((s) => s.type === \'local\');',
  '    if (localScope && localScope.object && localScope.object.objectId) {',
  '      try {',
  '        const props = await post(\'Runtime.getProperties\', {',
  '          objectId: localScope.object.objectId,',
  '          ownProperties: true,',
  '        });',
  '        const entries = (props.result || [])',
  '          .filter((p) => !String(p.name).startsWith(\'_\'))',
  '          .map((p) => ({ name: String(p.name), value: propText(p) }));',
  '        variables.push(...entries);',
  '      } catch (e) { /* ignore */ }',
  '    }',
  '  }',
  '  return { frames, variables };',
  '}',
  'async function onPaused(params) {',
  '  const frames = params.callFrames || [];',
  '  if (frames.length === 0) {',
  '    // Internal pauses (evaluation start / end of script) carry no frames.',
  '    session.post(\'Debugger.resume\');',
  '    return;',
  '  }',
  '  const reason = params.reason || \'breakpoint\';',
  '  const data = await collectVariables(params);',
  '  send({ event: \'paused\', reason, frames: data.frames, variables: data.variables });',
  '}',
  'async function run(msg) {',
  '  sourceUrl = pathToFileURL(msg.filePath).href;',
  '  filePath = msg.filePath;',
  '  breakpoints = msg.breakpoints || [];',
  '  try {',
  '    session.connect();',
  '    session.on(\'Debugger.paused\', onPaused);',
  '    session.on(\'Debugger.resumed\', () => {',
  '      send({ event: \'resumed\' });',
  '    });',
  '    session.on(\'Runtime.exceptionThrown\', (exceptionParams) => {',
  '      const details = exceptionParams.exceptionDetails || {};',
  '      const text = details.exception && details.exception.description',
  '        ? String(details.exception.description)',
  '        : details.text || \'Uncaught exception\';',
  '      send({ event: \'output\', kind: \'stderr\', text: text + \'\\n\' });',
  '    });',
  '    session.on(\'Debugger.scriptParsed\', (parsed) => {',
  '      if (parsed.url !== sourceUrl) return;',
  '      // Execution is suspended while scriptParsed is dispatched, so setting',
  '      // breakpoints here applies them before the first statement runs.',
  '      for (const bp of breakpoints) {',
  '        session.post(\'Debugger.setBreakpoint\', {',
  '          location: { scriptId: parsed.scriptId, lineNumber: bp.line - 1, columnNumber: 0 },',
  '        }, (err, result) => {',
  '          if (!err && result && result.breakpointId) {',
  '            const line = result.location ? result.location.lineNumber : bp.line - 1;',
  '            send({ event: \'breakpoint-verified\', file: filePath, line: line + 1 });',
  '          }',
  '        });',
  '      }',
  '    });',
  '    await post(\'Debugger.enable\');',
  '    await post(\'Runtime.enable\');',
  '    let code = msg.code;',
  '    if (msg.loader) {',
  '      try {',
  '        const esbuild = require(msg.esbuildPath);',
  '        code = esbuild.transformSync(code, { loader: msg.loader }).code;',
  '      } catch (e) {',
  '        send({ event: \'output\', kind: \'stderr\', text: \'Transpile failed: \' + String(e && e.message || e) + \'\\n\' });',
  '      }',
  '    }',
  '    const result = await post(\'Runtime.evaluate\', {',
  '      expression: code + \'\\n//# sourceURL=\' + sourceUrl,',
  '      includeCommandLineAPI: true,',
  '      silent: true,',
  '      awaitPromise: true,',
  '    });',
  '    if (result.exceptionDetails) {',
  '      const details = result.exceptionDetails;',
  '      const text = details.exception && details.exception.description',
  '        ? String(details.exception.description)',
  '        : details.text || \'Uncaught exception\';',
  '      send({ event: \'output\', kind: \'stderr\', text: text + \'\\n\' });',
  '    }',
  '  } catch (e) {',
  '    send({ event: \'error\', message: String(e && e.message || e) });',
  '  }',
  '  send({ event: \'exit\', code: 0 });',
  '  process.exit(0);',
  '}',
  'async function evaluate(msg) {',
  '  try {',
  '    const result = await post(\'Runtime.evaluate\', {',
  '      expression: msg.expression,',
  '      includeCommandLineAPI: true,',
  '      silent: true,',
  '    });',
  '    if (result.exceptionDetails) {',
  '      const details = result.exceptionDetails;',
  '      const text = details.exception && details.exception.description',
  '        ? String(details.exception.description)',
  '        : details.text || \'Evaluation failed\';',
  '      send({ event: \'eval-result\', id: msg.id, error: text });',
  '    } else {',
  '      send({ event: \'eval-result\', id: msg.id, result: argText(result.result) });',
  '    }',
  '  } catch (e) {',
  '    send({ event: \'eval-result\', id: msg.id, error: String(e && e.message || e) });',
  '  }',
  '}',
  'readline.createInterface({ input: process.stdin }).on(\'line\', (line) => {',
  '  let msg;',
  '  try { msg = JSON.parse(line); } catch (e) { return; }',
  '  if (msg.type === \'start\') {',
  '    void run(msg);',
  '  } else if (msg.type === \'stop\') {',
  '    process.exit(0);',
  '  } else if (msg.type === \'continue\') {',
  '    session.post(\'Debugger.resume\');',
  '  } else if (msg.type === \'step-over\') {',
  '    session.post(\'Debugger.stepOver\');',
  '  } else if (msg.type === \'step-into\') {',
  '    session.post(\'Debugger.stepInto\');',
  '  } else if (msg.type === \'step-out\') {',
  '    session.post(\'Debugger.stepOut\');',
  '  } else if (msg.type === \'evaluate\') {',
  '    void evaluate(msg);',
  '  }',
  '});',
].join('\n')

interface NodeSession extends DebugSession {
  kind: 'node'
  child: ChildProcessWithoutNullStreams
}

async function createNodeSession(
  filePath: string,
  breakpoints: DebugBreakpoint[],
): Promise<DebugSession | null> {
  const code = await fs.readFile(filePath, 'utf8')
  const child = spawn(process.execPath, ['-e', NODE_CHILD_CODE], {
    cwd: path.dirname(filePath),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const interface_ = createInterface({ input: child.stdout })
  interface_.on('line', (line) => {
    try {
      const message = JSON.parse(line) as DebugEvent & Record<string, unknown>
      emit(message)
    } catch {
      // Ignore non-JSON lines
    }
  })

  child.on('error', (error) => {
    emit({ event: 'error', message: String(error.message) })
  })
  child.on('exit', (code) => {
    if (activeSession && activeSession.filePath === filePath) {
      emit({ event: 'exit', code })
      activeSession = null
    }
    interface_.close()
  })

  const session: NodeSession = {
    kind: 'node',
    filePath,
    child,
    stop() {
      child.stdin.write(JSON.stringify({ type: 'stop' }) + '\n')
      const killer = setTimeout(() => child.kill(), 800)
      killer.unref()
    },
    sendCommand(command) {
      const mapping: Record<DebugCommand, string> = {
        continue: 'continue',
        'step-over': 'step-over',
        'step-into': 'step-into',
        'step-out': 'step-out',
      }
      child.stdin.write(JSON.stringify({ type: mapping[command] }) + '\n')
    },
    evaluate(expression, id) {
      child.stdin.write(JSON.stringify({ type: 'evaluate', expression, id }) + '\n')
    },
  }

  child.stdin.write(JSON.stringify({
    type: 'start',
    filePath,
    code,
    breakpoints,
  }) + '\n')

  return session
}

/* ------------------------------------------------------------------ */
/* Python 鈥?drive the standard library pdb debugger over a pipe       */
/* ------------------------------------------------------------------ */

type PdbLastCommand =
  | 'start'
  | 'set-break'
  | 'continue'
  | 'step'
  | 'next'
  | 'return'
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

const PDB_STACK_LINE = /^(>|\s+)(.*?)\((\d+)\)([A-Za-z_<][\w.<>]*)?/
const PDB_RETURN_LINE = /^--Return--/
const PDB_FINISHED_LINE = /The program finished/

function pdbStackFrames(lines: string[]): Array<{
  index: number
  name: string
  file: string
  line: number
  column: number
}> {
  const frames: Array<{ index: number; name: string; file: string; line: number; column: number }> = []
  for (const line of lines) {
    const match = PDB_STACK_LINE.exec(line.trim())
    if (!match) continue
    frames.push({
      index: frames.length,
      name: match[4] ? String(match[4]) : '<module>',
      file: match[2],
      line: Number(match[3]),
      column: 1,
    })
  }
  return frames
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

  const interface_ = createInterface({ input: child.stdout })
  const onLine = (line: string) => {
    if (line.trim() === '(Pdb)') {
      onPrompt()
      return
    }
    session.pendingLines.push(line)
  }

  const onPrompt = () => {
    const raw = session.pendingLines
    session.pendingLines = []

    const isReturn = raw.some((line) => PDB_RETURN_LINE.test(line.trim()))
    const isFinished = raw.some((line) => PDB_FINISHED_LINE.test(line))

    if (session.lastCommand === 'start') {
      session.breakIndex = 0
      if (breakpoints.length === 0) {
        session.lastCommand = 'continue'
        child.stdin.write('continue\n')
        return
      }
      session.lastCommand = 'set-break'
      const first = breakpoints[0]
      session.breakpointSet.add(`${first.file}:${first.line}`)
      child.stdin.write(`break ${first.file}:${first.line}\n`)
      return
    }

    if (session.lastCommand === 'set-break') {
      session.breakIndex += 1
      if (session.breakIndex < breakpoints.length) {
        const next = breakpoints[session.breakIndex]
        session.breakpointSet.add(`${next.file}:${next.line}`)
        child.stdin.write(`break ${next.file}:${next.line}\n`)
        return
      }
      session.lastCommand = 'continue'
      child.stdin.write('continue\n')
      return
    }

    if (session.lastCommand === 'vars') {
      const paused = session.pendingPaused
      session.pendingPaused = null
      session.lastCommand = 'none'
      const body = raw
        .filter((line) => !PDB_STACK_LINE.test(line.trim()))
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
      const pending = session.pendingEval
      session.pendingEval = null
      session.lastCommand = 'none'
      const body = raw.join('\n').trim()
      emit({
        event: 'eval-result',
        id: pending?.id ?? '',
        result: body || '(no value)',
      })
      return
    }

    if (isFinished) {
      emit({ event: 'output', kind: 'stdout', text: 'The program finished.\n' })
      emit({ event: 'exit', code: 0 })
      quitPdb(session)
      session.lastCommand = 'none'
      return
    }

    const frames = pdbStackFrames(raw)
    const current = frames[0]

    if (current && session.lastCommand === 'continue') {
      const key = `${current.file}:${current.line}`
      const hitBreakpoint = session.breakpointSet.has(key)
      if (!hitBreakpoint) {
        // The program terminated without hitting a breakpoint (e.g. an exception).
        const text = raw.join('\n').replace(/^\s+/gm, '')
        if (text) emit({ event: 'output', kind: 'stderr', text: `${text}\n` })
        emit({ event: 'exit', code: 1 })
        quitPdb(session)
        session.lastCommand = 'none'
        return
      }
      session.pendingPaused = {
        reason: 'breakpoint',
        frames: frames.map((frame) => ({
          index: frame.index,
          name: frame.name,
          file: frame.file,
          line: frame.line,
          column: frame.column,
        })),
      }
      sendPdbVarsQuery(session)
      return
    }

    if (current && ['step', 'next', 'return'].includes(session.lastCommand)) {
      session.pendingPaused = {
        reason: isReturn ? 'step-out' : 'step',
        frames: frames.map((frame) => ({
          index: frame.index,
          name: frame.name,
          file: frame.file,
          line: frame.line,
          column: frame.column,
        })),
      }
      sendPdbVarsQuery(session)
      return
    }

    session.lastCommand = 'none'
  }

  interface_.on('line', onLine)
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
  try {
    child.stdin.write('\n')
  } catch {
    // Ignore
  }

  return session
}
