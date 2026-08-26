import type { WorkbookInstance } from '@fortune-sheet/react'
import type { Cell, Sheet, SingleRange } from '@fortune-sheet/core'
import type { Editor, SuperDocInstance } from '@superdoc-dev/react'
import { SuperDoc } from 'superdoc'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import type {
  AgentUserDocumentActivity,
  DocumentEngine,
  DocumentEvent,
  DocumentOperationResult,
  DocumentPosition,
  WordEditPlan,
  WordEditPlanStep,
  WordPlaybackControl,
  WordPlaybackState,
} from '@/types/document'
import type {
  ArtifactDraftCreateRequest,
  ArtifactKind,
  ArtifactOperation,
  ArtifactOperationType,
  ArtifactVisualType,
  ArtifactTextMetadata,
  ArtifactReviewBatchManifest,
  CodeArtifactResolvedSnapshot,
  CodeDraftCreateRequest,
} from '@/types/artifact-review'
import { useFileStore } from '@/stores/file.store'
import {
  RENDERER_ARTIFACT_PRODUCER,
  type RendererArtifactRebuildRequest,
  type RendererArtifactRecipeEntry,
} from '@/lib/renderer-artifact-producer'
import {
  formatExcelA1Range,
  formatExcelCellAddress,
  parseExcelA1Range,
} from '@/lib/excel-functions/address'
import { validateCuratedExcelFormula } from '@/lib/excel-functions/catalog'
import { LiveOperationQueue } from './live-operation-queue'
import {
  WordAgentPlaybackController,
  orderWordPlanSteps,
  validateWordEditPlan,
  type PreparedWordPlanStep,
} from './word-agent-playback-controller'
import { readFileBuffer } from '../utils/file-io'

export type DocKind = 'word' | 'excel' | 'pdf' | 'presentation' | 'text' | 'none'
export interface AgentEditCommand {
  action:
    | 'insertText'
    | 'replaceText'
    | 'readDocument'
    | 'appendParagraph'
    | 'inspectWordDocument'
    | 'searchWordOperations'
    | 'validateWordPlan'
    | 'applyWordPlan'
    | 'controlWordPlayback'
    | 'setCellValue'
    | 'readExcelRange'
    | 'setExcelFormula'
    | 'inspectDocumentArtifact'
    | 'searchDocumentOperations'
    | 'createDocumentDraft'
    | 'insertCodeText'
    | 'replaceCodeRange'
    | 'deleteCodeRange'
    | 'inspectCodeWorkspace'
    | 'readCodeArtifact'
    | 'createCodeDraft'
  text?: string
  search?: string
  replace?: string
  all?: boolean
  row?: number
  col?: number
  value?: string
  sheet?: string
  range?: string
  target?: string
  formula?: string
  position?: 'cursor' | 'end' | 'start'
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  operationId?: string
  runId?: string
  agentId?: string
  agentName?: string
  baseRevision?: number
  plan?: WordEditPlan
  control?: WordPlaybackControl
  query?: string
  limit?: number
  artifactDraft?: Omit<ArtifactDraftCreateRequest, 'sourcePath' | 'runId' | 'agentId' | 'agentName'>
  artifactId?: string
  startOffset?: number
  endOffset?: number
  codeDraft?: CodeDraftCreateRequest
}

export interface CodeEditorAdapter {
  getValue: () => string
  getPosition: () => { lineNumber: number; column: number } | null
  getLineCount: () => number
  getLineMaxColumn: (lineNumber: number) => number
  getOffsetAt: (position: { lineNumber: number; column: number }) => number
  getPositionAt: (offset: number) => { lineNumber: number; column: number }
  getTextMetadata: () => ArtifactTextMetadata
  executeEdits: (source: string, edits: Array<{
    range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
    text: string
  }>) => void
  setPosition: (position: { lineNumber: number; column: number }) => void
  revealPositionInCenter: (position: { lineNumber: number; column: number }) => void
}

export interface BuiltInArtifactDraftRequest {
  kind: Extract<ArtifactKind, 'word' | 'excel' | 'code'>
  operations: ArtifactOperation[]
  recipes: RendererArtifactRecipeEntry[]
  command: AgentEditCommand
}

type BuiltInArtifactDraftFactory = (
  request: BuiltInArtifactDraftRequest,
) => Promise<DocumentOperationResult>

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
const seenUserEditEvents = new Set<string>()
let suppressUserRevision = false
let agentMutationDepth = 0
let activeWordPlayback: {
  controller: WordAgentPlaybackController
  command: AgentEditCommand
} | null = null
let latestUserActivity: AgentUserDocumentActivity | null = null
let builtInArtifactDraftFactoryForTesting: BuiltInArtifactDraftFactory | null = null

