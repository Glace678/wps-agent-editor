import type { AgentReasoningSelection } from '../types/agent'
import type {
  ProviderDefinition,
  ProviderModel,
  ProviderReasoningEffort,
  ProviderReasoningOption,
} from '../types/provider'

export const DEFAULT_AGENT_REASONING: AgentReasoningSelection = { kind: 'auto' }

const REASONING_EFFORTS = new Set<ProviderReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

export type AgentReasoningProfileMode =
  | 'unsupported'
  | 'fixed'
  | 'toggle'
  | 'effort'
  | 'budget'

export type AgentReasoningTransport =
  | 'none'
  | 'openai'
  | 'deepseek'
  | 'anthropic-adaptive'
  | 'anthropic-budget'
  | 'google-level'
  | 'google-budget'
  | 'kimi'
  | 'minimax'
  | 'qwen'
  | 'openrouter'
  | 'generic-toggle'

export interface AgentReasoningProfile {
  mode: AgentReasoningProfileMode
  transport: AgentReasoningTransport
  selections: AgentReasoningSelection[]
  budget?: { min: number; max: number }
}

export interface AgentReasoningRequestOptions {
  openAIReasoningEffort?: ProviderReasoningEffort
  modelKwargs?: Record<string, unknown>
  anthropic?: {
    thinking: { type: 'adaptive' } | { type: 'enabled'; budget_tokens: number }
    effort?: ProviderReasoningEffort
    maxTokens?: number
  }
  googleThinkingConfig?: {
    thinkingLevel?: ProviderReasoningEffort
    thinkingBudget?: number
  }
}

function isReasoningEffort(value: unknown): value is ProviderReasoningEffort {
  return typeof value === 'string'
    && REASONING_EFFORTS.has(value as ProviderReasoningEffort)
}

export function normalizeAgentReasoningSelection(value: unknown): AgentReasoningSelection {
  if (typeof value === 'string') {
    if (value === 'auto') return { kind: 'auto' }
    if (isReasoningEffort(value)) return { kind: 'effort', value }
    return { kind: 'auto' }
  }
  if (!value || typeof value !== 'object') return { kind: 'auto' }

  const candidate = value as Partial<AgentReasoningSelection> & { value?: unknown; tokens?: unknown }
  if (candidate.kind === 'auto' || candidate.kind === 'enabled' || candidate.kind === 'disabled') {
    return { kind: candidate.kind }
  }
  if (candidate.kind === 'effort' && isReasoningEffort(candidate.value)) {
    return { kind: 'effort', value: candidate.value }
  }
  if (candidate.kind === 'budget' && Number.isFinite(candidate.tokens)) {
    return { kind: 'budget', tokens: Math.max(0, Math.round(Number(candidate.tokens))) }
  }
  return { kind: 'auto' }
}

export function reasoningSelectionKey(value: AgentReasoningSelection): string {
  if (value.kind === 'effort') return `effort:${value.value}`
  if (value.kind === 'budget') return `budget:${value.tokens}`
  return value.kind
}

export function parseReasoningSelectionKey(value: string): AgentReasoningSelection {
  if (value === 'auto' || value === 'enabled' || value === 'disabled') return { kind: value }
  const [kind, detail] = value.split(':', 2)
  if (kind === 'effort' && isReasoningEffort(detail)) return { kind: 'effort', value: detail }
  if (kind === 'budget' && /^\d+$/.test(detail)) return { kind: 'budget', tokens: Number(detail) }
  return { kind: 'auto' }
}

export function reasoningSelectionsEqual(
  left: AgentReasoningSelection,
  right: AgentReasoningSelection,
): boolean {
  return reasoningSelectionKey(left) === reasoningSelectionKey(right)
}

