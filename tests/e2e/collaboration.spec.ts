import { expect, test, type Page } from '@playwright/test'
import type { AgentRunTaskRequest } from '../../src/types/generated/AgentRunTaskRequest'
import { selfValidateMockPayloads, validateMockResponses } from './support/mock-payloads'

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
  /** When true, the mock holds the event loop after dispatching this frame so
   *  the test can observe an intermediate render before releasing the next frame. */
  pauseAfter?: boolean
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
    // D1: un-whitelisted commands are recorded for the afterEach assertion.
    const unknownCommands: string[] = []
    // D2: record every mock response for runtime contract validation.
    const mockResponses: Array<{ command: string; result: unknown }> = []
    // C6: counted stream gate. pauseAfter frames queue individual waiters
    // instead of overwriting one global resolver — multiple concurrent holds
    // are representable, and the test can assert the outstanding hold count.
    const streamGate = {
      holds: 0,
      waiters: [] as Array<() => void>,
      acquire(): Promise<void> {
        this.holds += 1
        return new Promise<void>((resolve) => {
          this.waiters.push(resolve)
        })
      },
      releaseOne(): number {
        const resolve = this.waiters.shift()
        if (resolve) {
          this.holds -= 1
          resolve()
        }
        return this.holds
      },
      releaseAll(): number {
        const pending = this.waiters.splice(0)
        this.holds = 0
        for (const resolve of pending) resolve()
        return 0
      },
    }
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
        invoke: (() => {
          const handleInvoke = async (command: string, args?: Record<string, unknown>) => {
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
            case 'app_i18n_set_language':
            case 'app_theme_set':
            case 'app_startup_healthy':
            case 'documents_set_current_file':
              return { success: true }
            case 'app_take_recovery_notices':
              return []
            case 'files_session_save':
              return null
            case 'agents_run_task': {
              const request = (args as { request?: Record<string, unknown> })?.request
              const channel = (args as { onEvent?: unknown })?.onEvent
              const channelId = typeof channel === 'object' && channel !== null
                ? Number((channel as { id?: unknown }).id)
                : Number(channel)
              const callback = channelCallbacks.get(channelId)
              for (const event of scripted as ScriptedEvent[]) {
                const { pauseAfter, ...wire } = event
                callback?.({ index: messageIndex++, message: { ...wire, runId: request?.runId } })
                if (pauseAfter) {
                  // Hold the stream until the test releases this specific
                  // wait, so incremental render states are observable
                  // deterministically.
                  await streamGate.acquire()
                }
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
            default:
              unknownCommands.push(command)
              return { success: true }
          }
          }
          return async (command: string, args?: Record<string, unknown>) => {
            const result = await handleInvoke(command, args)
            mockResponses.push({ command, result })
            return result
          }
        })(),
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __WAE_UNKNOWN_COMMANDS__: unknownCommands,
      __WAE_MOCK_RESPONSES__: mockResponses,
      __WAE_STREAM_GATE__: {
        holdCount: () => streamGate.holds,
        releaseOne: () => streamGate.releaseOne(),
        releaseAll: () => streamGate.releaseAll(),
      },
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
      pauseAfter: true,
    },
    {
      type: 'agent-stream',
      timestamp: 5,
      agentId: 'director',
      agentName: 'Director',
      operationId: 'stream-director-1',
      content: 'of work.',
      pauseAfter: true,
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
    { type: 'handoff', timestamp: 7, agentId: 'peer', agentName: 'Peer', toAgentId: 'director', toAgentName: 'Director', content: 'Contribution delivered' },
    // Two measured turns with different cache hit ratios across agents: the
    // aggregate must be token-weighted, not a mean of the two per-turn rates.
    { type: 'agent-complete', timestamp: 8, agentId: 'director', agentName: 'Director', cacheUsage: cacheUsage(4_600, 300, 4_900) },
    { type: 'agent-complete', timestamp: 9, agentId: 'peer', agentName: 'Peer', cacheUsage: cacheUsage(5_400, 600, 6_000) },
    // An anomalous sample the provider did not actually measure: it must be
    // excluded from the summed readout entirely.
    {
      type: 'agent-complete',
      timestamp: 10,
      agentId: 'rogue',
      agentName: 'Rogue',
      cacheUsage: {
        measured: false, requests: 0, promptTokens: 999_999, cacheReadTokens: 999_999,
        cacheMissTokens: 0, cacheWriteTokens: 0, completionTokens: 0,
        totalTokens: 999_999, hitRate: 1,
      },
    },
    { type: 'run-complete', timestamp: 11 },
  ])

  await page.goto('/')
  await page.getByTestId('collaboration-open').click()
  await page.getByTestId('collaboration-task-input').fill('Summarize the contract')
  await page.getByTestId('collaboration-start').click()

  await expect(page.getByTestId('collaboration-chat')).toBeVisible()
  await expect(page.getByTestId('collaboration-task')).toHaveText('Summarize the contract')

  // page.evaluate structured-clones its return value, so functions on the
  // gate object would not survive; invoke the gate method inside the page.
  const gateCall = (method: 'holdCount' | 'releaseOne' | 'releaseAll') =>
    page.evaluate(
      (m) =>
        (
          window as unknown as {
            __WAE_STREAM_GATE__: Record<'holdCount' | 'releaseOne' | 'releaseAll', () => number>
          }
        ).__WAE_STREAM_GATE__[m](),
      method,
    )
  const releaseStream = () => gateCall('releaseOne')
  const speechBody = page.getByTestId('collaboration-speech').locator('p')

  // C6: frame 4 parks with exactly one outstanding hold.
  await expect.poll(() => gateCall('holdCount')).toBe(1)
  // Incremental update: the first delta renders alone while the stream is held.
  await expect(speechBody).toHaveText('Planning the split')

  // Releasing the second delta must concatenate onto the same bubble (by
  // operationId) rather than appending a second bubble or dropping the prefix.
  await releaseStream()
  await expect(speechBody).toHaveText('Planning the split of work.')

  // C6: frame 5 parked under a fresh wait — the old waiter was consumed and
  // the hold count is back to exactly one.
  await expect.poll(() => gateCall('holdCount')).toBe(1)
  // Release the remaining events (delegation, cache reports, run complete).
  await releaseStream()
  // C6: no waiters may remain once the stream ran to completion.
  await expect.poll(() => gateCall('holdCount')).toBe(0)

  // Exactly one speech bubble: the two stream frames merged, not rendered twice.
  await expect(page.getByTestId('collaboration-speech')).toHaveCount(1)
  await expect(page.getByTestId('collaboration-delegation')).toContainText('Draft the risks section')
  await expect(page.getByTestId('collaboration-delegation')).toContainText('Peer')

  const badge = page.getByTestId('collaboration-cache-rate')
  await expect(badge).toBeVisible()
  // Token-weighted aggregate: (4600+5400)/(4600+300+5400+600) = 10000/10900 = 91.7%.
  // A per-turn mean would give ~91.9%; including the unmeasured rogue sample
  // would skew far higher. This asserts the summed, measured-only weighting.
  await expect(badge).toHaveText('91.7%')
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

