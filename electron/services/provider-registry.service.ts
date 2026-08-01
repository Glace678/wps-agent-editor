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

interface ModelsDevModel {
  id: string
  name?: string
  description?: string
  family?: string
  modalities?: {
    input?: string[]
    output?: string[]
  }
}

interface ModelsDevProvider {
  id: string
  name: string
  api?: string
  env?: string[]
  npm?: string
  doc?: string
  models?: Record<string, ModelsDevModel>
}

interface ProviderCatalogCache {
  version: 2
  providers: ProviderDefinition[]
}

const PROVIDER_CACHE_VERSION = 2
const NON_CHAT_DESCRIPTION = /\b(?:embedding model|reranking model|image model|video model|speech generation model|speech transcription model|speech-to-text model|text-to-speech model|audio-to-audio model|safety model|moderation model|classification model|ocr model|translation model)\b/i
const NON_CHAT_ID = /embed|rerank|(?:^|[\s/._:-])ocr(?:$|[\s/._:-])|transcrib|whisper|(?:^|[\s/._:-])tts(?:$|[\s/._:-])|safeguard|prompt[-_ ]?guard|llama[-_ ]?guard|content[-_ ]?safety|moderation|classifier|reward[-_ ]?model/i
const NON_CHAT_FAMILIES = new Set([
  'text-embedding',
  'cohere-embed',
  'mistral-embed',
  'codestral-embed',
  'titan-embed',
  'voyage',
  'bge',
])

export function isTextChatModel(model: ModelsDevModel): boolean {
  const input = model.modalities?.input ?? []
  const output = model.modalities?.output ?? []
  if (!input.includes('text')) return false
  if (output.length !== 1 || output[0] !== 'text') return false

  const identity = [model.id, model.name, model.family].filter(Boolean).join(' ')
  return !NON_CHAT_DESCRIPTION.test(model.description ?? '')
    && !NON_CHAT_ID.test(identity)
    && !NON_CHAT_FAMILIES.has((model.family ?? '').toLowerCase())
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
    models: Object.values(p.models || {})
      .filter(isTextChatModel)
      .map((m) => ({ id: m.id, name: m.name || m.id })),
  }))
}

async function loadFromCache(): Promise<ProviderDefinition[] | null> {
  try {
    const stat = await fs.stat(getCachePath())
    if (Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) return null
    const raw = await fs.readFile(getCachePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<ProviderCatalogCache>
    if (parsed.version !== PROVIDER_CACHE_VERSION || !Array.isArray(parsed.providers)) return null
    return parsed.providers
  } catch {
    return null
  }
}

async function saveCache(providers: ProviderDefinition[]): Promise<void> {
  const cache: ProviderCatalogCache = {
    version: PROVIDER_CACHE_VERSION,
    providers,
  }
  await fs.writeFile(getCachePath(), JSON.stringify(cache, null, 2))
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
  const rootURL = baseURL.replace(/\/+$/, '').replace(/\/v1$/, '')
  const url = `${rootURL}/api/tags`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return { available: false, models: [], baseURL: `${rootURL}/v1` }
    const data = await res.json() as { models?: Array<{ name: string }> }
    const inspected = await Promise.all((data.models || []).map(async ({ name }) => {
      try {
        const show = await fetch(`${rootURL}/api/show`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: name }),
          signal: AbortSignal.timeout(3000),
        })
        if (!show.ok) return { name, isChat: !NON_CHAT_ID.test(name) }
        const details = await show.json() as { capabilities?: string[] }
        if (!Array.isArray(details.capabilities)) {
          return { name, isChat: !NON_CHAT_ID.test(name) }
        }
        return { name, isChat: details.capabilities.includes('completion') }
      } catch {
        return { name, isChat: !NON_CHAT_ID.test(name) }
      }
    }))
    return {
      available: true,
      models: inspected.filter((model) => model.isChat).map((model) => model.name),
      baseURL: `${rootURL}/v1`,
    }
  } catch {
    return { available: false, models: [], baseURL: `${rootURL}/v1` }
  }
}
