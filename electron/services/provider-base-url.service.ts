import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { ProviderDefinition } from './provider-registry.service'
import { normalizeProviderEndpoint } from './provider-base-url.util'

interface ProviderBaseURLStore {
  version: 1
  providers: Record<string, string>
}

const EMPTY_STORE: ProviderBaseURLStore = {
  version: 1,
  providers: {},
}

let writeQueue: Promise<void> = Promise.resolve()

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'provider-base-urls.json')
}

function normalizeProviderId(providerId: string): string {
  return providerId.replace(/\/+$/, '')
}

async function readStore(): Promise<ProviderBaseURLStore> {
  try {
    const raw = await fs.readFile(getStorePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<ProviderBaseURLStore>
    if (parsed.version !== 1 || !parsed.providers || typeof parsed.providers !== 'object') {
      return { ...EMPTY_STORE, providers: {} }
    }
    return { version: 1, providers: parsed.providers }
  } catch {
    return { ...EMPTY_STORE, providers: {} }
  }
}

async function writeStore(store: ProviderBaseURLStore): Promise<void> {
  await fs.writeFile(getStorePath(), JSON.stringify(store, null, 2), { mode: 0o600 })
}

export async function getProviderBaseURL(providerId: string): Promise<string | undefined> {
  const store = await readStore()
  return store.providers[normalizeProviderId(providerId)]
}

export async function setProviderBaseURL(providerId: string, baseURL: string): Promise<void> {
  const normalizedId = normalizeProviderId(providerId)
  const normalizedURL = baseURL.trim().replace(/\/+$/, '')

  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const store = await readStore()
    if (normalizedURL) store.providers[normalizedId] = normalizedURL
    else delete store.providers[normalizedId]
    await writeStore(store)
  })

  await writeQueue
}

export async function applyProviderBaseURLs(
  providers: ProviderDefinition[],
): Promise<ProviderDefinition[]> {
  const store = await readStore()
  return providers.map((provider) => {
    const defaultApi = provider.defaultApi ?? provider.api
    const storedOverride = store.providers[normalizeProviderId(provider.id)]
    let override: string | undefined
    try {
      override = storedOverride
        ? normalizeProviderEndpoint(provider, storedOverride)
        : undefined
    } catch {
      override = undefined
    }
    return {
      ...provider,
      api: override || defaultApi,
      defaultApi,
      isApiOverridden: Boolean(override),
    }
  })
}