test('root-agent dropdown supports full keyboard navigation', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.goto('/')
  await page.getByTestId('collaboration-open').click()

  const trigger = page.getByTestId('collaboration-root-agent')
  const menu = page.getByTestId('collaboration-root-agent-menu')
  const search = page.getByTestId('collaboration-root-agent-search')
  const directorOption = page.getByTestId('collaboration-root-agent-option-director')
  const peerOption = page.getByTestId('collaboration-root-agent-option-peer')

  await expect(menu).toHaveCount(0)

  await trigger.press('ArrowDown')
  await expect(menu).toBeVisible()
  await expect(search).toBeFocused()

  // ArrowDown moves focus into the option list; Home/End jump to the edges.
  await search.press('ArrowDown')
  await expect(directorOption).toBeFocused()
  await directorOption.press('End')
  await expect(peerOption).toBeFocused()
  await peerOption.press('Home')
  await expect(directorOption).toBeFocused()

  // ArrowUp from the first option returns focus to the search box.
  await directorOption.press('ArrowUp')
  await expect(search).toBeFocused()

  // Escape closes and restores focus to the trigger.
  await search.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()

  // Outside click while open dismisses the popover.
  await trigger.press('ArrowDown')
  await expect(menu).toBeVisible()
  await page.locator('body').click({ position: { x: 10, y: 10 } })
  await expect(menu).toHaveCount(0)

  expect(pageErrors).toEqual([])
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let callbackId = 0
    const requests: unknown[] = []
    // D1: un-whitelisted commands are recorded for the afterEach assertion.
    const unknownCommands: string[] = []
    // D2: record every mock response for runtime contract validation.
    const mockResponses: Array<{ command: string; result: unknown }> = []
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
        invoke: (() => {
          const handleInvoke = async (command: string, args?: Record<string, unknown>) => {
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
            case 'app_i18n_set_language':
            case 'app_theme_set':
            case 'app_startup_healthy':
            case 'documents_set_current_file':
              return { success: true }
            case 'app_take_recovery_notices':
              return []
            case 'files_session_save':
              return null
            case 'agents_run_task':
              requests.push(args?.request)
              return []
            default:
              unknownCommands.push(command)
              return { success: true }
          }
          }
          return async (command: string, args?: Record<string, unknown>) => {
            const result = await handleInvoke(command, args)
            mockResponses.push({ command, result })
            return result
          }
        })(),
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __WAE_UNKNOWN_COMMANDS__: unknownCommands,
      __WAE_MOCK_RESPONSES__: mockResponses,
    })
  })
})

// D1: no test may leave the app calling commands the active mock never
// whitelisted. The streaming mock overwrites __WAE_UNKNOWN_COMMANDS__ with
// its own recorder when it replaces __TAURI_INTERNALS__.
// D2: mock responses are validated at runtime against the generated contract.
test.afterEach(async ({ page }) => {
  selfValidateMockPayloads()
  const [unknown, responses] = await page.evaluate(() => [
    (window as unknown as { __WAE_UNKNOWN_COMMANDS__?: string[] }).__WAE_UNKNOWN_COMMANDS__ ?? [],
    (window as unknown as {
      __WAE_MOCK_RESPONSES__?: Array<{ command: string; result: unknown }>
    }).__WAE_MOCK_RESPONSES__ ?? [],
  ])
  expect(unknown, `unmocked invoke commands: ${unknown.join(', ')}`).toEqual([])
  const contractErrors = validateMockResponses(responses)
  expect(contractErrors, `mock payload contract violations:\n${contractErrors.join('\n')}`).toEqual([])
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
