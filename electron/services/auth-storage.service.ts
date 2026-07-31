/**
 * 参考 OpenCode auth.json：~/.local/share/opencode/auth.json
 * 使用 Electron safeStorage 加密存储 API Key
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { app, safeStorage } from 'electron'

export type AuthInfo =
  | { type: 'api'; key: string; metadata?: Record<string, string> }
  | { type: 'oauth'; access: string; refresh: string; expires: number }

interface EncryptedStore {
  version: 1
  encrypted: boolean
  data: string
}

function getAuthPath(): string {
  return path.join(app.getPath('userData'), 'auth.json')
}

function encryptPayload(payload: Record<string, AuthInfo>): string {
  const json = JSON.stringify(payload)
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(json).toString('base64')
  }
  return Buffer.from(json, 'utf-8').toString('base64')
}

function decryptPayload(data: string, encrypted: boolean): Record<string, AuthInfo> {
  try {
    const buf = Buffer.from(data, 'base64')
    const json = encrypted && safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf-8')
    return JSON.parse(json) as Record<string, AuthInfo>
  } catch {
    return {}
  }
}

async function readStore(): Promise<Record<string, AuthInfo>> {
  try {
    const raw = await fs.readFile(getAuthPath(), 'utf-8')
    const store = JSON.parse(raw) as EncryptedStore | Record<string, AuthInfo>
    if ('version' in store && (store as EncryptedStore).version === 1) {
      const enc = store as EncryptedStore
      return decryptPayload(enc.data, enc.encrypted)
    }
    return store as Record<string, AuthInfo>
  } catch {
    return {}
  }
}

async function writeStore(data: Record<string, AuthInfo>): Promise<void> {
  const encrypted = safeStorage.isEncryptionAvailable()
  const store: EncryptedStore = {
    version: 1,
    encrypted,
    data: encryptPayload(data),
  }
  await fs.writeFile(getAuthPath(), JSON.stringify(store, null, 2), { mode: 0o600 })
}

export async function getAuth(providerId: string): Promise<AuthInfo | undefined> {
  const store = await readStore()
  return store[providerId.replace(/\/+$/, '')]
}

export async function getAllAuth(): Promise<Record<string, { configured: boolean; type: AuthInfo['type'] }>> {
  const store = await readStore()
  return Object.fromEntries(
    Object.entries(store).map(([id, info]) => [id, { configured: true, type: info.type }]),
  )
}

export async function setAuth(providerId: string, info: AuthInfo): Promise<void> {
  const norm = providerId.replace(/\/+$/, '')
  const store = await readStore()
  store[norm] = info
  await writeStore(store)
}

export async function removeAuth(providerId: string): Promise<void> {
  const norm = providerId.replace(/\/+$/, '')
  const store = await readStore()
  delete store[norm]
  await writeStore(store)
}

export async function resolveApiKey(providerId: string, envKeys?: string[]): Promise<string | undefined> {
  const auth = await getAuth(providerId)
  if (auth?.type === 'api' && auth.key) return auth.key

  if (envKeys) {
    for (const key of envKeys) {
      const val = process.env[key]
      if (val) return val
    }
  }

  const envGuess = `${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`
  return process.env[envGuess]
}