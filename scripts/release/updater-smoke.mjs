import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  compareVersions,
  parseArguments,
  releaseArtifactSpec,
  requireSemverTag,
} from './release-smoke-lib.mjs'

const args = parseArguments(process.argv.slice(2))
const repository = args.repository || process.env.GITHUB_REPOSITORY
if (!repository) throw new Error('GITHUB_REPOSITORY or --repository is required')
const previous = requireSemverTag(args['previous-tag'], 'previous tag')
const current = requireSemverTag(args['current-tag'], 'current tag')
if (compareVersions(previous, current) >= 0) {
  throw new Error(`Updater smoke requires an upgrade; ${previous.tag} is not older than ${current.tag}`)
}

const previousSpec = releaseArtifactSpec(previous.tag, args.platform, args.arch, args['previous-directory'])
const currentSpec = releaseArtifactSpec(current.tag, args.platform, args.arch, args['current-directory'])
for (const path of [previousSpec.primaryPath, currentSpec.primaryPath, currentSpec.latestPath]) {
  if (!(await stat(path).catch(() => null))?.isFile()) throw new Error(`Updater smoke input is missing: ${path}`)
}

for (const tag of [previous.tag, current.tag]) {
  const result = spawnSync('gh', ['release', 'view', tag, '--repo', repository, '--json', 'isDraft,tagName'], {
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Cannot inspect ${tag}: ${result.stderr || result.stdout}`)
  const release = JSON.parse(result.stdout)
  if (release.isDraft) {
    throw new Error(`${tag} is a draft. Tauri cannot fetch GitHub /releases/download URLs for a draft; publish it as a staging prerelease before updater acceptance.`)
  }
}

const defaultHook = fileURLToPath(new URL('./run-updater-smoke.mjs', import.meta.url))
const hookPath = resolve(defaultHook)
if (!(await stat(hookPath).catch(() => null))?.isFile()) {
  throw new Error(`Checked-in updater acceptance hook is missing: ${hookPath}`)
}
const reportPath = resolve(args.report || `updater-${currentSpec.platform}-${currentSpec.arch}-smoke-report.json`)
const healthyReportPath = `${reportPath}.healthy.tmp`
const rollbackReportPath = `${reportPath}.rollback.tmp`
await writeFile(reportPath, `${JSON.stringify({
  schemaVersion: 2,
  fromVersion: previous.version,
  toVersion: current.version,
  platformKey: currentSpec.platformKey,
  stage: 'healthy-upgrade-pending',
  healthRollbackVerified: false,
}, null, 2)}\n`, { flag: 'w' })

async function runHook(outputPath, injectHealthFailure) {
  await writeFile(outputPath, '', { flag: 'w' })
  const hookArgs = [
    '--previous-package', previousSpec.primaryPath,
    '--current-package', currentSpec.primaryPath,
    '--current-updater', currentSpec.updaterPath,
    '--current-metadata', currentSpec.latestPath,
    '--previous-tag', previous.tag,
    '--current-tag', current.tag,
    '--platform-key', currentSpec.platformKey,
    '--repository', repository,
    '--report', outputPath,
  ]
  if (injectHealthFailure) hookArgs.push('--inject-health-failure')

  let executable = hookPath
  let commandArgs = hookArgs
  if (hookPath.endsWith('.mjs')) {
    executable = process.execPath
    commandArgs = [hookPath, ...hookArgs]
  } else if (hookPath.endsWith('.ps1')) {
    executable = 'pwsh'
    commandArgs = ['-NoLogo', '-NoProfile', '-File', hookPath, ...hookArgs]
  } else if (hookPath.endsWith('.sh')) {
    executable = 'bash'
    commandArgs = [hookPath, ...hookArgs]
  }

  const hook = spawnSync(executable, commandArgs, {
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, WAE_UPDATER_SMOKE: '1' },
  })
  if (hook.error) throw hook.error
  if (hook.status !== 0) {
    const mode = injectHealthFailure ? 'rollback' : 'healthy-upgrade'
    throw new Error(`Updater ${mode} hook failed with exit ${hook.status}:\n${hook.stdout}\n${hook.stderr}`)
  }

  try {
    return JSON.parse(await readFile(outputPath, 'utf8'))
  } catch (error) {
    throw new Error(`Updater hook did not write a valid JSON report to ${outputPath}: ${error.message}`)
  }
}

const report = await runHook(healthyReportPath, false)
const required = {
  schemaVersion: 2,
  fromVersion: previous.version,
  toVersion: current.version,
  platformKey: currentSpec.platformKey,
  updateAvailable: true,
  signatureVerified: true,
  installed: true,
  restarted: true,
  tamperRejected: true,
  invalidInstallPreserved: true,
  startupHealthVerified: true,
  healthFailureInjected: false,
  rollbackVerified: false,
}
for (const [field, expected] of Object.entries(required)) {
  if (report[field] !== expected) {
    throw new Error(`Updater hook report field ${field} must be ${JSON.stringify(expected)}, received ${JSON.stringify(report[field])}`)
  }
}
const requiredEvents = [
  'tamper-rejected', 'invalid-install-preserved', 'downloaded',
  'signature-verified', 'installed', 'restarted',
  'startup-health-verified',
]
if (!Array.isArray(report.events) || !requiredEvents.every((event) => report.events.includes(event))) {
  throw new Error(`Updater hook report must include: ${requiredEvents.join(', ')}`)
}
if (report.tamperErrorCode !== 'update-signature-invalid') {
  throw new Error('Updater hook must observe tamperErrorCode "update-signature-invalid"')
}
for (const field of ['previousExecutableSha256', 'invalidInstallExecutableSha256', 'currentExecutableSha256']) {
  if (!/^[0-9a-f]{64}$/.test(report[field] || '')) {
    throw new Error(`Updater hook report field ${field} must be a lowercase SHA-256 digest`)
  }
}
if (report.previousExecutableSha256 !== report.invalidInstallExecutableSha256) {
  throw new Error('Updater hook did not preserve the pre-update executable through the rejected install')
}
if (report.previousExecutableSha256 === report.currentExecutableSha256) {
  throw new Error('Updater hook did not observe a changed executable after the successful update')
}
if (report.installedVersionObserved !== current.version ||
    report.installedPlatformSignatureVerified !== true ||
    report.externalObservationVerified !== true) {
  throw new Error(`Updater hook did not independently observe installed version ${current.version}`)
}
if (currentSpec.platform === 'macos' &&
    (report.installedGatekeeperVerified !== true ||
     report.installedNotarizationTicketVerified !== true)) {
  throw new Error('Updater hook did not preserve macOS Gatekeeper approval and the stapled notarization ticket')
}
if (currentSpec.platform === 'windows' && report.installedRegistryVersionObserved !== current.version) {
  throw new Error(`Updater hook did not observe Windows uninstall version ${current.version}`)
}
if (report.stage !== 'complete' || !/^[0-9a-f]{32}$/.test(report.updateTransactionId || '')) {
  throw new Error('Healthy updater hook must complete a token-bound health transaction')
}
await writeFile(reportPath, `${JSON.stringify({
  ...report,
  stage: 'rollback-smoke-pending',
  healthRollbackVerified: false,
}, null, 2)}\n`, { flag: 'w' })

const rollbackReport = await runHook(rollbackReportPath, true)
const rollbackRequired = {
  schemaVersion: 2,
  fromVersion: previous.version,
  toVersion: current.version,
  platformKey: currentSpec.platformKey,
  updateAvailable: true,
  signatureVerified: true,
  installed: true,
  restarted: true,
  tamperRejected: true,
  invalidInstallPreserved: true,
  startupHealthVerified: false,
  healthFailureInjected: true,
  rollbackVerified: true,
  stage: 'complete',
  installedVersionObserved: previous.version,
  installedPlatformSignatureVerified: true,
  externalObservationVerified: true,
  healthRollbackExternalObservationVerified: true,
}
if (currentSpec.platform === 'macos') {
  rollbackRequired.installedGatekeeperVerified = true
  rollbackRequired.installedNotarizationTicketVerified = true
}
for (const [field, expected] of Object.entries(rollbackRequired)) {
  if (rollbackReport[field] !== expected) {
    throw new Error(`Updater rollback report field ${field} must be ${JSON.stringify(expected)}, received ${JSON.stringify(rollbackReport[field])}`)
  }
}
const rollbackEvents = [
  'tamper-rejected', 'invalid-install-preserved', 'downloaded',
  'signature-verified', 'installed', 'restarted', 'startup-health-failed',
  'rolled-back', 'rollback-restarted',
]
if (!Array.isArray(rollbackReport.events) ||
    !rollbackEvents.every((event) => rollbackReport.events.includes(event))) {
  throw new Error(`Updater rollback report must include: ${rollbackEvents.join(', ')}`)
}
if (!/^[0-9a-f]{32}$/.test(rollbackReport.updateTransactionId || '')) {
  throw new Error('Updater rollback report must identify its health transaction')
}
for (const field of [
  'previousExecutableSha256',
  'invalidInstallExecutableSha256',
  'unhealthyExecutableSha256',
  'rolledBackExecutableSha256',
  'currentExecutableSha256',
]) {
  if (!/^[0-9a-f]{64}$/.test(rollbackReport[field] || '')) {
    throw new Error(`Updater rollback report field ${field} must be a lowercase SHA-256 digest`)
  }
}
if (rollbackReport.previousExecutableSha256 !== rollbackReport.invalidInstallExecutableSha256 ||
    rollbackReport.previousExecutableSha256 !== rollbackReport.rolledBackExecutableSha256 ||
    rollbackReport.previousExecutableSha256 !== rollbackReport.currentExecutableSha256) {
  throw new Error('Startup-health rollback did not restore the independently observed previous executable')
}
if (rollbackReport.unhealthyExecutableSha256 === rollbackReport.previousExecutableSha256) {
  throw new Error('Startup-health failure injection never launched the updated executable')
}
if (currentSpec.platform === 'windows' &&
    rollbackReport.installedRegistryVersionObserved !== previous.version) {
  throw new Error(`Startup-health rollback did not restore Windows uninstall version ${previous.version}`)
}

const combinedReport = {
  ...report,
  healthRollbackVerified: true,
  healthRollback: rollbackReport,
}
await writeFile(reportPath, `${JSON.stringify(combinedReport, null, 2)}\n`, { flag: 'w' })
await Promise.all([
  rm(healthyReportPath, { force: true }),
  rm(rollbackReportPath, { force: true }),
])
console.log(`Updater acceptance and startup-health rollback passed: ${previous.tag} -> ${current.tag} (${currentSpec.platformKey})`)
