/**
 * 本地 OnlyOffice Document Server 管理
 * 一次安装，永久离线使用（类似 WPS / Office 本地版）
 */
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { app, shell } from 'electron'
import { spawn } from 'node:child_process'
import { t } from '../i18n/translate'

export type OfficeServerStatus =
  | 'not_installed'
  | 'downloading'
  | 'installing'
  | 'stopped'
  | 'running'
  | 'error'

export interface OfficeServerState {
  status: OfficeServerStatus
  documentServerUrl: string
  installPath: string | null
  version: string | null
  message: string
  offlineReady: boolean
}

const DS_URL = 'http://127.0.0.1:8080'
const HEALTH_URL = `${DS_URL}/healthcheck`

const INSTALLER_URLS: Record<string, string> = {
  win32: 'https://download.onlyoffice.com/install/documentserver/windows/onlyoffice-documentserver.exe',
  darwin: 'https://download.onlyoffice.com/install/documentserver/mac/onlyoffice-documentserver.pkg',
  linux: 'https://download.onlyoffice.com/install/documentserver/linux/onlyoffice-documentserver.x86_64.rpm',
}

const WINDOWS_PATHS = [
  'C:\\Program Files\\ONLYOFFICE\\DocumentServer',
  'C:\\Program Files (x86)\\ONLYOFFICE\\DocumentServer',
]

function getOfficeDir(): string {
  return path.join(app.getPath('userData'), 'onlyoffice')
}

function getInstallerPath(): string {
  const ext = process.platform === 'win32' ? 'exe' : process.platform === 'darwin' ? 'pkg' : 'rpm'
  return path.join(getOfficeDir(), `onlyoffice-documentserver.${ext}`)
}

function getStatePath(): string {
  return path.join(getOfficeDir(), 'state.json')
}

async function loadState(): Promise<Partial<OfficeServerState>> {
  try {
    return JSON.parse(await fs.readFile(getStatePath(), 'utf-8'))
  } catch {
    return {}
  }
}

async function saveState(state: Partial<OfficeServerState>): Promise<void> {
  await fs.mkdir(getOfficeDir(), { recursive: true })
  await fs.writeFile(getStatePath(), JSON.stringify(state, null, 2))
}

export async function checkDocumentServerHealth(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    try {
      const res = await fetch(`${DS_URL}/`, { signal: AbortSignal.timeout(2000) })
      return res.ok
    } catch {
      return false
    }
  }
}

function detectInstallPath(): string | null {
  if (process.platform === 'win32') {
    for (const p of WINDOWS_PATHS) {
      if (fsSync.existsSync(p)) return p
    }
  }
  if (process.platform === 'darwin') {
    const p = '/Applications/ONLYOFFICE/DocumentServer'
    if (fsSync.existsSync(p)) return p
  }
  if (process.platform === 'linux') {
    const p = '/var/www/onlyoffice/documentserver'
    if (fsSync.existsSync(p)) return p
  }
  return null
}

export async function getOfficeServerState(): Promise<OfficeServerState> {
  const saved = await loadState()
  const installPath = detectInstallPath() || saved.installPath || null
  const running = await checkDocumentServerHealth()

  let status: OfficeServerStatus = 'not_installed'
  if (running) status = 'running'
  else if (installPath) status = 'stopped'
  else if (saved.status === 'downloading' || saved.status === 'installing') status = saved.status

  return {
    status,
    documentServerUrl: DS_URL,
    installPath,
    version: saved.version ?? null,
    message: running
      ? t('documentServer.engineRunning')
      : installPath
        ? t('documentServer.installedPleaseStart')
        : t('documentServer.needInstall'),
    offlineReady: running,
  }
}

export async function downloadOfficeInstaller(
  onProgress?: (percent: number, message: string) => void,
): Promise<string> {
  const url = INSTALLER_URLS[process.platform]
  if (!url) {
    throw new Error(t('documentServer.unsupportedPlatform', { platform: process.platform }))
  }

  await fs.mkdir(getOfficeDir(), { recursive: true })
  const dest = getInstallerPath()
  await saveState({ status: 'downloading' })

  onProgress?.(0, t('documentServer.startDownload'))

  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(t('documentServer.downloadFailed', { error: res.status }))
  }

  const total = parseInt(res.headers.get('content-length') || '0', 10)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total > 0) {
      const pct = Math.round((received / total) * 100)
      onProgress?.(pct, t('documentServer.downloadProgress', {
        downloadedMB: (received / 1024 / 1024).toFixed(1),
        totalMB: (total / 1024 / 1024).toFixed(1),
        percent: pct,
      }))
    }
  }

  const buffer = Buffer.concat(chunks)
  await fs.writeFile(dest, buffer)
  onProgress?.(100, t('documentServer.downloadComplete'))
  await saveState({ status: 'not_installed' })
  return dest
}

export async function launchOfficeInstaller(installerPath?: string): Promise<void> {
  const file = installerPath || getInstallerPath()
  try {
    await fs.access(file)
  } catch {
    throw new Error(t('documentServer.installerNotFound'))
  }

  await saveState({ status: 'installing' })

  if (process.platform === 'win32') {
    await shell.openPath(file)
  } else if (process.platform === 'darwin') {
    spawn('open', [file], { detached: true, stdio: 'ignore' }).unref()
  } else {
    await shell.openPath(file)
  }
}

export async function tryStartDocumentServer(): Promise<boolean> {
  if (await checkDocumentServerHealth()) return true

  if (process.platform === 'win32') {
    const services = [
      'ONLYOFFICE Document Server',
      'DsDocService',
      'DsConverter',
    ]
    for (const name of services) {
      try {
        spawn('net', ['start', name], { shell: true, stdio: 'ignore' }).unref()
      } catch { /* ignore */ }
    }
    await new Promise((r) => setTimeout(r, 3000))
    return checkDocumentServerHealth()
  }

  if (process.platform === 'linux') {
    spawn('sudo', ['systemctl', 'start', 'ds-docservice', 'ds-converter', 'ds-metrics'], {
      stdio: 'ignore',
    }).unref()
    await new Promise((r) => setTimeout(r, 3000))
    return checkDocumentServerHealth()
  }

  return false
}

export function getInstallerDownloadUrl(): string {
  return INSTALLER_URLS[process.platform] || ''
}

export function hasLocalInstaller(): boolean {
  return fsSync.existsSync(getInstallerPath())
}

export async function openOfficeDataFolder(): Promise<void> {
  await fs.mkdir(getOfficeDir(), { recursive: true })
  await shell.openPath(getOfficeDir())
}
