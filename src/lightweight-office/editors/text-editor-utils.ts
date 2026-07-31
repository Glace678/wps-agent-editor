export type TextEncoding =
  | 'utf-8'
  | 'utf-8-bom'
  | 'gbk'
  | 'utf-16le'
  | 'utf-16be'

export type LineEnding = 'crlf' | 'lf' | 'cr'

export interface DecodedTextFile {
  text: string
  encoding: TextEncoding
  lineEnding: LineEnding
}

export interface TextMatch {
  start: number
  end: number
}

export interface FindOptions {
  matchCase: boolean
  wrapAround: boolean
}

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf])
const UTF16LE_BOM = new Uint8Array([0xff, 0xfe])
const UTF16BE_BOM = new Uint8Array([0xfe, 0xff])

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((value, index) => bytes[index] === value)
}

export function detectLineEnding(text: string): LineEnding {
  const crlf = (text.match(/\r\n/g) || []).length
  const withoutCrlf = text.replace(/\r\n/g, '')
  const lf = (withoutCrlf.match(/\n/g) || []).length
  const cr = (withoutCrlf.match(/\r/g) || []).length

  if (crlf >= lf && crlf >= cr && crlf > 0) return 'crlf'
  if (cr > lf && cr > 0) return 'cr'
  if (lf > 0) return 'lf'
  return 'crlf'
}

export function normalizeToLf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function applyLineEnding(text: string, lineEnding: LineEnding): string {
  const normalized = normalizeToLf(text)
  if (lineEnding === 'crlf') return normalized.replace(/\n/g, '\r\n')
  if (lineEnding === 'cr') return normalized.replace(/\n/g, '\r')
  return normalized
}

export function decodeTextFile(buffer: ArrayBuffer): DecodedTextFile {
  const bytes = new Uint8Array(buffer)
  let text: string
  let encoding: TextEncoding

  if (startsWith(bytes, UTF8_BOM)) {
    text = new TextDecoder('utf-8').decode(bytes.subarray(UTF8_BOM.length))
    encoding = 'utf-8-bom'
  } else if (startsWith(bytes, UTF16LE_BOM)) {
    text = new TextDecoder('utf-16le').decode(bytes.subarray(UTF16LE_BOM.length))
    encoding = 'utf-16le'
  } else if (startsWith(bytes, UTF16BE_BOM)) {
    text = new TextDecoder('utf-16be').decode(bytes.subarray(UTF16BE_BOM.length))
    encoding = 'utf-16be'
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      encoding = 'utf-8'
    } catch {
      text = new TextDecoder('gbk').decode(bytes)
      encoding = 'gbk'
    }
  }

  return {
    text: normalizeToLf(text),
    encoding,
    lineEnding: detectLineEnding(text),
  }
}

function prepend(prefix: Uint8Array, body: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(prefix.length + body.length)
  out.set(prefix, 0)
  out.set(body, prefix.length)
  return out.buffer
}

function encodeUtf16(text: string, bigEndian: boolean): Uint8Array {
  const body = new Uint8Array(text.length * 2)
  const view = new DataView(body.buffer)
  for (let index = 0; index < text.length; index += 1) {
    view.setUint16(index * 2, text.charCodeAt(index), !bigEndian)
  }
  return body
}

/**
 * GBK is handled by the main-process text saver. This fallback deliberately
 * returns UTF-8 so a renderer-only environment can still save without data loss.
 */
export function encodeTextFile(text: string, encoding: TextEncoding): ArrayBuffer {
  if (encoding === 'utf-8-bom') {
    return prepend(UTF8_BOM, new TextEncoder().encode(text))
  }
  if (encoding === 'utf-16le') {
    return prepend(UTF16LE_BOM, encodeUtf16(text, false))
  }
  if (encoding === 'utf-16be') {
    return prepend(UTF16BE_BOM, encodeUtf16(text, true))
  }
  return new TextEncoder().encode(text).buffer
}

export function encodingLabel(encoding: TextEncoding): string {
  switch (encoding) {
    case 'utf-8-bom':
      return 'UTF-8 BOM'
    case 'gbk':
      return 'ANSI (GBK)'
    case 'utf-16le':
      return 'UTF-16 LE'
    case 'utf-16be':
      return 'UTF-16 BE'
    default:
      return 'UTF-8'
  }
}

export function lineEndingLabel(lineEnding: LineEnding): string {
  if (lineEnding === 'crlf') return 'Windows (CRLF)'
  if (lineEnding === 'cr') return 'Macintosh (CR)'
  return 'Unix (LF)'
}

export function getCursorPosition(text: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, text.length))
  const before = text.slice(0, safeOffset)
  const lastBreak = before.lastIndexOf('\n')
  return {
    line: before.split('\n').length,
    column: safeOffset - lastBreak,
  }
}

export function findTextMatches(
  text: string,
  query: string,
  options: FindOptions,
): TextMatch[] {
  if (!query) return []

  const haystack = options.matchCase ? text : text.toLocaleLowerCase()
  const needle = options.matchCase ? query : query.toLocaleLowerCase()
  const matches: TextMatch[] = []
  let from = 0

  while (from <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, from)
    if (start < 0) break
    const end = start + needle.length
    matches.push({ start, end })
    from = Math.max(end, start + 1)
  }

  return matches
}

export function countLines(text: string): number {
  if (!text) return 1
  let lines = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lines += 1
  }
  return lines
}

export function getLineOffset(text: string, requestedLine: number): number {
  const target = Math.max(1, Math.floor(requestedLine))
  if (target === 1) return 0

  let line = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue
    line += 1
    if (line === target) return index + 1
  }
  return text.length
}
