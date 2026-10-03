import type { AgentConfig } from '@/types/agent'
import type { ProviderDefinition } from '@/types/provider'

const CUSTOM_PROVIDER_PREFIX =
  /^custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i

/** Custom providers sometimes prefix model ids with `custom-<uuid>/`. */
export function stripCustomPrefix(model: string): string {
  return model.trim().replace(CUSTOM_PROVIDER_PREFIX, '')
}

const MODEL_TOKEN_NAMES: Record<string, string> = {
  api: 'API',
  coder: 'Coder',
  code: 'Code',
  gemini: 'Gemini',
  glm: 'GLM',
  gpt: 'GPT',
  kimi: 'Kimi',
  llama: 'Llama',
  minimax: 'MiniMax',
  mimo: 'MiMo',
  qwen: 'Qwen',
}

function humanizeModelToken(token: string): string {
  const knownName = MODEL_TOKEN_NAMES[token.toLowerCase()]
  if (knownName) return knownName
  if (/^\d+o$/i.test(token)) return token.toLowerCase()
  if (/\d/.test(token)) return token.replace(/[a-z]/gi, (letter) => letter.toUpperCase())
  return token.charAt(0).toUpperCase() + token.slice(1)
}

/** Fallback prettifier for model ids missing from the provider catalog: uses the last path segment. */
export function humanizeModelId(modelId: string): string {
  const leaf = modelId.trim().split('/').filter(Boolean).at(-1) ?? ''
  return leaf
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(humanizeModelToken)
    .join(' ')
}

type ProviderModels = Pick<ProviderDefinition, 'id' | 'models'>

/** Catalog name when it adds information beyond the id itself. */
function readableCatalogName(model: { id: string; name: string }): string {
  const name = model.name?.trim() ?? ''
  return name && name.toLowerCase() !== model.id.trim().toLowerCase() ? name : ''
}

/**
 * Resolves the human-friendly model name. Order: exact provider catalog hit,
 * then a cross-provider hit only when every provider agrees on the name,
 * then a humanized id. Returns '' for an empty model so callers keep their
 * own "default" wording.
 */
export function modelDisplayName(
  providerId: string | undefined,
  modelId: string | undefined,
  providers: ProviderModels[],
): string {
  const raw = modelId?.trim()
  if (!raw) return ''
  const withoutPrefix = stripCustomPrefix(raw)
  const matches = (id: string) => id === withoutPrefix || id === raw

  const provider = providers.find((item) => item.id === providerId)
  const exact = provider?.models?.find((model) => matches(model.id))
  const exactName = exact ? readableCatalogName(exact) : ''
  if (exactName) return exactName

  const crossNames = new Set<string>()
  for (const item of providers) {
    for (const model of item.models ?? []) {
      if (matches(model.id)) {
        const name = readableCatalogName(model)
        if (name) crossNames.add(name)
      }
    }
  }
  if (!exact && crossNames.size === 1) return [...crossNames][0]

  return humanizeModelId(withoutPrefix) || withoutPrefix
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
