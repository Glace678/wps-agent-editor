import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { t } from '../i18n/translate'
import { getLanguage } from '../i18n/types'
import { localizeAgentDefaults } from '../../src/lib/i18n/agent-defaults'
import {
  DEFAULT_AGENT_REASONING,
  normalizeAgentReasoningSelection,
} from '../../src/lib/agent-reasoning'
import type { AgentConfig } from '../../src/types/agent'
import { DEFAULT_DOCUMENT_OPERATION_PROMPT } from '../../src/lib/document-operation-prompt'

export type { AgentConfig } from '../../src/types/agent'

/** Built-in presets removed from the product; never seed or surface these in the UI. */
export const REMOVED_BUILT_IN_AGENT_IDS = new Set([
  'agent-writer',
  'agent-editor',
  'agent-local',
])

export function isRemovedBuiltInAgentId(id: string): boolean {
  return REMOVED_BUILT_IN_AGENT_IDS.has(id)
}

/** Drop the three retired built-in presets from any agent list (defaults, disk, or save). */
export function filterRemovedBuiltInAgents(agents: AgentConfig[]): AgentConfig[] {
  return agents.filter((agent) => !isRemovedBuiltInAgentId(agent.id))
}

function getDefaultAgents(): AgentConfig[] {
  return []
}

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'agents.json')
}

function migrateLegacyAgent(raw: Record<string, unknown>): AgentConfig {
  const providerMap: Record<string, string> = {
    deepseek: 'deepseek',
    qwen: 'alibaba',
    doubao: 'volcengine',
    ollama: 'ollama',
    openai: 'openai',
  }
  const legacyProvider = raw.provider as string | undefined
  return {
    id: String(raw.id),
    name: String(raw.name ?? 'Agent'),
    role: String(raw.role ?? ''),
    systemPrompt: String(raw.systemPrompt ?? ''),
    documentOperationPrompt: String(raw.documentOperationPrompt ?? DEFAULT_DOCUMENT_OPERATION_PROMPT),
    providerId: String(raw.providerId ?? providerMap[legacyProvider ?? ''] ?? 'deepseek'),
    model: String(raw.model ?? ''),
    reasoning: normalizeAgentReasoningSelection(raw.reasoning ?? raw.reasoningEffort),
    color: String(raw.color ?? '#6366f1'),
    enabled: raw.enabled !== false,
  }
}

export async function getAgents(): Promise<AgentConfig[]> {
  try {
    const data = await fs.readFile(getStorePath(), 'utf-8')
    const parsed = JSON.parse(data) as Array<Record<string, unknown>>
    const agents = filterRemovedBuiltInAgents(parsed.map(migrateLegacyAgent))
    const requiresMigration = parsed.some((agent) => (
      'temperature' in agent || 'baseURL' in agent
        || 'baseUrl' in agent || 'tools' in agent || 'reasoningEffort' in agent
        || !('documentOperationPrompt' in agent)
        || JSON.stringify(normalizeAgentReasoningSelection(agent.reasoning))
          !== JSON.stringify(agent.reasoning)
    ))

    // Persist migrations so removed fields and retired built-ins cannot reappear.
    if (agents.length !== parsed.length || requiresMigration) {
      await saveAgents(agents)
    }
    return agents.map((agent) => localizeAgentDefaults(agent, getLanguage()))
  } catch {
    const defaultAgents = getDefaultAgents()
    await saveAgents(defaultAgents)
    return defaultAgents
  }
}

export async function saveAgents(agents: AgentConfig[]): Promise<void> {
  const cleaned = filterRemovedBuiltInAgents(agents)
  await fs.writeFile(getStorePath(), JSON.stringify(cleaned, null, 2))
}

export async function saveAgent(agent: AgentConfig): Promise<AgentConfig[]> {
  const normalized = migrateLegacyAgent(agent as unknown as Record<string, unknown>)
  if (isRemovedBuiltInAgentId(normalized.id)) {
    return getAgents()
  }
  const agents = await getAgents()
  const idx = agents.findIndex((a) => a.id === normalized.id)
  if (idx >= 0) agents[idx] = normalized
  else agents.push(normalized)
  await saveAgents(agents)
  return agents
}

export async function deleteAgent(agentId: string): Promise<AgentConfig[]> {
  const agents = (await getAgents()).filter((a) => a.id !== agentId)
  await saveAgents(agents)
  return agents
}

export function createAgent(partial: Partial<AgentConfig>): AgentConfig {
  return {
    id: uuidv4(),
    name: t('agents.newAgent'),
    role: t('agents.customAssistant'),
    systemPrompt: t('agents.customAssistantPrompt'),
    documentOperationPrompt: DEFAULT_DOCUMENT_OPERATION_PROMPT,
    providerId: 'deepseek',
    model: '',
    reasoning: DEFAULT_AGENT_REASONING,
    color: '#6366f1',
    enabled: true,
    ...partial,
  }
}
