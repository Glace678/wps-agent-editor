/**
 * Provider 注册表 — 对齐 OpenCode + models.dev
 * https://models.dev/api.json
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { t } from '../i18n/translate'

export type ProviderProtocol =
  | 'openai-compatible'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'bedrock'
  | 'unknown'

export interface ProviderModel {
  id: string
  name: string
}

export interface ProviderDefinition {
  id: string
  name: string
  api: string
  env: string[]
  npm: string
  protocol: ProviderProtocol
  doc?: string
  models: ProviderModel[]
  defaultApi?: string
  isApiOverridden?: boolean
  isCustom?: boolean
  isLocal?: boolean
}

/** OpenCode openai-compatible-profile.ts 预设 */
const OPENCODE_PROFILES: Record<string, { name: string; api: string; env: string[] }> = {
  baseten: { name: 'Baseten', api: 'https://inference.baseten.co/v1', env: ['BASETEN_API_KEY'] },
  cerebras: { name: 'Cerebras', api: 'https://api.cerebras.ai/v1', env: ['CEREBRAS_API_KEY'] },
  deepinfra: { name: 'Deep Infra', api: 'https://api.deepinfra.com/v1/openai', env: ['DEEPINFRA_API_KEY'] },
  deepseek: { name: 'DeepSeek', api: 'https://api.deepseek.com/v1', env: ['DEEPSEEK_API_KEY'] },
  fireworks: { name: 'Fireworks AI', api: 'https://api.fireworks.ai/inference/v1', env: ['FIREWORKS_API_KEY'] },
  groq: { name: 'Groq', api: 'https://api.groq.com/openai/v1', env: ['GROQ_API_KEY'] },
  openrouter: { name: 'OpenRouter', api: 'https://openrouter.ai/api/v1', env: ['OPENROUTER_API_KEY'] },
  togetherai: { name: 'Together AI', api: 'https://api.together.xyz/v1', env: ['TOGETHER_API_KEY'] },
  xai: { name: 'xAI', api: 'https://api.x.ai/v1', env: ['XAI_API_KEY'] },
}

const LOCAL_OLLAMA_BASE: ProviderDefinition = {
  id: 'ollama',
  name: 'Ollama',
  api: 'http://127.0.0.1:11434/v1',
  env: [],
  npm: '@ai-sdk/openai-compatible',
  protocol: 'openai-compatible',
  isLocal: true,
  models: [],
}

function inferProtocol(npm: string): ProviderProtocol {
  if (npm.includes('openai-compatible')) return 'openai-compatible'
  if (npm.includes('@ai-sdk/openai')) return 'openai'
  if (npm.includes('anthropic')) return 'anthropic'
  if (npm.includes('google')) return 'google'
  if (npm.includes('bedrock') || npm.includes('amazon')) return 'bedrock'
  return 'openai-compatible'
}

function getCachePath(): string {
  return path.join(app.getPath('userData'), 'provider-catalog.json')
}

interface ModelsDevProvider {
  id: string
  name: string
  api?: string
  env?: string[]
  npm?: string
  doc?: string
  models?: Record<string, { id: string; name: string }>
}

let catalogCache: ProviderDefinition[] | null = null

function localizeCatalog(providers: ProviderDefinition[]): ProviderDefinition[] {
  return providers.map((provider) => {
    if (provider.id === 'ollama') return { ...provider, name: t('providerRegistry.ollamaLocal') }
    if (provider.id === 'alibaba') return { ...provider, name: t('providerRegistry.tongyiQianwen') }
    if (provider.id === 'zhipuai') return { ...provider, name: t('providerRegistry.zhipuAi') }
    return provider
  })
}

