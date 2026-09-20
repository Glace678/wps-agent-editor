import { expect, test } from '@playwright/test'
import type { AgentRunTaskRequest } from '../../src/types/generated/AgentRunTaskRequest'

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
