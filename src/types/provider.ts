export type ProviderProtocol =
  | 'openai-compatible'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'bedrock'
  | 'unknown'

export type ProviderReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export type ProviderReasoningOption =
  | { type: 'toggle' }
  | { type: 'effort'; values: ProviderReasoningEffort[] }
  | { type: 'budget_tokens'; min?: number; max?: number }

export interface ProviderModel {
  id: string
  name: string
  family?: string
  reasoning?: boolean
  reasoningOptions?: ProviderReasoningOption[]
}

export interface ProviderDefinition {
  id: string
  name: string
  /** Canonical English name used for locale-independent provider ordering. */
  sortName?: string
  api: string
  env: string[]
  npm: string
  protocol: ProviderProtocol
  doc?: string
  models: ProviderModel[]
  defaultModel?: string
  defaultApi?: string
  isApiOverridden?: boolean
  isCustom?: boolean
  isLocal?: boolean
}

export interface CustomProviderConfig {
  id: string
  name: string
  baseURL: string
  defaultModel: string
  /** Models returned by the provider's OpenAI-compatible /models endpoint. */
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

export interface AuthStatus {
  configured: boolean
  type: 'api' | 'oauth'
}
