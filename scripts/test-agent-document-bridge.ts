import assert from 'node:assert/strict'
import {
  documentBridge,
  setBuiltInArtifactDraftFactoryForTesting,
  type BuiltInArtifactDraftRequest,
  type CodeEditorAdapter,
} from '../src/lightweight-office/agent/document-bridge'
import type { DocumentEvent } from '../src/types/document'
import type { Sheet } from '@fortune-sheet/core'

async function verifyVisibleWordOperations(): Promise<void> {
  const insertedContent: string[] = []
  const appendedContent: Array<{ position: number; html: string }> = []
  const replacements: Array<{ text: string; from: number; to: number }> = []

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
      dispatch() { throw new Error('live Word dispatch must not run') },
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
  assert.equal((insertResult as { success: boolean }).success, false)
  assert.deepEqual(insertedContent, [])
  assert.ok(events.some((event) => event.type === 'operation-prepared' && event.operationId === 'word-insert'))
  assert.ok(events.some((event) => event.type === 'operation-rejected' && event.operationId === 'word-insert'))
  assert.equal(appendedContent.length, 0)
  assert.deepEqual(replacements, [])

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
  assert.deepEqual(insertedContent, [])

  unsubscribe()
  documentBridge.clear()
}

async function verifyStableWordDocumentApiPlayback(): Promise<void> {
  let apiRevision = 7
  const invokes: Array<{ operationId: string; input: unknown; options?: Record<string, unknown> }> = []
  const target = {
    kind: 'selection',
    start: { kind: 'text', blockId: 'paragraph-1', offset: 5 },
    end: { kind: 'text', blockId: 'paragraph-1', offset: 10 },
  }
  const doc = {
    info: () => ({ revision: String(apiRevision), outline: [], counts: {}, capabilities: {} }),
    capabilities: () => ({
      operations: {
        replace: { available: true, tracked: true, dryRun: true },
        'sections.setPageMargins': { available: true, tracked: false, dryRun: true },
      },
      planEngine: {},
      global: {},
      format: {},
    }),
    query: {
      match: () => ({
        items: [{
          id: 'match-1',
          matchKind: 'text',
          handle: { ref: 'ref-1' },
          target,
          snippet: 'Hello world',
          highlightRange: { start: 6, end: 11 },
          blocks: [{ blockId: 'paragraph-1', text: 'world', ref: 'block-ref', range: { start: 5, end: 10 }, runs: [] }],
          address: { kind: 'block', nodeType: 'paragraph', nodeId: 'paragraph-1' },
        }],
        meta: { effectiveResolved: true },
        total: 1,
      }),
    },
    sections: {
      get: () => ({
        address: { kind: 'section', sectionId: 'section-1' },
        index: 0,
        range: { startParagraphIndex: 0, endParagraphIndex: 1 },
        pageSetup: { width: 8.5, height: 11 },
        margins: { top: 1, right: 1, bottom: 1, left: 1, gutter: 0 },
      }),
    },
    invoke: async ({ operationId, input, options }: any) => {
      invokes.push({ operationId, input, options })
      if (!options?.dryRun) apiRevision += 1
      return { success: true, resolution: { range: { from: 6, to: 11 }, text: 'world', target } }
    },
  }

  const events: DocumentEvent[] = []
  const draftRequests: BuiltInArtifactDraftRequest[] = []
  setBuiltInArtifactDraftFactoryForTesting(async (request) => {
    draftRequests.push(request)
    return { success: true, changed: false, revisionHandled: true, draft: true, draftId: 'word-draft' }
  })
  const unsubscribe = documentBridge.subscribeDocumentEvents((event) => events.push(event))
  documentBridge.setWord({ activeEditor: { doc } } as never, 'stable-document-api.docx')
  const pending = documentBridge.execute({
    action: 'replaceText',
    search: 'world',
    replace: 'reader',
    all: false,
    operationId: 'stable-replace',
    runId: 'stable-run',
    agentName: 'Writer',
    baseRevision: 0,
  })
  const result = await pending as any

  assert.equal(result.success, true)
  assert.equal(result.replaced, 1)
  assert.equal(invokes.filter((call) => call.options?.dryRun).length, 1)
  assert.equal(invokes.filter((call) => !call.options?.dryRun).length, 0)
  assert.ok(invokes.every((call) => call.operationId === 'replace'))
  assert.equal(draftRequests.length, 1)
  assert.equal(draftRequests[0].operations[0].visual, 'replacement')
  assert.equal(draftRequests[0].operations[0].location.kind, 'word')
  assert.ok(events.some((event) => event.type === 'operation-applied' && event.operationId === 'stable-replace'))
  assert.equal(documentBridge.getState().revision, 0)

  const activity = {
    eventId: 'same-user-burst',
    timestamp: Date.now(),
    documentRevision: 0,
    kind: 'edit' as const,
    before: 'a',
    after: 'b',
  }
  documentBridge.reportUserActivity(activity)
  documentBridge.reportUserActivity({ ...activity, after: 'bc' })
  assert.equal(documentBridge.getState().revision, 1, 'one typing burst increments the revision once')

  const invalidMargins = await documentBridge.execute({
    action: 'applyWordPlan',
    plan: {
      planId: 'invalid-section-geometry',
      documentRevision: 1,
      documentApiRevision: String(apiRevision),
      steps: [{
        id: 'invalid-margins',
        operationId: 'sections.setPageMargins',
        input: {
          target: { kind: 'section', sectionId: 'section-1' },
          left: 5,
          right: 5,
        },
        visual: 'page-region',
      }],
    },
    operationId: 'invalid-section-geometry',
    runId: 'invalid-section-run',
    baseRevision: 1,
  }) as any
  assert.equal(invalidMargins.success, false)
  assert.match(invalidMargins.error, /HORIZONTAL_MARGINS_EXCEED_PAGE/)

  unsubscribe()
  setBuiltInArtifactDraftFactoryForTesting(null)
  documentBridge.clear()
}

