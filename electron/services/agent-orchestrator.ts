import { randomUUID } from 'node:crypto'
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import type { AgentAttachment, AgentCollaborationEvent, AgentConfig, AgentTaskResult } from '../../src/types/agent'
import type {
  AgentApprovalRequest,
  AgentUserDocumentActivity,
  WordEditPlan,
} from '../../src/types/document'
import type { ArtifactDraftCreateRequest, CodeDraftCreateRequest } from '../../src/types/artifact-review'
import type { AgentEditCommand } from './onlyoffice.service'
import { createLLMFromAgent, MissingAgentModelError } from './llm-client.service'
import { t } from '../i18n/translate'
import { addStableAttachmentContextToMessages } from './agent-attachment.service'
import {
  EXCEL_FUNCTION_CATALOG_VERSION,
  EXCEL_FUNCTION_CATEGORIES,
  searchExcelFunctions,
  type ExcelFunctionCategory,
} from '../../src/lib/excel-functions/catalog'
import { getLanguage } from '../../src/lib/i18n/types'
import {
  AGENT_CACHE_PROTOCOL,
  aggregateAgentCacheUsage,
  extractAgentCacheUsage,
} from './agent-cache.service'
import { sanitizeProviderPayload } from './provider-payload-sanitizer'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: AgentAttachment[]
}

export type { AgentTaskResult } from '../../src/types/agent'

export type AgentEventHandler = (event: AgentCollaborationEvent) => void
export type AgentRunner = (
  agent: AgentConfig,
  messages: ChatMessage[],
  onEdit: EditHandler,
  options: AgentRunOptions,
) => Promise<AgentTaskResult>

export interface AgentRunOptions {
  runId?: string
  conversationId?: string
  rootAgentId?: string
  onEvent?: AgentEventHandler
  signal?: AbortSignal
  /** Allows an Agent to ask or delegate work to another configured Agent. */
  delegateAgent?: (agentId: string, question: string) => Promise<AgentTaskResult | { error: string }>
  collaborationDepth?: number
  maxCollaborationDepth?: number
  /** Dependency hook for deterministic orchestration tests and alternate runtimes. */
  executeAgent?: AgentRunner
  requestApproval?: (
    request: Omit<AgentApprovalRequest, 'approvalId' | 'requestedAt'>,
  ) => Promise<'continue' | 'end' | 'stale'>
  getDocumentActivities?: () => AgentUserDocumentActivity[]
}

type EditHandler = (command: AgentEditCommand) => Promise<unknown>
type AgentEditHandlerFactory = (agent: AgentConfig) => EditHandler

const DOCUMENT_TOOLS = [
  'insert_text',
  'append_paragraph',
  'replace_text',
  'read_document',
  'inspect_word_document',
  'search_word_operations',
  'apply_word_plan',
  'read_excel_range',
  'set_excel_formula',
  'inspect_document_artifact',
  'search_document_operations',
  'create_document_draft',
  'inspect_code_workspace',
  'read_code_artifact',
  'create_code_draft',
] as const
const REFERENCE_TOOLS = ['search_excel_functions'] as const
const COLLABORATION_TOOLS = ['ask_agent', 'spawn_agent'] as const
const COLLABORATION_PROTOCOL = `
You may ask another configured Agent for a review or delegate a subtask.
Use a tool block with valid JSON and an existing Agent id:
\`\`\`tool
{"tool":"ask_agent","args":{"agentId":"agent-id","question":"A focused question"}}
\`\`\`
Use spawn_agent when the other Agent should complete a bounded subtask and return its result.
Do not invent Agent ids. Keep delegated questions narrow and include the relevant context.
`
const MAX_SHARED_CONTEXT_CHARS = 24_000

function emitEvent(
  handler: AgentEventHandler | undefined,
  runId: string,
  event: Omit<AgentCollaborationEvent, 'runId' | 'timestamp'>,
): void {
  handler?.({ ...event, runId, timestamp: Date.now() })
}

