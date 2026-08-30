import type { WorkbookInstance } from '@fortune-sheet/react'
import type { SuperDocInstance } from '@superdoc-dev/react'
import type {
  AgentEditCommand,
  DocumentEngine,
  DocumentEvent,
  DocumentOperationResult,
  DocumentPosition,
} from '@/types/document'
import { LiveOperationQueue } from './live-operation-queue'
import { readFileBuffer } from '../utils/file-io'

export type DocKind = 'word' | 'excel' | 'pdf' | 'text' | 'none'
export interface CodeEditorAdapter {
  getValue: () => string
  getPosition: () => { lineNumber: number; column: number } | null
  getLineCount: () => number
  getLineMaxColumn: (lineNumber: number) => number
  executeEdits: (source: string, edits: Array<{
    range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
    text: string
  }>) => void
  setPosition: (position: { lineNumber: number; column: number }) => void
  revealPositionInCenter: (position: { lineNumber: number; column: number }) => void
}

interface BridgeState {
  kind: DocKind
  filePath: string | null
  superdoc: SuperDocInstance | null
  workbook: WorkbookInstance | null
  codeEditor: CodeEditorAdapter | null
  pdfText: string
  plainText: string
  revision: number
}

type PlainTextListener = (text: string) => void
type DocumentEventListener = (event: DocumentEvent) => void

const state: BridgeState = {
  kind: 'none',
  filePath: null,
  superdoc: null,
  workbook: null,
  codeEditor: null,
  pdfText: '',
  plainText: '',
  revision: 0,
}

const plainTextListeners = new Set<PlainTextListener>()
const documentEventListeners = new Set<DocumentEventListener>()
const operationQueue = new LiveOperationQueue()
const runRevisions = new Map<string, number>()
let suppressUserRevision = false
let agentMutationGraceUntil = 0

function notifyPlainTextListeners(): void {
  for (const listener of plainTextListeners) {
    try {
      listener(state.plainText)
    } catch (error) {
      console.error('[DocumentBridge] Plain-text listener failed:', error)
    }
  }
}

function emitDocumentEvent(
  type: DocumentEvent['type'],
  command: AgentEditCommand,
  extra: Partial<DocumentEvent> = {},
): DocumentEvent {
  const event: DocumentEvent = {
    eventId: crypto.randomUUID(),
    type,
    timestamp: Date.now(),
    operationId: command.operationId,
    runId: command.runId,
    agentId: command.agentId,
    agentName: command.agentName,
    documentId: state.filePath ?? undefined,
    engine: engineForKind(state.kind),
    revision: state.revision,
    baseRevision: command.baseRevision,
    text: command.text ?? command.replace,
    ...extra,
  }
  for (const listener of documentEventListeners) {
    try {
      listener(event)
    } catch (error) {
      console.error('[DocumentBridge] Document event listener failed:', error)
    }
  }
  return event
}

function engineForKind(kind: DocKind): DocumentEngine | undefined {
  if (kind === 'text' && state.codeEditor) return 'monaco'
  if (kind === 'word') return 'superdoc'
  if (kind === 'excel') return 'excel'
  if (kind === 'text') return 'text'
  return undefined
}

function positionForCommand(command: AgentEditCommand): DocumentPosition | undefined {
  if (typeof command.line !== 'number' || typeof command.column !== 'number') return undefined
  return { line: command.line, column: command.column }
}

