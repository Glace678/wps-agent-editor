import type { PdfFontDescriptor, PdfNormalizedRect } from '../mupdf-protocol'

export const MAX_PAGE_PIXELS = 16_777_216
export const MAX_PAGE_SIDE = 16_384
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 40_000_000
export const MAX_FONT_BYTES = 32 * 1024 * 1024
export const MAX_SAVE_BYTES = 100 * 1024 * 1024
export const WAE_METADATA_VERSION = 1
// Bound the WAE annotation Payload so a malicious/complex PDF cannot make
// JSON.parse (or the resulting object walk) consume unbounded memory/time.
export const MAX_WAE_PAYLOAD_CHARS = 64 * 1024
export const MAX_WAE_PAYLOAD_KEYS = 200
export const MAX_WAE_PAYLOAD_DEPTH = 6
export const WAE_NAME_PATTERN = /^WAE:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
export const BUILTIN_PDF_FONTS = new Set([
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
])

export function readPdfObjectString(object: {
  isName(): boolean
  asName(): string
  isString(): boolean
  asString(): string
}): string | null {
  if (object.isName()) return object.asName()
  if (object.isString()) return object.asString()
  return null
}

export function validFontDescriptor(value: unknown): value is PdfFontDescriptor {
  if (!value || typeof value !== 'object') return false
  const font = value as Partial<PdfFontDescriptor>
  return typeof font.fontId === 'string'
    && typeof font.familyName === 'string'
    && Number.isInteger(font.faceIndex)
    && typeof font.weight === 'number'
    && (font.style === 'normal' || font.style === 'italic' || font.style === 'oblique')
}

export function validNormalizedRect(value: unknown): value is PdfNormalizedRect {
  if (!value || typeof value !== 'object') return false
  const rect = value as Partial<PdfNormalizedRect>
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && Number(rect.width) > 0
    && Number(rect.height) > 0
}

/**
 * Parse a WAE Payload JSON string with hard limits: raw char length, total key
 * count, and nesting depth. Returns null when any bound is exceeded so a hostile
 * annotation is skipped instead of hanging the worker.
 */
export function parseWaePayload(raw: string): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  if (raw.length > MAX_WAE_PAYLOAD_CHARS) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  let keys = 0
  const walk = (value: unknown, depth: number): boolean => {
    if (depth > MAX_WAE_PAYLOAD_DEPTH) return false
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!walk(item, depth + 1)) return false
      }
      return true
    }
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        keys += 1
        if (keys > MAX_WAE_PAYLOAD_KEYS) return false
        if (!walk((value as Record<string, unknown>)[key], depth + 1)) return false
      }
    }
    return true
  }
  if (!walk(parsed, 0)) return null
  return parsed as Record<string, unknown>
}
