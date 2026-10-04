import type { AgentConfig } from '../../types/agent'
import { translations } from './index'
import type { LanguageCode } from './types'

type LocalizedAgentField = 'name' | 'role' | 'systemPrompt'
type AgentTranslationKey = 'newAgent' | 'customAssistant' | 'customAssistantPrompt'

const DEFAULT_AGENT_FIELDS: ReadonlyArray<{
  field: LocalizedAgentField
  key: AgentTranslationKey
}> = [
  { field: 'name', key: 'newAgent' },
  { field: 'role', key: 'customAssistant' },
  { field: 'systemPrompt', key: 'customAssistantPrompt' },
]

/**
 * In-session origin tracker: for each agent id, the language whose shipped
 * default a still-default field currently holds. A field is re-localised only
 * while it still equals that origin default — a user edit breaks the match and
 * the field is left untouched. We deliberately do NOT infer "shipped default"
 * from a fuzzy string match against every language, because a user can
 * legitimately type text that happens to equal one of those defaults.
 *
 * This is a session-level guard; a persisted `defaultSource` marker on
 * AgentConfig (owned by the types/components partition) would make bootstrap
 * fully exact across reloads.
 */
const defaultOriginByAgent = new Map<
  string,
  Partial<Record<LocalizedAgentField, LanguageCode>>
>()

function detectOriginLanguage(
  value: string,
  key: AgentTranslationKey,
): LanguageCode | null {
  for (const code of Object.keys(translations) as LanguageCode[]) {
    if (translations[code].agents[key] === value) return code
  }
  return null
}

/**
 * Translate only shipped Agent defaults. Custom names, roles, and prompts are user data
 * and must not be rewritten when the application language changes.
 */
export function localizeAgentDefaults<T extends Pick<AgentConfig, LocalizedAgentField>>(
  agent: T,
  language: LanguageCode,
): T {
  const localized = { ...agent }
  const target = translations[language].agents
  const agentId = (agent as Partial<AgentConfig>).id

  for (const { field, key } of DEFAULT_AGENT_FIELDS) {
    const value = agent[field]
    if (typeof value !== 'string' || value.length === 0) continue

    let originRecord = agentId ? defaultOriginByAgent.get(agentId) : undefined
    const origin = originRecord?.[field]

    if (origin) {
      // Already tracked: only re-localise while the field still holds the
      // shipped default of the origin language. Any user edit breaks equality.
      if (translations[origin].agents[key] === value) {
        localized[field] = target[key]
        originRecord![field] = language
      }
      continue
    }

    // First sight of this agent/field: bootstrap only when the current value is
    // a shipped default, then pin its origin so later edits are respected.
    const detected = detectOriginLanguage(value, key)
    if (!detected) continue
    if (!agentId) {
      // No stable id to anchor the origin (e.g. an unsaved draft) — localise
      // once to match existing behaviour, but we cannot protect edits later.
      localized[field] = target[key]
      continue
    }
    if (!originRecord) {
      originRecord = {}
      defaultOriginByAgent.set(agentId, originRecord)
    }
    originRecord[field] = language
    localized[field] = target[key]
  }

  return localized
}
