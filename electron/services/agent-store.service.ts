import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { t } from '../i18n/translate'

export interface AgentConfig {
  id: string
  name: string
  role: string
  systemPrompt: string
  providerId: string
  model: string
  baseURL?: string
  temperature: number
  tools: string[]
  color: string
  enabled: boolean
}

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
    providerId: String(raw.providerId ?? providerMap[legacyProvider ?? ''] ?? 'deepseek'),
    model: String(raw.model ?? 'deepseek-chat'),
    baseURL: raw.baseUrl as string | undefined ?? raw.baseURL as string | undefined,
    temperature: typeof raw.temperature === 'number' ? raw.temperature : 0.7,
    tools: Array.isArray(raw.tools) ? raw.tools as string[] : ['read_document'],
    color: String(raw.color ?? '#6366f1'),
    enabled: raw.enabled !== false,
  }
}

export async function getAgents(): Promise<AgentConfig[]> {
  try {
    const data = await fs.readFile(getStorePath(), 'utf-8')
    const parsed = JSON.parse(data) as Array<Record<string, unknown>>
    const agents = filterRemovedBuiltInAgents(parsed.map(migrateLegacyAgent))

    // Persist filtered list so removed built-ins do not reappear from disk.
    if (agents.length !== parsed.length) {
      await saveAgents(agents)
    }
    return agents
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
  if (isRemovedBuiltInAgentId(agent.id)) {
    return getAgents()
  }
  const agents = await getAgents()
  const idx = agents.findIndex((a) => a.id === agent.id)
  if (idx >= 0) agents[idx] = agent
  else agents.push(agent)
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
    providerId: 'deepseek',
    model: 'deepseek-chat',
    temperature: 0.7,
    tools: ['read_document'],
    color: '#6366f1',
    enabled: true,
    ...partial,
  }
}
