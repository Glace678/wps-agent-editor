import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { getCodeLanguage } from '../../src/lib/code-languages'
import type { CodeRunResult } from '../../src/types/code'
import { normalizePath } from './file.service'

const require = createRequire(import.meta.url)
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const RUN_TIMEOUT_MS = 30_000

interface CommandSpec {
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
}

interface CommandResult {
  success: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  errorCode?: CodeRunResult['errorCode']
}

function quoteArgument(value: string): string {
  return /\s|["']/.test(value) ? JSON.stringify(value) : value
}

function displayCommand(spec: CommandSpec): string {
  return [spec.command, ...spec.args].map(quoteArgument).join(' ')
}

function execute(spec: CommandSpec, cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(spec.command, spec.args, {
      cwd,
      env: spec.env ?? process.env,
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT_BYTES,
      timeout: RUN_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ success: true, exitCode: 0, stdout, stderr })
        return
      }

      const failure = error as NodeJS.ErrnoException & {
        code?: string | number
        killed?: boolean
      }
      const missing = failure.code === 'ENOENT'
      const timedOut = Boolean(failure.killed) || failure.code === 'ETIMEDOUT'
      resolve({
        success: false,
        exitCode: typeof failure.code === 'number' ? failure.code : null,
        stdout: String(stdout ?? ''),
        stderr: String(stderr || error.message),
        errorCode: missing ? 'runtime-missing' : timedOut ? 'timeout' : 'failed',
      })
    })
  })
}

async function executeWithFallback(
  specs: CommandSpec[],
  cwd: string,
): Promise<{ spec: CommandSpec; result: CommandResult }> {
  let last = specs[0]
  let result: CommandResult = {
    success: false,
    exitCode: null,
    stdout: '',
    stderr: 'No runtime configured.',
    errorCode: 'runtime-missing',
  }
  for (const spec of specs) {
    last = spec
    result = await execute(spec, cwd)
    if (result.errorCode !== 'runtime-missing') break
  }
  return { spec: last, result }
}

function electronNodeSpec(args: string[]): CommandSpec {
  return {
    command: process.execPath,
    args,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }
}