function modelIdentity(provider: Pick<ProviderDefinition, 'id' | 'name'>, model: ProviderModel): string {
  return [provider.id, provider.name, model.id, model.name, model.family]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function isAlibabaProvider(provider: Pick<ProviderDefinition, 'id' | 'name'>): boolean {
  return /(?:alibaba|dashscope)/i.test(`${provider.id} ${provider.name}`)
}

function isOpenCodeGoProvider(provider: Pick<ProviderDefinition, 'id' | 'name'>): boolean {
  return /opencode[-_ ]?go/i.test(`${provider.id} ${provider.name}`)
}

function curatedReasoningOptions(
  provider: Pick<ProviderDefinition, 'id' | 'name'>,
  identity: string,
): ProviderReasoningOption[] | 'fixed' | undefined {
  if (/gpt[-_. ]?5[.-]?6/.test(identity)) {
    return [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }]
  }
  if (/gpt[-_. ]?5[.-]?(?:2|4|5)/.test(identity)) {
    return [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] }]
  }
  if (/gpt[-_. ]?5[.-]?1/.test(identity)) {
    return [{ type: 'effort', values: ['none', 'low', 'medium', 'high'] }]
  }
  if (/gpt[-_. ]?5(?:\D|$)/.test(identity)) {
    return [{ type: 'effort', values: ['minimal', 'low', 'medium', 'high'] }]
  }

  if (/deepseek[-_/ .]?v4[-_/ .]?(?:flash|pro)/.test(identity)) {
    const values: ProviderReasoningEffort[] = isAlibabaProvider(provider)
      || (isOpenCodeGoProvider(provider) && /deepseek[-_/ .]?v4[-_/ .]?pro/.test(identity))
      ? ['high', 'max']
      : ['low', 'high', 'max']
    return [{ type: 'toggle' }, { type: 'effort', values }]
  }

  if (/(?:^|[\s/])hy3(?:[-_. ]?preview)?(?:$|[\s/])/.test(identity)) {
    return [{ type: 'effort', values: ['none', 'low', 'high'] }]
  }

  // MiMo's Chat Completions API only exposes a thinking toggle. Its Responses
  // API accepts an effort field, but currently maps every non-none value to
  // enabled, so exposing those as separate tiers would be misleading here.
  if (/mimo[-_/ .]?v2(?:[.-]?5)?(?:[-_/ .]?(?:pro|omni))?/.test(identity)) {
    return [{ type: 'toggle' }]
  }

  if (/glm[-_/ .]?5[.-]?2(?:\D|$)/.test(identity)) {
    return [
      ...(isAlibabaProvider(provider) ? [{ type: 'toggle' } as const] : []),
      { type: 'effort', values: ['high', 'max'] },
    ]
  }
  if (/glm[-_/ .]?5(?:[.-]?(?:1|turbo|v[-_/ .]?turbo))?(?:\D|$)/.test(identity)) {
    return isAlibabaProvider(provider)
      ? [{ type: 'toggle' }, { type: 'effort', values: ['high', 'max'] }]
      : [{ type: 'toggle' }]
  }

  if (/kimi[-_/ .]?k3(?:\D|$)/.test(identity)) {
    if (isAlibabaProvider(provider) || isOpenCodeGoProvider(provider)) return 'fixed'
    return [{ type: 'effort', values: ['low', 'high', 'max'] }]
  }
  if (/kimi[-_/ .]?k2[.-]?7[-_/ .]?code/.test(identity)) return 'fixed'
  if (/kimi[-_/ .]?k2[.-]?(?:5|6)(?:\D|$)/.test(identity)) return [{ type: 'toggle' }]
  if (/kimi[-_/ .]?k2[-_/ .]?thinking/.test(identity)) return 'fixed'

  if (/claude[-_/ .]?(?:sonnet|opus)[-_/ .]?4[.-]?6/.test(identity)) {
    return [{ type: 'effort', values: ['low', 'medium', 'high', 'max'] }]
  }
  if (/claude[-_/ .]?haiku[-_/ .]?4[.-]?5/.test(identity)) {
    return [{ type: 'budget_tokens', min: 1_024, max: 32_768 }]
  }

  if (/gemini[-_/ .]?3/.test(identity)) {
    const values: ProviderReasoningEffort[] = /flash/.test(identity)
      ? ['minimal', 'low', 'medium', 'high']
      : ['low', 'medium', 'high']
    return [{ type: 'effort', values }]
  }
  if (/gemini[-_/ .]?2[.-]?5[-_/ .]?pro/.test(identity)) {
    return [{ type: 'budget_tokens', min: 128, max: 32_768 }]
  }
  if (/gemini[-_/ .]?2[.-]?5[-_/ .]?flash[-_/ .]?lite/.test(identity)) {
    return [{ type: 'toggle' }, { type: 'budget_tokens', min: 512, max: 24_576 }]
  }
  if (/gemini[-_/ .]?2[.-]?5[-_/ .]?flash/.test(identity)) {
    return [{ type: 'toggle' }, { type: 'budget_tokens', min: 0, max: 24_576 }]
  }

  if (/grok[-_/ .]?4[.-]?20[-_/ .]?multi/.test(identity)) {
    return [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh'] }]
  }
  if (/grok[-_/ .]?4[.-]?(?:3|5)/.test(identity)) {
    return [{ type: 'effort', values: ['low', 'medium', 'high'] }]
  }

  if (/qwen3[.-]?8[-_/ .]?max/.test(identity)) {
    return [{ type: 'toggle' }, { type: 'effort', values: ['low', 'medium', 'xhigh'] }]
  }
  if (/qwen3[.-]?7[-_/ .]?(?:max|plus)/.test(identity)) {
    return [{ type: 'toggle' }, { type: 'budget_tokens', min: 1_024, max: 262_144 }]
  }
  if (/qwen3[.-]?(?:6|5)[-_/ .]?plus/.test(identity)) {
    return [{ type: 'toggle' }, { type: 'budget_tokens', min: 1_024, max: 81_920 }]
  }

  if (/minimax[-_/ .]?m3(?:[-_/ .]?highspeed)?(?:\D|$)/.test(identity)) {
    return [{ type: 'toggle' }]
  }
  if (/minimax[-_/ .]?m2(?:[.-]?[157])?(?:[-_/ .]?highspeed)?(?:\D|$)/.test(identity)) {
    return 'fixed'
  }
  if (/(?:thinking|reasoner|deepseek[-_/ .]?r1)(?:\D|$)/.test(identity)) return 'fixed'
  return undefined
}

