/**
 * Provider 注册表 — 对齐 OpenCode + models.dev
 * https://models.dev/api.json
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { t } from '../i18n/translate'
import { BUNDLED_PROVIDER_CATALOG } from './provider-catalog.seed'
import {
  isLoopbackProviderURL,
  normalizeProviderBaseURL,
} from './provider-base-url.util'
import type {
  ProviderDefinition,
  ProviderModel,
  ProviderProtocol,
  ProviderReasoningEffort,
  ProviderReasoningOption,
} from '../../src/types/provider'

export type { ProviderDefinition, ProviderModel, ProviderProtocol } from '../../src/types/provider'

/** Stable documentation links take precedence over changing upstream metadata. */
const PROVIDER_DOC_OVERRIDES: Record<string, string> = {
  alibaba: 'https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions',
  'alibaba-cn': 'https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions',
  'alibaba-token-plan-cn': 'https://help.aliyun.com/zh/model-studio/token-plan-personal-quick-start',
  anthropic: 'https://platform.claude.com/docs/en/api/overview',
  deepseek: 'https://api-docs.deepseek.com/',
  evroc: 'https://docs.evroc.com/products/think/think.html',
  google: 'https://ai.google.dev/api',
  groq: 'https://console.groq.com/docs/api-reference',
  helicone: 'https://docs.helicone.ai/getting-started/integration-method/openai-proxy',
  inception: 'https://docs.inceptionlabs.ai/get-started/get-started',
  inferx: 'https://model.inferx.net/help',
  'kimi-for-coding': 'https://www.kimi.com/code/docs/',
  meganova: 'https://docs.meganova.ai/inference-models/text-generation',
  moonshotai: 'https://platform.kimi.ai/docs/api/overview',
  'moonshotai-cn': 'https://platform.kimi.com/docs/api/overview',
  morph: 'https://docs.morphllm.com/api-reference/endpoint/apply',
  'opencode-go': 'https://opencode.ai/docs/go',
  openai: 'https://developers.openai.com/api/reference/overview',
  openrouter: 'https://openrouter.ai/docs/quickstart',
  qvac: 'https://docs.qvac.tether.io/cli/http-server/connection/',
  'routing-run': 'https://app.routing.run/docs',
  siliconflow: 'https://docs.siliconflow.com/cn/api-reference/chat-completions/chat-completions',
  'siliconflow-cn': 'https://siliconflow.cn/cn/api-reference/chat-completions/chat-completions',
  synthetic: 'https://dev.synthetic.new/docs/openai/chat-completions',
  wandb: 'https://docs.wandb.ai/inference/api-reference',
  xai: 'https://docs.x.ai/developers/rest-api-reference/inference/chat',
  zai: 'https://docs.z.ai/guides/develop/http/introduction',
  zhipuai: 'https://docs.bigmodel.cn/cn/api/introduction',
}