function appendSharedContext(current: string, contribution: string): string {
  const next = current ? `${current}\n\n${contribution}` : contribution
  if (next.length <= MAX_SHARED_CONTEXT_CHARS) return next
  return `${t('agentOrchestrator.earlierContextOmitted')}\n\n${next.slice(-MAX_SHARED_CONTEXT_CHARS)}`
}

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  onEdit: EditHandler,
  context: {
    runId: string
    agent: AgentConfig
    onEvent?: AgentEventHandler
    delegateAgent?: AgentRunOptions['delegateAgent']
  },
): Promise<unknown> {
  const operationId = randomUUID()
  const commandMeta = {
    operationId,
    runId: context.runId,
    agentId: context.agent.id,
    agentName: context.agent.name,
  }
  let result: unknown
  switch (toolName) {
    case 'insert_text':
      result = await onEdit({ action: 'insertText', text: args.text as string, position: args.position as AgentEditCommand['position'], ...commandMeta })
      break
    case 'append_paragraph':
      result = await onEdit({ action: 'appendParagraph', text: args.text as string, ...commandMeta })
      break
    case 'replace_text':
      result = await onEdit({ action: 'replaceText', search: args.search as string, replace: args.replace as string, all: args.all as boolean, ...commandMeta })
      break
    case 'read_document':
      result = await onEdit({ action: 'readDocument', ...commandMeta })
      break
    case 'inspect_word_document':
      result = await onEdit({ action: 'inspectWordDocument', ...commandMeta })
      break
    case 'search_word_operations':
      result = await onEdit({
        action: 'searchWordOperations',
        query: typeof args.query === 'string' ? args.query : '',
        limit: typeof args.limit === 'number' ? args.limit : undefined,
        ...commandMeta,
      })
      break
    case 'apply_word_plan':
      result = await onEdit({
        action: 'applyWordPlan',
        plan: (isWordEditPlan(args.plan) ? args.plan : args) as WordEditPlan,
        ...commandMeta,
      })
      break
    case 'search_excel_functions': {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      const requestedCategory = typeof args.category === 'string' ? args.category.trim() : ''
      const category = EXCEL_FUNCTION_CATEGORIES.includes(requestedCategory as ExcelFunctionCategory)
        ? requestedCategory as ExcelFunctionCategory
        : undefined
      if (requestedCategory && !category) {
        result = {
          success: false,
          error: 'INVALID_EXCEL_FUNCTION_CATEGORY',
          categories: EXCEL_FUNCTION_CATEGORIES,
        }
        break
      }
      const limit = typeof args.limit === 'number' ? args.limit : 10
      const searchResult = searchExcelFunctions({ query, category, limit, language: getLanguage() })
      result = {
        success: true,
        catalogVersion: EXCEL_FUNCTION_CATALOG_VERSION,
        count: searchResult.length,
        functions: searchResult,
      }
      break
    }
    case 'read_excel_range':
      result = await onEdit({
        action: 'readExcelRange',
        sheet: typeof args.sheet === 'string' ? args.sheet : undefined,
        range: typeof args.range === 'string' ? args.range : '',
        ...commandMeta,
      })
      break
    case 'set_excel_formula':
      result = await onEdit({
        action: 'setExcelFormula',
        sheet: typeof args.sheet === 'string' ? args.sheet : undefined,
        target: typeof args.target === 'string' ? args.target : '',
        formula: typeof args.formula === 'string' ? args.formula : '',
        ...commandMeta,
      })
      break
    case 'inspect_document_artifact':
      result = await onEdit({ action: 'inspectDocumentArtifact', ...commandMeta })
      break
    case 'search_document_operations':
      result = await onEdit({
        action: 'searchDocumentOperations',
        query: typeof args.query === 'string' ? args.query : '',
        limit: typeof args.limit === 'number' ? args.limit : undefined,
        ...commandMeta,
      })
      break
    case 'create_document_draft':
      result = await onEdit({
        action: 'createDocumentDraft',
        artifactDraft: args as unknown as Omit<ArtifactDraftCreateRequest, 'sourcePath' | 'runId' | 'agentId' | 'agentName'>,
        ...commandMeta,
      })
      break
    case 'inspect_code_workspace':
      result = await onEdit({ action: 'inspectCodeWorkspace', ...commandMeta })
      break
    case 'read_code_artifact':
      result = await onEdit({
        action: 'readCodeArtifact',
        artifactId: typeof args.artifactId === 'string' ? args.artifactId : '',
        startOffset: typeof args.startOffset === 'number' ? args.startOffset : undefined,
        endOffset: typeof args.endOffset === 'number' ? args.endOffset : undefined,
        ...commandMeta,
      })
      break
    case 'create_code_draft':
      result = await onEdit({
        action: 'createCodeDraft',
        codeDraft: args as unknown as CodeDraftCreateRequest,
        ...commandMeta,
      })
      break
    case 'ask_agent':
    case 'spawn_agent': {
      const targetAgentId = typeof args.agentId === 'string' ? args.agentId.trim() : ''
      const question = typeof args.question === 'string'
        ? args.question.trim()
        : typeof args.task === 'string'
          ? args.task.trim()
          : ''
      if (!context.delegateAgent) {
        result = { error: t('agentOrchestrator.delegationUnavailable') }
        break
      }
      if (!targetAgentId || !question) {
        result = { error: t('agentOrchestrator.invalidDelegation') }
        break
      }
      emitEvent(context.onEvent, context.runId, {
        type: 'agent-question',
        agentId: context.agent.id,
        agentName: context.agent.name,
        toAgentId: targetAgentId,
        content: question,
        action: toolName,
      })
      result = await context.delegateAgent(targetAgentId, question)
      const answer = result && typeof result === 'object' && 'response' in result
        ? String((result as AgentTaskResult).response)
        : result && typeof result === 'object' && 'error' in result
          ? String((result as { error: unknown }).error)
          : JSON.stringify(result)
      emitEvent(context.onEvent, context.runId, {
        type: 'agent-answer',
        agentId: targetAgentId,
        toAgentId: context.agent.id,
        fromAgentId: targetAgentId,
        fromAgentName: result && typeof result === 'object' && 'agentName' in result
          ? String((result as AgentTaskResult).agentName)
          : undefined,
        content: answer,
        action: toolName,
      })
      break
    }
    default:
      result = { error: t('agentOrchestrator.unknownTool', { tool: toolName }) }
  }
  return result
}