export const documentBridge = {
  setWord(superdoc: SuperDocInstance | null, filePath: string) {
    state.kind = 'word'
    state.filePath = filePath
    state.superdoc = superdoc
    state.workbook = null
    state.codeEditor = null
    state.revision = 0
  },

  setExcel(workbook: WorkbookInstance | null, filePath: string) {
    state.kind = 'excel'
    state.filePath = filePath
    state.workbook = workbook
    state.superdoc = null
    state.codeEditor = null
    state.revision = 0
  },

  setPdf(text: string, filePath: string) {
    state.kind = 'pdf'
    state.filePath = filePath
    state.pdfText = text
    state.superdoc = null
    state.workbook = null
    state.codeEditor = null
    state.revision = 0
  },

  setPlainText(text: string, filePath: string, source: 'user' | 'system' = 'user') {
    const sameDocument = state.kind === 'text' && state.filePath === filePath
    state.kind = 'text'
    state.filePath = filePath
    state.plainText = text
    state.superdoc = null
    state.workbook = null
    if (!sameDocument) state.codeEditor = null
    if (!sameDocument) state.revision = 0
    if (sameDocument && source === 'user' && !suppressUserRevision) {
      state.revision += 1
      emitDocumentEvent('revision-changed', { action: 'readDocument' }, {
        revision: state.revision,
        message: 'user-edit',
      })
    }
    notifyPlainTextListeners()
  },

  setCodeEditor(editor: CodeEditorAdapter, filePath: string): void {
    const sameDocument = state.kind === 'text' && state.filePath === filePath
    state.kind = 'text'
    state.filePath = filePath
    state.codeEditor = editor
    state.superdoc = null
    state.workbook = null
    state.plainText = editor.getValue()
    if (!sameDocument) state.revision = 0
    notifyPlainTextListeners()
  },

  subscribePlainText(listener: PlainTextListener): () => void {
    plainTextListeners.add(listener)
    return () => plainTextListeners.delete(listener)
  },

  subscribeDocumentEvents(listener: DocumentEventListener): () => void {
    documentEventListeners.add(listener)
    return () => documentEventListeners.delete(listener)
  },

  clear() {
    state.kind = 'none'
    state.filePath = null
    state.superdoc = null
    state.workbook = null
    state.codeEditor = null
    state.pdfText = ''
    state.plainText = ''
    state.revision = 0
    runRevisions.clear()
  },

  getState() {
    return { ...state }
  },

  async execute(command: AgentEditCommand): Promise<DocumentOperationResult | unknown> {
    const operationId = command.operationId ?? crypto.randomUUID()
    const operation = { ...command, operationId }
    return operationQueue.enqueue(
      { operationId, runId: command.runId },
      async () => {
        const expectedRevision = operation.runId
          ? runRevisions.get(operation.runId) ?? operation.baseRevision
          : operation.baseRevision
        if (expectedRevision !== undefined && expectedRevision !== state.revision) {
          const message = `Document revision conflict: expected ${expectedRevision}, current ${state.revision}`
          emitDocumentEvent('conflict', operation, {
            baseRevision: expectedRevision,
            message,
          })
          return { success: false, operationId, revision: state.revision, error: message }
        }
        if (operation.runId && !runRevisions.has(operation.runId)) {
          runRevisions.set(operation.runId, state.revision)
        }
        emitDocumentEvent('operation-prepared', operation, {
          baseRevision: state.revision,
          position: positionForCommand(operation),
        })
        try {
          suppressUserRevision = true
          const result = await executeVisibleCommand(operation)
          const normalized = (result && typeof result === 'object')
            ? result as DocumentOperationResult
            : { success: true, result } as DocumentOperationResult
          if (!normalized.success) {
            emitDocumentEvent('operation-rejected', operation, { message: normalized.error })
            return { ...normalized, operationId, revision: state.revision }
          }
          const changesDocument = operation.action !== 'readDocument'
          if (changesDocument) state.revision += 1
          emitDocumentEvent('operation-applied', operation, {
            revision: state.revision,
            position: positionForCommand(operation),
          })
          if (changesDocument) emitDocumentEvent('revision-changed', operation, { revision: state.revision })
          if (operation.runId) runRevisions.set(operation.runId, state.revision)
          return { ...normalized, operationId, revision: state.revision }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          emitDocumentEvent('operation-rejected', operation, { message })
          return { success: false, operationId, revision: state.revision, error: message }
        } finally {
          suppressUserRevision = false
          agentMutationGraceUntil = Date.now() + 250
        }
      },
    )
  },

  cancelRun(runId: string): void {
    operationQueue.cancelRun(runId)
    runRevisions.delete(runId)
    emitDocumentEvent('run-cancelled', { action: 'readDocument', runId }, { message: 'AGENT_RUN_CANCELLED' })
  },

  markUserEdit(): void {
    if (suppressUserRevision) return
    if (Date.now() < agentMutationGraceUntil) return
    state.revision += 1
    emitDocumentEvent('revision-changed', { action: 'readDocument' }, {
      revision: state.revision,
      message: 'user-edit',
    })
  },
}

