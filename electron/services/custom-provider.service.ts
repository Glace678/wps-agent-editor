import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { ProviderDefinition, ProviderModel, ProviderProtocol } from './provider-registry.service'
import { t } from '../i18n/translate'
import { normalizeProviderBaseURL } from './provider-base-url.util'

export interface CustomProviderConfig {
  id: string
  name: string
  baseURL: string
  defaultModel: string
  models?: ProviderModel[]
  protocol: ProviderProtocol
  createdAt: number
}

export type CustomProviderConnectionTestError =
  | 'invalid-base-url'
  | 'missing-api-key'
  | 'unauthorized'
  | 'no-models'
  | 'connection-failed'

export interface CustomProviderConnectionTestResult {
  success: boolean
  models: ProviderModel[]
  error?: CustomProviderConnectionTestError
}

interface OpenAIModelsResponse {
  data?: Array<{
    id?: unknown
    name?: unknown
  }>
}

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'custom-providers.json')
}

export async function getCustomProviders(): Promise<CustomProviderConfig[]> {
  try {
    const data = await fs.readFile(getStorePath(), 'utf-8')
    return JSON.parse(data) as CustomProviderConfig[]
  } catch {
    return []
  }
}

export async function saveCustomProvider(provider: CustomProviderConfig): Promise<CustomProviderConfig[]> {
  const list = await getCustomProviders()
  const idx = list.findIndex((p) => p.id === provider.id)
  if (idx >= 0) list[idx] = provider
  else list.push(provider)
  await fs.writeFile(getStorePath(), JSON.stringify(list, null, 2))
  return list
}

export async function deleteCustomProvider(id: string): Promise<CustomProviderConfig[]> {
  const list = (await getCustomProviders()).filter((p) => p.id !== id)
  await fs.writeFile(getStorePath(), JSON.stringify(list, null, 2))
  return list
}

export function createCustomProvider(partial?: Partial<CustomProviderConfig>): CustomProviderConfig {
  return {
    id: `custom-${uuidv4()}`,
    name: t('providerSettings.customProvider'),
    baseURL: 'https://api.example.com/v1',
    defaultModel: 'gpt-4o-mini',
    protocol: 'openai-compatible',
    createdAt: Date.now(),
    ...partial,
  }
}

export function toProviderDefinition(custom: CustomProviderConfig): ProviderDefinition {
  const models = custom.models?.filter((model) => model.id.trim()) ?? []

  return {
    id: custom.id,
    name: custom.name,
    api: custom.baseURL,
    env: [],
    npm: '@ai-sdk/openai-compatible',
    protocol: custom.protocol,
    isCustom: true,
    // Older saved providers only have defaultModel, so retain it as a fallback.
    models: models.length > 0 ? models : [{ id: custom.defaultModel, name: custom.defaultModel }],
  }
}

function failure(error: CustomProviderConnectionTestError): CustomProviderConnectionTestResult {
  return { success: false, models: [], error }
}

/**
 * Validates an OpenAI-compatible endpoint with GET /models. The API key remains
 * in the main process for the request and is not persisted while testing.
 */
export async function testCustomProviderConnection(
  baseURL: string,
  apiKey: string,
): Promise<CustomProviderConnectionTestResult> {
  if (!apiKey.trim()) return failure('missing-api-key')

  let normalizedBaseURL: string
  try {
    normalizedBaseURL = normalizeProviderBaseURL('openai-compatible', baseURL)
  } catch {
    return failure('invalid-base-url')
  }
  if (!normalizedBaseURL) return failure('invalid-base-url')

  try {
    const modelsURL = new URL('models', `${normalizedBaseURL}/`).toString()
    const response = await fetch(modelsURL, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey.trim()}`,
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (response.status === 401 || response.status === 403) return failure('unauthorized')
    if (!response.ok) return failure('connection-failed')

    const body = await response.json() as OpenAIModelsResponse
    const seen = new Set<string>()
    const models = (Array.isArray(body.data) ? body.data : []).flatMap((model) => {
      if (typeof model.id !== 'string' || !model.id.trim()) return []
      const id = model.id.trim()
      if (seen.has(id)) return []
      seen.add(id)
      return [{ id, name: typeof model.name === 'string' && model.name.trim() ? model.name.trim() : id }]
    })

    return models.length > 0
      ? { success: true, models }
      : failure('no-models')
  } catch {
    return failure('connection-failed')
  }
}
