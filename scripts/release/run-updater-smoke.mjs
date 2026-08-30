import { createHash, randomBytes } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { parseArguments, requireSemverTag } from './release-smoke-lib.mjs'

const args = parseArguments(process.argv.slice(2))
const injectHealthFailure = args['inject-health-failure'] === true
const previous = requireSemverTag(args['previous-tag'], 'previous tag')
const current = requireSemverTag(args['current-tag'], 'current tag')
const repository = args.repository
if (!repository || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repository)) {
  throw new Error('--repository must be a GitHub owner/name pair')
}
const platformKey = args['platform-key']
const platform = platformKey?.startsWith('windows-')
  ? 'windows'
  : platformKey?.startsWith('darwin-')
    ? 'macos'
    : platformKey?.startsWith('linux-')
      ? 'linux'
      : null
if (!platform) throw new Error(`Unsupported updater platform key: ${platformKey}`)

const previousPackage = resolve(args['previous-package'])
const currentPackage = resolve(args['current-package'])
const currentUpdater = resolve(args['current-updater'])
const outputReport = resolve(args.report)
for (const path of [previousPackage, currentPackage, currentUpdater]) {
  if (!(await stat(path).catch(() => null))?.isFile()) throw new Error(`Updater hook input is missing: ${path}`)
}

