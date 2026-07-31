import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages'
import type { AgentConfig } from './agent-store.service'
import type { AgentEditCommand } from './onlyoffice.service'
import { createLLMFromAgent } from './llm-client.service'
import { t } from '../i18n/translate'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AgentTaskResult {
  agentId: string
  agentName: string
  response: string
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>
}

type EditHandler = (command: AgentEditCommand) => Promise<unknown>

async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  onEdit: EditHandler,
): Promise<unknown> {
  switch (toolName) {
    case 'insert_text':
      return onEdit({ action: 'insertText', text: args.text as string, position: args.position as AgentEditCommand['position'] })
    case 'append_paragraph':
      return onEdit({ action: 'appendParagraph', text: args.text as string })
    case 'replace_text':
      return onEdit({ action: 'replaceText', search: args.search as string, replace: args.replace as string, all: args.all as boolean })
    case 'read_document':
      return onEdit({ action: 'readDocument' })
    default:
      return { error: `Unknown tool: ${toolName}` }
  }
}

function parseToolCalls(content: string): Array<{ tool: string; args: Record<string, unknown> }> {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
  const toolPattern = /```tool\n([\s\S]*?)```/g
  let match
  while ((match = toolPattern.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1])
      if (parsed.tool) calls.push(parsed)
    } catch { /* skip */ }
  }
  return calls
}

export async function runAgentChat(
  agent: AgentConfig,
  messages: ChatMessage[],
  onEdit: EditHandler,
): Promise<AgentTaskResult> {
  const llm = await createLLMFromAgent(agent)

  const toolDescriptions = agent.tools.map((tool) => {
    const desc: Record<string, string> = {
      insert_text: t('agentOrchestrator.insertTextDesc'),
      append_paragraph: t('agentOrchestrator.appendParagraphDesc'),
      replace_text: t('agentOrchestrator.replaceTextDesc'),
      read_document: t('agentOrchestrator.readDocumentDesc'),
    }
    return desc[tool] || tool
  }).join('\n')

  const systemContent = `${agent.systemPrompt}

${t('agentOrchestrator.toolInstruction')}
${toolDescriptions}

${t('agentOrchestrator.example')}
\`\`\`tool
{"tool": "insert_text", "args": {"text": "Hello World", "position": "end"}}
\`\`\`
`

  const lcMessages = [
    new SystemMessage(systemContent),
    ...messages.map((m) => {
      if (m.role === 'user') return new HumanMessage(m.content)
      if (m.role === 'assistant') return new AIMessage(m.content)
      return new SystemMessage(m.content)
    }),
  ]

  const response = await llm.invoke(lcMessages)
  const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)

  const toolCalls = parseToolCalls(content)
  const executedTools: AgentTaskResult['toolCalls'] = []

  for (const call of toolCalls) {
    if (agent.tools.includes(call.tool)) {
      const result = await executeTool(call.tool, call.args, onEdit)
      executedTools.push({ tool: call.tool, args: call.args, result })
    }
  }

  return {
    agentId: agent.id,
    agentName: agent.name,
    response: content,
    toolCalls: executedTools,
  }
}

export async function runMultiAgentTask(
  agents: AgentConfig[],
  task: string,
  onEdit: EditHandler,
): Promise<AgentTaskResult[]> {
  const results: AgentTaskResult[] = []
  const planner = agents[0]
  if (!planner) return results

  const planResult = await runAgentChat(planner, [
    { role: 'user', content: t('agentOrchestrator.analyzeTask', { task }) },
  ], onEdit)
  results.push(planResult)

  for (let i = 1; i < agents.length; i++) {
    const worker = agents[i]
    const workerResult = await runAgentChat(worker, [
      {
        role: 'user',
        content: `${t('agentOrchestrator.previousAgentContext', {
          agent: planner.name,
          output: planResult.response,
        })}\n\n${t('agentOrchestrator.continueTask')}\n\n${task}`,
      },
    ], onEdit)
    results.push(workerResult)
  }

  return results
}
