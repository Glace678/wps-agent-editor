import assert from 'node:assert/strict'
import {
  runMultiAgentTask,
  type AgentRunOptions,
  type ChatMessage,
} from '../electron/services/agent-orchestrator'
import { MissingAgentModelError } from '../electron/services/llm-client.service'
import type { AgentConfig, AgentTaskResult } from '../src/types/agent'

const PROVIDER_ID = 'opencode-go'
const DEEPSEEK_MODEL = 'deepseek-v4-flash'
const MIMO_MODEL = 'mimo-v2.5'

const agents: AgentConfig[] = [
  {
    id: 'opencode-go-deepseek-lead',
    name: 'DeepSeek V4 Flash Lead',
    role: 'Plan the work and produce the final consensus',
    systemPrompt: 'Plan the work and reconcile the final answer.',
    providerId: PROVIDER_ID,
    model: DEEPSEEK_MODEL,
    color: '#2563eb',
    enabled: true,
  },
  {
    id: 'opencode-go-mimo-reviewer',
    name: 'MiMo V2.5 Reviewer',
    role: 'Review the lead model output',
    systemPrompt: 'Review the work and identify any corrections.',
    providerId: PROVIDER_ID,
    model: MIMO_MODEL,
    color: '#059669',
    enabled: true,
  },
]

const calls: Array<{ agentId: string; providerId: string; model: string; prompt: string }> = []
const editOwners: string[] = []
const events: string[] = []

const options: AgentRunOptions = {
  runId: 'opencode-go-two-model-collaboration',
  onEvent: (event) => events.push(event.type),
  executeAgent: async (agent, messages: ChatMessage[], onEdit) => {
    calls.push({
      agentId: agent.id,
      providerId: agent.providerId,
      model: agent.model,
      prompt: messages[0].content,
    })
    await onEdit({ action: 'readDocument' })
    const response = `${agent.name} response for ${agent.providerId}/${agent.model}`
    return {
      agentId: agent.id,
      agentName: agent.name,
      providerId: agent.providerId,
      model: agent.model,
      response,
      toolCalls: [],
    } satisfies AgentTaskResult
  },
}

async function verifySameProviderDifferentModels(): Promise<void> {
  const results = await runMultiAgentTask(
    agents,
    'Prepare and review one concise answer.',
    (agent) => async () => {
      editOwners.push(agent.id)
      return { success: true }
    },
    options,
  )

  assert.deepEqual(
    calls.map(({ agentId }) => agentId),
    ['opencode-go-deepseek-lead', 'opencode-go-mimo-reviewer', 'opencode-go-deepseek-lead'],
    'DeepSeek leads, MiMo reviews, and DeepSeek performs the final synthesis',
  )
  assert.deepEqual(
    new Set(calls.map(({ providerId }) => providerId)),
    new Set([PROVIDER_ID]),
    'every collaboration request stays on OpenCode Go',
  )
  assert.deepEqual(
    new Set(calls.map(({ model }) => model)),
    new Set([DEEPSEEK_MODEL, MIMO_MODEL]),
    'no model outside DeepSeek V4 Flash and MiMo V2.5 is used',
  )
  assert.match(calls[1].prompt, /opencode-go\/deepseek-v4-flash/)
  assert.match(calls[2].prompt, /opencode-go\/mimo-v2\.5/)
  assert.deepEqual(
    editOwners,
    ['opencode-go-deepseek-lead', 'opencode-go-mimo-reviewer', 'opencode-go-deepseek-lead'],
    'document tools execute with the identity of the model that issued them',
  )
  assert.equal(results.length, 2, 'the result set keeps one final result per selected Agent')
  assert.equal(results[0].model, DEEPSEEK_MODEL)
  assert.equal(results[1].model, MIMO_MODEL)
  assert.equal(events.filter((type) => type === 'handoff').length, 2)
  assert.equal(events[0], 'run-start')
  assert.equal(events.at(-1), 'run-complete')
}

