import assert from 'node:assert/strict'
import { documentBridge, type CodeEditorAdapter } from '../src/lightweight-office/agent/document-bridge'
import type { DocumentEvent } from '../src/types/document'

async function verifyVisibleWordOperations(): Promise<void> {
  const insertedContent: string[] = []
  const appendedContent: Array<{ position: number; html: string }> = []
  const replacements: Array<{ text: string; from: number; to: number }> = []
  let dispatchCount = 0

  const transaction = {
    insertText(text: string, from: number, to: number) {
      replacements.push({ text, from, to })
      return transaction
    },
  }
  const activeEditor = {
    state: {
      doc: {
        content: { size: 12 },
        descendants(visitor: (node: { isText: boolean; text: string }, position: number) => void) {
          visitor({ isText: true, text: 'Hello world' }, 1)
        },
      },
      tr: transaction,
    },
    view: {
      dispatch(value: unknown) {
        assert.equal(value, transaction)
        dispatchCount += 1
      },
    },
    commands: {
      insertContent(text: string) {
        insertedContent.push(text)
      },
      insertContentAt(position: number, html: string) {
        appendedContent.push({ position, html })
      },
    },
  }

  const events: DocumentEvent[] = []
  const unsubscribe = documentBridge.subscribeDocumentEvents((event) => events.push(event))
  documentBridge.setWord({ activeEditor } as never, 'visible-word.docx')

  const insertResult = await documentBridge.execute({
    action: 'insertText',
    text: 'Visible insert',
    runId: 'word-run',
    operationId: 'word-insert',
    agentId: 'root-agent',
    agentName: 'Root Agent',
    baseRevision: 0,
  })
  assert.equal((insertResult as { success: boolean }).success, true)
  assert.deepEqual(insertedContent, ['Visible insert'])
  assert.ok(events.some((event) => event.type === 'operation-prepared' && event.operationId === 'word-insert'))
  assert.ok(events.some((event) => event.type === 'operation-applied' && event.operationId === 'word-insert'))

  await new Promise((resolve) => setTimeout(resolve, 275))
  documentBridge.markUserEdit()
  const conflictResult = await documentBridge.execute({
    action: 'appendParagraph',
    text: 'Must not overwrite the user edit',
    runId: 'word-run',
    operationId: 'word-conflict',
    agentId: 'root-agent',
  })
  assert.equal((conflictResult as { success: boolean }).success, false)
  assert.equal(appendedContent.length, 0)
  assert.ok(events.some((event) => event.type === 'conflict' && event.operationId === 'word-conflict'))

  const replaceRevision = documentBridge.getState().revision
  const replaceResult = await documentBridge.execute({
    action: 'replaceText',
    search: 'Hello',
    replace: 'Hi',
    runId: 'word-replace-run',
    operationId: 'word-replace',
    baseRevision: replaceRevision,
  })
  assert.equal((replaceResult as { success: boolean }).success, true)
  assert.deepEqual(replacements, [{ text: 'Hi', from: 1, to: 6 }])
  assert.equal(dispatchCount, 1)

  documentBridge.cancelRun('cancelled-word-run')
  await assert.rejects(
    documentBridge.execute({
      action: 'insertText',
      text: 'Cancelled text',
      runId: 'cancelled-word-run',
      operationId: 'cancelled-word-operation',
    }),
    /AGENT_RUN_CANCELLED/,
  )
  assert.deepEqual(insertedContent, ['Visible insert'])

  unsubscribe()
  documentBridge.clear()
}

async function verifyVisibleCodeRangeOperation(): Promise<void> {
  let value = 'const value = 1'
  let cursor: { lineNumber: number; column: number } | null = null
  let revealed: { lineNumber: number; column: number } | null = null
  const edits: Parameters<CodeEditorAdapter['executeEdits']>[1] = []

  const adapter: CodeEditorAdapter = {
    getValue: () => value,
    getPosition: () => ({ lineNumber: 1, column: 1 }),
    getLineCount: () => 1,
    getLineMaxColumn: () => value.length + 1,
    executeEdits: (_source, nextEdits) => {
      edits.push(...nextEdits)
      const edit = nextEdits[0]
      const start = edit.range.startColumn - 1
      const end = edit.range.endColumn - 1
      value = value.slice(0, start) + edit.text + value.slice(end)
    },
    setPosition: (position) => { cursor = position },
    revealPositionInCenter: (position) => { revealed = position },
  }

  const events: DocumentEvent[] = []
  const unsubscribe = documentBridge.subscribeDocumentEvents((event) => events.push(event))
  documentBridge.setPlainText(value, 'visible-code.ts', 'system')
  documentBridge.setCodeEditor(adapter, 'visible-code.ts')

  const result = await documentBridge.execute({
    action: 'replaceCodeRange',
    replace: 'answer',
    line: 1,
    column: 7,
    endLine: 1,
    endColumn: 12,
    runId: 'code-run',
    operationId: 'code-range',
    agentId: 'worker-agent',
    agentName: 'Worker Agent',
    baseRevision: 0,
  })

  assert.equal((result as { success: boolean }).success, true)
  assert.equal(value, 'const answer = 1')
  assert.deepEqual(cursor, { lineNumber: 1, column: 7 })
  assert.deepEqual(revealed, { lineNumber: 1, column: 7 })
  assert.equal(edits.length, 1)
  assert.ok(events.some((event) => event.type === 'cursor-moved' && event.operationId === 'code-range'))
  assert.ok(events.some((event) => event.type === 'operation-applied' && event.operationId === 'code-range'))

  unsubscribe()
  documentBridge.clear()
}

async function main(): Promise<void> {
  await verifyVisibleWordOperations()
  await verifyVisibleCodeRangeOperation()
  console.log('PASS visible Word and code Agent document operations')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
