import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArguments } from './release-smoke-lib.mjs'

const args = parseArguments(process.argv.slice(2))
const executable = resolve(args.executable || '')
const platform = args.platform
const outputReport = resolve(args.report || '')
if (!['windows', 'macos', 'linux'].includes(platform)) {
  throw new Error('--platform must be windows, macos, or linux')
}
if (!(await stat(executable).catch(() => null))?.isFile()) {
  throw new Error(`Installed runtime executable is missing: ${executable}`)
}
if (!args.report) throw new Error('--report is required')

const reportDirectory = resolve(tmpdir(), 'wae-runtime-smoke')
const reportPath = resolve(reportDirectory, `${randomBytes(16).toString('hex')}.json`)
await mkdir(reportDirectory, { recursive: true })
await mkdir(dirname(outputReport), { recursive: true })
const appArgs = ['--wae-runtime-smoke', `--wae-runtime-report=${reportPath}`]
const environment = { ...process.env, WAE_RUNTIME_SMOKE: '1' }
const command = platform === 'linux' ? 'dbus-run-session' : executable
const commandArgs = platform === 'linux'
  ? [
      '--', 'xvfb-run', '-a', '-s', '-screen 0 1440x900x24',
      'env', 'NO_AT_BRIDGE=1', 'WEBKIT_DISABLE_COMPOSITING_MODE=1',
      executable, ...appArgs,
    ]
  : appArgs
const startedAt = Date.now()
try {
  const processResult = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    env: environment,
    timeout: 90_000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (processResult.error) throw processResult.error
  let report
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'))
  } catch (error) {
    throw new Error(`Installed runtime did not write a valid core-smoke report: ${error.message}\n${processResult.stdout || ''}\n${processResult.stderr || ''}`)
  }
  if (processResult.status !== 0 || report.ok !== true) {
    throw new Error(`Installed runtime core smoke failed with exit ${processResult.status} (${report.errorCode || 'unknown'}): ${report.errorMessage || processResult.stderr || processResult.stdout}`)
  }
  const requiredTrue = [
    'atomicFileRoundTrip',
    'wae1BinaryRoundTrip',
    'wordRawRoundTrip',
    'spreadsheetRawRoundTrip',
    'presentationOoxmlEdit',
    'agentStreaming',
  ]
  for (const field of requiredTrue) {
    if (report[field] !== true) throw new Error(`Installed runtime report field ${field} was not true`)
  }
  if (JSON.stringify(report.agentDeltas) !== JSON.stringify(['Hel', 'lo'])) {
    throw new Error(`Installed runtime did not preserve Agent SSE delta order: ${JSON.stringify(report.agentDeltas)}`)
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(report.packageVersion || '')) {
    throw new Error(`Installed runtime reported an invalid package version: ${report.packageVersion}`)
  }
  const result = {
    ...report,
    platform,
    executable,
    processExitCode: processResult.status,
    elapsedMilliseconds: Date.now() - startedAt,
  }
  await writeFile(outputReport, `${JSON.stringify(result, null, 2)}\n`, { flag: 'w' })
  console.log(`Installed core document/Agent smoke passed: ${outputReport}`)
} finally {
  await rm(reportPath, { force: true })
}