export function setBuiltInArtifactDraftFactoryForTesting(
  factory: BuiltInArtifactDraftFactory | null,
): void {
  builtInArtifactDraftFactoryForTesting = factory
}

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
  const stableEventId = [
    command.runId ?? 'local',
    command.operationId ?? 'document',
    extra.planId ?? '',
    extra.stepId ?? '',
    type,
    extra.phase ?? '',
    extra.completed ?? '',
    extra.activity?.eventId ?? '',
  ].join(':')
  const event: DocumentEvent = {
    eventId: stableEventId,
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

function isReadOnlyAgentAction(action: AgentEditCommand['action']): boolean {
  return action === 'readDocument'
    || action === 'readExcelRange'
    || action === 'inspectWordDocument'
    || action === 'searchWordOperations'
    || action === 'validateWordPlan'
    || action === 'inspectDocumentArtifact'
    || action === 'searchDocumentOperations'
    || action === 'createDocumentDraft'
    || action === 'inspectCodeWorkspace'
    || action === 'readCodeArtifact'
    || action === 'createCodeDraft'
}

export const documentBridge = {
  setWord(superdoc: SuperDocInstance | null, filePath: string) {
    activeWordPlayback?.controller.control({ type: 'cancel' })
    activeWordPlayback = null
    state.kind = 'word'
    state.filePath = filePath
    state.superdoc = superdoc
    state.workbook = null
    state.codeEditor = null
    state.revision = 0
    runRevisions.clear()
    seenUserEditEvents.clear()
    latestUserActivity = null
  },

  setExcel(workbook: WorkbookInstance | null, filePath: string) {
    const sameDocument = state.kind === 'excel' && state.filePath === filePath
    state.kind = 'excel'
    state.filePath = filePath
    state.workbook = workbook
    state.superdoc = null
    state.codeEditor = null
    if (!sameDocument) state.revision = 0
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

  setPresentation(filePath: string) {
    state.kind = 'presentation'
    state.filePath = filePath
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
    activeWordPlayback?.controller.control({ type: 'cancel' })
    activeWordPlayback = null
    state.kind = 'none'
    state.filePath = null
    state.superdoc = null
    state.workbook = null
    state.codeEditor = null
    state.pdfText = ''
    state.plainText = ''
    state.revision = 0
    runRevisions.clear()
    seenUserEditEvents.clear()
    latestUserActivity = null
  },

  getState() {
    return { ...state }
  },

  getWordPlaybackState(): WordPlaybackState | null {
    return activeWordPlayback?.controller.getState() ?? null
  },

  isApplyingAgentMutation(): boolean {
    return agentMutationDepth > 0
  },

  controlWordPlayback(control: WordPlaybackControl): WordPlaybackState | null {
    return activeWordPlayback?.controller.control(control) ?? null
  },

  reportUserActivity(activity: AgentUserDocumentActivity): void {
    if (activity.documentId && state.filePath && activity.documentId !== state.filePath) return
    if (activity.kind === 'edit') {
      if (suppressUserRevision || agentMutationDepth > 0) return
      if (!seenUserEditEvents.has(activity.eventId)) {
        seenUserEditEvents.add(activity.eventId)
        state.revision += 1
      }
    }
    const command = activeWordPlayback?.command ?? {
      action: 'readDocument' as const,
      runId: activity.runId,
    }
    const normalized: AgentUserDocumentActivity = {
      ...activity,
      runId: activity.runId ?? command.runId,
      documentId: state.filePath ?? activity.documentId,
      documentRevision: state.revision,
    }
    latestUserActivity = normalized
    activeWordPlayback?.controller.reportUserActivity(normalized)
    emitDocumentEvent('user-activity', command, {
      activity: normalized,
      revision: state.revision,
      message: normalized.kind,
    })
    if (normalized.kind === 'edit') {
      emitDocumentEvent('revision-changed', command, {
        revision: state.revision,
        message: 'user-edit',
      })
    }
  },

  async execute(command: AgentEditCommand): Promise<DocumentOperationResult | unknown> {
    const operationId = command.operationId ?? crypto.randomUUID()
    const operation = { ...command, operationId }
    if (operation.action === 'controlWordPlayback') {
      if (!operation.control) return { success: false, error: 'WORD_PLAYBACK_CONTROL_REQUIRED' }
      return { success: true, playback: activeWordPlayback?.controller.control(operation.control) ?? null }
    }
    return operationQueue.enqueue(
      { operationId, runId: command.runId },
      async () => {
        const expectedRevision = operation.runId
          ? runRevisions.get(operation.runId) ?? operation.baseRevision
          : operation.baseRevision
        if (
          expectedRevision !== undefined
          && expectedRevision !== state.revision
          && !isReadOnlyAgentAction(operation.action)
        ) {
          const message = `Document revision conflict: expected ${expectedRevision}, current ${state.revision}`
          emitDocumentEvent('conflict', operation, {
            baseRevision: expectedRevision,
            message,
          })
          return { success: false, operationId, revision: state.revision, error: message }
        }
        if (operation.runId && !runRevisions.has(operation.runId)) {
          runRevisions.set(operation.runId, state.revision)
        } else if (operation.runId && isReadOnlyAgentAction(operation.action)) {
          runRevisions.set(operation.runId, state.revision)
        }
        emitDocumentEvent('operation-prepared', operation, {
          baseRevision: state.revision,
          position: positionForCommand(operation),
        })
        try {
          const result = await executeVisibleCommand(operation)
          const normalized = (result && typeof result === 'object')
            ? result as DocumentOperationResult
            : { success: true, result } as DocumentOperationResult
          if (!normalized.success) {
            emitDocumentEvent('operation-rejected', operation, { message: normalized.error })
            return { ...normalized, operationId, revision: state.revision }
          }
          const readOnly = isReadOnlyAgentAction(operation.action)
          const revisionHandled = normalized.revisionHandled === true
          const changesDocument = !readOnly && !revisionHandled
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
        }
      },
    )
  },

  cancelRun(runId: string): void {
    operationQueue.cancelRun(runId)
    if (activeWordPlayback?.command.runId === runId) {
      activeWordPlayback.controller.control({ type: 'cancel' })
    }
    runRevisions.delete(runId)
    emitDocumentEvent('run-cancelled', { action: 'readDocument', runId }, { message: 'AGENT_RUN_CANCELLED' })
  },

  markUserEdit(activity?: Omit<AgentUserDocumentActivity, 'eventId' | 'timestamp' | 'documentRevision'>): void {
    this.reportUserActivity({
      eventId: crypto.randomUUID(),
      timestamp: Date.now(),
      documentRevision: state.revision,
      kind: 'edit',
      documentId: state.filePath ?? undefined,
      ...activity,
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
      return executeLegacyWordInsert(command)
    case 'replaceText':
      return executeLegacyWordReplace(command)
    case 'readDocument':
      return readDocument()
    case 'inspectWordDocument':
      return inspectWordDocument()
    case 'searchWordOperations':
      return searchWordOperations(command.query ?? '', command.limit)
    case 'validateWordPlan':
      return command.plan
        ? validateWordPlanAgainstDocument(command.plan)
        : { success: false, error: 'WORD_PLAN_REQUIRED' }
    case 'applyWordPlan':
      return command.plan
        ? applyWordEditPlan(command.plan, command)
        : { success: false, error: 'WORD_PLAN_REQUIRED' }
    case 'controlWordPlayback':
      return { success: true, playback: command.control ? documentBridge.controlWordPlayback(command.control) : null }
    case 'setCellValue':
      return setCell(command.row ?? 0, command.col ?? 0, command.value ?? command.text ?? '', command)
    case 'readExcelRange':
      return readExcelRange(command.sheet, command.range ?? '')
    case 'setExcelFormula':
      return setExcelFormula(command.sheet, command.target ?? '', command.formula ?? '', command)
    case 'inspectDocumentArtifact':
      return inspectDocumentArtifact()
    case 'searchDocumentOperations':
      return searchDocumentOperations(command.query ?? '', command.limit)
    case 'createDocumentDraft':
      return createDocumentDraft(command)
    case 'inspectCodeWorkspace':
      return inspectCodeWorkspace()
    case 'readCodeArtifact':
      return readCodeArtifact(command)
    case 'createCodeDraft':
      return createCodeDraft(command)
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

async function sha256CodeText(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function codePointAtOffset(value: string, offset: number) {
  const before = value.slice(0, Math.max(0, Math.min(value.length, offset)))
  const lines = before.split('\n')
  return { offset, line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 }
}

function encodeCodeSnapshot(value: string, metadata: ArtifactTextMetadata): Uint8Array {
  const encoded = new TextEncoder().encode(value)
  if (!metadata.hasBom) return encoded
  const result = new Uint8Array(encoded.length + 3)
  result.set([0xef, 0xbb, 0xbf])
  result.set(encoded, 3)
  return result
}

interface PreparedCodeDraftEdit {
  id: string
  label: string
  startOffset: number
  endOffset: number
  afterText: string
  expectedBeforeText?: string
  dependsOn?: string[]
  atomicGroupId?: string
}

interface PreparedCodeDraft {
  candidate: string
  operations: ArtifactOperation[]
  recipes: RendererArtifactRecipeEntry[]
}

async function prepareCodeDraft(
  source: string,
  edits: PreparedCodeDraftEdit[],
): Promise<PreparedCodeDraft> {
  const sorted = [...edits].sort((left, right) => (
    left.startOffset - right.startOffset
    || left.endOffset - right.endOffset
    || left.id.localeCompare(right.id)
  ))
  const seenIds = new Set<string>()
  for (let index = 0; index < sorted.length; index += 1) {
    const edit = sorted[index]
    if (!edit.id.trim() || seenIds.has(edit.id)) throw new Error(`ARTIFACT_CODE_OPERATION_ID_INVALID:${edit.id}`)
    seenIds.add(edit.id)
    if (!Number.isInteger(edit.startOffset) || !Number.isInteger(edit.endOffset)
      || edit.startOffset < 0 || edit.endOffset < edit.startOffset || edit.endOffset > source.length) {
      throw new Error(`ARTIFACT_CODE_RECIPE_RANGE_INVALID:${edit.id}`)
    }
    if (index > 0 && edit.startOffset < sorted[index - 1].endOffset) {
      throw new Error(`ARTIFACT_CODE_RANGE_OVERLAP:${edit.id}`)
    }
    const beforeText = source.slice(edit.startOffset, edit.endOffset)
    if (edit.expectedBeforeText !== undefined && beforeText !== edit.expectedBeforeText) {
      throw new Error(`ARTIFACT_CODE_BEFORE_TEXT_MISMATCH:${edit.id}`)
    }
    if (beforeText === edit.afterText) throw new Error(`ARTIFACT_CODE_OPERATION_NO_CHANGE:${edit.id}`)
  }
  let candidate = source
  for (const edit of [...sorted].reverse()) {
    candidate = candidate.slice(0, edit.startOffset) + edit.afterText + candidate.slice(edit.endOffset)
  }

  let delta = 0
  const entries = await Promise.all(sorted.map(async (edit) => {
    const beforeText = source.slice(edit.startOffset, edit.endOffset)
    const candidateStart = edit.startOffset + delta
    const candidateEnd = candidateStart + edit.afterText.length
    delta += edit.afterText.length - beforeText.length
    const [beforeDigest, afterDigest, contextBeforeDigest, contextAfterDigest] = await Promise.all([
      sha256CodeText(beforeText),
      sha256CodeText(edit.afterText),
      sha256CodeText(source.slice(Math.max(0, edit.startOffset - 96), edit.startOffset)),
      sha256CodeText(source.slice(edit.endOffset, edit.endOffset + 96)),
    ])
    const executionRef = crypto.randomUUID()
    const visual: ArtifactVisualType = beforeText.length === 0
      ? 'addition'
      : edit.afterText.length === 0
        ? 'deletion'
        : 'replacement'
    const operation: ArtifactOperation = {
      id: edit.id,
      type: beforeText.length === 0 ? 'insert' : edit.afterText.length === 0 ? 'delete' : 'replace',
      label: edit.label,
      location: {
        kind: 'code',
        originalRange: {
          start: codePointAtOffset(source, edit.startOffset),
          end: codePointAtOffset(source, edit.endOffset),
        },
        candidateRange: {
          start: codePointAtOffset(candidate, candidateStart),
          end: codePointAtOffset(candidate, candidateEnd),
        },
        beforeDigest,
        afterDigest,
        contextBeforeDigest,
        contextAfterDigest,
      },
      ...(beforeText.length > 0 ? { before: { text: beforeText, digest: beforeDigest } } : {}),
      ...(edit.afterText.length > 0 ? { after: { text: edit.afterText, digest: afterDigest } } : {}),
      ...(edit.dependsOn?.length ? { dependsOn: edit.dependsOn } : {}),
      ...(edit.atomicGroupId ? { atomicGroupId: edit.atomicGroupId } : {}),
      visual,
      executionRef,
    }
    const recipe: RendererArtifactRecipeEntry = {
      executionRef,
      recipe: {
        kind: 'code-edit',
        startOffset: edit.startOffset,
        endOffset: edit.endOffset,
        beforeText,
        afterText: edit.afterText,
        beforeDigest,
        afterDigest,
      },
    }
    return { operation, recipe }
  }))
  return {
    candidate,
    operations: entries.map(({ operation }) => operation),
    recipes: entries.map(({ recipe }) => recipe),
  }
}

async function openCodeDraft(
  edits: PreparedCodeDraftEdit[],
  command: AgentEditCommand,
): Promise<DocumentOperationResult> {
  const editor = state.codeEditor
  if (!editor) return { success: false, error: 'Code editor not ready' }
  const source = editor.getValue()
  try {
    const prepared = await prepareCodeDraft(source, edits)
    return openBuiltInArtifactDraft('code', prepared.operations, prepared.recipes, command)
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function executeCodeCommand(command: AgentEditCommand): Promise<DocumentOperationResult> {
  const editor = state.codeEditor
  if (!editor) return { success: false, error: 'Code editor not ready' }
  const start = command.action === 'appendParagraph'
    ? { lineNumber: editor.getLineCount(), column: editor.getLineMaxColumn(editor.getLineCount()) }
    : codePosition(command)
  const end = typeof command.endLine === 'number' && typeof command.endColumn === 'number'
    ? { lineNumber: command.endLine, column: command.endColumn }
    : start
  const afterText = command.action === 'deleteCodeRange'
    ? ''
    : command.action === 'replaceCodeRange'
      ? command.replace ?? command.text ?? ''
      : command.action === 'appendParagraph'
        ? `${editor.getValue().endsWith('\n') ? '' : '\n'}${command.text ?? ''}`
        : command.text ?? ''
  return openCodeDraft([{
    id: command.operationId ?? crypto.randomUUID(),
    label: command.action === 'deleteCodeRange' ? 'delete-code' : command.action === 'replaceCodeRange' ? 'replace-code' : 'insert-code',
    startOffset: editor.getOffsetAt(start),
    endOffset: editor.getOffsetAt(end),
    afterText,
  }], command)
}

function offsetToCodePosition(value: string, offset: number): { lineNumber: number; column: number } {
  const before = value.slice(0, Math.max(0, offset))
  const lines = before.split('\n')
  return { lineNumber: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 }
}

async function executeCodeReplaceSearch(command: AgentEditCommand): Promise<DocumentOperationResult> {
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
  const atomicGroupId = matches.length > 1 ? command.operationId ?? crypto.randomUUID() : undefined
  return openCodeDraft(matches.map((start, index) => ({
    id: matches.length === 1 && command.operationId ? command.operationId : `${command.operationId ?? crypto.randomUUID()}:${index + 1}`,
    label: matches.length === 1 ? 'replace-code' : `replace-code-${index + 1}`,
    startOffset: start,
    endOffset: start + search.length,
    afterText: command.replace ?? '',
    atomicGroupId,
  })), command)
}

type RuntimeWordCapability = {
  available: boolean
  tracked: boolean
  dryRun: boolean
  reasons?: string[]
}

type RuntimeWordDocumentApi = Editor['doc']

function getWordEditor(): Editor | null {
  if (state.kind !== 'word') return null
  return (state.superdoc?.activeEditor as Editor | null | undefined) ?? null
}

function getWordDocumentApi(): RuntimeWordDocumentApi | null {
  const editor = getWordEditor()
  if (!editor) return null
  try {
    return editor.doc
  } catch {
    return null
  }
}

async function withAgentMutation<T>(operation: () => T | Promise<T>): Promise<T> {
  agentMutationDepth += 1
  suppressUserRevision = true
  try {
    return await operation()
  } finally {
    agentMutationDepth = Math.max(0, agentMutationDepth - 1)
    suppressUserRevision = agentMutationDepth > 0
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function wordOperationFailure(result: unknown): string | null {
  if (!isRecord(result)) return null
  if (result.valid === false && Array.isArray(result.failures)) {
    const failure = result.failures.find(isRecord)
    if (failure) {
      const code = typeof failure.code === 'string' ? `${failure.code}:` : ''
      const message = typeof failure.message === 'string' ? failure.message : 'WORD_MUTATION_PREVIEW_FAILED'
      return `${code}${message}`
    }
    return 'WORD_MUTATION_PREVIEW_FAILED'
  }
  if (result.success !== false) return null
  if (isRecord(result.failure) && typeof result.failure.message === 'string') {
    const code = typeof result.failure.code === 'string' ? `${result.failure.code}:` : ''
    return `${code}${result.failure.message}`
  }
  if (typeof result.error === 'string') return result.error
  return 'WORD_OPERATION_FAILED'
}

function wordOperationConflict(result: unknown): boolean {
  if (!isRecord(result) || !isRecord(result.failure)) return false
  return [
    'REVISION_MISMATCH',
    'STALE_REVISION',
    'TARGET_NOT_FOUND',
    'TARGET_MOVED',
    'ADDRESS_STALE',
    'AMBIGUOUS_MATCH',
    'MATCH_NOT_FOUND',
  ].includes(String(result.failure.code ?? ''))
}

function findAbsoluteRange(value: unknown, seen = new Set<object>()): { from: number; to: number } | undefined {
  if (!value || typeof value !== 'object') return undefined
  if (seen.has(value)) return undefined
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const range = findAbsoluteRange(item, seen)
      if (range) return range
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  if (isRecord(record.range) && typeof record.range.from === 'number' && typeof record.range.to === 'number') {
    return { from: record.range.from, to: record.range.to }
  }
  for (const key of ['resolution', 'resolutions', 'selectionResolutions', 'steps', 'data']) {
    const range = findAbsoluteRange(record[key], seen)
    if (range) return range
  }
  return undefined
}

function countResolvedTargets(value: unknown): number {
  if (!isRecord(value)) return 1
  if (Array.isArray(value.steps)) {
    return Math.max(1, value.steps.reduce((total, step) => total + countResolvedTargets(step), 0))
  }
  const count = ['resolutions', 'spanResolutions', 'selectionResolutions']
    .reduce((total, key) => total + (Array.isArray(value[key]) ? value[key].length : 0), 0)
  return Math.max(1, count)
}

function isReadOnlyWordOperation(operationId: string): boolean {
  if (['get', 'find', 'getNode', 'getNodeById', 'getText', 'getMarkdown', 'getHtml', 'info', 'extract', 'markdownToFragment'].includes(operationId)) {
    return true
  }
  if (operationId === 'query.match' || operationId === 'ranges.resolve' || operationId === 'selection.current') return true
  return /(^|\.)(list|get|resolve|current)([A-Z.]|$)/.test(operationId)
}

function inferWordVisual(step: WordEditPlanStep): NonNullable<WordEditPlanStep['visual']> {
  if (step.visual) return step.visual
  const operation = step.operationId.toLowerCase()
  if (operation === 'insert' || operation.startsWith('create.paragraph') || operation.startsWith('create.heading')) return 'text-insert'
  if (operation === 'replace') return 'text-replace'
  if (operation === 'delete' || operation.includes('.delete') || operation.includes('.remove')) return 'text-delete'
  if (operation.includes('format') || operation.includes('style') || operation.includes('list')) return 'format'
  if (operation.includes('table')) return 'table-cell'
  if (operation.includes('image')) return 'image'
  if (operation.includes('section') || operation.includes('header') || operation.includes('footer')) return 'page-region'
  return 'object-anchor'
}

function replacementTextForStep(step: WordEditPlanStep): string | undefined {
  if (!isRecord(step.input)) return undefined
  for (const key of ['text', 'value', 'replace']) {
    if (typeof step.input[key] === 'string') return step.input[key] as string
  }
  return undefined
}

function wordAnchorKey(step: WordEditPlanStep): string | null {
  const anchor = step.anchor
  if (!anchor?.search) return null
  return [
    anchor.blockId ?? '*',
    anchor.search,
    anchor.contextBefore ?? '',
    anchor.contextAfter ?? '',
  ].join('\u0000')
}

function stepConsumesWordAnchor(step: WordEditPlanStep): boolean {
  const search = step.anchor?.search
  if (!search) return false
  const visual = inferWordVisual(step)
  if (visual === 'text-delete') return true
  if (visual !== 'text-replace') return false
  return !replacementTextForStep(step)?.includes(search)
}

function internalWordOptions(step: WordEditPlanStep): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(step.options ?? {}).filter(([key]) => !key.startsWith('__')),
  )
}

function wordInputWithRevisionGuard(operationId: string, input: unknown, revision: string): unknown {
  if ((operationId === 'mutations.apply' || operationId === 'mutations.preview') && isRecord(input)) {
    return { ...input, expectedRevision: revision }
  }
  return input
}

function validateSectionGeometry(
  doc: RuntimeWordDocumentApi,
  operationId: string,
  input: unknown,
): void {
  if (!isRecord(input) || !['sections.setPageMargins', 'sections.setPageSetup'].includes(operationId)) return
  if (!isRecord(input.target) || input.target.kind !== 'section') return
  const section = doc.sections.get({ address: input.target as never })
  const currentMargins = section.margins ?? {}
  const currentSetup = section.pageSetup ?? {}
  const dimension = (value: unknown, fallback: number): number => {
    const resolved = value ?? fallback
    if (typeof resolved !== 'number' || !Number.isFinite(resolved) || resolved < 0) {
      throw new Error(`WORD_SECTION_GEOMETRY_INVALID:${operationId}`)
    }
    return resolved
  }
  const margins = operationId === 'sections.setPageMargins'
    ? {
        top: dimension(input.top, currentMargins.top ?? 0),
        right: dimension(input.right, currentMargins.right ?? 0),
        bottom: dimension(input.bottom, currentMargins.bottom ?? 0),
        left: dimension(input.left, currentMargins.left ?? 0),
        gutter: dimension(input.gutter, currentMargins.gutter ?? 0),
      }
    : {
        top: dimension(currentMargins.top, 0),
        right: dimension(currentMargins.right, 0),
        bottom: dimension(currentMargins.bottom, 0),
        left: dimension(currentMargins.left, 0),
        gutter: dimension(currentMargins.gutter, 0),
      }
  const setup = operationId === 'sections.setPageSetup'
    ? {
        width: dimension(input.width, currentSetup.width ?? 8.5),
        height: dimension(input.height, currentSetup.height ?? 11),
      }
    : {
        width: dimension(currentSetup.width, 8.5),
        height: dimension(currentSetup.height, 11),
      }
  if (setup.width <= 0 || setup.height <= 0) throw new Error(`WORD_SECTION_PAGE_SIZE_INVALID:${operationId}`)
  if (margins.left + margins.right + margins.gutter >= setup.width) {
    throw new Error('WORD_SECTION_HORIZONTAL_MARGINS_EXCEED_PAGE')
  }
  if (margins.top + margins.bottom >= setup.height) {
    throw new Error('WORD_SECTION_VERTICAL_MARGINS_EXCEED_PAGE')
  }
}

function stepReference(value: unknown): { stepId: string; path?: string } | null {
  if (!isRecord(value) || typeof value.$step !== 'string') return null
  return { stepId: value.$step, path: typeof value.path === 'string' ? value.path : undefined }
}

function containsStepReference(value: unknown): boolean {
  if (stepReference(value)) return true
  if (Array.isArray(value)) return value.some(containsStepReference)
  return isRecord(value) && Object.values(value).some(containsStepReference)
}

function valueAtPath(value: unknown, path?: string): unknown {
  if (!path) return value
  return path.split('.').reduce<unknown>((current, key) => (
    isRecord(current) || Array.isArray(current)
      ? (current as Record<string, unknown>)[key]
      : undefined
  ), value)
}

function resolveStepReferences(value: unknown, results: Map<string, unknown>): unknown {
  const reference = stepReference(value)
  if (reference) {
    if (!results.has(reference.stepId)) throw new Error(`WORD_PLAN_DEPENDENCY_RESULT_MISSING:${reference.stepId}`)
    const resolved = valueAtPath(results.get(reference.stepId), reference.path)
    if (resolved === undefined) throw new Error(`WORD_PLAN_DEPENDENCY_PATH_MISSING:${reference.stepId}:${reference.path ?? ''}`)
    return resolved
  }
  if (Array.isArray(value)) return value.map((item) => resolveStepReferences(item, results))
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveStepReferences(item, results)]))
}

type WordAnchorMatch = {
  target: unknown
  ref?: string
  text: string
  range?: { from: number; to: number }
  blockId?: string
}

function resolveWordAnchorMatch(
  doc: RuntimeWordDocumentApi,
  step: WordEditPlanStep,
): WordAnchorMatch | null {
  const search = step.anchor?.search
  if (!search) return null
  const output = doc.query.match({
    select: { type: 'text', pattern: search, mode: 'contains', caseSensitive: true },
    require: 'any',
    limit: 500,
  })
  const candidates = output.items.filter((item) => {
    if (item.matchKind !== 'text') return false
    if (step.anchor?.blockId && !item.blocks.some((block) => block.blockId === step.anchor?.blockId)) return false
    const before = item.snippet.slice(0, item.highlightRange.start)
    const after = item.snippet.slice(item.highlightRange.end)
    if (step.anchor?.contextBefore && !before.endsWith(step.anchor.contextBefore)) return false
    if (step.anchor?.contextAfter && !after.startsWith(step.anchor.contextAfter)) return false
    return true
  })
  const occurrence = Math.max(0, step.anchor?.occurrence ?? 0)
  const match = candidates[occurrence]
  if (!match || match.matchKind !== 'text') {
    throw new Error(candidates.length > 0 ? 'WORD_ANCHOR_OCCURRENCE_NOT_FOUND' : 'WORD_ANCHOR_NOT_FOUND')
  }
  const firstBlock = match.blocks[0]
  return {
    target: match.target,
    ref: match.handle.ref,
    text: search,
    blockId: firstBlock?.blockId,
  }
}

function resolveWordStepRequest(
  doc: RuntimeWordDocumentApi,
  step: WordEditPlanStep,
): { input: unknown; anchorMatch: WordAnchorMatch | null } {
  const anchorMatch = resolveWordAnchorMatch(doc, step)
  const input = isRecord(step.input) ? { ...step.input } : step.input
  if (
    anchorMatch
    && isRecord(input)
    && (
      step.options?.__resolveAnchor === true
      || (
        input.target === undefined
        && input.ref === undefined
        && (
          ['replace', 'delete', 'format.apply', 'comments.create', 'hyperlinks.wrap', 'contentControls.wrap', 'metadata.attach'].includes(step.operationId)
          || step.operationId.startsWith('format.')
        )
      )
    )
  ) {
    input.target = anchorMatch.target
    delete input.ref
  }
  return { input, anchorMatch }
}

async function prepareWordPlanStep(
  step: WordEditPlanStep,
  allowDeferredDependencies = false,
  documentApi?: RuntimeWordDocumentApi,
): Promise<PreparedWordPlanStep> {
  const doc = documentApi ?? getWordDocumentApi()
  if (!doc) throw new Error('WORD_DOCUMENT_API_UNAVAILABLE')
  if (isReadOnlyWordOperation(step.operationId)) throw new Error(`WORD_PLAN_READ_ONLY_OPERATION:${step.operationId}`)
  const capabilities = doc.capabilities()
  const capability = (capabilities.operations as unknown as Record<string, RuntimeWordCapability>)[step.operationId]
  if (!capability?.available) {
    const reasons = capability?.reasons?.join(',') || 'OPERATION_UNAVAILABLE'
    throw new Error(`WORD_OPERATION_UNAVAILABLE:${step.operationId}:${reasons}`)
  }

  const { input: unresolvedInput, anchorMatch } = resolveWordStepRequest(doc, step)
  const apiRevision = doc.info({}).revision
  const input = wordInputWithRevisionGuard(step.operationId, unresolvedInput, apiRevision)
  validateSectionGeometry(doc, step.operationId, input)
  const deferred = allowDeferredDependencies
    && Boolean(step.dependsOn?.length)
    && containsStepReference(input)
  let preview: unknown
  if (step.operationId === 'mutations.apply' && !deferred) {
    const previewCapability = (capabilities.operations as unknown as Record<string, RuntimeWordCapability>)['mutations.preview']
    if (!previewCapability?.available) throw new Error('WORD_MUTATION_PREVIEW_UNAVAILABLE')
    preview = await doc.invoke({
      operationId: 'mutations.preview',
      input: wordInputWithRevisionGuard('mutations.preview', unresolvedInput, apiRevision),
      options: internalWordOptions(step),
    } as never)
    const failure = wordOperationFailure(preview)
    if (failure) throw new Error(`WORD_PLAN_PREVIEW_FAILED:${step.id}:${failure}`)
  } else if (capability.dryRun && !deferred) {
    preview = await doc.invoke({
      operationId: step.operationId,
      input,
      options: {
        ...internalWordOptions(step),
        dryRun: true,
        expectedRevision: apiRevision,
      },
    } as never)
    const failure = wordOperationFailure(preview)
    if (failure) throw new Error(`WORD_PLAN_PREVIEW_FAILED:${step.id}:${failure}`)
  }

  const resolvedTargets = preview ? countResolvedTargets(preview) : 1
  if (resolvedTargets > 1) throw new Error(`WORD_PLAN_MULTI_TARGET_MUST_EXPAND:${step.id}:${resolvedTargets}`)
  const range = findAbsoluteRange(preview)
  return {
    step: { ...step, visual: inferWordVisual(step) },
    range,
    page: step.anchor?.page,
    resolvedTargets,
    text: anchorMatch?.text,
    metadata: {
      preview,
      input,
      beforeText: anchorMatch?.text,
      afterText: replacementTextForStep(step),
      fineGrained: Boolean(range),
      deferred,
    },
  }
}

function eventRange(prepared: PreparedWordPlanStep) {
  if (!prepared.range) return undefined
  return {
    start: { offset: prepared.range.from },
    end: { offset: prepared.range.to },
  }
}

function playbackEventType(
  phase: WordPlaybackState['phase'],
  previousPhase: WordPlaybackState['phase'],
): DocumentEvent['type'] | null {
  switch (phase) {
    case 'validating': return 'plan-prepared'
    case 'running':
      if (previousPhase === 'paused') return 'playback-resumed'
      if (previousPhase === 'validating' || previousPhase === 'idle') return 'playback-started'
      return 'playback-progress'
    case 'paused': return 'playback-paused'
    case 'interrupted': return 'playback-interrupted'
    case 'completed': return 'playback-completed'
    case 'cancelled': return 'run-cancelled'
    default: return null
  }
}

function wordArtifactOperationType(step: WordEditPlanStep): ArtifactOperationType {
  const operation = step.operationId.toLowerCase()
  const visual = inferWordVisual(step)
  if (visual === 'text-insert') return 'insert'
  if (visual === 'text-delete') return 'delete'
  if (visual === 'text-replace') return 'replace'
  if (visual === 'format') return 'format'
  if (operation.includes('comment')) return 'comment'
  if (operation.includes('move')) return 'move'
  if (operation.includes('resize')) return 'resize'
  if (operation.startsWith('create.') || operation.includes('table') || operation.includes('section')) return 'structure'
  return 'metadata'
}

function wordArtifactVisual(step: WordEditPlanStep): ArtifactVisualType {
  switch (inferWordVisual(step)) {
    case 'text-insert': return 'addition'
    case 'text-delete': return 'deletion'
    case 'text-replace': return 'replacement'
    case 'format': return 'format'
    case 'table-cell':
    case 'table-row':
    case 'table-column': return 'range'
    case 'page-region': return 'page-region'
    default: return 'object'
  }
}

function wordStepSummaryText(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value == null) return undefined
  if (typeof value === 'string') return value.slice(0, 500)
  if (Array.isArray(value)) {
    const text = value.map((item) => wordStepSummaryText(item, depth + 1)).filter(Boolean).join(' ')
    return text ? text.slice(0, 500) : undefined
  }
  if (!isRecord(value)) return undefined
  const direct = ['text', 'value', 'replace', 'label', 'title']
    .map((key) => typeof value[key] === 'string' ? value[key] as string : '')
    .filter(Boolean)
    .join(' ')
  if (direct) return direct.slice(0, 500)
  const nested = Object.values(value)
    .map((item) => wordStepSummaryText(item, depth + 1))
    .filter(Boolean)
    .join(' ')
  return nested ? nested.slice(0, 500) : undefined
}

function wordPlanDraftEntries(plan: WordEditPlan): {
  operations: ArtifactOperation[]
  recipes: RendererArtifactRecipeEntry[]
} {
  const entries = plan.steps.map((step) => {
    const executionRef = crypto.randomUUID()
    const visual = wordArtifactVisual(step)
    const beforeText = step.anchor?.search
    const afterText = replacementTextForStep(step) ?? wordStepSummaryText(step.input)
    const operation: ArtifactOperation = {
      id: step.id,
      type: wordArtifactOperationType(step),
      label: step.label?.trim() || step.operationId,
      location: {
        kind: 'word',
        page: step.anchor?.page,
        blockId: step.anchor?.blockId,
        offset: step.anchor?.position?.offset,
        search: step.anchor?.search,
        occurrence: step.anchor?.occurrence,
        region: step.anchor?.region,
      },
      ...(beforeText ? { before: { text: beforeText } } : {}),
      ...(afterText ? { after: { text: afterText } } : {}),
      dependsOn: step.dependsOn,
      visual,
      executionRef,
    }
    return {
      operation,
      recipe: { executionRef, recipe: { kind: 'word-step' as const, step } },
    }
  })
  return {
    operations: entries.map((entry) => entry.operation),
    recipes: entries.map((entry) => entry.recipe),
  }
}

async function applyWordEditPlan(plan: WordEditPlan, command: AgentEditCommand): Promise<DocumentOperationResult> {
  let validated: WordEditPlan
  try {
    validated = validateWordEditPlan(plan)
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
  const validation = await validateWordPlanAgainstDocument(validated)
  if (!validation.success) return validation
  const { operations, recipes } = wordPlanDraftEntries(validated)
  return openBuiltInArtifactDraft('word', operations, recipes, command)
}

/** Retained only as the isolated replay implementation reference; live commands no longer call it. */
async function applyWordEditPlanLiveLegacy(plan: WordEditPlan, command: AgentEditCommand): Promise<DocumentOperationResult> {
  const doc = getWordDocumentApi()
  if (!doc) return { success: false, error: 'WORD_DOCUMENT_API_UNAVAILABLE' }
  const currentApiRevision = doc.info({}).revision
  if (plan.documentApiRevision && plan.documentApiRevision !== currentApiRevision) {
    return {
      success: false,
      error: `WORD_DOCUMENT_API_REVISION_MISMATCH:${plan.documentApiRevision}:${currentApiRevision}`,
    }
  }

  const committedAnchorCounts = new Map<string, number>()
  const committedStepResults = new Map<string, unknown>()
  let previousPlaybackPhase: WordPlaybackState['phase'] = 'idle'
  let controller: WordAgentPlaybackController
  controller = new WordAgentPlaybackController({
    getRevision: () => state.revision,
    prepare: async (step) => prepareWordPlanStep(step, true),
    commit: async (initialPrepared) => {
      const originalStep = initialPrepared.step
      const anchorKey = wordAnchorKey(originalStep)
      const priorCount = anchorKey ? committedAnchorCounts.get(anchorKey) ?? 0 : 0
      const anchoredStep = priorCount > 0 && originalStep.anchor
        ? {
            ...originalStep,
            anchor: {
              ...originalStep.anchor,
              occurrence: Math.max(0, (originalStep.anchor.occurrence ?? 0) - priorCount),
            },
          }
        : originalStep
      const refreshedStep = {
        ...anchoredStep,
        input: resolveStepReferences(anchoredStep.input, committedStepResults),
      }

      let prepared: PreparedWordPlanStep
      try {
        prepared = await prepareWordPlanStep(refreshedStep)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const conflict = /ANCHOR|TARGET|REVISION|MATCH/.test(message)
        emitDocumentEvent(conflict ? 'conflict' : 'operation-rejected', command, {
          planId: plan.planId,
          stepId: originalStep.id,
          action: originalStep.operationId,
          visual: inferWordVisual(originalStep),
          message,
        })
        return { success: false, skipped: conflict, conflict, error: message }
      }

      const unresolvedInput = isRecord(prepared.metadata?.input)
        ? prepared.metadata?.input
        : resolveWordStepRequest(doc, refreshedStep).input
      const apiRevision = doc.info({}).revision
      const input = wordInputWithRevisionGuard(refreshedStep.operationId, unresolvedInput, apiRevision)
      const options = {
        ...internalWordOptions(refreshedStep),
        expectedRevision: apiRevision,
      }
      const result = await withAgentMutation(() => doc.invoke({
        operationId: refreshedStep.operationId,
        input,
        options,
      } as never))
      const failure = wordOperationFailure(result)
      if (failure) {
        const conflict = wordOperationConflict(result)
        emitDocumentEvent(conflict ? 'conflict' : 'operation-rejected', command, {
          planId: plan.planId,
          stepId: originalStep.id,
          action: originalStep.operationId,
          visual: inferWordVisual(originalStep),
          range: eventRange(prepared),
          message: failure,
        })
        return { success: false, skipped: conflict, conflict, error: failure, result }
      }

      state.revision += 1
      committedStepResults.set(originalStep.id, result)
      if (anchorKey && stepConsumesWordAnchor(originalStep)) {
        committedAnchorCounts.set(anchorKey, priorCount + 1)
      }
      emitDocumentEvent('operation-applied', command, {
        planId: plan.planId,
        planVersion: plan.version ?? 1,
        stepId: originalStep.id,
        action: originalStep.operationId,
        visual: inferWordVisual(originalStep),
        range: eventRange(prepared),
        beforeText: String(prepared.metadata?.beforeText ?? ''),
        afterText: String(prepared.metadata?.afterText ?? ''),
        revision: state.revision,
        phase: 'applied',
      })
      emitDocumentEvent('revision-changed', command, {
        planId: plan.planId,
        stepId: originalStep.id,
        revision: state.revision,
      })
      return { success: true, changed: true, result }
    },
    onVisual: async (phase, prepared, playback) => {
      const detail = {
        planId: plan.planId,
        planVersion: plan.version ?? 1,
        stepId: prepared.step.id,
        action: prepared.step.operationId,
        visual: inferWordVisual(prepared.step),
        range: eventRange(prepared),
        position: prepared.range ? { offset: prepared.range.from } : prepared.step.anchor?.position,
        page: prepared.page,
        blockId: prepared.step.anchor?.blockId,
        beforeText: String(prepared.metadata?.beforeText ?? prepared.text ?? ''),
        afterText: String(prepared.metadata?.afterText ?? replacementTextForStep(prepared.step) ?? ''),
        playback,
        phase,
      } satisfies Partial<DocumentEvent>
      if (phase === 'locate') emitDocumentEvent('cursor-moved', command, detail)
      if (phase === 'before') emitDocumentEvent('operation-prepared', command, detail)
      if (phase === 'clear') emitDocumentEvent('playback-progress', command, detail)
    },
    onState: (playback) => {
      const eventType = playbackEventType(playback.phase, previousPlaybackPhase)
      previousPlaybackPhase = playback.phase
      if (!eventType) return
      emitDocumentEvent(eventType, command, {
        planId: plan.planId,
        planVersion: plan.version ?? 1,
        stepId: playback.currentStepId,
        action: playback.currentOperationId,
        completed: playback.completed,
        total: playback.total,
        playback,
        message: playback.message,
        phase: playback.phase,
      })
    },
  })

  activeWordPlayback = { controller, command }
  emitDocumentEvent('plan-prepared', command, {
    planId: plan.planId,
    planVersion: plan.version ?? 1,
    completed: 0,
    total: plan.steps.length,
  })
  try {
    const result = await controller.play(plan, {
      runId: command.runId,
      agentId: command.agentId,
      agentName: command.agentName,
    })
    return {
      ...result,
      success: result.success,
      changed: result.appliedStepIds.length > 0,
      revisionHandled: true,
      revision: state.revision,
      documentApiRevision: doc.info({}).revision,
    }
  } finally {
    if (activeWordPlayback?.controller === controller) activeWordPlayback = null
  }
}

function textTargetToSelectionTarget(target: unknown): unknown {
  if (!isRecord(target) || !Array.isArray(target.segments) || target.segments.length === 0) return null
  const first = target.segments[0]
  const last = target.segments[target.segments.length - 1]
  if (!isRecord(first) || !isRecord(last) || !isRecord(first.range) || !isRecord(last.range)) return null
  return {
    kind: 'selection',
    start: { kind: 'text', blockId: first.blockId, offset: first.range.start, story: target.story },
    end: { kind: 'text', blockId: last.blockId, offset: last.range.end, story: target.story },
    story: target.story,
  }
}

function documentEdgeTarget(doc: RuntimeWordDocumentApi, edge: 'start' | 'end'): unknown {
  return doc.ranges.resolve({
    start: { kind: 'document', edge },
    end: { kind: 'document', edge },
  }).target
}

async function executeLegacyWordInsert(command: AgentEditCommand): Promise<unknown> {
  const text = command.text ?? ''
  const appendParagraph = command.action === 'appendParagraph'
  if (state.kind === 'text') return insertWordText(text, appendParagraph)
  const doc = getWordDocumentApi()
  if (!doc) return { success: false, error: 'WORD_DOCUMENT_API_UNAVAILABLE' }

  let operationId = 'insert'
  let input: Record<string, unknown>
  let anchor: WordEditPlanStep['anchor']
  if (appendParagraph) {
    operationId = 'create.paragraph'
    input = { at: { kind: 'documentEnd' }, text }
    anchor = { region: 'page' }
  } else if (command.position === 'start') {
    const target = documentEdgeTarget(doc, 'start')
    input = { target, value: text, type: 'text' }
    anchor = { target, position: { offset: 0 } }
  } else if (command.position === 'end') {
    input = { value: text, type: 'text' }
    anchor = { region: 'page' }
  } else {
    const selection = doc.selection.current({ includeText: true })
    const target = textTargetToSelectionTarget(selection.target)
    input = target ? { target, value: text, type: 'text' } : { value: text, type: 'text' }
    anchor = target ? { target } : { region: 'page' }
  }

  return applyWordEditPlan({
    planId: `legacy:${command.operationId ?? crypto.randomUUID()}`,
    documentRevision: state.revision,
    documentApiRevision: doc.info({}).revision,
    version: 1,
    steps: [{
      id: command.operationId ?? crypto.randomUUID(),
      operationId,
      input,
      anchor,
      visual: 'text-insert',
      label: appendParagraph ? 'append-paragraph' : 'insert-text',
    }],
  }, command)
}

async function executeLegacyWordReplace(command: AgentEditCommand): Promise<unknown> {
  const search = command.search ?? ''
  const replace = command.replace ?? ''
  if (!search) return { success: false, error: 'Empty search' }
  if (state.kind === 'text') return replaceWordText(search, replace, command.all)
  const doc = getWordDocumentApi()
  if (!doc) return { success: false, error: 'WORD_DOCUMENT_API_UNAVAILABLE' }

  const matches = doc.query.match({
    select: { type: 'text', pattern: search, mode: 'contains', caseSensitive: true },
    require: 'any',
    limit: command.all ? 500 : 1,
  }).items.filter((item) => item.matchKind === 'text')
  if (matches.length === 0) {
    return { success: true, changed: false, replaced: 0, revisionHandled: true }
  }
  const selected = command.all ? matches : matches.slice(0, 1)
  const occurrenceByBlock = new Map<string, number>()
  const steps: WordEditPlanStep[] = selected.map((match, index) => {
    if (match.matchKind !== 'text') throw new Error('WORD_TEXT_MATCH_REQUIRED')
    const blockId = match.blocks[0].blockId
    const occurrence = occurrenceByBlock.get(blockId) ?? 0
    occurrenceByBlock.set(blockId, occurrence + 1)
    return {
      id: `${command.operationId ?? 'replace'}:${index + 1}`,
      operationId: 'replace',
      input: { target: match.target, text: replace },
      options: { __resolveAnchor: true },
      anchor: { search, blockId, occurrence },
      visual: replace ? 'text-replace' : 'text-delete',
      label: replace ? 'replace-text' : 'delete-text',
    }
  })
  const result = await applyWordEditPlan({
    planId: `legacy:${command.operationId ?? crypto.randomUUID()}`,
    documentRevision: state.revision,
    documentApiRevision: doc.info({}).revision,
    version: 1,
    steps,
  }, command) as DocumentOperationResult
  return { ...result, replaced: result.success ? steps.length : 0 }
}

function inspectWordDocument(): DocumentOperationResult {
  const doc = getWordDocumentApi()
  if (!doc) return { success: false, error: 'WORD_DOCUMENT_API_UNAVAILABLE' }
  const info = doc.info({})
  const extracted = doc.extract({})
  const selection = doc.selection.current({ includeText: true })
  const capabilities = doc.capabilities()
  return {
    success: true,
    kind: 'word',
    revision: state.revision,
    documentApiRevision: info.revision,
    info,
    blocks: extracted.blocks,
    comments: extracted.comments,
    trackedChanges: extracted.trackedChanges,
    selection,
    focusContext: latestUserActivity,
    capabilitySummary: {
      available: Object.values(capabilities.operations).filter((entry) => entry.available).length,
      total: Object.keys(capabilities.operations).length,
      planEngine: capabilities.planEngine,
    },
  }
}

function operationCategory(operationId: string): string {
  const prefix = operationId.includes('.') ? operationId.split('.')[0] : 'document'
  if (['insert', 'replace', 'delete', 'formatRange'].includes(operationId)) return 'text'
  return prefix
}

function wordOperationInputHint(operationId: string): string | undefined {
  if (operationId === 'insert') return '{value:string,type?:"text"|"markdown"|"html",target?:SelectionTarget}'
  if (operationId === 'replace') return '{text:string,target?:SelectionTarget}; anchor.search may supply target'
  if (operationId === 'delete') return '{target?:SelectionTarget,behavior?:"selection"|"exact"}; anchor.search may supply target'
  if (operationId === 'format.apply') return '{target?:SelectionTarget,inline?:object}; anchor.search may supply target'
  if (operationId.startsWith('format.')) return '{target?:SelectionTarget,value?:unknown}; anchor.search may supply target'
  if (operationId === 'create.paragraph') return '{text?:string,at?:{kind:"documentStart"|"documentEnd"}|{kind:"before"|"after",target:BlockAddress}}'
  if (operationId === 'create.heading') return '{level:1..6,text?:string,at?:ParagraphCreateLocation}'
  if (operationId.startsWith('tables.')) return 'Use tableId/cell/row/column addresses returned by inspect_word_document or a prior table query.'
  if (operationId.startsWith('images.')) return 'Use the image address returned by images.list/images.get.'
  if (operationId === 'sections.setPageMargins') return '{target:SectionAddress,top?,right?,bottom?,left?,gutter?}; dimensions are inches and opposing margins must fit the page.'
  if (operationId === 'sections.setPageSetup') return '{target:SectionAddress,width?,height?,orientation?,paperSize?}; width and height are inches.'
  if (operationId.startsWith('sections.')) return 'Use the section address returned by sections.list/sections.get.'
  if (operationId.startsWith('headerFooters.')) return 'Use section/part references returned by headerFooters.list/resolve.'
  if (operationId.startsWith('comments.')) return 'Use a text target from inspect/query for create, or an entityId for later operations.'
  return undefined
}

function searchWordOperations(query: string, requestedLimit?: number): DocumentOperationResult {
  const doc = getWordDocumentApi()
  if (!doc) return { success: false, error: 'WORD_DOCUMENT_API_UNAVAILABLE' }
  const normalized = query.trim().toLowerCase()
  const limit = Math.min(100, Math.max(1, Math.floor(requestedLimit ?? 30)))
  const capabilities = doc.capabilities()
  const operations = Object.entries(capabilities.operations as unknown as Record<string, RuntimeWordCapability>)
    .filter(([operationId]) => !normalized || operationId.toLowerCase().includes(normalized))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, limit)
    .map(([operationId, capability]) => ({
      operationId,
      category: operationCategory(operationId),
      mutation: !isReadOnlyWordOperation(operationId),
      inputHint: wordOperationInputHint(operationId),
      ...capability,
    }))
  return {
    success: true,
    query,
    count: operations.length,
    operations,
    planEngine: capabilities.planEngine,
  }
}

async function validateWordPlanAgainstDocument(plan: WordEditPlan): Promise<DocumentOperationResult> {
  const doc = getWordDocumentApi()
  if (!doc) return { success: false, error: 'WORD_DOCUMENT_API_UNAVAILABLE' }
  try {
    plan = validateWordEditPlan(plan)
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
  if (plan.documentRevision !== state.revision) {
    return {
      success: false,
      error: `WORD_PLAN_REVISION_MISMATCH:${plan.documentRevision}:${state.revision}`,
    }
  }
  const apiRevision = doc.info({}).revision
  if (plan.documentApiRevision && plan.documentApiRevision !== apiRevision) {
    return {
      success: false,
      error: `WORD_DOCUMENT_API_REVISION_MISMATCH:${plan.documentApiRevision}:${apiRevision}`,
    }
  }
  try {
    const prepared = await Promise.all(plan.steps.map((step) => prepareWordPlanStep(step, true)))
    const resolvedTargets = prepared.reduce((total, step) => total + (step.resolvedTargets ?? 1), 0)
    if (prepared.some((step) => (step.resolvedTargets ?? 1) > 500)) {
      return { success: false, error: 'WORD_PLAN_TARGET_LIMIT' }
    }
    return {
      success: true,
      planId: plan.planId,
      planVersion: plan.version ?? 1,
      documentRevision: state.revision,
      documentApiRevision: apiRevision,
      steps: prepared.length,
      resolvedTargets,
      chunks: Math.max(Math.ceil(prepared.length / 200), Math.ceil(resolvedTargets / 500)),
      operations: prepared.map((step) => ({
        id: step.step.id,
        operationId: step.step.operationId,
        visual: step.step.visual,
        fineGrained: Boolean(step.range),
      })),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
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
    const arrayBuffer = await readFileBuffer(state.filePath)
    const result = await mammoth.extractRawText({ arrayBuffer })
    const live = (state.superdoc?.activeEditor as any)?.state?.doc?.textContent
    return { success: true, content: live || result.value }
  }
  if (state.kind === 'excel' && state.workbook) {
    return readExcelWorkbookSummary(state.workbook)
  }
  if (state.kind === 'pdf') return { success: true, content: state.pdfText }
  if (state.kind === 'presentation') {
    return { success: true, kind: 'presentation', documentId: state.filePath, revision: state.revision }
  }
  if (state.kind === 'text') return { success: true, content: state.plainText }
  return { success: false, error: 'No document open' }
}

function artifactKindForState(): ArtifactKind | null {
  if (state.kind === 'text' && state.codeEditor) return 'code'
  if (state.kind === 'word' || state.kind === 'excel' || state.kind === 'pdf') return state.kind
  if (state.kind === 'presentation') return 'presentation'
  return null
}

async function inspectDocumentArtifact(): Promise<unknown> {
  const kind = artifactKindForState()
  if (!kind || !state.filePath) return { success: false, error: 'NO_DOCUMENT_ARTIFACT_OPEN' }
  const producers = await window.api.artifact.getProducerCapabilities(kind)
  return {
    success: true,
    kind,
    documentId: state.filePath,
    sourceRevision: state.revision,
    producerAdapters: producers,
    reviewProtocolVersion: 1,
    candidateTransport: 'opaque-handle',
    sourceMutation: 'forbidden-before-review-save',
  }
}

async function searchDocumentOperations(query: string, limit = 30): Promise<unknown> {
  const kind = artifactKindForState()
  if (!kind) return { success: false, error: 'NO_DOCUMENT_ARTIFACT_OPEN' }
  const producers = await window.api.artifact.getProducerCapabilities(kind)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const operations = producers.flatMap(({ producer, capabilities }) => capabilities.operationTypes
    .filter((type) => !normalizedQuery || type.includes(normalizedQuery) || normalizedQuery.includes(type))
    .map((type) => ({
      producer,
      type,
      canRebuild: capabilities.canRebuild,
      canRebase: capabilities.canRebase,
      locationKind: kind,
      requiresExecutionRef: true,
    })))
    .slice(0, Math.max(1, Math.min(100, limit)))
  return { success: true, kind, count: operations.length, operations }
}

function copyArtifactBuffer(data: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data.slice(0)
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy.buffer
}

async function buildWordArtifactCandidate(
  sourceData: Uint8Array | ArrayBuffer,
  sourceName: string,
  operations: ArtifactOperation[],
  recipes: RendererArtifactRecipeEntry[],
): Promise<ArrayBuffer> {
  const recipeByRef = new Map(recipes.map((entry) => [entry.executionRef, entry.recipe]))
  const steps = orderWordPlanSteps(operations.map((operation) => {
    const recipe = recipeByRef.get(operation.executionRef)
    if (recipe?.kind !== 'word-step') throw new Error(`ARTIFACT_WORD_RECIPE_MISSING:${operation.id}`)
    return recipe.step
  }))
  const container = document.createElement('div')
  container.dataset.artifactProducer = 'word'
  container.setAttribute('aria-hidden', 'true')
  Object.assign(container.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: '900px',
    height: '1100px',
    opacity: '0',
    pointerEvents: 'none',
    overflow: 'hidden',
  })
  document.body.appendChild(container)

  let instance: SuperDoc | null = null
  try {
    instance = await new Promise<SuperDoc>((resolve, reject) => {
      let settled = false
      const timer = window.setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error('ARTIFACT_WORD_PRODUCER_READY_TIMEOUT'))
      }, 45_000)
      try {
        new SuperDoc({
          selector: container,
          documentMode: 'editing',
          document: new File(
            [copyArtifactBuffer(sourceData)],
            sourceName,
            { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
          ),
          onReady: ({ superdoc }) => {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            resolve(superdoc)
          },
          onContentError: ({ error }) => {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            reject(error instanceof Error ? error : new Error(String(error)))
          },
        })
      } catch (error) {
        settled = true
        window.clearTimeout(timer)
        reject(error)
      }
    })
    const doc = instance.activeEditor?.doc as RuntimeWordDocumentApi | undefined
    if (!doc) throw new Error('ARTIFACT_WORD_DOCUMENT_API_UNAVAILABLE')

    const anchorCounts = new Map<string, number>()
    const stepResults = new Map<string, unknown>()
    for (const originalStep of steps) {
      const anchorKey = wordAnchorKey(originalStep)
      const priorCount = anchorKey ? anchorCounts.get(anchorKey) ?? 0 : 0
      const anchoredStep = priorCount > 0 && originalStep.anchor
        ? {
            ...originalStep,
            anchor: {
              ...originalStep.anchor,
              occurrence: Math.max(0, (originalStep.anchor.occurrence ?? 0) - priorCount),
            },
          }
        : originalStep
      const step = {
        ...anchoredStep,
        input: resolveStepReferences(anchoredStep.input, stepResults),
      }
      const prepared = await prepareWordPlanStep(step, false, doc)
      const unresolvedInput = isRecord(prepared.metadata?.input)
        ? prepared.metadata.input
        : resolveWordStepRequest(doc, step).input
      const revision = doc.info({}).revision
      const result = await doc.invoke({
        operationId: step.operationId,
        input: wordInputWithRevisionGuard(step.operationId, unresolvedInput, revision),
        options: { ...internalWordOptions(step), expectedRevision: revision },
      } as never)
      const failure = wordOperationFailure(result)
      if (failure) throw new Error(`ARTIFACT_WORD_REPLAY_FAILED:${step.id}:${failure}`)
      stepResults.set(step.id, result)
      if (anchorKey && stepConsumesWordAnchor(originalStep)) anchorCounts.set(anchorKey, priorCount + 1)
    }
    const blob = await instance.export({ triggerDownload: false })
    return blob.arrayBuffer()
  } finally {
    instance?.destroy()
    container.remove()
  }
}

async function buildExcelArtifactCandidate(
  sourceData: Uint8Array | ArrayBuffer,
  operations: ArtifactOperation[],
  recipes: RendererArtifactRecipeEntry[],
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(copyArtifactBuffer(sourceData) as never)
  const recipeByRef = new Map(recipes.map((entry) => [entry.executionRef, entry.recipe]))
  for (const operation of operations) {
    const recipe = recipeByRef.get(operation.executionRef)
    if (!recipe || (recipe.kind !== 'excel-cell' && recipe.kind !== 'excel-formula')) {
      throw new Error(`ARTIFACT_EXCEL_RECIPE_MISSING:${operation.id}`)
    }
    const worksheet = recipe.sheet ? workbook.getWorksheet(recipe.sheet) : workbook.worksheets[0]
    if (!worksheet) throw new Error(`ARTIFACT_EXCEL_SHEET_NOT_FOUND:${recipe.sheet ?? ''}`)
    const target = parseExcelA1Range(recipe.target)
    if (!target) throw new Error(`ARTIFACT_EXCEL_RANGE_INVALID:${recipe.target}`)
    if (recipe.kind === 'excel-formula') {
      const formula = recipe.formula.trim().replace(/^=/, '')
      if (target.cellCount === 1) worksheet.getCell(target.normalized).value = { formula }
      else worksheet.fillFormula(target.normalized, formula)
    } else {
      for (let row = target.start.row; row <= target.end.row; row += 1) {
        for (let column = target.start.column; column <= target.end.column; column += 1) {
          worksheet.getCell(row + 1, column + 1).value = recipe.value
        }
      }
    }
  }
  workbook.calcProperties.fullCalcOnLoad = true
  const output = await workbook.xlsx.writeBuffer()
  return copyArtifactBuffer(output as Uint8Array | ArrayBuffer)
}

async function buildCodeArtifactCandidate(
  sourceData: Uint8Array | ArrayBuffer,
  operations: ArtifactOperation[],
  recipes: RendererArtifactRecipeEntry[],
): Promise<ArrayBuffer> {
  const bytes = sourceData instanceof ArrayBuffer
    ? new Uint8Array(sourceData)
    : new Uint8Array(sourceData.buffer, sourceData.byteOffset, sourceData.byteLength)
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  let value = new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? bytes.subarray(3) : bytes)
  const recipeByRef = new Map(recipes.map((entry) => [entry.executionRef, entry.recipe]))
  const edits = operations.map((operation) => {
    const recipe = recipeByRef.get(operation.executionRef)
    if (recipe?.kind !== 'code-edit') throw new Error(`ARTIFACT_CODE_RECIPE_MISSING:${operation.id}`)
    return { operation, recipe }
  }).sort((left, right) => left.recipe.startOffset - right.recipe.startOffset || left.operation.id.localeCompare(right.operation.id))
  for (let index = 0; index < edits.length; index += 1) {
    const { operation, recipe } = edits[index]
    if (recipe.endOffset > value.length || recipe.startOffset < 0 || recipe.endOffset < recipe.startOffset) {
      throw new Error(`ARTIFACT_CODE_RECIPE_RANGE_INVALID:${operation.id}`)
    }
    if (index > 0 && recipe.startOffset < edits[index - 1].recipe.endOffset) {
      throw new Error(`ARTIFACT_CODE_RANGE_OVERLAP:${operation.id}`)
    }
    const beforeText = value.slice(recipe.startOffset, recipe.endOffset)
    if (beforeText !== recipe.beforeText || await sha256CodeText(beforeText) !== recipe.beforeDigest) {
      throw new Error(`ARTIFACT_CODE_RECIPE_SOURCE_MISMATCH:${operation.id}`)
    }
    if (await sha256CodeText(recipe.afterText) !== recipe.afterDigest) {
      throw new Error(`ARTIFACT_CODE_RECIPE_DIGEST_MISMATCH:${operation.id}`)
    }
  }
  for (const { recipe } of [...edits].reverse()) {
    value = value.slice(0, recipe.startOffset) + recipe.afterText + value.slice(recipe.endOffset)
  }
  const encoded = new TextEncoder().encode(value)
  const output = hasBom ? new Uint8Array(encoded.length + 3) : encoded
  if (hasBom) {
    output.set([0xef, 0xbb, 0xbf])
    output.set(encoded, 3)
  }
  return copyArtifactBuffer(output)
}

export async function buildRendererArtifactCandidate(
  request: RendererArtifactRebuildRequest,
): Promise<ArrayBuffer> {
  if (request.kind === 'word') {
    return buildWordArtifactCandidate(request.sourceData, request.sourceName, request.operations, request.recipes)
  }
  if (request.kind === 'excel') {
    return buildExcelArtifactCandidate(request.sourceData, request.operations, request.recipes)
  }
  return buildCodeArtifactCandidate(request.sourceData, request.operations, request.recipes)
}

async function openBuiltInArtifactDraft(
  kind: Extract<ArtifactKind, 'word' | 'excel' | 'code'>,
  operations: ArtifactOperation[],
  recipes: RendererArtifactRecipeEntry[],
  command: AgentEditCommand,
): Promise<DocumentOperationResult> {
  if (builtInArtifactDraftFactoryForTesting) {
    return builtInArtifactDraftFactoryForTesting({ kind, operations, recipes, command })
  }
  if (!state.filePath) return { success: false, error: 'NO_DOCUMENT_ARTIFACT_OPEN' }
  const textMetadata = kind === 'code' ? state.codeEditor?.getTextMetadata() : undefined
  if (kind === 'code' && !textMetadata) return { success: false, error: 'CODE_EDITOR_NOT_READY' }
  const sourceData = kind === 'code'
    ? encodeCodeSnapshot(state.codeEditor!.getValue(), textMetadata!)
    : await readFileBuffer(state.filePath)
  const sourceSnapshot = kind === 'code'
    ? await window.api.artifact.stageSourceSnapshot({
        sourcePath: state.filePath,
        data: sourceData,
        sourceRevision: state.revision,
        metadata: textMetadata!,
      })
    : null
  const candidateData = await buildRendererArtifactCandidate({
    requestId: crypto.randomUUID(),
    draftId: 'initial',
    kind,
    sourceData,
    sourceName: state.filePath.split(/[/\\]/).pop() || (kind === 'word' ? 'document.docx' : kind === 'excel' ? 'workbook.xlsx' : 'source.txt'),
    operations,
    recipes,
  })
  const candidate = await window.api.artifact.stageProducedCandidate({
    data: candidateData,
    kind,
    recipes,
  })
  const result = await window.api.artifact.createDraft({
    sourcePath: state.filePath,
    documentId: state.filePath,
    kind,
    candidateHandle: candidate.candidateHandle,
    sourceRevision: state.revision,
    producer: RENDERER_ARTIFACT_PRODUCER,
    operations,
    ...(sourceSnapshot ? { sourceSnapshotHandle: sourceSnapshot.sourceSnapshotHandle } : {}),
    ...(textMetadata ? { textMetadata } : {}),
    runId: command.runId,
    agentId: command.agentId,
    agentName: command.agentName,
  })
  return {
    success: true,
    changed: false,
    revisionHandled: true,
    draft: true,
    draftId: result.manifest.draftId,
    operationCount: operations.length,
    reviewState: result.reviewState,
  }
}

async function createDocumentDraft(command: AgentEditCommand): Promise<unknown> {
  const kind = artifactKindForState()
  if (!kind || !state.filePath) return { success: false, error: 'NO_DOCUMENT_ARTIFACT_OPEN' }
  if (!command.artifactDraft) return { success: false, error: 'ARTIFACT_DRAFT_REQUEST_REQUIRED' }
  if (command.artifactDraft.kind !== kind) return { success: false, error: 'ARTIFACT_DRAFT_KIND_MISMATCH' }
  if (command.artifactDraft.sourceRevision !== state.revision) {
    return {
      success: false,
      error: 'ARTIFACT_SOURCE_REVISION_CONFLICT',
      expectedRevision: state.revision,
      receivedRevision: command.artifactDraft.sourceRevision,
    }
  }
  try {
    const result = await window.api.artifact.createDraft({
      ...command.artifactDraft,
      sourcePath: state.filePath,
      documentId: state.filePath,
      runId: command.runId,
      agentId: command.agentId,
      agentName: command.agentName,
    })
    return {
      success: true,
      draftId: result.manifest.draftId,
      operationCount: result.manifest.operations.length,
      reviewState: result.reviewState,
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function normalizedRendererPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  return window.api.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
}

function rendererPathInside(root: string, target: string): boolean {
  const normalizedRoot = normalizedRendererPath(root)
  const normalizedTarget = normalizedRendererPath(target)
  return normalizedTarget.startsWith(`${normalizedRoot}/`)
}

function decodeCodeSnapshot(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  return new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? bytes.subarray(3) : bytes)
}

async function inspectCodeWorkspace(): Promise<unknown> {
  const workspaceRoot = useFileStore.getState().currentDir
  if (!workspaceRoot) return { success: false, error: 'CODE_WORKSPACE_NOT_OPEN' }
  const activeSnapshot = state.codeEditor && state.filePath && rendererPathInside(workspaceRoot, state.filePath)
    ? {
        sourcePath: state.filePath,
        data: encodeCodeSnapshot(state.codeEditor.getValue(), state.codeEditor.getTextMetadata()),
        metadata: state.codeEditor.getTextMetadata(),
        revision: state.revision,
      }
    : undefined
  try {
    const result = await window.api.codeArtifact.inspectWorkspace({ workspaceRoot, activeSnapshot })
    return {
      success: true,
      workspaceId: result.workspaceId,
      artifacts: result.artifacts,
      truncated: result.truncated,
      pathPolicy: 'opaque-handles-and-relative-paths-only',
      excludedExtensions: ['.md', '.txt', '.log'],
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function readCodeArtifact(command: AgentEditCommand): Promise<unknown> {
  if (!command.artifactId) return { success: false, error: 'CODE_ARTIFACT_HANDLE_REQUIRED' }
  const workspaceRoot = useFileStore.getState().currentDir
  if (!workspaceRoot) return { success: false, error: 'CODE_WORKSPACE_NOT_OPEN' }
  try {
    const result = await window.api.codeArtifact.read({
      artifactId: command.artifactId,
      workspaceRoot,
      ...(command.startOffset !== undefined ? { startOffset: command.startOffset } : {}),
      ...(command.endOffset !== undefined ? { endOffset: command.endOffset } : {}),
    })
    return { success: true, ...result }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function assertCodePlanGraph(request: CodeDraftCreateRequest): {
  ownerByOperationId: Map<string, string>
  orderedArtifactIds: string[]
  fileDependencies: Map<string, Set<string>>
} {
  if (request.protocolVersion !== 1 || !request.planId?.trim()) throw new Error('CODE_DRAFT_PROTOCOL_INVALID')
  if (!Array.isArray(request.files) || request.files.length === 0 || request.files.length > 100) {
    throw new Error('CODE_DRAFT_FILE_COUNT_INVALID')
  }
  const fileById = new Map<string, (typeof request.files)[number]>()
  const ownerByOperationId = new Map<string, string>()
  const atomicGroupOwners = new Map<string, string>()
  for (const file of request.files) {
    if (!file.artifactId?.trim() || fileById.has(file.artifactId)) throw new Error('CODE_DRAFT_ARTIFACT_DUPLICATE')
    if (!Number.isInteger(file.baseRevision) || file.baseRevision < 0 || !/^[a-f0-9]{64}$/i.test(file.baseHash)) {
      throw new Error(`CODE_DRAFT_BASE_INVALID:${file.artifactId}`)
    }
    if (!Array.isArray(file.edits) || file.edits.length === 0 || file.edits.length > 500) {
      throw new Error(`CODE_DRAFT_EDIT_COUNT_INVALID:${file.artifactId}`)
    }
    fileById.set(file.artifactId, file)
    for (const edit of file.edits) {
      if (!edit.id?.trim() || ownerByOperationId.has(edit.id)) throw new Error(`CODE_DRAFT_OPERATION_ID_DUPLICATE:${edit.id}`)
      if (typeof edit.label !== 'string' || !edit.label.trim()
        || typeof edit.beforeText !== 'string' || typeof edit.afterText !== 'string') {
        throw new Error(`CODE_DRAFT_EDIT_INVALID:${edit.id}`)
      }
      ownerByOperationId.set(edit.id, file.artifactId)
      if (edit.atomicGroupId) {
        const owner = atomicGroupOwners.get(edit.atomicGroupId)
        if (owner && owner !== file.artifactId) throw new Error(`CODE_DRAFT_ATOMIC_GROUP_CROSSES_FILES:${edit.atomicGroupId}`)
        atomicGroupOwners.set(edit.atomicGroupId, file.artifactId)
      }
    }
  }

  const dependenciesByOperation = new Map<string, string[]>()
  for (const file of request.files) {
    for (const edit of file.edits) {
      const dependencies = edit.dependsOn ?? []
      if (new Set(dependencies).size !== dependencies.length || dependencies.includes(edit.id)) {
        throw new Error(`CODE_DRAFT_DEPENDENCY_INVALID:${edit.id}`)
      }
      for (const dependency of dependencies) {
        if (!ownerByOperationId.has(dependency)) throw new Error(`CODE_DRAFT_DEPENDENCY_UNKNOWN:${edit.id}:${dependency}`)
      }
      dependenciesByOperation.set(edit.id, dependencies)
    }
  }
  const visitState = new Map<string, 0 | 1 | 2>()
  const visit = (id: string) => {
    const status = visitState.get(id) ?? 0
    if (status === 1) throw new Error(`CODE_DRAFT_DEPENDENCY_CYCLE:${id}`)
    if (status === 2) return
    visitState.set(id, 1)
    for (const dependency of dependenciesByOperation.get(id) ?? []) visit(dependency)
    visitState.set(id, 2)
  }
  for (const id of ownerByOperationId.keys()) visit(id)

  const fileDependencies = new Map(request.files.map((file) => [file.artifactId, new Set<string>()]))
  for (const [operationId, dependencies] of dependenciesByOperation) {
    const owner = ownerByOperationId.get(operationId)!
    for (const dependency of dependencies) {
      const dependencyOwner = ownerByOperationId.get(dependency)!
      if (dependencyOwner !== owner) fileDependencies.get(owner)!.add(dependencyOwner)
    }
  }
  const orderedArtifactIds: string[] = []
  const remaining = new Set(request.files.map(({ artifactId }) => artifactId))
  while (remaining.size > 0) {
    const ready = request.files
      .map(({ artifactId }) => artifactId)
      .filter((artifactId) => remaining.has(artifactId)
        && [...(fileDependencies.get(artifactId) ?? [])].every((dependency) => !remaining.has(dependency)))
    if (ready.length === 0) throw new Error('CODE_DRAFT_FILE_DEPENDENCY_CYCLE')
    for (const artifactId of ready) {
      remaining.delete(artifactId)
      orderedArtifactIds.push(artifactId)
    }
  }
  return { ownerByOperationId, orderedArtifactIds, fileDependencies }
}

async function createCodeDraft(command: AgentEditCommand): Promise<unknown> {
  if (!command.codeDraft) return { success: false, error: 'CODE_DRAFT_REQUEST_REQUIRED' }
  const workspaceRoot = useFileStore.getState().currentDir
  if (!workspaceRoot) return { success: false, error: 'CODE_WORKSPACE_NOT_OPEN' }
  const createdDraftIds: string[] = []
  const stagedCandidateHandles: string[] = []
  const stagedSourceSnapshotHandles: string[] = []
  try {
    const graph = assertCodePlanGraph(command.codeDraft)
    const plansByArtifact = new Map(command.codeDraft.files.map((file) => [file.artifactId, file]))
    const resolvedByArtifact = new Map<string, CodeArtifactResolvedSnapshot>()
    for (const artifactId of graph.orderedArtifactIds) {
      const resolved = await window.api.codeArtifact.resolve({ artifactId, workspaceRoot })
      const plan = plansByArtifact.get(artifactId)!
      if (resolved.artifact.sourceHash !== plan.baseHash || resolved.artifact.revision !== plan.baseRevision) {
        throw new Error(`CODE_DRAFT_SOURCE_STALE:${resolved.artifact.relativePath}`)
      }
      if (!rendererPathInside(workspaceRoot, resolved.sourcePath)) {
        throw new Error(`CODE_DRAFT_ARTIFACT_OUTSIDE_WORKSPACE:${resolved.artifact.relativePath}`)
      }
      if (state.codeEditor && state.filePath
        && normalizedRendererPath(state.filePath) === normalizedRendererPath(resolved.sourcePath)
        && (state.revision !== plan.baseRevision || state.codeEditor.getValue() !== decodeCodeSnapshot(resolved.data))) {
        throw new Error(`CODE_DRAFT_ACTIVE_BUFFER_STALE:${resolved.artifact.relativePath}`)
      }
      resolvedByArtifact.set(artifactId, resolved)
    }

    const preparedFiles = [] as Array<{
      artifactId: string
      resolved: CodeArtifactResolvedSnapshot
      prepared: PreparedCodeDraft
      candidateData: Uint8Array
    }>
    for (const artifactId of graph.orderedArtifactIds) {
      const plan = plansByArtifact.get(artifactId)!
      const resolved = resolvedByArtifact.get(artifactId)!
      const source = decodeCodeSnapshot(resolved.data)
      const prepared = await prepareCodeDraft(source, plan.edits.map((edit) => ({
        id: edit.id,
        label: edit.label,
        startOffset: edit.startOffset,
        endOffset: edit.endOffset,
        expectedBeforeText: edit.beforeText,
        afterText: edit.afterText,
        dependsOn: edit.dependsOn?.filter((dependency) => graph.ownerByOperationId.get(dependency) === artifactId),
        atomicGroupId: edit.atomicGroupId,
      })))
      preparedFiles.push({
        artifactId,
        resolved,
        prepared,
        candidateData: encodeCodeSnapshot(prepared.candidate, resolved.metadata),
      })
    }

    const batchId = crypto.randomUUID()
    const stagedFiles = [] as Array<(typeof preparedFiles)[number] & {
      sourceSnapshotHandle: string
      candidateHandle: string
    }>
    for (const file of preparedFiles) {
      const sourceSnapshot = await window.api.artifact.stageSourceSnapshot({
        sourcePath: file.resolved.sourcePath,
        data: file.resolved.data,
        sourceRevision: file.resolved.artifact.revision,
        metadata: file.resolved.metadata,
      })
      stagedSourceSnapshotHandles.push(sourceSnapshot.sourceSnapshotHandle)
      const candidate = await window.api.artifact.stageProducedCandidate({
        data: file.candidateData,
        kind: 'code',
        recipes: file.prepared.recipes,
      })
      stagedCandidateHandles.push(candidate.candidateHandle)
      stagedFiles.push({
        ...file,
        sourceSnapshotHandle: sourceSnapshot.sourceSnapshotHandle,
        candidateHandle: candidate.candidateHandle,
      })
    }

    const draftRequests: ArtifactDraftCreateRequest[] = stagedFiles.map((file) => {
      const sourcePlan = plansByArtifact.get(file.artifactId)!
      const crossFileDependencies = sourcePlan.edits.flatMap((edit) => (
        (edit.dependsOn ?? []).flatMap((dependsOnOperationId) => {
          const dependencyOwner = graph.ownerByOperationId.get(dependsOnOperationId)
          if (!dependencyOwner || dependencyOwner === file.artifactId) return []
          const dependencyFile = resolvedByArtifact.get(dependencyOwner)
          if (!dependencyFile) throw new Error(`CODE_DRAFT_DEPENDENCY_OWNER_MISSING:${edit.id}`)
          return [{
            operationId: edit.id,
            dependsOnRelativePath: dependencyFile.artifact.relativePath,
            dependsOnOperationId,
          }]
        })
      ))
      return {
        sourcePath: file.resolved.sourcePath,
        documentId: file.resolved.sourcePath,
        kind: 'code',
        candidateHandle: file.candidateHandle,
        sourceRevision: file.resolved.artifact.revision,
        sourceSnapshotHandle: file.sourceSnapshotHandle,
        textMetadata: file.resolved.metadata,
        batchId,
        relativePath: file.resolved.artifact.relativePath,
        ...(crossFileDependencies.length > 0 ? { crossFileDependencies } : {}),
        producer: RENDERER_ARTIFACT_PRODUCER,
        operations: file.prepared.operations,
        runId: command.runId,
        agentId: command.agentId,
        agentName: command.agentName,
      }
    })
    const summaries = draftRequests.length === 1
      ? [await window.api.artifact.createDraft(draftRequests[0])]
      : await window.api.artifact.createDraftBatch({ requests: draftRequests })
    createdDraftIds.push(...summaries.map(({ manifest }) => manifest.draftId))

    const draftIdByArtifact = new Map(stagedFiles.map((file, index) => [file.artifactId, summaries[index].manifest.draftId]))
    const batch: ArtifactReviewBatchManifest = {
      protocolVersion: 1,
      batchId,
      runId: command.runId,
      agentId: command.agentId,
      agentName: command.agentName,
      workspaceRoot,
      items: stagedFiles.map((file, index) => ({
        draftId: summaries[index].manifest.draftId,
        documentId: file.resolved.sourcePath,
        relativePath: file.resolved.artifact.relativePath,
        status: index === 0 ? 'reviewing' : 'pending',
        dependsOnDraftIds: [...(graph.fileDependencies.get(file.artifactId) ?? [])]
          .map((artifactId) => draftIdByArtifact.get(artifactId))
          .filter((draftId): draftId is string => Boolean(draftId)),
      })),
      createdAt: Date.now(),
    }
    return {
      success: true,
      batchId,
      files: batch.items.map((item, index) => ({
        draftId: item.draftId,
        relativePath: item.relativePath,
        operationCount: summaries[index].manifest.operations.length,
        dependsOnDraftIds: item.dependsOnDraftIds,
      })),
      totalFiles: batch.items.length,
      sourceMutation: 'none-until-each-file-is-reviewed-and-saved',
    }
  } catch (error) {
    await Promise.all(createdDraftIds.map((draftId) => (
      window.api.artifact.command(draftId, { type: 'discard' }).catch(() => null)
    )))
    await window.api.artifact.releaseStagedInputs({
      candidateHandles: stagedCandidateHandles,
      sourceSnapshotHandles: stagedSourceSnapshotHandles,
    }).catch(() => null)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function setCell(
  row: number,
  col: number,
  value: string,
  command: AgentEditCommand,
): Promise<DocumentOperationResult> {
  const workbook = state.workbook
  if (!workbook || state.kind !== 'excel') return { success: false, error: 'Excel editor not ready' }
  if (!Number.isInteger(row) || row < 0 || !Number.isInteger(col) || col < 0) {
    return { success: false, error: 'INVALID_EXCEL_CELL' }
  }
  const sheet = workbook.getSheet() as Sheet
  const address = formatExcelCellAddress(row, col)
  const existing = (sheet.celldata ?? []).find((cell) => cell.r === row && cell.c === col)?.v
  const executionRef = crypto.randomUUID()
  return openBuiltInArtifactDraft('excel', [{
    id: command.operationId ?? crypto.randomUUID(),
    type: isMeaningfulExcelCell(existing) ? 'replace' : 'insert',
    label: `${sheet.name}!${address}`,
    location: { kind: 'excel', sheetId: sheet.id, sheetName: sheet.name, range: address },
    before: isMeaningfulExcelCell(existing) ? { text: String(existing?.m ?? existing?.v ?? '') } : undefined,
    after: { text: value },
    visual: isMeaningfulExcelCell(existing) ? 'replacement' : 'addition',
    executionRef,
  }], [{
    executionRef,
    recipe: { kind: 'excel-cell', sheet: sheet.name, target: address, value },
  }], command)
}

function isMeaningfulExcelCell(cell: Cell | null | undefined): boolean {
  return Boolean(cell && (cell.f != null || cell.v != null || cell.m != null))
}

function normalizeStoredFormula(formula: string | undefined): string | undefined {
  if (!formula) return undefined
  return formula.startsWith('=') ? formula : `=${formula}`
}

function usedRangeForSheet(sheet: Sheet): string | null {
  const cells = sheet.celldata ?? []
  let startRow = Number.POSITIVE_INFINITY
  let startColumn = Number.POSITIVE_INFINITY
  let endRow = -1
  let endColumn = -1
  for (const cell of cells) {
    if (!isMeaningfulExcelCell(cell.v)) continue
    startRow = Math.min(startRow, cell.r)
    startColumn = Math.min(startColumn, cell.c)
    endRow = Math.max(endRow, cell.r)
    endColumn = Math.max(endColumn, cell.c)
  }
  return endRow < 0
    ? null
    : formatExcelA1Range(startRow, startColumn, endRow, endColumn)
}

function latestWorkbookSheets(workbook: WorkbookInstance): Sheet[] {
  return workbook.getAllSheets().map((sheet) => workbook.getSheet({ id: sheet.id }) as Sheet)
}

function resolveWorkbookSheet(
  workbook: WorkbookInstance,
  requested?: string,
): { sheet: Sheet; active: boolean } | null {
  const activeSheet = workbook.getSheet() as Sheet
  if (!requested?.trim()) return { sheet: activeSheet, active: true }
  const query = requested.trim()
  const sheets = latestWorkbookSheets(workbook)
  const exact = sheets.find((sheet) => sheet.id === query || sheet.name === query)
  const insensitive = sheets.find((sheet) => sheet.name.toLocaleLowerCase() === query.toLocaleLowerCase())
  const sheet = exact ?? insensitive
  if (!sheet) return null
  return { sheet, active: sheet.id === activeSheet.id }
}

function readExcelWorkbookSummary(workbook: WorkbookInstance): unknown {
  const activeSheet = workbook.getSheet() as Sheet
  const selection = workbook.getSelection() ?? []
  const sheets = latestWorkbookSheets(workbook).map((sheet) => ({
    id: sheet.id,
    name: sheet.name,
    active: sheet.id === activeSheet.id,
    usedRange: usedRangeForSheet(sheet),
  }))
  return {
    success: true,
    kind: 'excel',
    workbook: {
      activeSheet: activeSheet.name,
      sheets,
      selection: selection.map((item) => formatExcelA1Range(
        item.row[0],
        item.column[0],
        item.row[1],
        item.column[1],
      )),
    },
  }
}

function readExcelRange(sheetName: string | undefined, rangeText: string): unknown {
  const workbook = state.workbook
  if (!workbook || state.kind !== 'excel') return { success: false, error: 'Excel editor not ready' }
  const range = parseExcelA1Range(rangeText)
  if (!range) return { success: false, error: 'INVALID_EXCEL_RANGE', range: rangeText }
  if (range.cellCount > 500) {
    return { success: false, error: 'EXCEL_RANGE_READ_LIMIT', limit: 500, requestedCells: range.cellCount }
  }
  const resolved = resolveWorkbookSheet(workbook, sheetName)
  if (!resolved) return { success: false, error: 'EXCEL_SHEET_NOT_FOUND', sheet: sheetName }
  const sheet = workbook.getSheet({ id: resolved.sheet.id }) as Sheet
  const cellMap = new Map((sheet.celldata ?? []).map((cell) => [`${cell.r}:${cell.c}`, cell.v]))
  const cells: Array<{
    address: string
    value: string | number | boolean | null
    display: string | number | boolean | null
    formula?: string
  }> = []
  for (let row = range.start.row; row <= range.end.row; row += 1) {
    for (let column = range.start.column; column <= range.end.column; column += 1) {
      const cell = cellMap.get(`${row}:${column}`)
      cells.push({
        address: formatExcelCellAddress(row, column),
        value: cell?.v ?? null,
        display: cell?.m ?? cell?.v ?? null,
        ...(cell?.f ? { formula: normalizeStoredFormula(cell.f) } : {}),
      })
    }
  }
  return {
    success: true,
    kind: 'excel-range',
    sheet: sheet.name,
    range: range.normalized,
    cells,
  }
}

function fillApiCalls(range: NonNullable<ReturnType<typeof parseExcelA1Range>>): Array<{
  name: string
  args: any[]
}> {
  const { start, end } = range
  const calls: Array<{ name: string; args: any[] }> = []
  const seed: SingleRange = { row: [start.row, start.row], column: [start.column, start.column] }
  if (end.column > start.column) {
    calls.push({
      name: 'autoFillCell',
      args: [seed, {
        row: [start.row, start.row],
        column: [start.column + 1, end.column],
      }, 'right'],
    })
  }
  if (end.row > start.row) {
    const copyRange: SingleRange = {
      row: [start.row, start.row],
      column: [start.column, end.column],
    }
    calls.push({
      name: 'autoFillCell',
      args: [copyRange, {
        row: [start.row + 1, end.row],
        column: [start.column, end.column],
      }, 'down'],
    })
  }
  return calls
}

async function waitForWorkbookUpdate(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    return
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function waitForWrittenFormulaCells(
  originalWorkbook: WorkbookInstance,
  sheetId: string,
  target: NonNullable<ReturnType<typeof parseExcelA1Range>>,
): Promise<{ workbook: WorkbookInstance; sheet: Sheet; cells: NonNullable<Sheet['celldata']> }> {
  let latestWorkbook = state.workbook ?? originalWorkbook
  let latestSheet = latestWorkbook.getSheet({ id: sheetId }) as Sheet
  let relevantCells: NonNullable<Sheet['celldata']> = []
  for (let attempt = 0; attempt < 12; attempt += 1) {
    latestWorkbook = state.workbook ?? originalWorkbook
    latestSheet = latestWorkbook.getSheet({ id: sheetId }) as Sheet
    relevantCells = (latestSheet.celldata ?? []).filter((cell) => (
      cell.r >= target.start.row
      && cell.r <= target.end.row
      && cell.c >= target.start.column
      && cell.c <= target.end.column
    ))
    if (relevantCells.some((cell) => Boolean(cell.v?.f))) break
    await waitForWorkbookUpdate()
  }
  return { workbook: latestWorkbook, sheet: latestSheet, cells: relevantCells }
}

async function setExcelFormula(
  sheetName: string | undefined,
  targetText: string,
  formulaText: string,
  command: AgentEditCommand,
): Promise<unknown> {
  const workbook = state.workbook
  if (!workbook || state.kind !== 'excel') return { success: false, error: 'Excel editor not ready' }
  const target = parseExcelA1Range(targetText)
  if (!target) return { success: false, error: 'INVALID_EXCEL_RANGE', target: targetText }
  if (target.cellCount > 10_000) {
    return { success: false, error: 'EXCEL_FORMULA_WRITE_LIMIT', limit: 10_000, requestedCells: target.cellCount }
  }
  const validation = validateCuratedExcelFormula(formulaText)
  if (!validation.valid) {
    return { success: false, error: validation.error, unsupportedFunctions: validation.unsupported }
  }
  const resolved = resolveWorkbookSheet(workbook, sheetName)
  if (!resolved) return { success: false, error: 'EXCEL_SHEET_NOT_FOUND', sheet: sheetName }
  const existing = (resolved.sheet.celldata ?? []).filter((cell) => (
    cell.r >= target.start.row
    && cell.r <= target.end.row
    && cell.c >= target.start.column
    && cell.c <= target.end.column
    && isMeaningfulExcelCell(cell.v)
  ))
  const executionRef = crypto.randomUUID()
  const draft = await openBuiltInArtifactDraft('excel', [{
    id: command.operationId ?? crypto.randomUUID(),
    type: 'formula',
    label: `${resolved.sheet.name}!${target.normalized}`,
    location: {
      kind: 'excel',
      sheetId: resolved.sheet.id,
      sheetName: resolved.sheet.name,
      range: target.normalized,
    },
    before: existing.length > 0 ? { text: `${existing.length} populated cell(s)` } : undefined,
    after: { text: formulaText.trim(), attributes: { formula: true, cells: target.cellCount } },
    visual: existing.length > 0 ? 'replacement' : 'addition',
    executionRef,
  }], [{
    executionRef,
    recipe: {
      kind: 'excel-formula',
      sheet: resolved.sheet.name,
      target: target.normalized,
      formula: formulaText.trim(),
    },
  }], command)
  return {
    ...draft,
    kind: 'excel-formula',
    sheet: resolved.sheet.name,
    target: target.normalized,
    formula: formulaText.trim(),
    functions: validation.functions,
    changedCells: target.cellCount,
  }
}

/** Legacy direct editor implementation retained for migration diagnostics only. */
async function setExcelFormulaLiveLegacy(
  sheetName: string | undefined,
  targetText: string,
  formulaText: string,
): Promise<unknown> {
  const workbook = state.workbook
  if (!workbook || state.kind !== 'excel') return { success: false, error: 'Excel editor not ready' }
  const target = parseExcelA1Range(targetText)
  if (!target) return { success: false, error: 'INVALID_EXCEL_RANGE', target: targetText }
  if (target.cellCount > 10_000) {
    return { success: false, error: 'EXCEL_FORMULA_WRITE_LIMIT', limit: 10_000, requestedCells: target.cellCount }
  }
  const validation = validateCuratedExcelFormula(formulaText)
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
      unsupportedFunctions: validation.unsupported,
    }
  }
  const resolved = resolveWorkbookSheet(workbook, sheetName)
  if (!resolved) return { success: false, error: 'EXCEL_SHEET_NOT_FOUND', sheet: sheetName }
  const sheetId = resolved.sheet.id
  if (!sheetId) return { success: false, error: 'EXCEL_SHEET_ID_MISSING', sheet: resolved.sheet.name }
  const selectedRange: SingleRange = {
    row: [target.start.row, target.end.row],
    column: [target.start.column, target.end.column],
  }
  const apiCalls: Array<{ name: string; args: any[] }> = [
    { name: 'activateSheet', args: [{ id: sheetId }] },
    {
      name: 'setCellValue',
      args: [target.start.row, target.start.column, formulaText.trim(), null, { id: sheetId }],
    },
    ...fillApiCalls(target),
    { name: 'calculateFormula', args: [sheetId, selectedRange] },
    { name: 'setSelection', args: [[selectedRange], { id: sheetId }] },
  ]
  workbook.batchCallApis(apiCalls)
  workbook.scroll({ targetRow: target.start.row, targetColumn: target.start.column })
  const { cells: relevantCells } = await waitForWrittenFormulaCells(workbook, sheetId, target)
  const allCalculationErrors = relevantCells
    .filter((cell) => typeof (cell.v?.m ?? cell.v?.v) === 'string' && String(cell.v?.m ?? cell.v?.v).startsWith('#'))
    .map((cell) => ({
      address: formatExcelCellAddress(cell.r, cell.c),
      error: String(cell.v?.m ?? cell.v?.v),
    }))
  const calculationErrors = allCalculationErrors.slice(0, 50)
  const previewCandidates = relevantCells.length <= 20
    ? relevantCells
    : [relevantCells[0], relevantCells[relevantCells.length - 1]].filter(Boolean)
  const preview = previewCandidates.map((cell) => ({
    address: formatExcelCellAddress(cell.r, cell.c),
    formula: normalizeStoredFormula(cell.v?.f),
    display: cell.v?.m ?? cell.v?.v ?? null,
  }))
  const actualFormulas = relevantCells
    .filter((cell) => Boolean(cell.v?.f))
    .slice(0, 50)
    .map((cell) => ({
      address: formatExcelCellAddress(cell.r, cell.c),
      formula: normalizeStoredFormula(cell.v?.f),
    }))
  return {
    success: true,
    changed: true,
    kind: 'excel-formula',
    sheet: resolved.sheet.name,
    target: target.normalized,
    formula: formulaText.trim(),
    functions: validation.functions,
    changedCells: target.cellCount,
    actualFormulaCount: relevantCells.filter((cell) => Boolean(cell.v?.f)).length,
    actualFormulas,
    preview,
    calculationErrors,
    calculationErrorCount: allCalculationErrors.length,
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
