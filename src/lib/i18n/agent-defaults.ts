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

const localizedDefaultValues = Object.values(translations).map(({ agents }) => agents)

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

  for (const { field, key } of DEFAULT_AGENT_FIELDS) {
    const value = agent[field]
    const isShippedDefault = localizedDefaultValues.some((agents) => agents[key] === value)
    if (isShippedDefault) localized[field] = target[key]
  }

  return localized
}