async function verifyGlobalReplaceExpandsInDocumentOrder(): Promise<void> {
  let content = 'TODO alpha TODO beta'
  let apiRevision = 3
  const blockId = 'paragraph-global'
  const matches = () => {
    const items: any[] = []
    let offset = 0
    while (offset < content.length) {
      const start = content.indexOf('TODO', offset)
      if (start < 0) break
      const end = start + 4
      const target = {
        kind: 'selection',
        start: { kind: 'text', blockId, offset: start },
        end: { kind: 'text', blockId, offset: end },
      }
      items.push({
        id: `match-${start}`,
        matchKind: 'text',
        handle: { ref: `ref-${start}` },
        target,
        snippet: content,
        highlightRange: { start, end },
        blocks: [{ blockId, text: 'TODO', ref: `block-${start}`, range: { start, end }, runs: [] }],
        address: { kind: 'block', nodeType: 'paragraph', nodeId: blockId },
      })
      offset = end
    }
    return { items, meta: { effectiveResolved: true }, total: items.length }
  }
  const doc = {
    info: () => ({ revision: String(apiRevision), outline: [], counts: {}, capabilities: {} }),
    capabilities: () => ({
      operations: { replace: { available: true, tracked: true, dryRun: true } },
      planEngine: {},
      global: {},
      format: {},
    }),
    query: { match: matches },
    invoke: async ({ input, options }: any) => {
      const from = input.target.start.offset
      const to = input.target.end.offset
      if (!options?.dryRun) {
        assert.equal(options.expectedRevision, String(apiRevision))
        content = content.slice(0, from) + input.text + content.slice(to)
        apiRevision += 1
      }
      return { success: true, resolution: { range: { from, to }, text: content.slice(from, to), target: input.target } }
    },
  }

  const draftRequests: BuiltInArtifactDraftRequest[] = []
  setBuiltInArtifactDraftFactoryForTesting(async (request) => {
    draftRequests.push(request)
    return { success: true, changed: false, revisionHandled: true, draft: true, draftId: 'global-draft' }
  })
  documentBridge.setWord({ activeEditor: { doc } } as never, 'global-replace.docx')
  const pending = documentBridge.execute({
    action: 'replaceText',
    search: 'TODO',
    replace: 'DONE',
    all: true,
    operationId: 'global-replace',
    runId: 'global-run',
    baseRevision: 0,
  })
  const result = await pending as any
  assert.equal(result.success, true)
  assert.equal(result.replaced, 2)
  assert.equal(content, 'TODO alpha TODO beta')
  assert.equal(draftRequests[0].operations.length, 2)
  assert.equal(draftRequests[0].operations[1].location.kind, 'word')
  setBuiltInArtifactDraftFactoryForTesting(null)
  documentBridge.clear()
}

