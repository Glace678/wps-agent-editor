/**
 * 统一 LLM Client — 参考 OpenCode @opencode-ai/llm
 * 根据 Provider protocol 动态创建 LangChain 客户端
 */
import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AgentConfig } from './agent-store.service'
import { getAuth } from './auth-storage.service'
import { detectOllama, getProviderById } from './provider-registry.service'
import { getCustomProviders, toProviderDefinition } from './custom-provider.service'
import { getProviderBaseURL } from './provider-base-url.service'
import {
  normalizeProviderBaseURL,
  normalizeProviderEndpoint,
  splitGoogleBaseURL,
} from './provider-base-url.util'
import {
  getAgentReasoningRequestOptions,
  resolveAgentReasoningProfile,
} from '../../src/lib/agent-reasoning'
import type { AgentReasoningSelection } from '../../src/types/agent'
import { createPromptCacheKey } from './agent-cache.service'

export interface LLMRequestConfig {
  providerId: string
  model?: string
  reasoning?: AgentReasoningSelection
  conversationId?: string
}

class ReasoningChatGoogleGenerativeAI extends ChatGoogleGenerativeAI {
  constructor(
    fields: ConstructorParameters<typeof ChatGoogleGenerativeAI>[0],
    private readonly thinkingConfig: Record<string, unknown>,
  ) {
    super(fields)
  }

  override invocationParams(
    options: Parameters<ChatGoogleGenerativeAI['invocationParams']>[0],
  ): ReturnType<ChatGoogleGenerativeAI['invocationParams']> {
    return {
      ...super.invocationParams(options),
      generationConfig: { thinkingConfig: this.thinkingConfig },
    } as unknown as ReturnType<ChatGoogleGenerativeAI['invocationParams']>
  }
}

export class UnknownProviderError extends Error {
  constructor(readonly providerId: string) {
    super('UNKNOWN_PROVIDER')
    this.name = 'UnknownProviderError'
  }
}

export class MissingAgentModelError extends Error {
  constructor(readonly agentId: string) {
    super('AGENT_MODEL_REQUIRED')
    this.name = 'MissingAgentModelError'
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

export async function createLLMClient(config: LLMRequestConfig): Promise<BaseChatModel> {
  const provider = await resolveProvider(config.providerId)
  if (!provider) throw new UnknownProviderError(config.providerId)
  const auth = await getAuth(config.providerId)
  if (!provider.isLocal && (!auth || auth.type !== 'api' || !auth.key)) {
    throw new UnknownProviderError(config.providerId)
  }

  const apiKey = auth?.type === 'api' && auth.key ? auth.key : 'ollama'
  const configuredBaseURL = await getProviderBaseURL(config.providerId)
  const baseURL = normalizeProviderEndpoint(provider, configuredBaseURL || provider.api)
  let model = config.model?.trim() || provider.defaultModel || provider.models[0]?.id

  if (!model && provider.id === 'ollama') {
    const detected = await detectOllama(baseURL)
    model = detected.models[0]
  }
  if (!model) throw new UnknownProviderError(config.providerId)

  const reasoningProfile = resolveAgentReasoningProfile(provider, model)
  const reasoningRequest = getAgentReasoningRequestOptions(reasoningProfile, config.reasoning)
  const supportsPromptCacheKey = provider.id === 'openai'
    || provider.id.startsWith('opencode')
    || /\/\/opencode\.ai\//i.test(baseURL)
  const promptCacheKey = config.conversationId && supportsPromptCacheKey
    ? createPromptCacheKey(config.conversationId)
    : undefined
  const openAIModelKwargs = {
    ...(reasoningRequest.modelKwargs ?? {}),
    ...(reasoningRequest.openAIReasoningEffort
      ? { reasoning_effort: reasoningRequest.openAIReasoningEffort }
      : {}),
    ...(promptCacheKey ? { prompt_cache_key: promptCacheKey } : {}),
  }

  if (provider.id === 'ollama') {
    return new ChatOpenAI({
      modelName: model,
      openAIApiKey: apiKey,
      modelKwargs: openAIModelKwargs,
      __includeRawResponse: true,
      configuration: { baseURL: normalizeProviderBaseURL('openai-compatible', baseURL) },
    })
  }

  switch (provider.protocol) {
    case 'anthropic':
      return new ChatAnthropic({
        modelName: model,
        anthropicApiKey: apiKey,
        anthropicApiUrl: normalizeProviderBaseURL('anthropic', baseURL),
        ...(reasoningRequest.anthropic
          ? {
              thinking: reasoningRequest.anthropic.thinking,
              maxTokens: reasoningRequest.anthropic.maxTokens ?? 16_384,
              ...(reasoningRequest.anthropic.effort
                ? {
                    invocationKwargs: {
                      output_config: { effort: reasoningRequest.anthropic.effort },
                      temperature: undefined,
                      top_k: undefined,
                      top_p: undefined,
                    },
                  }
                : {}),
            }
          : {}),
      } as ConstructorParameters<typeof ChatAnthropic>[0])

    case 'google': {
      const googleEndpoint = splitGoogleBaseURL(baseURL)
      const fields: ConstructorParameters<typeof ChatGoogleGenerativeAI>[0] = {
        model,
        apiKey,
        baseUrl: googleEndpoint.baseUrl,
        apiVersion: googleEndpoint.apiVersion,
      }
      return reasoningRequest.googleThinkingConfig
        ? new ReasoningChatGoogleGenerativeAI(fields, reasoningRequest.googleThinkingConfig)
        : new ChatGoogleGenerativeAI(fields)
    }

    case 'openai':
    case 'openai-compatible':
      return new ChatOpenAI({
        modelName: model,
        openAIApiKey: apiKey,
        modelKwargs: openAIModelKwargs,
        __includeRawResponse: true,
        configuration: { baseURL: normalizeProviderBaseURL(provider.protocol, baseURL) },
      })

    default:
      return new ChatOpenAI({
        modelName: model,
        openAIApiKey: apiKey,
        modelKwargs: promptCacheKey ? { prompt_cache_key: promptCacheKey } : {},
        __includeRawResponse: true,
        configuration: { baseURL: normalizeProviderBaseURL(provider.protocol, baseURL) },
      })
  }
}

export async function createLLMFromAgent(
  agent: AgentConfig,
  conversationId?: string,
): Promise<BaseChatModel> {
  const model = agent.model.trim()
  if (!model) throw new MissingAgentModelError(agent.id)

  return createLLMClient({
    providerId: agent.providerId,
    model,
    reasoning: agent.reasoning,
    conversationId,
  })
}