const LOCAL_OLLAMA_BASE: ProviderDefinition = {
  id: 'ollama',
  name: 'Ollama',
  api: 'http://127.0.0.1:11434/v1',
  env: [],
  npm: '@ai-sdk/openai-compatible',
  protocol: 'openai-compatible',
  doc: 'https://docs.ollama.com/api/openai-compatibility',
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

function getDeletedProvidersPath(): string {
  return path.join(app.getPath('userData'), 'deleted-providers.json')
}

export async function getDeletedProviderIds(): Promise<string[]> {
  try {
    const raw = await fs.readFile(getDeletedProvidersPath(), 'utf-8')
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export async function addDeletedProviderId(id: string): Promise<string[]> {
  const list = await getDeletedProviderIds()
  if (!list.includes(id)) {
    list.push(id)
    await fs.writeFile(getDeletedProvidersPath(), JSON.stringify(list, null, 2))
  }
  return list
}

export interface ModelsDevModel {
  id: string
  name?: string
  description?: string
  family?: string
  modalities?: {
    input?: string[]
    output?: string[]
  }
  reasoning?: boolean
  reasoning_options?: Array<
    | { type: 'toggle' }
    | { type: 'effort'; values?: string[] }
    | { type: 'budget_tokens'; min?: number; max?: number }
  >
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
  version: 5
  providers: ProviderDefinition[]
}

const PROVIDER_CACHE_VERSION = 5
const REASONING_EFFORTS = new Set<ProviderReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])
const NON_CHAT_DESCRIPTION = /\b(?:embedding model|reranking model|image model|video model|speech generation model|speech transcription model|speech-to-text model|text-to-speech model|audio-to-audio model|safety model|moderation model|classification model|ocr model|translation model)\b/i
const NON_CHAT_ID = /embed|rerank|ocr|transcrib|whisper|tts|voice|(?:^|[\s/._:-])bge(?:$|[\s/._:-])|(?:^|[\s/._:-])(?:e5|gte|all[-_ ]?minilm)(?:$|[\s/._:-])|gliner|gliguard|qwen\d*guard|guardrails?|safeguard|prompt[-_ ]?guard|llama[-_ ]?guard|content[-_ ]?safety|moderation|classifier|reward[-_ ]?model|esm(?:fold|\d)|usdvalidate|translat/i
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
let catalogRefreshPromise: Promise<ProviderDefinition[]> | null = null

function localizeCatalog(providers: ProviderDefinition[]): ProviderDefinition[] {
  return providers.map((provider) => {
    if (provider.id === 'ollama') {
      return { ...provider, name: t('providerRegistry.ollamaLocal'), sortName: provider.name }
    }
    if (provider.id === 'alibaba') {
      return { ...provider, name: t('providerRegistry.tongyiQianwen'), sortName: provider.name }
    }
    if (provider.id === 'zhipuai') {
      return { ...provider, name: t('providerRegistry.zhipuAi'), sortName: provider.name }
    }
    return provider
  })
}

function mergeModels(current: ProviderModel[], incoming: ProviderModel[]): ProviderModel[] {
  const models = new Map(current.map((model) => [model.id, { ...model }]))
  for (const model of incoming) {
    const existing = models.get(model.id)
    models.set(model.id, existing ? { ...existing, ...model } : { ...model })
  }
  return [...models.values()]
}

function cloneProvider(provider: ProviderDefinition): ProviderDefinition {
  return {
    ...provider,
    env: [...provider.env],
    models: provider.models.map((model) => ({
      ...model,
      reasoningOptions: model.reasoningOptions?.map((option) => option.type === 'effort'
        ? { ...option, values: [...option.values] }
        : { ...option }),
    })),
  }
}

function normalizeReasoningOptions(model: ModelsDevModel): ProviderReasoningOption[] | undefined {
  const options = (model.reasoning_options ?? []).flatMap((option): ProviderReasoningOption[] => {
    if (option.type === 'toggle') return [{ type: 'toggle' }]
    if (option.type === 'budget_tokens') {
      return [{
        type: 'budget_tokens',
        ...(Number.isFinite(option.min) ? { min: option.min } : {}),
        ...(Number.isFinite(option.max) ? { max: option.max } : {}),
      }]
    }
    const values = (option.values ?? []).filter(
      (value): value is ProviderReasoningEffort => REASONING_EFFORTS.has(value as ProviderReasoningEffort),
    )
    return values.length > 0 ? [{ type: 'effort', values }] : []
  })
  return options.length > 0 ? options : undefined
}

export function mergeProviderCatalog(...catalogs: ProviderDefinition[][]): ProviderDefinition[] {
  const providers = new Map<string, ProviderDefinition>()

  for (const catalog of catalogs) {
    for (const provider of catalog) {
      const current = providers.get(provider.id)
      if (!current) {
        const next = cloneProvider(provider)
        next.doc = PROVIDER_DOC_OVERRIDES[provider.id] || next.doc
        providers.set(provider.id, next)
        continue
      }

      providers.set(provider.id, {
        ...current,
        // Remote catalogs are model metadata feeds, not trusted connection
        // configuration. The first catalog owns every field that can affect
        // where credentials or requests are sent.
        name: current.name,
        api: current.api,
        env: [...current.env],
        npm: current.npm,
        protocol: current.protocol,
        doc: PROVIDER_DOC_OVERRIDES[provider.id] || current.doc,
        models: mergeModels(current.models, provider.models),
      })
    }
  }

  return [...providers.values()]
}

export function withBundledCatalog(...catalogs: ProviderDefinition[][]): ProviderDefinition[] {
  const bundledIds = new Set(BUNDLED_PROVIDER_CATALOG.map((provider) => provider.id))
  const knownRemoteMetadata = catalogs.map((catalog) => catalog.filter(
    (provider) => provider.id !== 'ollama' && bundledIds.has(provider.id),
  ))
  return [
    cloneProvider(LOCAL_OLLAMA_BASE),
    ...mergeProviderCatalog(BUNDLED_PROVIDER_CATALOG, ...knownRemoteMetadata),
  ]
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
    doc: PROVIDER_DOC_OVERRIDES[id] || p.doc,
    models: Object.entries(p.models || {})
      .map(([modelId, m]) => ({ ...m, id: m.id || modelId }))
      .filter(isTextChatModel)
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        family: m.family,
        reasoning: m.reasoning,
        reasoningOptions: normalizeReasoningOptions(m),
      })),
  }))
}

