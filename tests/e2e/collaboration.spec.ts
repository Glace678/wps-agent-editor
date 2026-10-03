import { expect, test, type Page } from '@playwright/test'
import type { AgentRunTaskRequest } from '../../src/types/generated/AgentRunTaskRequest'

interface ScriptedEvent {
  type: string
  timestamp: number
  agentId?: string
  agentName?: string
  operationId?: string
  content?: string
  toAgentId?: string
  toAgentName?: string
  error?: string
  cacheUsage?: {
    measured: boolean
    requests: number
    promptTokens: number
    cacheReadTokens: number
    cacheMissTokens: number
    cacheWriteTokens: number
    completionTokens: number
    totalTokens: number
    hitRate: number
  }
}

/**
 * Installs a desktop mock whose `agents_run_task` streams a scripted
 * collaboration event list back through the Tauri channel before resolving, so
 * the transcript, the delegation cards, and the cache readout are exercised in
 * a real render pass.
 */
async function installStreamingCollaborationMock(
  page: Page,
  events: ScriptedEvent[],
): Promise<void> {
  await page.addInitScript((scripted) => {
    let callbackId = 0
    let messageIndex = 0
    const channelCallbacks = new Map<number, (message: unknown) => void>()
    const agents = ['director', 'peer'].map((id) => ({
      id,
      name: id === 'director' ? 'Director' : 'Peer',
      role: 'Assistant',
      systemPrompt: '',
      providerId: 'ollama',
      model: 'test-model',
      reasoning: null,
      color: '#2563eb',
      enabled: true,
      description: null,
    }))
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        transformCallback(callback: (message: unknown) => void) {
          callbackId += 1
          channelCallbacks.set(callbackId, callback)
          return callbackId
        },
        unregisterCallback(id: number) {
          channelCallbacks.delete(id)
        },
        async invoke(command: string, args?: Record<string, unknown>) {
          switch (command) {
            case 'plugin:event|listen': return ++callbackId
            case 'plugin:event|unlisten': return null
            case 'files_get_home': return { path: '/mock/home', grantId: 'home-grant' }
            case 'files_list':
            case 'files_search':
            case 'files_get_recent':
            case 'documents_list_fonts':
            case 'app_take_startup_files':
            case 'agents_conversations_list': return []
            case 'files_session_load': return {
              mainDirectory: null, currentDirectory: null,
              recentDirectories: [], openFiles: [], activeFile: null,
            }
            case 'agents_list': return agents
            case 'providers_list': return [{
              id: 'ollama', name: 'Ollama', api: 'http://127.0.0.1:11434/v1',
              npm: '', env: [], protocol: 'openaiCompatible', models: [],
              isCustom: false, isLocal: true,
            }]
            case 'providers_auth_status': return {}
            case 'agents_conversations_import_codex': return {
              discovered: 0, imported: 0, updated: 0, skipped: 0,
              failed: 0, messages: 0, failures: [],
            }
            case 'agents_run_task': {
              const request = (args as { request?: Record<string, unknown> })?.request
              const channel = (args as { onEvent?: unknown })?.onEvent
              const channelId = typeof channel === 'object' && channel !== null
                ? Number((channel as { id?: unknown }).id)
                : Number(channel)
              const callback = channelCallbacks.get(channelId)
              for (const event of scripted as ScriptedEvent[]) {
                callback?.({ index: messageIndex++, message: { ...event, runId: request?.runId } })
              }
              return agents.map((agent) => ({
                agentId: agent.id,
                agentName: agent.name,
                providerId: agent.providerId,
                model: agent.model,
                response: `final answer from ${agent.id}`,
                toolCalls: [],
                cacheUsage: scripted.at(-1)?.cacheUsage ?? null,
              }))
            }
            default: return { success: true }
          }
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    })
  }, events)
}

function cacheUsage(cacheReadTokens: number, cacheMissTokens: number, promptTokens: number) {
  const read = cacheReadTokens
  const miss = cacheMissTokens
  return {
    measured: true,
    requests: 1,
    promptTokens,
    cacheReadTokens: read,
    cacheMissTokens: miss,
    cacheWriteTokens: 0,
    completionTokens: 32,
    totalTokens: promptTokens + 32,
    hitRate: read + miss > 0 ? read / (read + miss) : 0,
  }
}

