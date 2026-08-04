import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

type TerminalEventSink = (event: TerminalEvent) => void

export type TerminalEvent =
  | { type: 'output'; text: string }
  | { type: 'exit'; code: number | null }

let eventSink: TerminalEventSink | null = null
let shell: ChildProcessWithoutNullStreams | null = null
let shellReady = false
let cwd = os.homedir()
let buffer = ''

export function setTerminalEventSink(sink: TerminalEventSink | null): void {
  eventSink = sink
}

function emit(event: TerminalEvent): void {
  eventSink?.(event)
}

function shellCommand(): string {
  if (process.platform === 'win32') return 'cmd.exe'
  return process.env.SHELL || '/bin/bash'
}

function startShell(): void {
  if (shell) return
  buffer = ''
  shell = spawn(shellCommand(), [], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, PROMPT: '$P$G' },
  })
  shellReady = true
  if (process.platform === 'win32') {
    shell.stdin.write('chcp 65001 >nul\r\n')
  }
  shell.stdout.setEncoding('utf8')
  shell.stdout.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    emit({ type: 'output', text: lines.join('\n') + '\n' })
  })
  shell.stderr.setEncoding('utf8')
  shell.stderr.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    emit({ type: 'output', text: lines.join('\n') + '\n' })
  })
  shell.on('exit', (code) => {
    shell = null
    shellReady = false
    if (buffer) {
      emit({ type: 'output', text: buffer })
      buffer = ''
    }
    emit({ type: 'exit', code })
  })
  shell.on('error', (error) => {
    emit({ type: 'output', text: `[终端] ${error.message}\n` })
  })
}

function normalizeCwd(value: string): string {
  return path.normalize(value)
}

function looksLikeCdPath(target: string): boolean {
  if (!target) return false
  return /^[a-zA-Z]:[\\/]/.test(target)
    || target.startsWith('/')
    || target.startsWith('\\')
    || target.startsWith('~')
    || target === '..'
    || target.startsWith('..\\')
    || target.startsWith('../')
}

export async function terminalExec(input: string): Promise<{ started: boolean; cwd: string }> {
  const raw = String(input ?? '').replace(/\r?\n/g, '')
  const trimmed = raw.trim()

  if (trimmed.toLowerCase().startsWith('cd ') && looksLikeCdPath(trimmed.slice(3).trim().replace(/^["']|["']$/g, ''))) {
    const target = trimmed.slice(3).trim().replace(/^["']|["']$/g, '')
    const resolved = path.isAbsolute(target) ? target : path.resolve(cwd, target)
    try {
      const stat = await import('node:fs/promises').then((fs) => fs.stat(resolved))
      if (!stat.isDirectory()) throw new Error('not a directory')
      cwd = normalizeCwd(resolved)
      startShell()
      if (process.platform === 'win32') {
        shell!.stdin.write(`cd /d "${cwd}"\r\n`)
      } else {
        shell!.stdin.write(`cd "${cwd}"\n`)
      }
      emit({ type: 'output', text: `${cwd}\n` })
    } catch {
      emit({ type: 'output', text: `[终端] 目录不存在: ${target}\n` })
    }
    return { started: true, cwd }
  }

  startShell()
  shell!.stdin.write(raw + '\r\n')
  return { started: true, cwd }
}

export function terminalKill(): void {
  if (!shell) return
  shell.kill()
  shell = null
  shellReady = false
}
