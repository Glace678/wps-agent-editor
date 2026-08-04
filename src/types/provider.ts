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