function isWordEditPlan(value: unknown): value is WordEditPlan {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WordEditPlan>
  return typeof candidate.planId === 'string'
    && typeof candidate.documentRevision === 'number'
    && Array.isArray(candidate.steps)
}

function parseToolCalls(content: string): Array<{ tool: string; args: Record<string, unknown> }> {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
  const toolPattern = /```tool\s*\r?\n([\s\S]*?)```/gi
  let match
  while ((match = toolPattern.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1])
      if (parsed.tool) calls.push(parsed)
    } catch { /* skip malformed tool blocks */ }
  }
  return calls
}

function resultRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function wordPlanFromToolArgs(args: Record<string, unknown>): WordEditPlan | null {
  if (isWordEditPlan(args.plan)) return args.plan
  return isWordEditPlan(args) ? args : null
}

function wordPlanSummary(plan: WordEditPlan): string {
  const counts = new Map<string, number>()
  for (const step of plan.steps) {
    const category = step.operationId.includes('.') ? step.operationId.split('.')[0] : step.operationId
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return [...counts.entries()].map(([category, count]) => `${category}:${count}`).join(', ')
}

function compactDocumentActivities(activities: AgentUserDocumentActivity[]): AgentUserDocumentActivity[] {
  return activities
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-20)
    .map((activity) => ({
      ...activity,
      before: activity.before?.slice(0, 2_000),
      after: activity.after?.slice(0, 2_000),
      contextBefore: activity.contextBefore?.slice(-160),
      contextAfter: activity.contextAfter?.slice(0, 160),
      selectionText: activity.selectionText?.slice(0, 1_000),
    }))
}

function responseContentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content)
  return content.flatMap((block) => {
    if (!block || typeof block !== 'object') return []
    const candidate = block as { type?: unknown; text?: unknown }
    return candidate.type === 'text' && typeof candidate.text === 'string'
      ? [candidate.text]
      : []
  }).join('\n')
}

export function createAgentRunId(): string {
  return randomUUID()
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('AGENT_RUN_CANCELLED')
}

