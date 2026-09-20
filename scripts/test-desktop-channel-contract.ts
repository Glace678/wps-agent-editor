import assert from 'node:assert/strict'
import { base64ToBytes, encodeWae1 } from '../src/platform/binary'
import { desktopApi } from '../src/platform/desktop'
import { configureTauriBindings } from '../src/platform/transport'
import type { DesktopChannel, InvokeBody } from '../src/types/desktop-api'

let nextChannelId = 0
class MockChannel<T> implements DesktopChannel<T> {
  readonly id = ++nextChannelId
  onmessage: ((message: T) => void) | null

  constructor(handler?: (message: T) => void) {
    this.onmessage = handler ?? null
  }

  toJSON(): string {
    return `mock-channel:${this.id}`
  }
}

const channels: DesktopChannel<unknown>[] = []
const taskRequests: unknown[] = []
configureTauriBindings({
  channel: MockChannel,
  listen: async () => () => undefined,
  invoke: async <T>(command: string, args?: InvokeBody): Promise<T> => {
    const payload = args as Record<string, unknown> | undefined
    if (payload?.onEvent) channels.push(payload.onEvent as DesktopChannel<unknown>)
    if (command === 'process_terminal_start') {
      return { started: true, cwd: '.', sessionId: (payload?.request as { sessionId: string }).sessionId } as T
    }
    if (command === 'process_debug_start') {
      return { ok: true, kind: 'node', sessionId: `debug-${channels.length}` } as T
    }
    if (command === 'agents_chat') {
      return { success: true, runId: `agent-${channels.length}` } as T
    }
    if (command === 'agents_run_task') {
      taskRequests.push(payload?.request)
      return [] as T
    }
    if (command === 'documents_prepare_word') {
      return encodeWae1({
        convertedFromLegacy: false,
        converter: null,
        nativeConversionFailed: false,
        normalizedLegacyImageCount: 2,
        normalizedTableCount: 3,
        removedUnderlineRunCount: 4,
        normalizedWmfCount: 0,
      }, new Uint8Array([0x50, 0x4b])) as T
    }
    throw new Error(`Unexpected command: ${command}`)
  },
})

async function main(): Promise<void> {
  assert.deepEqual([...base64ToBytes('AQI=', 2)], [1, 2])
  assert.throws(() => base64ToBytes('AAAAA', 2), { code: 'file-too-large' })
  assert.throws(() => base64ToBytes('AQID', 2), { code: 'file-too-large' })

  desktopApi.files.registerGrant({ path: 'C:\\workspace\\example.ts', grantId: 'debug-grant' })
  desktopApi.files.registerGrant({ path: 'C:\\workspace\\example.docx', grantId: 'word-grant' })
  const preparedWord = await desktopApi.documents.prepareWord('C:\\workspace\\example.docx')
  assert.deepEqual([...preparedWord.data], [0x50, 0x4b])
  assert.equal(preparedWord.normalizedLegacyImageCount, 2)
  assert.equal(preparedWord.normalizedTableCount, 3)
  assert.equal(preparedWord.removedUnderlineRunCount, 4)
  const delivered: string[] = []
  await desktopApi.agents.chat({ agentId: 'agent', messages: [], conversationId: undefined, runId: 'agent-1', onEvent: (event) => delivered.push(event.runId) })
  await desktopApi.agents.chat({ agentId: 'agent', messages: [], conversationId: undefined, runId: 'agent-2', onEvent: (event) => delivered.push(event.runId) })
  await desktopApi.process.terminalStart('terminal-1', undefined, (event) => delivered.push(event.sessionId))
  await desktopApi.process.terminalStart('terminal-2', undefined, (event) => delivered.push(event.sessionId))
  await desktopApi.process.debugStart('debug-1', 'C:\\workspace\\example.ts', [], (event) => delivered.push(event.sessionId))
  await desktopApi.process.debugStart('debug-2', 'C:\\workspace\\example.ts', [], (event) => delivered.push(event.sessionId))

  const expectedTaskRequests = (['directed', 'parallel'] as const).map((mode) => ({
    agentIds: ['agent', 'peer'],
    task: `Run ${mode} collaboration`,
    runId: `collaboration-${mode}`,
    rootAgentId: 'agent',
    mode,
  }))
  for (const request of expectedTaskRequests) {
    const response = await desktopApi.agents.runTask({
      ...request,
      onEvent: (event) => delivered.push(event.runId),
    })
    assert.deepEqual(response, { runId: request.runId, result: [] })
  }
  assert.deepEqual(taskRequests, expectedTaskRequests, 'Both collaboration modes must reach the Rust request unchanged')

  assert.equal(channels.length, 8)
  assert.equal(new Set(channels).size, channels.length)
  assert.deepEqual(channels.map((channel) => channel.id), [1, 2, 3, 4, 5, 6, 7, 8])
  channels[0].onmessage?.({ runId: 'agent-2' })
  channels[0].onmessage?.({ runId: 'agent-1' })
  channels[2].onmessage?.({ sessionId: 'terminal-2' })
  channels[2].onmessage?.({ sessionId: 'terminal-1' })
  channels[4].onmessage?.({ sessionId: 'debug-2' })
  channels[4].onmessage?.({ sessionId: 'debug-1' })
  channels[6].onmessage?.({ runId: 'collaboration-parallel' })
  channels[6].onmessage?.({ runId: 'collaboration-directed' })
  channels[7].onmessage?.({ runId: 'collaboration-directed' })
  channels[7].onmessage?.({ runId: 'collaboration-parallel' })
  assert.deepEqual(delivered, ['agent-1', 'terminal-1', 'debug-1', 'collaboration-directed', 'collaboration-parallel'])
  console.log('Desktop Channel lifecycle checks passed')
}

void main().finally(() => configureTauriBindings(undefined))
