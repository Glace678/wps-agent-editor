import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import { t } from '../i18n/translate'
import type { AgentAttachment } from '../../src/types/agent'

const MAX_ATTACHMENTS_PER_MESSAGE = 12
const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_FILE_CHARS = 24_000
export const MAX_ATTACHMENT_CONTEXT_CHARS = 64_000
const MAX_ATTACHMENT_SESSIONS = 64

interface FrozenAttachmentMessage {
  signature: string
  role: 'user' | 'assistant' | 'system'
  content: string
  attachmentContextChars: number
}

const frozenAttachmentSessions = new Map<string, FrozenAttachmentMessage[]>()

const KNOWN_BINARY_EXTENSIONS = new Set([
  '.7z', '.avi', '.bmp', '.class', '.dll', '.dmg', '.doc', '.exe', '.gif', '.gz',
  '.heic', '.ico', '.iso', '.jar', '.jpeg', '.jpg', '.mov', '.mp3', '.mp4', '.o',
  '.obj', '.odt', '.ogg', '.png', '.rar', '.so', '.tar', '.tif', '.tiff', '.wav',
  '.webm', '.webp', '.zip',
])

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function truncate(value: string, maxChars = MAX_FILE_CHARS): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n${t('agentOrchestrator.attachmentContentTruncated')}`
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
  if (sample.length === 0) return true
  let nullBytes = 0
  let controlBytes = 0
  for (const byte of sample) {
    if (byte === 0) nullBytes += 1
    else if (byte < 9 || (byte > 13 && byte < 32)) controlBytes += 1
  }
  return nullBytes === 0 && controlBytes / sample.length < 0.03
}

async function extractSpreadsheetText(buffer: Buffer): Promise<string> {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const sections: string[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
    sections.push(`${t('agentOrchestrator.attachmentSheet', { name: sheetName })}\n${csv}`)
    if (sections.join('\n\n').length >= MAX_FILE_CHARS) break
  }
  return sections.join('\n\n')
}

async function extractPresentationText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const slides = Object.values(zip.files)
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name))
    .sort((a, b) => {
      const aIndex = Number(a.name.match(/slide(\d+)\.xml$/i)?.[1] || 0)
      const bIndex = Number(b.name.match(/slide(\d+)\.xml$/i)?.[1] || 0)
      return aIndex - bIndex
    })
  const sections: string[] = []
  for (const [index, slide] of slides.entries()) {
    const xml = await slide.async('text')
    const text = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gi)]
      .map((match) => decodeXml(match[1]))
      .join(' ')
      .trim()
    sections.push(`${t('agentOrchestrator.attachmentSlide', { number: index + 1 })}: ${text}`)
    if (sections.join('\n').length >= MAX_FILE_CHARS) break
  }
  return sections.join('\n')
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingOptions = {
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  } as Parameters<typeof pdfjs.getDocument>[0]
  const loadingTask = pdfjs.getDocument(loadingOptions)
  const pdf = await loadingTask.promise
  const pages: string[] = []
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter(Boolean)
        .join(' ')
      pages.push(`${t('agentOrchestrator.attachmentPage', { number: pageNumber })}:\n${text}`)
      if (pages.join('\n\n').length >= MAX_FILE_CHARS) break
    }
  } finally {
    await pdf.destroy()
  }
  return pages.join('\n\n')
}

async function extractFileText(filePath: string, buffer: Buffer): Promise<string | null> {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.docx') {
    return (await mammoth.extractRawText({ buffer })).value
  }
  if (['.xlsx', '.xls', '.ods', '.csv'].includes(extension)) {
    return extractSpreadsheetText(buffer)
  }
  if (extension === '.pptx') return extractPresentationText(buffer)
  if (extension === '.pdf') return extractPdfText(buffer)
  if (KNOWN_BINARY_EXTENSIONS.has(extension) || !looksLikeText(buffer)) return null
  return buffer.toString('utf8')
}

async function renderAttachment(
  attachment: AgentAttachment,
  availableChars: number,
): Promise<string> {
  if (!attachment || typeof attachment.path !== 'string' || !path.isAbsolute(attachment.path)) {
    return `<attachment status="invalid">${t('agentOrchestrator.invalidAttachmentPath')}</attachment>`
  }

  const filePath = path.resolve(attachment.path)
  const name = path.basename(filePath)
  const safeName = escapeAttribute(name)
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) {
      return `<attachment name="${safeName}" status="unavailable">${t('agentOrchestrator.attachmentNotRegularFile')}</attachment>`
    }
    // The absolute path is needed locally to read the file, but must never be
    // included in the provider prompt because it commonly contains usernames.
    const metadata = `name="${safeName}" size="${stat.size}"`
    if (stat.size > MAX_FILE_BYTES) {
      return `<attachment ${metadata} status="metadata-only">${t('agentOrchestrator.attachmentTooLarge', { bytes: MAX_FILE_BYTES })}</attachment>`
    }

    const buffer = await fs.readFile(filePath)
    const extracted = await extractFileText(filePath, buffer)
    if (extracted === null) {
      return `<attachment ${metadata} status="metadata-only">${t('agentOrchestrator.binaryAttachmentUnsupported')}</attachment>`
    }
    const contentBudget = Math.max(0, Math.min(MAX_FILE_CHARS, availableChars - 256))
    const content = truncate(extracted, contentBudget)
    return `<attachment ${metadata}>\n${content}\n</attachment>`
  } catch {
    return `<attachment name="${safeName}" status="unavailable">${t('agentOrchestrator.attachmentReadFailed')}</attachment>`
  }
}

export async function buildAttachmentContext(
  attachments: AgentAttachment[] | undefined,
  maxChars = MAX_ATTACHMENT_CONTEXT_CHARS,
): Promise<string> {
  if (!Array.isArray(attachments) || attachments.length === 0 || maxChars <= 0) return ''

  const selected = attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
  const rendered: string[] = []
  const seen = new Set<string>()
  let usedChars = 0
  for (const attachment of selected) {
    const key = typeof attachment?.path === 'string'
      ? path.resolve(attachment.path).toLocaleLowerCase()
      : ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    const remaining = maxChars - usedChars
    if (remaining <= 256) break
    const value = await renderAttachment(attachment, remaining)
    rendered.push(value)
    usedChars += value.length
  }
  if (rendered.length === 0) return ''
  return `${t('agentOrchestrator.attachmentContextHeader')}\n${rendered.join('\n\n')}`.slice(0, maxChars)
}

export async function addAttachmentContextToMessages<T extends {
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: AgentAttachment[]
}>(messages: T[]): Promise<Array<{ role: T['role']; content: string }>> {
  const contexts = new Map<number, string>()
  let remaining = MAX_ATTACHMENT_CONTEXT_CHARS

  // Newest files are most relevant when the total context budget is reached.
  for (let index = messages.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user' || !message.attachments?.length) continue
    const context = await buildAttachmentContext(message.attachments, remaining)
    if (!context) continue
    contexts.set(index, context)
    remaining -= context.length
  }

  return messages.map((message, index) => {
    const context = contexts.get(index)
    return {
      role: message.role,
      content: context
        ? `${message.content}${message.content.trim() ? '\n\n' : ''}${context}`
        : message.content,
    }
  })
}

function messageSignature(message: {
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: AgentAttachment[]
}): string {
  return JSON.stringify([
    message.role,
    message.content,
    (message.attachments ?? []).map((attachment) => [
      attachment.path,
      attachment.name,
      attachment.source,
    ]),
  ])
}

/**
 * Expands each attachment once per conversation. Re-reading an old file or
 * rebalancing the global attachment budget would mutate an already cached
 * prefix on every later turn.
 */
export async function addStableAttachmentContextToMessages<T extends {
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: AgentAttachment[]
}>(conversationId: string, messages: T[]): Promise<Array<{ role: T['role']; content: string }>> {
  const previous = frozenAttachmentSessions.get(conversationId) ?? []
  let prefixLength = 0
  while (
    prefixLength < previous.length
    && prefixLength < messages.length
    && previous[prefixLength].signature === messageSignature(messages[prefixLength])
  ) {
    prefixLength += 1
  }

  const frozen = previous.slice(0, prefixLength)
  let remaining = Math.max(
    0,
    MAX_ATTACHMENT_CONTEXT_CHARS
      - frozen.reduce((sum, message) => sum + message.attachmentContextChars, 0),
  )
  for (let index = prefixLength; index < messages.length; index += 1) {
    const message = messages[index]
    const context = message.role === 'user' && message.attachments?.length && remaining > 0
      ? await buildAttachmentContext(message.attachments, remaining)
      : ''
    frozen.push({
      signature: messageSignature(message),
      role: message.role,
      content: context
        ? `${message.content}${message.content.trim() ? '\n\n' : ''}${context}`
        : message.content,
      attachmentContextChars: context.length,
    })
    remaining -= context.length
  }

  frozenAttachmentSessions.delete(conversationId)
  frozenAttachmentSessions.set(conversationId, frozen)
  while (frozenAttachmentSessions.size > MAX_ATTACHMENT_SESSIONS) {
    const oldest = frozenAttachmentSessions.keys().next().value
    if (typeof oldest !== 'string') break
    frozenAttachmentSessions.delete(oldest)
  }
  return frozen.map((message) => ({
    role: message.role as T['role'],
    content: message.content,
  }))
}
