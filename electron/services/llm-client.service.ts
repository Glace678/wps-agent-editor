/**
 * 统一 LLM Client — 参考 OpenCode @opencode-ai/llm
 * 根据 Provider protocol 动态创建 LangChain 客户端
 */
import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AgentConfig } from './agent-store.service'
import { resolveApiKey } from './auth-storage.service'
import { getProviderById } from './provider-registry.service'
import { getCustomProviders, toProviderDefinition } from './custom-provider.service'
import { getProviderBaseURL } from './provider-base-url.service'

export interface LLMRequestConfig {
  providerId: string
  model: string
  temperature: number
  baseURL?: string
}

export class UnknownProviderError extends Error {
  constructor(readonly providerId: string) {
    super('UNKNOWN_PROVIDER')
    this.name = 'UnknownProviderError'
  }
}

async function resolveProvider(providerId: string) {
  if (providerId.startsWith('custom-')) {
    const customs = await getCustomProviders()
    const custom = customs.find((p) => p.id === providerId)
    if (custom) return toProviderDefinition(custom)
  }
  return getProviderById(providerId)
}

export function normalizeOpenAICompatibleBaseURL(baseURL?: string): string | undefined {
  return baseURL
    ?.trim()
    .replace(/\/+$/, '')
    .replace(/\/(?:chat\/completions|completions|responses)$/i, '')
}

export function normalizeAnthropicBaseURL(baseURL?: string): string | undefined {
  return baseURL
    ?.trim()
    .replace(/\/+$/, '')
    .replace(/\/v1\/messages$/i, '')
    .replace(/\/v1$/i, '')
}

export function parseGoogleBaseURL(baseURL?: string): { baseUrl?: string; apiVersion?: string } {
  const normalizedURL = baseURL?.trim().replace(/\/+$/, '')
  const endpointMatch = normalizedURL?.match(
    /\/(v\d+(?:beta\d*)?)(?:\/models\/[^/?]+(?::(?:generateContent|streamGenerateContent))?)?$/i,
  )

  return {
    baseUrl: endpointMatch
      ? normalizedURL?.slice(0, -endpointMatch[0].length)
      : normalizedURL || undefined,
    apiVersion: endpointMatch?.[1],
  }
}

export async function createLLMClient(config: LLMRequestConfig): Promise<BaseChatModel> {
  const provider = await resolveProvider(config.providerId)
  if (!provider) throw new UnknownProviderError(config.providerId)

  const apiKey = await resolveApiKey(config.providerId, provider.env)
  const configuredBaseURL = await getProviderBaseURL(config.providerId)
  const baseURL = configuredBaseURL || config.baseURL || provider.api
  const temperature = config.temperature ?? 0.7

  if (provider.id === 'ollama') {
    return new ChatOpenAI({
      modelName: config.model,
      openAIApiKey: apiKey || 'ollama',
      temperature,
      configuration: { baseURL: normalizeOpenAICompatibleBaseURL(baseURL) },
    })
  }

  switch (provider.protocol) {
    case 'anthropic':
      return new ChatAnthropic({
        modelName: config.model,
        anthropicApiKey: apiKey,
        anthropicApiUrl: normalizeAnthropicBaseURL(baseURL),
        temperature,
      })

    case 'google': {
      const googleEndpoint = parseGoogleBaseURL(baseURL)
      return new ChatGoogleGenerativeAI({
        model: config.model,
        apiKey,
        baseUrl: googleEndpoint.baseUrl,
        apiVersion: googleEndpoint.apiVersion,
        temperature,
      })
    }

    case 'openai':
    case 'openai-compatible':
    default:
      return new ChatOpenAI({
        modelName: config.model,
        openAIApiKey: apiKey || 'missing-api-key',
        temperature,
        configuration: { baseURL: normalizeOpenAICompatibleBaseURL(baseURL) },
      })
  }
}

export async function createLLMFromAgent(agent: AgentConfig): Promise<BaseChatModel> {
  return createLLMClient({
    providerId: agent.providerId,
    model: agent.model,
    temperature: agent.temperature,
    baseURL: agent.baseURL,
  })
}