async function loadFromCache(): Promise<ProviderDefinition[] | null> {
  try {
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

function refreshProviderCatalog(): Promise<ProviderDefinition[]> {
  if (!catalogRefreshPromise) {
    catalogRefreshPromise = (async () => {
      const remote = await fetchModelsDev()
      const next = withBundledCatalog(remote)
      await saveCache(next.filter((provider) => provider.id !== 'ollama'))
      catalogCache = next
      return next
    })().finally(() => {
      catalogRefreshPromise = null
    })
  }
  return catalogRefreshPromise
}

export async function getProviderCatalog(forceRefresh = false): Promise<ProviderDefinition[]> {
  const deletedIds = await getDeletedProviderIds()
  const filterDeleted = (list: ProviderDefinition[]) =>
    deletedIds.length > 0 ? list.filter((p) => !deletedIds.includes(p.id)) : list

  if (forceRefresh) {
    try {
      return filterDeleted(localizeCatalog(await refreshProviderCatalog()))
    } catch {
      catalogCache ??= withBundledCatalog()
      return filterDeleted(localizeCatalog(catalogCache))
    }
  }

  if (catalogCache) return filterDeleted(localizeCatalog(catalogCache))

  const cached = await loadFromCache()
  if (cached) {
    catalogCache = withBundledCatalog(cached)
    return filterDeleted(localizeCatalog(catalogCache))
  }

  catalogCache = withBundledCatalog()
  void refreshProviderCatalog().catch(() => {})
  return filterDeleted(localizeCatalog(catalogCache))
}

export async function getProviderById(providerId: string): Promise<ProviderDefinition | undefined> {
  const catalog = await getProviderCatalog()
  return catalog.find((p) => p.id === providerId)
}

export async function detectOllama(baseURL = 'http://127.0.0.1:11434'): Promise<{ available: boolean; models: string[]; baseURL: string }> {
  const normalizedBaseURL = normalizeProviderBaseURL('openai-compatible', baseURL)
  if (!isLoopbackProviderURL(normalizedBaseURL)) throw new Error('LOCAL_PROVIDER_MUST_USE_LOOPBACK')
  const rootURL = normalizedBaseURL.replace(/\/+$/, '').replace(/\/v1$/, '')
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
        if (!show.ok) return { name, isChat: false }
        const details = await show.json() as { capabilities?: string[] }
        return {
          name,
          isChat: Array.isArray(details.capabilities)
            && details.capabilities.includes('completion')
            && !NON_CHAT_ID.test(name),
        }
      } catch {
        return { name, isChat: false }
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