async function buildRunSteps(
  filePath: string,
  tempDir: string,
): Promise<{ compile?: CommandSpec; run: CommandSpec; fallbacks?: CommandSpec[] } | null> {
  const extension = path.extname(filePath).slice(1).toLowerCase()
  const output = path.join(tempDir, process.platform === 'win32' ? 'program.exe' : 'program')

  if (['js', 'jsx', 'mjs', 'cjs'].includes(extension)) {
    return { run: electronNodeSpec([filePath]) }
  }
  if (['ts', 'tsx'].includes(extension)) {
    return { run: electronNodeSpec([require.resolve('tsx/cli'), filePath]) }
  }
  if (['py', 'pyw'].includes(extension)) {
    const specs: CommandSpec[] = process.platform === 'win32'
      ? [{ command: 'python', args: [filePath] }, { command: 'py', args: ['-3', filePath] }]
      : [{ command: 'python3', args: [filePath] }, { command: 'python', args: [filePath] }]
    return { run: specs[0], fallbacks: specs }
  }
  if (extension === 'c') {
    return {
      compile: { command: 'gcc', args: [filePath, '-o', output] },
      run: { command: output, args: [] },
    }
  }
  if (['cc', 'cpp', 'cxx'].includes(extension)) {
    return {
      compile: { command: 'g++', args: [filePath, '-std=c++17', '-o', output] },
      run: { command: output, args: [] },
    }
  }
  if (extension === 'java') {
    const source = await fs.readFile(filePath, 'utf8')
    const packageName = source.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1]
    const className = path.basename(filePath, path.extname(filePath))
    return {
      compile: { command: 'javac', args: ['-encoding', 'UTF-8', '-d', tempDir, filePath] },
      run: { command: 'java', args: ['-cp', tempDir, packageName ? `${packageName}.${className}` : className] },
    }
  }
  if (extension === 'go') return { run: { command: 'go', args: ['run', filePath] } }
  if (extension === 'rs') {
    return {
      compile: { command: 'rustc', args: [filePath, '-o', output] },
      run: { command: output, args: [] },
    }
  }
  if (['kt', 'kts'].includes(extension)) {
    const jar = path.join(tempDir, 'program.jar')
    return {
      compile: { command: 'kotlinc', args: [filePath, '-include-runtime', '-d', jar] },
      run: { command: 'java', args: ['-jar', jar] },
    }
  }
  if (extension === 'swift') return { run: { command: 'swift', args: [filePath] } }
  if (extension === 'dart') return { run: { command: 'dart', args: ['run', filePath] } }
  if (extension === 'rb') return { run: { command: 'ruby', args: [filePath] } }
  if (extension === 'php') return { run: { command: 'php', args: [filePath] } }
  if (['pl', 'pm'].includes(extension)) return { run: { command: 'perl', args: [filePath] } }
  if (extension === 'lua') return { run: { command: 'lua', args: [filePath] } }
  if (extension === 'r') return { run: { command: 'Rscript', args: [filePath] } }
  if (extension === 'jl') return { run: { command: 'julia', args: [filePath] } }
  if (['sh', 'bash', 'zsh'].includes(extension)) return { run: { command: 'bash', args: [filePath] } }
  if (extension === 'fish') return { run: { command: 'fish', args: [filePath] } }
  if (extension === 'ps1') {
    const command = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
    return { run: { command, args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', filePath] } }
  }
  if (['bat', 'cmd'].includes(extension) && process.platform === 'win32') {
    return { run: { command: 'cmd.exe', args: ['/d', '/c', filePath] } }
  }
  return null
}

export async function runCodeFile(inputPath: string): Promise<CodeRunResult> {
  const startedAt = Date.now()
  const filePath = normalizePath(inputPath)
  const language = getCodeLanguage(filePath)
  if (!language?.runnable) {
    return {
      success: false,
      exitCode: null,
      stdout: '',
      stderr: 'This file type does not have a configured runner.',
      command: '',
      durationMs: Date.now() - startedAt,
      errorCode: 'unsupported',
    }
  }

  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error('CODE_RUN_NOT_A_FILE')

  const tempRoot = path.resolve(os.tmpdir())
  const tempDir = await fs.mkdtemp(path.join(tempRoot, 'wps-code-run-'))
  try {
    const steps = await buildRunSteps(filePath, tempDir)
    if (!steps) {
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: 'This file type does not have a configured runner.',
        command: '',
        durationMs: Date.now() - startedAt,
        errorCode: 'unsupported',
      }
    }

    let command = ''
    let stdout = ''
    let stderr = ''
    if (steps.compile) {
      command = displayCommand(steps.compile)
      const compiled = await execute(steps.compile, path.dirname(filePath))
      stdout += compiled.stdout
      stderr += compiled.stderr
      if (!compiled.success) {
        return {
          ...compiled,
          command,
          durationMs: Date.now() - startedAt,
        }
      }
    }

    const executed = steps.fallbacks
      ? await executeWithFallback(steps.fallbacks, path.dirname(filePath))
      : { spec: steps.run, result: await execute(steps.run, path.dirname(filePath)) }
    command = command
      ? `${command}\n${displayCommand(executed.spec)}`
      : displayCommand(executed.spec)
    return {
      ...executed.result,
      stdout: stdout + executed.result.stdout,
      stderr: stderr + executed.result.stderr,
      command,
      durationMs: Date.now() - startedAt,
    }
  } finally {
    const resolvedTempDir = path.resolve(tempDir)
    if (resolvedTempDir.startsWith(`${tempRoot}${path.sep}`)) {
      await fs.rm(resolvedTempDir, { recursive: true, force: true })
    }
  }
}