test('renders the collaboration transcript and the aggregated cache readout', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await installStreamingCollaborationMock(page, [
    { type: 'run-start', timestamp: 1, content: 'Summarize the contract' },
    { type: 'task-created', timestamp: 2, agentId: 'director', agentName: 'Director' },
    { type: 'agent-start', timestamp: 3, agentId: 'director', agentName: 'Director' },
    {
      type: 'agent-stream',
      timestamp: 4,
      agentId: 'director',
      agentName: 'Director',
      operationId: 'stream-director-1',
      content: 'Planning the split ',
    },
    {
      type: 'agent-stream',
      timestamp: 5,
      agentId: 'director',
      agentName: 'Director',
      operationId: 'stream-director-1',
      content: 'of work.',
    },
    {
      type: 'agent-delegated',
      timestamp: 6,
      agentId: 'director',
      agentName: 'Director',
      toAgentId: 'peer',
      toAgentName: 'Peer',
      content: 'Draft the risks section',
    },
    { type: 'agent-message', timestamp: 7, agentId: 'director', agentName: 'Director', content: 'Planning the split of work.' },
    { type: 'handoff', timestamp: 8, agentId: 'peer', agentName: 'Peer', toAgentId: 'director', toAgentName: 'Director', content: 'Contribution delivered' },
    // A provider that reports a 94% prefix hit on the director turn and a
    // second turn that is fully cached: the aggregate must stay above 90%.
    { type: 'agent-complete', timestamp: 9, agentId: 'peer', agentName: 'Peer', cacheUsage: cacheUsage(4_600, 300, 4_900) },
    { type: 'run-complete', timestamp: 10 },
  ])

  await page.goto('/')
  await page.getByTestId('collaboration-open').click()
  await page.getByTestId('collaboration-task-input').fill('Summarize the contract')
  await page.getByTestId('collaboration-start').click()

  await expect(page.getByTestId('collaboration-chat')).toBeVisible()
  await expect(page.getByTestId('collaboration-task')).toHaveText('Summarize the contract')
  await expect(page.getByTestId('collaboration-speech').first()).toContainText('Planning the split of work.')
  await expect(page.getByTestId('collaboration-delegation')).toContainText('Draft the risks section')
  await expect(page.getByTestId('collaboration-delegation')).toContainText('Peer')

  const badge = page.getByTestId('collaboration-cache-rate')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveText('93.9%')
  expect(pageErrors).toEqual([])
})

test('hides the cache readout when no provider measured caching', async ({ page }) => {
  await installStreamingCollaborationMock(page, [
    { type: 'run-start', timestamp: 1, content: 'Hello' },
    { type: 'run-complete', timestamp: 2 },
  ])

  await page.goto('/')
  await page.getByTestId('collaboration-open').click()
  await page.getByTestId('collaboration-task-input').fill('Hello')
  await page.getByTestId('collaboration-start').click()

  await expect(page.getByTestId('collaboration-chat')).toBeVisible()
  await expect(page.getByTestId('collaboration-cache-rate')).toHaveCount(0)
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let callbackId = 0
    const requests: unknown[] = []
    const agents = ['director', 'peer'].map((id) => ({
      id,
      name: id,
      role: 'Assistant',
      systemPrompt: '',
      providerId: 'ollama',
      model: 'test-model',
      reasoning: null,
      color: '#2563eb',
      enabled: true,
      description: null,
    }))
    Object.assign(window, {
      __WAE_COLLABORATION_REQUESTS__: requests,
      __TAURI_INTERNALS__: {
        transformCallback: () => ++callbackId,
        unregisterCallback() {},
        async invoke(command: string, args?: Record<string, unknown>) {
          switch (command) {
            case 'plugin:event|listen': return ++callbackId
            case 'plugin:event|unlisten': return null
            case 'files_get_home': return { path: '/mock/home', grantId: 'home-grant' }
            case 'files_list':
            case 'files_search':
            case 'files_get_recent':
            case 'documents_list_fonts':
            case 'app_take_startup_files':
            case 'agents_conversations_list': return []
            case 'files_session_load': return {
              mainDirectory: null, currentDirectory: null,
              recentDirectories: [], openFiles: [], activeFile: null,
            }
            case 'agents_list': return agents
            case 'providers_list': return [{
              id: 'ollama', name: 'Ollama', api: 'http://127.0.0.1:11434/v1',
              npm: '', env: [], protocol: 'openaiCompatible', models: [],
              isCustom: false, isLocal: true,
            }]
            case 'providers_auth_status': return {}
            case 'agents_conversations_import_codex': return {
              discovered: 0, imported: 0, updated: 0, skipped: 0,
              failed: 0, messages: 0, failures: [],
            }
            case 'agents_run_task':
              requests.push(args?.request)
              return []
            default: return { success: true }
          }
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    })
  })
})

for (const mode of ['directed', 'parallel'] as const) {
  test(`sends the selected ${mode} mode from the collaboration dialog to Tauri`, async ({ page }) => {
    const pageErrors: Error[] = []
    page.on('pageerror', (error) => pageErrors.push(error))
    await page.goto('/')
    await page.getByTestId('collaboration-open').click()
    await expect(page.getByTestId('collaboration-agent-director')).toBeChecked()
    await expect(page.getByTestId('collaboration-agent-peer')).toBeChecked()
    await page.getByTestId('collaboration-task-input').fill('  Review this document  ')
    await page.getByTestId(`collaboration-mode-${mode}`).click()
    await expect(page.getByTestId(`collaboration-mode-${mode}`)).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('collaboration-start').click()

    await expect(page.getByTestId('collaboration-chat')).toBeVisible()
    const requests = await page.evaluate(() => (
      window as unknown as { __WAE_COLLABORATION_REQUESTS__: AgentRunTaskRequest[] }
    ).__WAE_COLLABORATION_REQUESTS__)
    expect(requests).toEqual([{
      agentIds: ['director', 'peer'],
      task: 'Review this document',
      rootAgentId: 'director',
      runId: expect.any(String),
      mode,
    }])
    expect(requests[0].runId).not.toBe('')
    await expect(page.getByTestId('collaboration-close')).toBeEnabled()
    await page.getByTestId('collaboration-close').click()
    await expect(page.getByTestId('collaboration-open')).toBeVisible()
    expect(pageErrors).toEqual([])
  })
}
