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

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: number
}

export interface AgentTaskResult {
  agentId: string
  agentName: string
  response: string
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>
}