function buildBudgetSelections(min: number, max: number, canDisable: boolean): AgentReasoningSelection[] {
  const candidates = [min, 1_024, 2_048, 4_096, 8_192, 16_384, 32_768, max]
  const budgets = [...new Set(candidates
    .map((value) => Math.round(value))
    .filter((value) => value >= min && value <= max))]
    .sort((left, right) => left - right)
  return [
    { kind: 'auto' },
    ...(canDisable ? [{ kind: 'disabled' } as const] : []),
    ...budgets.map((tokens): AgentReasoningSelection => ({ kind: 'budget', tokens })),
  ]
}

function reasoningTransport(
  provider: ProviderDefinition,
  identity: string,
  mode: AgentReasoningProfileMode,
): AgentReasoningTransport {
  if (mode === 'unsupported' || mode === 'fixed') return 'none'
  if (provider.protocol === 'anthropic') {
    return mode === 'budget' ? 'anthropic-budget' : 'anthropic-adaptive'
  }
  if (provider.protocol === 'google') {
    return mode === 'budget' ? 'google-budget' : 'google-level'
  }
  // DashScope uses enable_thinking/thinking_budget for hosted models from
  // several vendors. MiniMax M3 is the documented exception.
  if (isAlibabaProvider(provider)) {
    return /minimax/.test(identity) ? 'minimax' : 'qwen'
  }
  if (/deepseek/.test(identity)) return 'deepseek'
  if (/(?:moonshot|kimi)/.test(identity)) return 'kimi'
  if (/minimax/.test(identity)) return 'minimax'
  if (/(?:alibaba|dashscope|qwen)/.test(identity)) return 'qwen'
  if (/openrouter/.test(identity)) return 'openrouter'
  if (mode === 'toggle' || mode === 'budget') return 'generic-toggle'
  return 'openai'
}