async function executeVisibleCommand(command: AgentEditCommand): Promise<unknown> {
  if (command.action === 'insertCodeText' || command.action === 'replaceCodeRange' || command.action === 'deleteCodeRange') {
    return executeCodeCommand(command)
  }
  if (state.codeEditor && state.kind === 'text' && command.action === 'replaceText') {
    return executeCodeReplaceSearch(command)
  }
  if (state.codeEditor && state.kind === 'text' && (command.action === 'insertText' || command.action === 'appendParagraph')) {
    return executeCodeCommand(command)
  }
  switch (command.action) {
    case 'insertText':
    case 'appendParagraph':
      return insertWordText(command.text || '', command.action === 'appendParagraph')
    case 'replaceText':
      return replaceWordText(command.search || '', command.replace || '', command.all)
    case 'readDocument':
      return readDocument()
    case 'setCellValue':
      return setCell(command.row ?? 0, command.col ?? 0, command.value ?? command.text ?? '')
    default:
      return { success: false, error: `Unknown action: ${command.action}` }
  }
}

function codePosition(command: AgentEditCommand): { lineNumber: number; column: number } {
  const editor = state.codeEditor
  if (!editor) return { lineNumber: 1, column: 1 }
  if (typeof command.line === 'number' && typeof command.column === 'number') {
    return { lineNumber: Math.max(1, command.line), column: Math.max(1, command.column) }
  }
  if (command.position === 'start') return { lineNumber: 1, column: 1 }
  if (command.position === 'end') {
    const lineNumber = editor.getLineCount()
    return { lineNumber, column: editor.getLineMaxColumn(lineNumber) }
  }
  return editor.getPosition() ?? { lineNumber: 1, column: 1 }
}

function executeCodeCommand(command: AgentEditCommand): DocumentOperationResult {
  const editor = state.codeEditor
  if (!editor) return { success: false, error: 'Code editor not ready' }
  const start = codePosition(command)
  const end = typeof command.endLine === 'number' && typeof command.endColumn === 'number'
    ? { lineNumber: command.endLine, column: command.endColumn }
    : start
  const text = command.action === 'deleteCodeRange'
    ? ''
    : command.action === 'replaceCodeRange'
      ? command.replace ?? command.text ?? ''
      : command.text ?? ''
  editor.setPosition(start)
  editor.revealPositionInCenter(start)
  emitDocumentEvent('cursor-moved', command, { position: { line: start.lineNumber, column: start.column } })
  editor.executeEdits('agent', [{
    range: {
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    },
    text,
  }])
  state.plainText = editor.getValue()
  notifyPlainTextListeners()
  return { success: true, changed: true, content: state.plainText }
}

function offsetToCodePosition(value: string, offset: number): { lineNumber: number; column: number } {
  const before = value.slice(0, Math.max(0, offset))
  const lines = before.split('\n')
  return { lineNumber: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 }
}

function executeCodeReplaceSearch(command: AgentEditCommand): DocumentOperationResult {
  const editor = state.codeEditor
  if (!editor) return { success: false, error: 'Code editor not ready' }
  const search = command.search ?? ''
  if (!search) return { success: false, error: 'Empty search' }
  const value = editor.getValue()
  const matches: number[] = []
  let offset = 0
  while (offset <= value.length - search.length) {
    const found = value.indexOf(search, offset)
    if (found < 0) break
    matches.push(found)
    if (!command.all) break
    offset = found + Math.max(1, search.length)
  }
  if (matches.length === 0) return { success: true, changed: false, replaced: 0 }
  const edits = matches.map((start) => {
    const from = offsetToCodePosition(value, start)
    const to = offsetToCodePosition(value, start + search.length)
    return {
      range: {
        startLineNumber: from.lineNumber,
        startColumn: from.column,
        endLineNumber: to.lineNumber,
        endColumn: to.column,
      },
      text: command.replace ?? '',
    }
  })
  const first = offsetToCodePosition(value, matches[0])
  editor.setPosition(first)
  editor.revealPositionInCenter(first)
  emitDocumentEvent('cursor-moved', command, { position: { line: first.lineNumber, column: first.column } })
  editor.executeEdits('agent', edits)
  state.plainText = editor.getValue()
  notifyPlainTextListeners()
  return { success: true, changed: true, replaced: matches.length, content: state.plainText }
}

