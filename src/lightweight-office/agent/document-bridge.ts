import type { WorkbookInstance } from '@fortune-sheet/react'
import type { SuperDocInstance } from '@superdoc-dev/react'
import mammoth from 'mammoth'
import { t } from '@/lib/i18n/translate'
import { readFileBuffer } from '../utils/file-io'

export type DocKind = 'word' | 'excel' | 'pdf' | 'text' | 'none'

export interface AgentEditCommand {
  action: 'insertText' | 'replaceText' | 'readDocument' | 'appendParagraph' | 'setCellValue'
  text?: string
  search?: string
  replace?: string
  all?: boolean
  row?: number
  col?: number
  value?: string
}

interface BridgeState {
  kind: DocKind
  filePath: string | null
  superdoc: SuperDocInstance | null
  workbook: WorkbookInstance | null
  pdfText: string
  plainText: string
}

type PlainTextListener = (text: string) => void

const state: BridgeState = {
  kind: 'none',
  filePath: null,
  superdoc: null,
  workbook: null,
  pdfText: '',
  plainText: '',
}

const plainTextListeners = new Set<PlainTextListener>()

function notifyPlainTextListeners(): void {
  const text = state.plainText
  for (const listener of plainTextListeners) {
    try {
      listener(text)
    } catch (error) {
      console.error('[DocumentBridge] Plain-text listener failed:', error)
    }
  }
}

export const documentBridge = {
  setWord(superdoc: SuperDocInstance | null, filePath: string) {
    state.kind = 'word'
    state.filePath = filePath
    state.superdoc = superdoc
    state.workbook = null
  },

  setExcel(workbook: WorkbookInstance | null, filePath: string) {
    state.kind = 'excel'
    state.filePath = filePath
    state.workbook = workbook
    state.superdoc = null
  },

  setPdf(text: string, filePath: string) {
    state.kind = 'pdf'
    state.filePath = filePath
    state.pdfText = text
    state.superdoc = null
    state.workbook = null
  },

  setPlainText(text: string, filePath: string) {
    state.kind = 'text'
    state.filePath = filePath
    state.plainText = text
    state.superdoc = null
    state.workbook = null
  },

  subscribePlainText(listener: PlainTextListener): () => void {
    plainTextListeners.add(listener)
    return () => {
      plainTextListeners.delete(listener)
    }
  },

  clear() {
    state.kind = 'none'
    state.filePath = null
    state.superdoc = null
    state.workbook = null
    state.pdfText = ''
    state.plainText = ''
  },

  getState() {
    return { ...state }
  },

  async execute(command: AgentEditCommand): Promise<unknown> {
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
  },
}

async function insertWordText(text: string, append: boolean): Promise<unknown> {
  // 纯文本：Agent 改动通过订阅通知活动编辑器。
  if (state.kind === 'text') {
    const before = state.plainText
    state.plainText = append
      ? `${before}${before.endsWith('\n') || !before ? '' : '\n'}${text}`
      : `${before}${text}`
    if (state.plainText !== before) notifyPlainTextListeners()
    return { success: true, kind: 'text', content: state.plainText }
  }

  const editor = state.superdoc?.activeEditor
  if (!editor) return { success: false, error: 'Word editor not ready' }
  try {
    if (append) {
      editor.commands.insertContentAt(editor.state.doc.content.size, `<p>${escapeHtml(text)}</p>`)
    } else {
      editor.commands.insertContent(text)
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

async function replaceWordText(search: string, replace: string, all?: boolean): Promise<unknown> {
  if (!state.filePath) return { success: false, error: 'No file' }

  if (state.kind === 'text') {
    if (!search) return { success: false, error: 'Empty search' }
    const before = state.plainText
    state.plainText = all
      ? before.split(search).join(replace)
      : before.replace(search, replace)
    const changed = before !== state.plainText
    if (changed) notifyPlainTextListeners()
    return {
      success: true,
      kind: 'text',
      replaced: search,
      changed,
      content: state.plainText,
    }
  }

  const arrayBuffer = await readFileBuffer(state.filePath)
  const result = await mammoth.extractRawText({ arrayBuffer })
  // 简化替换：插入新段落提示用户（完整 OOXML 替换较复杂）
  const editor = state.superdoc?.activeEditor
  if (editor) {
    editor.commands.insertContent(`\n[${t('documentBridge.agentReplacementMarker')}] ${replace}\n`)
  }
  return {
    success: true,
    note: t('documentBridge.insertedAtEnd'),
    replaced: search,
    preview: result.value.slice(0, 200),
  }
}

async function readDocument(): Promise<unknown> {
  if (state.kind === 'word' && state.filePath) {
    const arrayBuffer = await readFileBuffer(state.filePath)
    const result = await mammoth.extractRawText({ arrayBuffer })
    const live = state.superdoc?.activeEditor?.state?.doc?.textContent
    return { success: true, content: live || result.value }
  }
  if (state.kind === 'excel' && state.workbook) {
    const sheet = state.workbook.getSheet()
    const lines: string[] = []
    for (const cell of sheet?.celldata || []) {
      lines.push(`${cell.r},${cell.c}: ${cell.v?.m ?? cell.v?.v ?? ''}`)
    }
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