export async function runAgentChat(
  agent: AgentConfig,
  messages: ChatMessage[],
  onEdit: EditHandler,
  options: AgentRunOptions = {},
): Promise<AgentTaskResult> {
  const runId = options.runId ?? createAgentRunId()
  const modelLabel = agent.model.trim() || 'default'
  emitEvent(options.onEvent, runId, {
    type: 'agent-start',
    agentId: agent.id,
    agentName: agent.name,
    providerId: agent.providerId,
    model: modelLabel,
  })

  try {
    throwIfCancelled(options.signal)
    const conversationId = options.conversationId ?? runId
    const llm = await createLLMFromAgent(agent, conversationId)
    const messagesWithAttachments = await addStableAttachmentContextToMessages(
      conversationId,
      messages,
    )
    const lcMessages: BaseMessage[] = [
      new SystemMessage(AGENT_CACHE_PROTOCOL),
      new SystemMessage(agent.systemPrompt),
      ...(agent.documentOperationPrompt.trim()
        ? [new SystemMessage(`DOCUMENT DRAFT SPLITTING POLICY\n${agent.documentOperationPrompt}`)]
        : []),
      ...(options.delegateAgent ? [new SystemMessage(COLLABORATION_PROTOCOL)] : []),
      ...messagesWithAttachments.map((m) => {
        if (m.role === 'user') return new HumanMessage(m.content)
        if (m.role === 'assistant') return new AIMessage(m.content)
        return new SystemMessage(m.content)
      }),
    ]

    const executedTools: AgentTaskResult['toolCalls'] = []
    const requestUsages = []
    let content = ''
    let approvalRequiredForNextPlan = false
    let taskEndedByUser = false
    let documentDraftFailures = 0
    let finalizeAfterDocumentDraftFailure = false

    // Bound tool rounds so a malformed response cannot run tools forever.
    const maxToolRounds = 12
    for (let round = 0; round <= maxToolRounds; round += 1) {
      throwIfCancelled(options.signal)
      const response = await (llm as any).invoke(lcMessages, options.signal ? { signal: options.signal } : undefined)
      const cacheUsage = extractAgentCacheUsage(response)
      requestUsages.push(cacheUsage)
      content = responseContentToText(response.content)
      if (finalizeAfterDocumentDraftFailure) {
        content = content.replace(/```tool\s*\r?\n[\s\S]*?```/gi, '').trim()
          || t('agentOrchestrator.documentDraftNeedsClarification')
      }
      emitEvent(options.onEvent, runId, {
        type: 'agent-message',
        agentId: agent.id,
        agentName: agent.name,
        providerId: agent.providerId,
        model: modelLabel,
        content,
        cacheUsage,
      })

      if (finalizeAfterDocumentDraftFailure) break

      const toolCalls = parseToolCalls(content)
      if (toolCalls.length === 0) break
      if (round === maxToolRounds) break

      const toolResults: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> = []
      for (const call of toolCalls) {
        throwIfCancelled(options.signal)
        const isAvailable = DOCUMENT_TOOLS.some((tool) => tool === call.tool)
          || REFERENCE_TOOLS.some((tool) => tool === call.tool)
          || COLLABORATION_TOOLS.some((tool) => tool === call.tool)
        let result: unknown
        if (!isAvailable) {
          result = { error: t('agentOrchestrator.unknownTool', { tool: call.tool }) }
        } else if (
          approvalRequiredForNextPlan
          && ['insert_text', 'append_paragraph', 'replace_text'].includes(call.tool)
        ) {
          result = { success: false, error: 'REPLAN_MUST_USE_APPLY_WORD_PLAN' }
        } else if (call.tool === 'apply_word_plan' && approvalRequiredForNextPlan) {
          const plan = wordPlanFromToolArgs(call.args)
          if (!plan) {
            result = { success: false, error: 'WORD_PLAN_REQUIRED' }
          } else {
            const validation = await onEdit({
              action: 'validateWordPlan',
              plan,
              operationId: randomUUID(),
              runId,
              agentId: agent.id,
              agentName: agent.name,
              baseRevision: plan.documentRevision,
            })
            const validationRecord = resultRecord(validation)
            if (validationRecord?.success === false) {
              result = validation
            } else if (!options.requestApproval) {
              result = { success: false, error: 'WORD_REPLAN_APPROVAL_UNAVAILABLE' }
            } else {
              const validatedPlan: WordEditPlan = {
                ...plan,
                documentRevision: typeof validationRecord?.documentRevision === 'number'
                  ? validationRecord.documentRevision
                  : plan.documentRevision,
                documentApiRevision: typeof validationRecord?.documentApiRevision === 'string'
                  ? validationRecord.documentApiRevision
                  : plan.documentApiRevision,
              }
              const approval = await options.requestApproval({
                runId,
                planId: validatedPlan.planId,
                planVersion: validatedPlan.version ?? 1,
                documentRevision: validatedPlan.documentRevision,
                documentApiRevision: validatedPlan.documentApiRevision,
                agentId: agent.id,
                agentName: agent.name,
                remainingSteps: validatedPlan.steps.length,
                summary: wordPlanSummary(validatedPlan),
                changes: validatedPlan.steps.map((step) => ({
                  id: step.id,
                  operationId: step.operationId,
                  label: step.label,
                })),
              })
              if (approval === 'continue') {
                approvalRequiredForNextPlan = false
                result = await onEdit({
                  action: 'applyWordPlan',
                  plan: validatedPlan,
                  operationId: randomUUID(),
                  runId,
                  agentId: agent.id,
                  agentName: agent.name,
                  baseRevision: validatedPlan.documentRevision,
                })
              } else if (approval === 'end') {
                taskEndedByUser = true
                result = { success: false, ended: true, error: 'USER_ENDED_REMAINING_PLAN' }
              } else {
                result = { success: false, approvalStale: true, error: 'WORD_REPLAN_APPROVAL_STALE' }
              }
            }
          }
        } else {
          result = await executeTool(call.tool, call.args, onEdit, {
            runId,
            agent,
            onEvent: options.onEvent,
            delegateAgent: options.delegateAgent,
          })
        }
        const resultDetails = resultRecord(result)
        if (call.tool === 'create_document_draft' || call.tool === 'create_code_draft') {
          if (resultDetails?.success === false || typeof resultDetails?.error === 'string') {
            documentDraftFailures += 1
            if (documentDraftFailures >= 2) finalizeAfterDocumentDraftFailure = true
          } else {
            documentDraftFailures = 0
          }
        }
        if (resultDetails?.requiresReplan === true) {
          approvalRequiredForNextPlan = true
          emitEvent(options.onEvent, runId, {
            type: 'run-paused',
            agentId: agent.id,
            agentName: agent.name,
            action: 'user-edit-replan',
            phase: 'replanning',
            result,
          })
        }
        toolResults.push({
          tool: call.tool,
          args: call.args,
          result: sanitizeProviderPayload(result),
        })
        if (isAvailable) executedTools.push({ tool: call.tool, args: call.args, result })
        emitEvent(options.onEvent, runId, {
          type: 'agent-tool',
          agentId: agent.id,
          agentName: agent.name,
          providerId: agent.providerId,
          model: modelLabel,
          tool: call.tool,
          args: call.args,
          result,
        })
      }

      if (taskEndedByUser) {
        content = t('agentOrchestrator.userEndedRemainingPlan')
        break
      }

      // Keep the provider response object intact across document-tool rounds so
      // structured tool calls and any reasoning blocks retained by the adapter survive.
      lcMessages.push(response)
      const activities = compactDocumentActivities(options.getDocumentActivities?.() ?? [])
      const activityContext = activities.length > 0
        ? `\n\nDOCUMENT_ACTIVITY_CHECKPOINT\n${JSON.stringify(sanitizeProviderPayload(activities))}`
        : ''
      const replanInstruction = approvalRequiredForNextPlan
        ? '\n\nThe user changed the document. Inspect the latest document, discard every unexecuted old step, and create a new apply_word_plan containing only the remaining requested work. Preserve the user edit exactly. The new plan will require user approval before execution.'
        : ''
      const draftRepairInstruction = documentDraftFailures === 1
        ? '\n\nDOCUMENT_DRAFT_REPAIR_REQUIRED\nThe host rejected the draft schema, candidate, capability, anchor, dependency graph, or difference mapping. Inspect the structured error, repair the candidate and operation graph once, and resubmit the same draft tool one more time. Do not broaden anchors or bypass validation.'
        : finalizeAfterDocumentDraftFailure
          ? '\n\nDOCUMENT_DRAFT_REPAIR_EXHAUSTED\nThe one automatic repair attempt also failed. Do not call another document tool. Ask the user a focused question in the chat and explain the blocking validation issue.'
          : ''
      lcMessages.push(new HumanMessage(`${t('agentOrchestrator.toolResultFollowUp', {
        results: JSON.stringify(toolResults),
      })}${activityContext}${replanInstruction}${draftRepairInstruction}`))
    }

    const cacheUsage = aggregateAgentCacheUsage(requestUsages)
    const result: AgentTaskResult = {
      agentId: agent.id,
      agentName: agent.name,
      providerId: agent.providerId,
      model: modelLabel,
      response: content,
      toolCalls: executedTools,
      cacheUsage,
    }
    emitEvent(options.onEvent, runId, {
      type: 'agent-complete',
      agentId: agent.id,
      agentName: agent.name,
      providerId: agent.providerId,
      model: modelLabel,
      content,
      cacheUsage,
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'AGENT_RUN_CANCELLED') {
      emitEvent(options.onEvent, runId, {
        type: 'run-cancelled',
        agentId: agent.id,
        agentName: agent.name,
        providerId: agent.providerId,
        model: modelLabel,
      })
    } else {
      emitEvent(options.onEvent, runId, {
        type: 'error',
        agentId: agent.id,
        agentName: agent.name,
        providerId: agent.providerId,
        model: modelLabel,
        error: message,
      })
    }
    throw error
  }
}

export async function runMultiAgentTask(
  agents: AgentConfig[],
  task: string,
  createEditHandler: AgentEditHandlerFactory,
  options: AgentRunOptions = {},
): Promise<AgentTaskResult[]> {
  const runId = options.runId ?? createAgentRunId()
  const results: AgentTaskResult[] = []
  if (agents.length === 0) return results

  const agentWithoutModel = agents.find((agent) => !agent.model.trim())
  if (agentWithoutModel) throw new MissingAgentModelError(agentWithoutModel.id)

  emitEvent(options.onEvent, runId, {
    type: 'run-start',
    content: task,
  })
  emitEvent(options.onEvent, runId, {
    type: 'task-created',
    agentId: options.rootAgentId,
    content: task,
  })

  try {
    const executeAgent = options.executeAgent ?? runAgentChat
    const depth = options.collaborationDepth ?? 0
    const maxDepth = options.maxCollaborationDepth ?? 2
    const root = options.rootAgentId ? agents.find((agent) => agent.id === options.rootAgentId) : undefined
    const orderedAgents = root ? [root, ...agents.filter((agent) => agent.id !== root.id)] : agents
    const delegate = async (
      parent: AgentConfig,
      targetAgentId: string,
      question: string,
      nextDepth: number,
    ): Promise<AgentTaskResult | { error: string }> => {
      throwIfCancelled(options.signal)
      if (nextDepth > maxDepth) return { error: t('agentOrchestrator.delegationDepthExceeded') }
      const target = agents.find((candidate) => candidate.id === targetAgentId)
      if (!target || !target.enabled) return { error: t('agentOrchestrator.agentUnavailable') }
      if (!target.model.trim()) throw new MissingAgentModelError(target.id)
      emitEvent(options.onEvent, runId, {
        type: 'agent-spawned',
        agentId: target.id,
        agentName: target.name,
        fromAgentId: parent.id,
        fromAgentName: parent.name,
        toAgentId: target.id,
        toAgentName: target.name,
        content: question,
      })
      emitEvent(options.onEvent, runId, {
        type: 'task-assigned',
        agentId: target.id,
        agentName: target.name,
        fromAgentId: parent.id,
        fromAgentName: parent.name,
        toAgentId: target.id,
        toAgentName: target.name,
        content: question,
      })
      return executeAgent(target, [{ role: 'user', content: question }], createEditHandler(target), {
        runId,
        conversationId: `${runId}:${target.id}:delegated:${nextDepth}`,
        onEvent: options.onEvent,
        signal: options.signal,
        executeAgent: options.executeAgent,
        requestApproval: options.requestApproval,
        getDocumentActivities: options.getDocumentActivities,
        collaborationDepth: nextDepth,
        maxCollaborationDepth: maxDepth,
        delegateAgent: (nestedTargetId, nestedQuestion) =>
          delegate(target, nestedTargetId, nestedQuestion, nextDepth + 1),
      })
    }
    let sharedContext = ''
    for (let i = 0; i < orderedAgents.length; i += 1) {
      throwIfCancelled(options.signal)
      const agent = orderedAgents[i]
      emitEvent(options.onEvent, runId, {
        type: i === 0 ? 'task-assigned' : 'agent-spawned',
        agentId: agent.id,
        agentName: agent.name,
        content: i === 0 ? task : t('agentOrchestrator.continueTask'),
      })
      if (i > 0) {
        const previous = orderedAgents[i - 1]
        emitEvent(options.onEvent, runId, {
          type: 'handoff',
          fromAgentId: previous.id,
          fromAgentName: previous.name,
          toAgentId: agent.id,
          toAgentName: agent.name,
          content: sharedContext,
        })
        emitEvent(options.onEvent, runId, {
          type: 'agent-question',
          agentId: previous.id,
          agentName: previous.name,
          toAgentId: agent.id,
          toAgentName: agent.name,
          content: `${t('agentOrchestrator.continueTask')}\n\n${sharedContext}`,
        })
      }

      const prompt = i === 0
        ? t('agentOrchestrator.analyzeTask', { task })
        : `${t('agentOrchestrator.previousAgentContext', {
          agent: orderedAgents[i - 1].name,
          output: sharedContext,
        })}\n\n${t('agentOrchestrator.continueTask')}\n\n${task}`
      const result = await executeAgent(agent, [{ role: 'user', content: prompt }], createEditHandler(agent), {
        runId,
        conversationId: `${runId}:${agent.id}:work`,
        onEvent: options.onEvent,
        signal: options.signal,
        requestApproval: options.requestApproval,
        getDocumentActivities: options.getDocumentActivities,
        collaborationDepth: depth,
        maxCollaborationDepth: maxDepth,
        delegateAgent: (targetAgentId, question) => delegate(agent, targetAgentId, question, depth + 1),
      })
      results.push(result)
      if (i > 0) {
        const previous = orderedAgents[i - 1]
        emitEvent(options.onEvent, runId, {
          type: 'agent-answer',
          agentId: agent.id,
          agentName: agent.name,
          fromAgentId: agent.id,
          fromAgentName: agent.name,
          toAgentId: previous.id,
          toAgentName: previous.name,
          content: result.response,
        })
      }
      const contribution = `${agent.name} (${agent.providerId}/${result.model}):\n${result.response}`
      sharedContext = appendSharedContext(sharedContext, contribution)
    }

    if (orderedAgents.length > 1) {
      // Give the lead a final synthesis turn so the workflow is a conversation:
      // worker outputs are reviewed by another model before the run completes.
      const lastAgent = orderedAgents[orderedAgents.length - 1]
      emitEvent(options.onEvent, runId, {
        type: 'handoff',
        fromAgentId: lastAgent.id,
        fromAgentName: lastAgent.name,
        toAgentId: orderedAgents[0].id,
        toAgentName: orderedAgents[0].name,
        content: sharedContext,
      })
      const synthesis = await executeAgent(orderedAgents[0], [{
        role: 'user',
        content: `${t('agentOrchestrator.previousAgentContext', {
          agent: lastAgent.name,
          output: sharedContext,
        })}\n\n${task}\n\n`
          + t('agentOrchestrator.finalConsensus'),
      }], createEditHandler(orderedAgents[0]), {
        runId,
        conversationId: `${runId}:${orderedAgents[0].id}:synthesis`,
        onEvent: options.onEvent,
        signal: options.signal,
        requestApproval: options.requestApproval,
        getDocumentActivities: options.getDocumentActivities,
        collaborationDepth: depth,
        maxCollaborationDepth: maxDepth,
        delegateAgent: (targetAgentId, question) => delegate(orderedAgents[0], targetAgentId, question, depth + 1),
      })
      const rootIndex = results.findIndex((result) => result.agentId === orderedAgents[0].id)
      if (rootIndex >= 0) results[rootIndex] = synthesis
    }

    emitEvent(options.onEvent, runId, {
      type: 'run-complete',
      content: JSON.stringify(results.map((result) => ({ agentId: result.agentId, response: result.response }))),
    })
    return results
  } catch (error) {
    if (error instanceof Error && error.message === 'AGENT_RUN_CANCELLED') {
      emitEvent(options.onEvent, runId, { type: 'run-cancelled' })
    } else {
      emitEvent(options.onEvent, runId, {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
    throw error
  }
}