async function verifyMissingModelCannotFallBack(): Promise<void> {
  let executionCount = 0
  const missingModelAgents = agents.map((agent, index) => (
    index === 1 ? { ...agent, model: '   ' } : agent
  ))

  await assert.rejects(
    runMultiAgentTask(
      missingModelAgents,
      'This task must not start.',
      () => async () => ({ success: true }),
      {
        executeAgent: async () => {
          executionCount += 1
          throw new Error('executeAgent must not run when any model is missing')
        },
      },
    ),
    (error: unknown) => error instanceof MissingAgentModelError
      && error.agentId === 'opencode-go-mimo-reviewer',
  )
  assert.equal(executionCount, 0, 'model validation finishes before the first provider request')
}

async function verifyRuntimeDelegation(): Promise<void> {
  const delegatedCalls: string[] = []
  const delegationEvents: string[] = []
  const result = await runMultiAgentTask(
    agents,
    'Let the root Agent ask the reviewer one focused question.',
    () => async () => ({ success: true }),
    {
      runId: 'runtime-delegation-test',
      onEvent: (event) => delegationEvents.push(event.type),
      executeAgent: async (agent, messages, _onEdit, runOptions) => {
        if (agent.id === agents[0].id && runOptions.delegateAgent) {
          const delegated = await runOptions.delegateAgent(
            agents[1].id,
            'Check whether the task wording is internally consistent.',
          )
          delegatedCalls.push(
            'response' in delegated ? delegated.agentId : delegated.error,
          )
        }
        return {
          agentId: agent.id,
          agentName: agent.name,
          providerId: agent.providerId,
          model: agent.model,
          response: `${agent.name} delegated-test response`,
          toolCalls: [],
        } as AgentTaskResult
      },
    },
  )
  assert.deepEqual(delegatedCalls, [agents[1].id, agents[1].id], 'a running Agent can delegate bounded questions to another Agent')
  assert.ok(delegationEvents.includes('task-assigned'), 'runtime delegation emits a task assignment event')
  assert.ok(delegationEvents.includes('agent-question'), 'runtime delegation emits a question event')
  assert.ok(delegationEvents.includes('agent-answer'), 'runtime delegation emits an answer event')
  assert.equal(result.length, 2, 'runtime delegation does not add an extra top-level result')
}

async function verifyCancellationStopsNextAgent(): Promise<void> {
  const controller = new AbortController()
  const executedAgents: string[] = []
  const cancellationEvents: string[] = []

  await assert.rejects(
    runMultiAgentTask(
      agents,
      'Stop before the second Agent starts.',
      () => async () => ({ success: true }),
      {
        runId: 'collaboration-cancellation-test',
        signal: controller.signal,
        onEvent: (event) => cancellationEvents.push(event.type),
        executeAgent: async (agent) => {
          executedAgents.push(agent.id)
          controller.abort()
          return {
            agentId: agent.id,
            agentName: agent.name,
            providerId: agent.providerId,
            model: agent.model,
            response: 'First Agent completed before cancellation was observed.',
            toolCalls: [],
          } as AgentTaskResult
        },
      },
    ),
    /AGENT_RUN_CANCELLED/,
  )

  assert.deepEqual(executedAgents, [agents[0].id], 'cancellation prevents the next Agent from starting')
  assert.ok(cancellationEvents.includes('run-cancelled'), 'cancellation is visible in the collaboration event stream')
  assert.ok(!cancellationEvents.includes('run-complete'), 'a cancelled run is never reported as complete')
}

async function main(): Promise<void> {
  await verifySameProviderDifferentModels()
  await verifyMissingModelCannotFallBack()
  await verifyRuntimeDelegation()
  await verifyCancellationStopsNextAgent()
  console.log('PASS OpenCode Go collaboration uses only DeepSeek V4 Flash and MiMo V2.5')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
