import type { AgentConfig } from '@/types/agent'
import type { ProviderDefinition } from '@/types/provider'

const CUSTOM_PROVIDER_PREFIX = /^custom-[a-f0-9-]+\//i

/** Custom providers sometimes prefix model ids with `custom-<uuid>/`. */
export function stripCustomPrefix(model: string): string {
  return model.trim().replace(CUSTOM_PROVIDER_PREFIX, '')
}

/** Fallback prettifier for model ids missing from the provider catalog. */
export function humanizeModelId(modelId: string): string {
  const normalized = modelId.replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((word) => (/^[a-z]/.test(word) ? `${word[0].toUpperCase()}${word.slice(1)}` : word))
    .join(' ')
}

type ProviderModels = Pick<ProviderDefinition, 'id' | 'models'>

/** Resolves the human-friendly model name from the catalog, falling back to a humanized id. */
export function modelDisplayName(
  providerId: string | undefined,
  modelId: string | undefined,
  providers: ProviderModels[],
): string {
  const raw = modelId?.trim()
  if (!raw) return ''
  const withoutPrefix = stripCustomPrefix(raw)
  const provider = providers.find((item) => item.id === providerId)
  const match = provider?.models?.find((model) => model.id === withoutPrefix || model.id === raw)
  return match?.name || humanizeModelId(withoutPrefix)
}

/** Minimal identity carried by collaboration transcript rows. */
export interface AgentIdentity {
  agentId?: string
  agentName?: string
  providerId?: string
  model?: string
  color?: string
}

interface IdentityRef {
  agentId?: string
  agentName?: string
  providerId?: string
  model?: string
}

/**
 * Merges runtime event fields with the saved Agent config so the UI always
 * has logo/model/color even on events that only carry agent id + name.
 */
export function resolveAgentIdentity(ref: IdentityRef, agents: AgentConfig[]): AgentIdentity {
  const configured = ref.agentId ? agents.find((agent) => agent.id === ref.agentId) : undefined
  return {
    agentId: ref.agentId,
    agentName: configured?.name ?? ref.agentName,
    providerId: configured?.providerId ?? ref.providerId,
    model: configured?.model ?? ref.model,
    color: configured?.color,
  }
}
