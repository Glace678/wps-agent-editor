/**
 * 参考 OpenCode auth.json：~/.local/share/opencode/auth.json
 * 使用 Electron safeStorage 加密存储 API Key
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import {
  isStrongSafeStorageBackend,
  type LinuxSafeStorageBackend,
} from './auth-storage-security'

export type AuthInfo =
  | { type: 'api'; key: string; metadata?: Record<string, string> }
  | { type: 'oauth'; access: string; refresh: string; expires: number }

interface EncryptedStore {
  version: 2
  encrypted: true
  data: string
}

interface LegacyStore {
  version: 1
  encrypted: boolean
  data: string
}

let operationQueue: Promise<void> = Promise.resolve()
let sessionStore: Record<string, AuthInfo> = {}
let sessionLoaded = false

function getAuthPath(): string {
  return path.join(app.getPath('userData'), 'auth.json')
}

function getLinuxStorageBackend(): LinuxSafeStorageBackend | undefined {
  if (process.platform !== 'linux') return undefined
  try {
    return safeStorage.getSelectedStorageBackend()
  } catch {
    return 'unknown'
  }
}

function isSecureStorageAvailable(): boolean {
  return isStrongSafeStorageBackend(
    process.platform,
    safeStorage.isEncryptionAvailable(),
    getLinuxStorageBackend(),
  )
}

function encryptPayload(payload: Record<string, AuthInfo>): string {
  if (!isSecureStorageAvailable()) throw new Error('AUTH_SECURE_STORAGE_UNAVAILABLE')
  return safeStorage.encryptString(JSON.stringify(payload)).toString('base64')
}

function decryptPayload(data: string): Record<string, AuthInfo> {
  try {
    const buf = Buffer.from(data, 'base64')
    if (!safeStorage.isEncryptionAvailable()) return {}
    return JSON.parse(safeStorage.decryptString(buf)) as Record<string, AuthInfo>
  } catch {
    return {}
  }
}

function decodeLegacyPayload(data: string): Record<string, AuthInfo> {
  try {
    return JSON.parse(Buffer.from(data, 'base64').toString('utf-8')) as Record<string, AuthInfo>
  } catch {
    return {}
  }
}

async function removeUnsafeLegacyStore(): Promise<void> {
  try {
    await fs.rm(getAuthPath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error('AUTH_UNENCRYPTED_STORE_CLEANUP_FAILED')
    }
  }
}

async function readPersistedStore(): Promise<{
  data: Record<string, AuthInfo>
  unencrypted: boolean
} | null> {
  try {
    const raw = await fs.readFile(getAuthPath(), 'utf-8')
    const store = JSON.parse(raw) as EncryptedStore | LegacyStore | Record<string, AuthInfo>
    if (typeof store === 'object' && store !== null && 'version' in store && 'data' in store) {
      const encoded = store as EncryptedStore | LegacyStore
      if (encoded.version === 2 && encoded.encrypted === true) {
        return safeStorage.isEncryptionAvailable()
          ? { data: decryptPayload(encoded.data), unencrypted: false }
          : null
      }
      if (encoded.version === 1) {
        if (encoded.encrypted) {
          return safeStorage.isEncryptionAvailable()
            ? { data: decryptPayload(encoded.data), unencrypted: false }
            : null
        }
        return { data: decodeLegacyPayload(encoded.data), unencrypted: true }
      }
    }
    return { data: store as Record<string, AuthInfo>, unencrypted: true }
  } catch {
    return null
  }
}

async function readStore(): Promise<Record<string, AuthInfo>> {
  const secureStorageAvailable = isSecureStorageAvailable()
  const persisted = await readPersistedStore()

  if (!secureStorageAvailable) {
    if (!sessionLoaded) {
      // Plaintext legacy data and Linux basic_text data may be used for this
      // process, but must be removed from disk immediately.
      if (persisted) {
        sessionStore = { ...persisted.data }
        await removeUnsafeLegacyStore()
      }
      sessionLoaded = true
    }
    return { ...sessionStore }
  }

  const merged = { ...(persisted?.data ?? {}), ...sessionStore }
  if (persisted?.unencrypted || Object.keys(sessionStore).length > 0) {
    await writeStore(merged)
    sessionStore = {}
  }
  return merged
}

async function writeStore(data: Record<string, AuthInfo>): Promise<void> {
  if (!isSecureStorageAvailable()) {
    sessionStore = { ...data }
    sessionLoaded = true
    return
  }
  const store: EncryptedStore = {
    version: 2,
    encrypted: true,
    data: encryptPayload(data),
  }
  await fs.writeFile(getAuthPath(), JSON.stringify(store, null, 2), { mode: 0o600 })
  if (process.platform !== 'win32') await fs.chmod(getAuthPath(), 0o600)
}

export function getAuthStorageMode(): 'encrypted' | 'session' {
  return isSecureStorageAvailable() ? 'encrypted' : 'session'
}

function runSerialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.catch(() => undefined).then(operation)
  operationQueue = result.then(() => undefined, () => undefined)
  return result
}

async function updateStore(update: (store: Record<string, AuthInfo>) => void): Promise<void> {
  await runSerialized(async () => {
    const store = await readStore()
    update(store)
    await writeStore(store)
  })
}

export async function getAuth(providerId: string): Promise<AuthInfo | undefined> {
  return runSerialized(async () => {
    const store = await readStore()
    return store[providerId.replace(/\/+$/, '')]
  })
}

export async function getAllAuth(): Promise<Record<string, {
  configured: boolean
  type: AuthInfo['type']
}>> {
  return runSerialized(async () => {
    const store = await readStore()
    return Object.fromEntries(
      Object.entries(store).map(([id, info]) => [id, {
        configured: true,
        type: info.type,
      }]),
    )
  })
}

export async function setAuth(providerId: string, info: AuthInfo): Promise<void> {
  const norm = providerId.replace(/\/+$/, '')
  await updateStore((store) => {
    store[norm] = info
  })
}

export async function removeAuth(providerId: string): Promise<void> {
  const norm = providerId.replace(/\/+$/, '')
  await updateStore((store) => {
    delete store[norm]
  })
}
