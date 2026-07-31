import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { ProviderDefinition, ProviderProtocol } from './provider-registry.service'
import { t } from '../i18n/translate'

export interface CustomProviderConfig {
  id: string
  name: string
  baseURL: string
  defaultModel: string
  protocol: ProviderProtocol
  createdAt: number
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
  return {
    id: custom.id,
    name: custom.name,
    api: custom.baseURL,
    env: [],
    npm: '@ai-sdk/openai-compatible',
    protocol: custom.protocol,
    isCustom: true,
    models: [{ id: custom.defaultModel, name: custom.defaultModel }],
  }
}
