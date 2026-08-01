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
  protocol: ProviderProtocol
  createdAt: number
}

export interface AuthStatus {
  configured: boolean
  type: 'api' | 'oauth'
}