async function insertWordText(text: string, append: boolean): Promise<unknown> {
  if (state.kind === 'text') {
    const before = state.plainText
    state.plainText = append
      ? `${before}${before.endsWith('\n') || !before ? '' : '\n'}${text}`
      : `${before}${text}`
    if (state.plainText !== before) notifyPlainTextListeners()
    return { success: true, kind: 'text', content: state.plainText }
  }

  const editor = state.superdoc?.activeEditor as any
  if (!editor) return { success: false, error: 'Word editor not ready' }
  try {
    if (append) editor.commands.insertContentAt(editor.state.doc.content.size, `<p>${escapeHtml(text)}</p>`)
    else editor.commands.insertContent(text)
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

async function replaceWordText(search: string, replace: string, all?: boolean): Promise<unknown> {
  if (!search) return { success: false, error: 'Empty search' }
  if (state.kind === 'text') {
    const before = state.plainText
    state.plainText = all ? before.split(search).join(replace) : before.replace(search, replace)
    const changed = before !== state.plainText
    if (changed) notifyPlainTextListeners()
    return { success: true, kind: 'text', replaced: search, changed, content: state.plainText }
  }

  const editor = state.superdoc?.activeEditor as any
  if (!editor?.state?.doc || !editor?.view) return { success: false, error: 'Word editor not ready' }
  const matches: Array<{ from: number; to: number }> = []
  editor.state.doc.descendants((node: any, pos: number) => {
    if (!node.isText || typeof node.text !== 'string') return
    let offset = 0
    while (offset < node.text.length) {
      const index = node.text.indexOf(search, offset)
      if (index < 0) break
      matches.push({ from: pos + index, to: pos + index + search.length })
      if (!all) break
      offset = index + Math.max(1, search.length)
    }
  })
  if (matches.length === 0) return { success: true, replaced: 0, changed: false }
  if (!all && matches.length > 1) matches.splice(1)
  const transaction = editor.state.tr
  for (const match of [...matches].reverse()) {
    transaction.insertText(replace, match.from, match.to)
  }
  editor.view.dispatch(transaction)
  return { success: true, replaced: matches.length, changed: true }
}

async function readDocument(): Promise<unknown> {
  if (state.codeEditor) return { success: true, content: state.codeEditor.getValue() }
  if (state.kind === 'word' && state.filePath) {
    const { default: mammoth } = await import('mammoth')
    const arrayBuffer = await readFileBuffer(state.filePath)
    const result = await mammoth.extractRawText({ arrayBuffer })
    const live = (state.superdoc?.activeEditor as any)?.state?.doc?.textContent
    return { success: true, content: live || result.value }
  }
  if (state.kind === 'excel' && state.workbook) {
    const sheet = state.workbook.getSheet()
    const lines: string[] = []
    for (const cell of sheet?.celldata || []) lines.push(`${cell.r},${cell.c}: ${cell.v?.m ?? cell.v?.v ?? ''}`)
    return { success: true, content: lines.join('\n') }
  }
  if (state.kind === 'pdf') return { success: true, content: state.pdfText }
  if (state.kind === 'text') return { success: true, content: state.plainText }
  return { success: false, error: 'No document open' }
}

function setCell(row: number, col: number, value: string): unknown {
  if (!state.workbook) return { success: false, error: 'Excel editor not ready' }
  state.workbook.setCellValue(row, col, value)
  return { success: true, row, col, value }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
