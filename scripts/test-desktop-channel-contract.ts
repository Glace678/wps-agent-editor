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
configureTauriBindings({
  channel: MockChannel,
  listen: async () => () => undefined,
  invoke: async <T>(command: string, args?: InvokeBody): Promise<T> => {
    const payload = args as Record<string, unknown> | undefined
    if (payload?.onEvent) channels.push(payload.onEvent as DesktopChannel<unknown>)
    if (command === 'process_terminal_exec') {
      return { started: true, cwd: '.', sessionId: `terminal-${channels.length}` } as T
    }
    if (command === 'process_debug_start') {
      return { ok: true, kind: 'node', sessionId: `debug-${channels.length}` } as T
    }
    if (command === 'agents_chat') {
      return { success: true, runId: `agent-${channels.length}` } as T
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
  await desktopApi.agents.chat('agent', [])
  await desktopApi.agents.chat('agent', [])
  await desktopApi.process.terminalExec('echo one')
  await desktopApi.process.terminalExec('echo two')
  await desktopApi.process.debugStart('C:\\workspace\\example.ts', [])
  await desktopApi.process.debugStart('C:\\workspace\\example.ts', [])

  assert.equal(channels.length, 6)
  assert.equal(new Set(channels).size, channels.length)
  assert.deepEqual(channels.map((channel) => channel.id), [1, 2, 3, 4, 5, 6])
  console.log('Desktop Channel lifecycle checks passed')
}

void main().finally(() => configureTauriBindings(undefined))