async function verifyVisibleCodeRangeOperation(): Promise<void> {
  let value = 'const value = 1'
  let cursor: { lineNumber: number; column: number } | null = null
  let revealed: { lineNumber: number; column: number } | null = null
  const edits: Parameters<CodeEditorAdapter['executeEdits']>[1] = []
  const draftRequests: BuiltInArtifactDraftRequest[] = []
  setBuiltInArtifactDraftFactoryForTesting(async (request) => {
    draftRequests.push(request)
    return { success: true, changed: false, revisionHandled: true, draft: true, draftId: 'code-draft' }
  })

  const adapter: CodeEditorAdapter = {
    getValue: () => value,
    getPosition: () => ({ lineNumber: 1, column: 1 }),
    getLineCount: () => 1,
    getLineMaxColumn: () => value.length + 1,
    getOffsetAt: (position) => position.column - 1,
    getPositionAt: (offset) => ({ lineNumber: 1, column: offset + 1 }),
    getTextMetadata: () => ({
      encoding: 'utf-8', hasBom: false, eol: 'lf', languageId: 'typescript', dirty: true,
    }),
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
  assert.equal(value, 'const value = 1', 'Agent code command must not mutate the Monaco model')
  assert.equal(cursor, null)
  assert.equal(revealed, null)
  assert.equal(edits.length, 0)
  assert.equal(draftRequests.length, 1)
  assert.equal(draftRequests[0].kind, 'code')
  assert.equal(draftRequests[0].operations[0].location.kind, 'code')
  assert.equal(draftRequests[0].operations[0].visual, 'replacement')
  assert.equal(draftRequests[0].recipes[0].recipe.kind, 'code-edit')
  assert.ok(events.some((event) => event.type === 'operation-applied' && event.operationId === 'code-range'))

  unsubscribe()
  setBuiltInArtifactDraftFactoryForTesting(null)
  documentBridge.clear()
}

async function verifyExcelRangeAndFormulaOperations(): Promise<void> {
  const sheets: Sheet[] = [
    {
      id: 'sheet-1',
      name: 'Sheet1',
      status: 1,
      celldata: [
        { r: 0, c: 0, v: { v: 10, m: '10' } },
        { r: 0, c: 1, v: { v: 15, m: '15', f: 'SUM(A1,5)' } },
      ],
    },
    {
      id: 'sheet-2',
      name: 'Other Sheet',
      status: 0,
      celldata: [{ r: 2, c: 2, v: { v: 'other', m: 'other' } }],
    },
  ]
  let activeSheetId = 'sheet-1'
  const apiCalls: Array<{ name: string; args: any[] }> = []
  const scrollCalls: unknown[] = []
  const workbook = {
    getAllSheets: () => sheets,
    getSheet: (options?: { id?: string }) => (
      sheets.find((sheet) => sheet.id === (options?.id ?? activeSheetId))!
    ),
    getSelection: () => [{ row: [0, 1], column: [0, 1] }],
    batchCallApis: (calls: Array<{ name: string; args: any[] }>) => {
      apiCalls.push(...calls)
      for (const call of calls) {
        if (call.name === 'activateSheet') activeSheetId = call.args[0].id
        if (call.name === 'setCellValue') {
          const [row, column, formula] = call.args
          const sheet = sheets.find((candidate) => candidate.id === activeSheetId)!
          sheet.celldata = [
            ...(sheet.celldata ?? []).filter((cell) => cell.r !== row || cell.c !== column),
            { r: row, c: column, v: { f: String(formula).slice(1), v: 6, m: '6' } },
          ]
        }
      }
    },
    scroll: (options: unknown) => scrollCalls.push(options),
  }

  const draftRequests: BuiltInArtifactDraftRequest[] = []
  setBuiltInArtifactDraftFactoryForTesting(async (request) => {
    draftRequests.push(request)
    return { success: true, changed: false, revisionHandled: true, draft: true, draftId: 'excel-draft' }
  })
  documentBridge.setExcel(workbook as never, 'visible-excel.xlsx')
  const summary = await documentBridge.execute({ action: 'readDocument', operationId: 'excel-summary' }) as any
  assert.equal(summary.success, true)
  assert.equal(summary.kind, 'excel')
  assert.equal(summary.workbook.activeSheet, 'Sheet1')
  assert.equal(summary.workbook.sheets[0].usedRange, 'A1:B1')
  assert.deepEqual(summary.workbook.selection, ['A1:B2'])

  const range = await documentBridge.execute({
    action: 'readExcelRange',
    sheet: 'sheet1',
    range: 'A1:B1',
    operationId: 'excel-read',
  }) as any
  assert.equal(range.success, true)
  assert.equal(range.sheet, 'Sheet1')
  assert.deepEqual(range.cells, [
    { address: 'A1', value: 10, display: '10' },
    { address: 'B1', value: 15, display: '15', formula: '=SUM(A1,5)' },
  ])
  assert.equal(documentBridge.getState().revision, 0, 'reads must not change the revision')

  const oversizedRead = await documentBridge.execute({
    action: 'readExcelRange',
    range: 'A1:Z20',
    operationId: 'excel-read-too-large',
  }) as any
  assert.equal(oversizedRead.success, false)
  assert.equal(oversizedRead.error, 'EXCEL_RANGE_READ_LIMIT')

  const unsupported = await documentBridge.execute({
    action: 'setExcelFormula',
    sheet: 'Sheet1',
    target: 'D2',
    formula: '=XLOOKUP(A1,A:A,B:B)',
    operationId: 'excel-unsupported',
  }) as any
  assert.equal(unsupported.success, false)
  assert.deepEqual(unsupported.unsupportedFunctions, ['XLOOKUP'])
  assert.equal(apiCalls.length, 0, 'allowlist rejection must happen before mutation')

  const write = await documentBridge.execute({
    action: 'setExcelFormula',
    sheet: 'Sheet1',
    target: 'D2:F4',
    formula: '=SUM($A$1,B2,$C2,D$1)',
    operationId: 'excel-write',
  }) as any
  assert.equal(write.success, true)
  assert.equal(write.target, 'D2:F4')
  assert.equal(write.changedCells, 9)
  assert.deepEqual(write.functions, ['SUM'])
  assert.equal(write.draft, true)
  assert.equal(draftRequests.length, 1)
  assert.equal(draftRequests[0].operations[0].location.kind, 'excel')
  assert.equal(draftRequests[0].operations[0].visual, 'addition')
  assert.equal(draftRequests[0].recipes[0].recipe.kind, 'excel-formula')
  assert.deepEqual(apiCalls, [], 'draft creation must not mutate the visible workbook')
  assert.deepEqual(scrollCalls, [])

  const tooLarge = await documentBridge.execute({
    action: 'setExcelFormula',
    target: 'A1:ZZ100',
    formula: '=1+1',
    operationId: 'excel-write-too-large',
  }) as any
  assert.equal(tooLarge.success, false)
  assert.equal(tooLarge.error, 'EXCEL_FORMULA_WRITE_LIMIT')

  const missingEquals = await documentBridge.execute({
    action: 'setExcelFormula',
    target: 'A1',
    formula: 'SUM(1,2)',
    operationId: 'excel-write-invalid-formula',
  }) as any
  assert.equal(missingEquals.success, false)
  assert.equal(missingEquals.error, 'FORMULA_MUST_START_WITH_EQUALS')

  setBuiltInArtifactDraftFactoryForTesting(null)
  documentBridge.clear()
}

async function main(): Promise<void> {
  await verifyVisibleWordOperations()
  await verifyStableWordDocumentApiPlayback()
  await verifyGlobalReplaceExpandsInDocumentOrder()
  await verifyVisibleCodeRangeOperation()
  await verifyExcelRangeAndFormulaOperations()
  console.log('PASS visible Word, code, and Excel Agent document operations')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
