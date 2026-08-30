import type {
  CustomProviderConfig as GeneratedCustomProviderConfig,
  ProviderDefinition as GeneratedProviderDefinition,
} from '@/types/generated'
import type {
  CustomProviderConfig,
  ProviderDefinition,
} from '@/types/provider'

// Tauri serializes Rust u64 values as JSON numbers. ts-rs models the wider
// in-memory integer as bigint, so the transport boundary must narrow it explicitly.
export type CustomProviderWire = Omit<GeneratedCustomProviderConfig, 'createdAt'> & {
  createdAt: number
}

export type ProviderDefinitionWire = GeneratedProviderDefinition

export type CustomProviderSaveArgs = Record<string, unknown> & {
  provider: CustomProviderWire
}

export function toCustomProviderWire(provider: CustomProviderConfig): CustomProviderWire {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseURL,
    defaultModel: provider.defaultModel,
    models: provider.models ?? [],
    protocol: provider.protocol,
    createdAt: provider.createdAt,
  }
}

export function toCustomProviderSaveArgs(
  provider: CustomProviderConfig,
): CustomProviderSaveArgs {
  return { provider: toCustomProviderWire(provider) }
}

export function fromCustomProviderWire(provider: CustomProviderWire): CustomProviderConfig {
  return {
    id: provider.id,
    name: provider.name,
    baseURL: provider.baseUrl,
    defaultModel: provider.defaultModel,
    models: provider.models,
    protocol: provider.protocol,
    createdAt: provider.createdAt,
  }
}

export function fromProviderDefinitionWire(
  provider: ProviderDefinitionWire,
): ProviderDefinition {
  return {
    id: provider.id,
    name: provider.name,
    api: provider.api,
    npm: provider.npm,
    doc: provider.doc,
    env: provider.env,
    protocol: provider.protocol,
    models: provider.models,
    defaultModel: provider.defaultModel,
    defaultApi: provider.defaultApi,
    isApiOverridden: provider.isApiOverridden,
    isCustom: provider.isCustom,
    isLocal: provider.isLocal,
  }
}