export function resolveAgentReasoningProfile(
  provider: ProviderDefinition | null,
  modelId: string,
): AgentReasoningProfile {
  if (!provider || provider.isLocal) {
    return { mode: 'unsupported', transport: 'none', selections: [{ kind: 'auto' }] }
  }

  const model = provider.models.find((item) => item.id === modelId)
    ?? { id: modelId, name: modelId }
  const identity = modelIdentity(provider, model)
  const curated = curatedReasoningOptions(provider, identity)
  // Curated rules are maintained from provider documentation and take
  // precedence for known models. Catalog metadata remains the fallback for
  // newly-added or provider-specific model aliases.
  const reasoningOptions = curated !== undefined
    ? curated === 'fixed' ? [] : curated
    : model.reasoningOptions?.length ? model.reasoningOptions : undefined

  if (reasoningOptions?.length) {
    const toggle = reasoningOptions.some((option) => option.type === 'toggle')
    const effort = reasoningOptions.find((option) => option.type === 'effort')
    if (effort?.type === 'effort' && effort.values.length > 0) {
      const mode = 'effort' as const
      return {
        mode,
        transport: reasoningTransport(provider, identity, mode),
        selections: [
          { kind: 'auto' },
          ...(toggle ? [{ kind: 'disabled' } as const] : []),
          ...effort.values.map((value): AgentReasoningSelection => ({ kind: 'effort', value })),
        ],
      }
    }

    const budget = reasoningOptions.find((option) => option.type === 'budget_tokens')
    if (budget?.type === 'budget_tokens') {
      const min = Math.max(0, Math.round(budget.min ?? 1_024))
      const max = Math.max(min, Math.round(budget.max ?? 32_768))
      const mode = 'budget' as const
      return {
        mode,
        transport: reasoningTransport(provider, identity, mode),
        selections: buildBudgetSelections(min, max, toggle || min === 0),
        budget: { min, max },
      }
    }

    if (toggle) {
      const mode = 'toggle' as const
      return {
        mode,
        transport: reasoningTransport(provider, identity, mode),
        selections: [{ kind: 'auto' }, { kind: 'enabled' }, { kind: 'disabled' }],
      }
    }
  }

  if (curated === 'fixed' || model.reasoning === true) {
    return { mode: 'fixed', transport: 'none', selections: [] }
  }
  return { mode: 'unsupported', transport: 'none', selections: [{ kind: 'auto' }] }
}

export function normalizeReasoningForProfile(
  profile: AgentReasoningProfile,
  value: unknown,
): AgentReasoningSelection {
  const normalized = normalizeAgentReasoningSelection(value)
  if (profile.mode === 'fixed' || profile.mode === 'unsupported') return { kind: 'auto' }
  return profile.selections.some((selection) => reasoningSelectionsEqual(selection, normalized))
    ? normalized
    : { kind: 'auto' }
}

export function getAgentReasoningRequestOptions(
  profile: AgentReasoningProfile,
  value: unknown,
): AgentReasoningRequestOptions {
  const selection = normalizeReasoningForProfile(profile, value)
  if (selection.kind === 'auto' || profile.transport === 'none') return {}

  if (selection.kind === 'disabled') {
    if (profile.transport === 'qwen') return { modelKwargs: { enable_thinking: false } }
    if (profile.transport === 'openrouter') return { modelKwargs: { reasoning: { enabled: false } } }
    if (profile.transport === 'google-budget') return { googleThinkingConfig: { thinkingBudget: 0 } }
    return { modelKwargs: { thinking: { type: 'disabled' } } }
  }

  if (selection.kind === 'enabled') {
    if (profile.transport === 'qwen') return { modelKwargs: { enable_thinking: true } }
    if (profile.transport === 'openrouter') return { modelKwargs: { reasoning: { enabled: true } } }
    if (profile.transport === 'minimax') return { modelKwargs: { thinking: { type: 'adaptive' } } }
    return { modelKwargs: { thinking: { type: 'enabled' } } }
  }

  if (selection.kind === 'effort') {
    if (profile.transport === 'anthropic-adaptive') {
      return { anthropic: { thinking: { type: 'adaptive' }, effort: selection.value } }
    }
    if (profile.transport === 'google-level') {
      return { googleThinkingConfig: { thinkingLevel: selection.value } }
    }
    if (profile.transport === 'openrouter') {
      return { modelKwargs: { reasoning: { effort: selection.value } } }
    }
    if (profile.transport === 'deepseek') {
      return {
        openAIReasoningEffort: selection.value,
        modelKwargs: { thinking: { type: 'enabled' } },
      }
    }
    if (profile.transport === 'qwen') {
      return {
        openAIReasoningEffort: selection.value,
        modelKwargs: { enable_thinking: selection.value !== 'none' },
      }
    }
    return { openAIReasoningEffort: selection.value }
  }

  if (profile.transport === 'anthropic-budget') {
    return {
      anthropic: {
        thinking: { type: 'enabled', budget_tokens: selection.tokens },
        maxTokens: Math.max(4_096, selection.tokens + 1_024),
      },
    }
  }
  if (profile.transport === 'google-budget') {
    return { googleThinkingConfig: { thinkingBudget: selection.tokens } }
  }
  if (profile.transport === 'qwen') {
    return { modelKwargs: { enable_thinking: true, thinking_budget: selection.tokens } }
  }
  if (profile.transport === 'openrouter') {
    return { modelKwargs: { reasoning: { max_tokens: selection.tokens } } }
  }
  return {
    modelKwargs: { thinking: { type: 'enabled', budget_tokens: selection.tokens } },
  }
}