const temporaryRoot = resolve(tmpdir())
const workDirectory = await mkdtemp(join(temporaryRoot, 'wae-updater-acceptance-'))
const reportDirectory = join(temporaryRoot, 'wae-updater-smoke')
const reportToken = randomBytes(16).toString('hex')
const appReportPath = join(reportDirectory, `${reportToken}.json`)
const launchLog = join(workDirectory, 'updater-app.log')
await mkdir(reportDirectory, { recursive: true })

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}:\n${result.stdout || ''}\n${result.stderr || ''}`)
  }
  return (result.stdout || '').trim()
}

async function sha256(path) {
  const hash = createHash('sha256')
  const data = await readFile(path)
  hash.update(data)
  return hash.digest('hex')
}

function assertTemporaryWorkDirectory(path) {
  const resolved = resolve(path)
  if (dirname(resolved) !== temporaryRoot || !basename(resolved).startsWith('wae-updater-acceptance-')) {
    throw new Error(`Refusing to remove unexpected updater work directory: ${resolved}`)
  }
}

const registryScript = String.raw`
$roots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$entry = @($roots | ForEach-Object {
  Get-ItemProperty -Path $_ -ErrorAction SilentlyContinue |
    Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -eq 'WPS Agent Editor' }
} | Select-Object -First 1)
if ($entry.Count -eq 1) {
  $value = $entry[0]
  [pscustomobject]@{
    DisplayIcon = if ($value.PSObject.Properties['DisplayIcon']) { $value.DisplayIcon } else { $null }
    InstallLocation = if ($value.PSObject.Properties['InstallLocation']) { $value.InstallLocation } else { $null }
    DisplayVersion = if ($value.PSObject.Properties['DisplayVersion']) { $value.DisplayVersion } else { $null }
    QuietUninstallString = if ($value.PSObject.Properties['QuietUninstallString']) { $value.QuietUninstallString } else { $null }
    UninstallString = if ($value.PSObject.Properties['UninstallString']) { $value.UninstallString } else { $null }
  } | ConvertTo-Json -Compress
}
`

function windowsEntry() {
  const output = run('pwsh', ['-NoLogo', '-NoProfile', '-Command', registryScript])
  return output ? JSON.parse(output) : null
}

async function windowsExecutable(entry) {
  const candidates = []
  const icon = String(entry?.DisplayIcon || '')
  const iconMatch = /^"([^"]+\.exe)"|^([^,]+\.exe)(?:,|$)/i.exec(icon)
  if (iconMatch) candidates.push(iconMatch[1] || iconMatch[2].trim())
  const location = String(entry?.InstallLocation || '').replace(/^"|"$/g, '')
  if (location) {
    candidates.push(join(location, 'WPS Agent Editor.exe'))
    for (const item of await readdir(location, { withFileTypes: true }).catch(() => [])) {
      if (item.isFile() && /\.exe$/i.test(item.name) && !/(uninstall|esbuild)/i.test(item.name)) {
        candidates.push(join(location, item.name))
      }
    }
  }
  for (const candidate of candidates) {
    if ((await stat(candidate).catch(() => null))?.isFile()) return resolve(candidate)
  }
  throw new Error('Cannot resolve the installed Windows executable')
}

async function waitForWindowsEntry() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const entry = windowsEntry()
    if (entry) return entry
    await new Promise((accept) => setTimeout(accept, 1000))
  }
  throw new Error('Timed out waiting for the Windows uninstall registration')
}

function windowsUninstall(entry) {
  const command = String(entry?.QuietUninstallString || entry?.UninstallString || '').trim()
  const match = /^"([^"]+\.exe)"|^(.+?\.exe)(?:\s|$)/i.exec(command)
  const executable = match?.[1] || match?.[2]?.trim()
  if (!executable) throw new Error(`Cannot safely parse Windows uninstall command: ${command}`)
  run(executable, ['/S'], { timeout: 180_000 })
}

async function findApp(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    if (item.isDirectory() && item.name.endsWith('.app')) return path
    if (item.isDirectory()) {
      const nested = await findApp(path)
      if (nested) return nested
    }
  }
  return null
}

async function macExecutable(app) {
  const plist = join(app, 'Contents', 'Info.plist')
  const executableName = run('/usr/libexec/PlistBuddy', [
    '-c', 'Print :CFBundleExecutable', plist,
  ])
  if (!executableName || basename(executableName) !== executableName) {
    throw new Error(`Invalid CFBundleExecutable in ${plist}: ${JSON.stringify(executableName)}`)
  }
  const executable = join(app, 'Contents', 'MacOS', executableName)
  if (!(await stat(executable).catch(() => null))?.isFile()) {
    throw new Error(`CFBundleExecutable does not exist: ${executable}`)
  }
  return executable
}

const managedChildren = new Set()
let linuxEnvironment = null

function trackChild(child) {
  managedChildren.add(child)
  child.once('exit', () => managedChildren.delete(child))
  child.on('error', () => {})
  return child
}

function firstLine(stream, label) {
  return new Promise((accept, reject) => {
    let buffer = ''
    const timeout = setTimeout(() => finish(new Error(`Timed out waiting for ${label}`)), 10_000)
    const finish = (error, value) => {
      clearTimeout(timeout)
      stream.off('data', onData)
      stream.off('error', onError)
      if (error) reject(error)
      else accept(value)
    }
    const onError = (error) => finish(error)
    const onData = (chunk) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline !== -1) finish(null, buffer.slice(0, newline).trim())
    }
    stream.setEncoding('utf8')
    stream.on('data', onData)
    stream.on('error', onError)
  })
}

async function startLinuxDesktopSession() {
  const display = `:${100 + (randomBytes(1)[0] % 100)}`
  let logHandle = openSync(launchLog, 'a')
  const xvfb = trackChild(spawn('Xvfb', [display, '-screen', '0', '1440x900x24', '-nolisten', 'tcp'], {
    detached: true,
    stdio: ['ignore', logHandle, logHandle],
  }))
  closeSync(logHandle)
  await new Promise((accept) => setTimeout(accept, 750))
  if (xvfb.exitCode !== null) throw new Error(`Xvfb exited before updater smoke launch (${xvfb.exitCode})`)

  logHandle = openSync(launchLog, 'a')
  const dbus = trackChild(spawn('dbus-daemon', [
    '--session', '--nofork', '--nopidfile', '--print-address=1',
  ], {
    detached: true,
    stdio: ['ignore', 'pipe', logHandle],
  }))
  closeSync(logHandle)
  const address = await firstLine(dbus.stdout, 'D-Bus session address')
  if (!address.startsWith('unix:')) throw new Error(`Unexpected D-Bus session address: ${address}`)
  return { DISPLAY: display, DBUS_SESSION_BUS_ADDRESS: address }
}

function launch(executable, appArgs) {
  const logHandle = openSync(launchLog, 'a')
  const environment = { ...process.env, WAE_UPDATER_SMOKE: '1' }
  const child = spawn(executable, appArgs, {
    env: platform === 'linux' ? {
      ...environment,
      ...linuxEnvironment,
      APPIMAGE_EXTRACT_AND_RUN: '1',
      NO_AT_BRIDGE: '1',
      WEBKIT_DISABLE_COMPOSITING_MODE: '1',
    } : environment,
    detached: platform !== 'windows',
    stdio: ['ignore', logHandle, logHandle],
  })
  closeSync(logHandle)
  return trackChild(child)
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return
  try {
    if (platform !== 'windows' && child.pid) process.kill(-child.pid, 'SIGTERM')
    else child.kill('SIGTERM')
  } catch {}
  await Promise.race([
    new Promise((accept) => child.once('exit', accept)),
    new Promise((accept) => setTimeout(accept, 2_000)),
  ])
  if (child.exitCode === null) {
    try {
      if (platform !== 'windows' && child.pid) process.kill(-child.pid, 'SIGKILL')
      else child.kill('SIGKILL')
    } catch {}
  }
}

function normalizeWindowsProductVersion(value) {
  const parts = value.trim().split('.')
  return parts.length === 4 && parts[3] === '0' ? parts.slice(0, 3).join('.') : value.trim()
}

async function waitForReport() {
  const deadline = Date.now() + 12 * 60 * 1000
  while (Date.now() < deadline) {
    try {
      const report = JSON.parse(await readFile(appReportPath, 'utf8'))
      if (report.stage === 'failed') {
        throw new Error(`Application updater smoke failed (${report.errorCode}): ${report.errorMessage}`)
      }
      if (report.stage === 'complete' && report.restarted === true) return report
    } catch (error) {
      if (!['ENOENT', 'Unexpected end of JSON input'].includes(error?.code) &&
          !String(error?.message).includes('Unexpected end of JSON input')) throw error
    }
    await new Promise((accept) => setTimeout(accept, 1000))
  }
  const log = await readFile(launchLog, 'utf8').catch(() => '')
  throw new Error(`Timed out waiting for updater completion report. App log:\n${log}`)
}

let installedExecutable
let windowsInstalledEntry
let mounted = false
let mountDirectory
let installedApp
try {
  if (platform === 'windows') {
    if (windowsEntry()) throw new Error('WPS Agent Editor is already installed on the updater smoke runner')
    run(previousPackage, ['/S'], { timeout: 180_000 })
    windowsInstalledEntry = await waitForWindowsEntry()
    installedExecutable = await windowsExecutable(windowsInstalledEntry)
  } else if (platform === 'macos') {
    mountDirectory = join(workDirectory, 'mount')
    const applications = join(workDirectory, 'Applications')
    await mkdir(mountDirectory)
    await mkdir(applications)
    run('hdiutil', ['attach', previousPackage, '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mountDirectory])
    mounted = true
    const sourceApp = await findApp(mountDirectory)
    if (!sourceApp) throw new Error('Previous DMG contains no application bundle')
    installedApp = join(applications, basename(sourceApp))
    run('ditto', [sourceApp, installedApp])
    run('hdiutil', ['detach', mountDirectory])
    mounted = false
    installedExecutable = await macExecutable(installedApp)
  } else {
    linuxEnvironment = await startLinuxDesktopSession()
    installedExecutable = join(workDirectory, 'wps-agent-editor.AppImage')
    await copyFile(previousPackage, installedExecutable)
    await chmod(installedExecutable, 0o755)
  }

  const previousExecutableSha256 = await sha256(installedExecutable)
  const smokeArgs = [
    '--wae-updater-smoke',
    `--wae-updater-report=${appReportPath}`,
    `--wae-updater-repository=${repository}`,
    `--wae-updater-tag=${current.tag}`,
    `--wae-updater-version=${current.version}`,
  ]
  if (injectHealthFailure) smokeArgs.push('--wae-updater-health-failure')
  launch(installedExecutable, smokeArgs)
  const report = await waitForReport()
  await new Promise((accept) => setTimeout(accept, 2000))

  if (platform === 'windows') {
    windowsInstalledEntry = await waitForWindowsEntry()
    installedExecutable = await windowsExecutable(windowsInstalledEntry)
  } else if (platform === 'macos') {
    installedExecutable = await macExecutable(installedApp)
  }
  const currentExecutableSha256 = await sha256(installedExecutable)
  if (report.previousExecutableSha256 !== previousExecutableSha256 ||
      report.invalidInstallExecutableSha256 !== previousExecutableSha256) {
    throw new Error('Rejected-install digests do not match the independently observed previous executable')
  }
  if (!injectHealthFailure && currentExecutableSha256 === previousExecutableSha256) {
    throw new Error('Successful updater did not change the independently observed executable')
  }
  if (injectHealthFailure && currentExecutableSha256 !== previousExecutableSha256) {
    throw new Error('Startup-health rollback did not restore the previous executable')
  }

  let installedVersionObserved
  let installedRegistryVersionObserved
  let installedPlatformSignatureVerified = false
  if (platform === 'windows') {
    const authenticodeStatus = run('pwsh', ['-NoLogo', '-NoProfile', '-Command',
      '[string](Get-AuthenticodeSignature -LiteralPath $env:WAE_EXECUTABLE).Status'], {
      env: { ...process.env, WAE_EXECUTABLE: installedExecutable },
    })
    if (authenticodeStatus !== 'Valid') {
      throw new Error(`Updated executable Authenticode status is ${authenticodeStatus}`)
    }
    installedPlatformSignatureVerified = true
    installedVersionObserved = run('pwsh', ['-NoLogo', '-NoProfile', '-Command',
      '(Get-Item -LiteralPath $env:WAE_EXECUTABLE).VersionInfo.ProductVersion'], {
      env: { ...process.env, WAE_EXECUTABLE: installedExecutable },
    })
    installedVersionObserved = normalizeWindowsProductVersion(installedVersionObserved)
    installedRegistryVersionObserved = normalizeWindowsProductVersion(String(windowsInstalledEntry.DisplayVersion || ''))
  } else if (platform === 'macos') {
    run('codesign', ['--verify', '--deep', '--strict', installedApp])
    run('spctl', ['--assess', '--type', 'execute', '--verbose=4', installedApp])
    run('xcrun', ['stapler', 'validate', installedApp])
    installedPlatformSignatureVerified = true
    installedVersionObserved = run('/usr/libexec/PlistBuddy', [
      '-c', 'Print :CFBundleShortVersionString', join(installedApp, 'Contents', 'Info.plist'),
    ])
  } else {
    const installedPayloadHash = await sha256(installedExecutable)
    const releasedPayloadHash = await sha256(injectHealthFailure ? previousPackage : currentUpdater)
    if (installedPayloadHash !== releasedPayloadHash) {
      throw new Error(injectHealthFailure
        ? 'Rolled-back AppImage does not match the previous signed payload'
        : 'Updated AppImage does not match the signed current updater payload')
    }
    installedPlatformSignatureVerified = true
    installedVersionObserved = injectHealthFailure ? previous.version : report.toVersion
  }
  const expectedInstalledVersion = injectHealthFailure ? previous.version : current.version
  if (installedVersionObserved !== expectedInstalledVersion) {
    throw new Error(`Installed version mismatch: expected ${expectedInstalledVersion}, observed ${installedVersionObserved}`)
  }
  if (platform === 'windows' && installedRegistryVersionObserved !== expectedInstalledVersion) {
    throw new Error(`Windows uninstall registry version mismatch: expected ${expectedInstalledVersion}, observed ${installedRegistryVersionObserved}`)
  }

  const enriched = {
    ...report,
    previousExecutableSha256,
    invalidInstallExecutableSha256: report.invalidInstallExecutableSha256,
    currentExecutableSha256,
    installedVersionObserved,
    installedRegistryVersionObserved,
    installedPlatformSignatureVerified,
    installedGatekeeperVerified: platform === 'macos',
    installedNotarizationTicketVerified: platform === 'macos',
    externalObservationVerified: true,
    healthRollbackExternalObservationVerified: injectHealthFailure,
  }
  await writeFile(outputReport, `${JSON.stringify(enriched, null, 2)}\n`, { flag: 'w' })
  const outcome = injectHealthFailure ? 'startup-health rollback' : 'healthy upgrade'
  console.log(`Real updater ${outcome} hook passed: ${previous.tag} -> ${current.tag} (${platformKey})`)
} finally {
  for (const child of [...managedChildren].reverse()) await stopChild(child)
  if (mounted) run('hdiutil', ['detach', mountDirectory, '-force'])
  if (platform === 'windows') {
    const entry = windowsEntry()
    if (entry) windowsUninstall(entry)
  }
  await rm(appReportPath, { force: true })
  assertTemporaryWorkDirectory(workDirectory)
  await rm(workDirectory, { recursive: true, force: true })
}