async function fetchModelsDev(): Promise<ProviderDefinition[]> {
  const res = await fetch('https://models.dev/api.json', { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`models.dev fetch failed: ${res.status}`)
  const data = await res.json() as Record<string, ModelsDevProvider>

  return Object.entries(data).map(([id, p]) => ({
    id,
    name: p.name || id,
    api: p.api || '',
    env: p.env || [],
    npm: p.npm || '@ai-sdk/openai-compatible',
    protocol: inferProtocol(p.npm || ''),
    doc: p.doc,
    models: Object.values(p.models || {}).map((m) => ({ id: m.id, name: m.name || m.id })),
  }))
}

async function loadFromCache(): Promise<ProviderDefinition[] | null> {
  try {
    const stat = await fs.stat(getCachePath())
    if (Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) return null
    const raw = await fs.readFile(getCachePath(), 'utf-8')
    return JSON.parse(raw) as ProviderDefinition[]
  } catch {
    return null
  }
}

async function saveCache(providers: ProviderDefinition[]): Promise<void> {
  await fs.writeFile(getCachePath(), JSON.stringify(providers, null, 2))
}

export async function getProviderCatalog(forceRefresh = false): Promise<ProviderDefinition[]> {
  if (catalogCache && !forceRefresh) return localizeCatalog(catalogCache)

  if (!forceRefresh) {
    const cached = await loadFromCache()
    if (cached) {
      catalogCache = [LOCAL_OLLAMA_BASE, ...cached]
      return localizeCatalog(catalogCache)
    }
  }

  try {
    const remote = await fetchModelsDev()
    await saveCache(remote)
    catalogCache = [LOCAL_OLLAMA_BASE, ...remote]
    return localizeCatalog(catalogCache)
  } catch {
    catalogCache = [LOCAL_OLLAMA_BASE, ...buildFallbackCatalog()]
    return localizeCatalog(catalogCache)
  }
}

function buildFallbackCatalog(): ProviderDefinition[] {
  const fromProfiles = Object.entries(OPENCODE_PROFILES).map(([id, p]) => ({
    id,
    name: p.name,
    api: p.api,
    env: p.env,
    npm: '@ai-sdk/openai-compatible',
    protocol: 'openai-compatible' as const,
    models: [] as ProviderModel[],
  }))

  const extras: ProviderDefinition[] = [
    { id: 'openai', name: 'OpenAI', api: 'https://api.openai.com/v1', env: ['OPENAI_API_KEY'], npm: '@ai-sdk/openai', protocol: 'openai', models: [] },
    { id: 'anthropic', name: 'Anthropic', api: 'https://api.anthropic.com/v1', env: ['ANTHROPIC_API_KEY'], npm: '@ai-sdk/anthropic', protocol: 'anthropic', models: [] },
    { id: 'google', name: 'Google', api: 'https://generativelanguage.googleapis.com/v1beta', env: ['GOOGLE_API_KEY'], npm: '@ai-sdk/google', protocol: 'google', models: [] },
    { id: 'alibaba', name: 'Qwen', api: 'https://dashscope.aliyuncs.com/compatible-mode/v1', env: ['DASHSCOPE_API_KEY'], npm: '@ai-sdk/openai-compatible', protocol: 'openai-compatible', models: [] },
    { id: 'zhipuai', name: 'Zhipu AI', api: 'https://open.bigmodel.cn/api/paas/v4', env: ['ZHIPU_API_KEY'], npm: '@ai-sdk/openai-compatible', protocol: 'openai-compatible', models: [] },
    { id: 'moonshotai', name: 'Moonshot', api: 'https://api.moonshot.cn/v1', env: ['MOONSHOT_API_KEY'], npm: '@ai-sdk/openai-compatible', protocol: 'openai-compatible', models: [] },
    { id: 'siliconflow', name: 'SiliconFlow', api: 'https://api.siliconflow.cn/v1', env: ['SILICONFLOW_API_KEY'], npm: '@ai-sdk/openai-compatible', protocol: 'openai-compatible', models: [] },
    { id: 'minimax', name: 'MiniMax', api: 'https://api.minimax.chat/v1', env: ['MINIMAX_API_KEY'], npm: '@ai-sdk/openai-compatible', protocol: 'openai-compatible', models: [] },
  ]

  return [...fromProfiles, ...extras]
}

export async function getProviderById(providerId: string): Promise<ProviderDefinition | undefined> {
  const catalog = await getProviderCatalog()
  return catalog.find((p) => p.id === providerId)
}

export async function detectOllama(baseURL = 'http://127.0.0.1:11434'): Promise<{ available: boolean; models: string[]; baseURL: string }> {
  const url = `${baseURL.replace(/\/$/, '')}/api/tags`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return { available: false, models: [], baseURL: `${baseURL}/v1` }
    const data = await res.json() as { models?: Array<{ name: string }> }
    return {
      available: true,
      models: (data.models || []).map((m) => m.name),
      baseURL: `${baseURL.replace(/\/$/, '')}/v1`,
    }
  } catch {
    return { available: false, models: [], baseURL: `${baseURL}/v1` }
  }
}
