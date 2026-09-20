import type {
  PdfAnnotationRecord,
  PdfFontDescriptor,
  PdfImageAnnotationRecord,
  PdfMutationResult,
  PdfNormalizedRect,
  PdfOpenResult,
  PdfPageInfo,
  PdfRenderResult,
  PdfRotation,
  PdfSaveResult,
  PdfTextAnnotationRecord,
  PdfTextLayer,
  PdfTextLine,
  PdfWorkerRequest,
  PdfWorkerResponse,
} from './mupdf-protocol'
import { PDF_TEXT_WRAP_TOLERANCE, textParagraphs } from './pdf-text-paragraphs'

type MuPdfApi = typeof import('mupdf').default

const MAX_PAGE_PIXELS = 16_777_216
const MAX_PAGE_SIDE = 16_384
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_IMAGE_PIXELS = 40_000_000
const MAX_FONT_BYTES = 32 * 1024 * 1024
const MAX_SAVE_BYTES = 100 * 1024 * 1024
const WAE_METADATA_VERSION = 1
const WAE_NAME_PATTERN = /^WAE:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
const BUILTIN_PDF_FONTS = new Set([
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
])

interface OpenDocumentState {
  documentId: string
  document: InstanceType<typeof mupdf.PDFDocument>
  encrypted: boolean
  journalEnabled: boolean
  fonts: Map<string, InstanceType<typeof mupdf.Font>>
}

interface WorkerResult {
  result: unknown
  transfer?: Transferable[]
}

interface LocatedAnnotation {
  page: InstanceType<typeof mupdf.PDFPage>
  annotation: InstanceType<typeof mupdf.PDFAnnotation>
}

class PdfWorkerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

let current: OpenDocumentState | null = null
let requestQueue = Promise.resolve()
let mupdf: MuPdfApi
let emptyStore: () => void = () => undefined
let mupdfReady: Promise<void> | null = null

function initializeMuPdf(): Promise<void> {
  if (!mupdfReady) {
    mupdfReady = import('mupdf').then((module) => {
      mupdf = module.default
      emptyStore = module.emptyStore
    })
  }
  return mupdfReady
}

function copyArrayBuffer(bytes: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function destroyObject(value: { destroy(): void } | null | undefined): void {
  try {
    value?.destroy()
  } catch {
    // MuPDF objects are explicitly released where practical; cleanup is best effort.
  }
}

function disposeCurrent(): void {
  if (!current) return
  for (const font of current.fonts.values()) destroyObject(font)
  destroyObject(current.document)
  current = null
  try {
    emptyStore()
  } catch {
    // The shared MuPDF store can already be empty.
  }
}

function requireDocument(documentId: string): OpenDocumentState {
  if (!current || current.documentId !== documentId) {
    throw new PdfWorkerError('stale-document', 'The PDF request belongs to a closed document')
  }
  return current
}

function requireAuthenticated(state: OpenDocumentState): void {
  if (state.document.needsPassword()) {
    throw new PdfWorkerError('password-required', 'The PDF password is required')
  }
}

function pageBounds(page: InstanceType<typeof mupdf.PDFPage>): [number, number, number, number] {
  const bounds = page.getBounds('CropBox')
  const width = bounds[2] - bounds[0]
  const height = bounds[3] - bounds[1]
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new PdfWorkerError('invalid-page', 'The PDF page has an invalid CropBox')
  }
  return bounds
}

function normalizeRect(
  page: InstanceType<typeof mupdf.PDFPage>,
  rect: [number, number, number, number],
): PdfNormalizedRect {
  const bounds = pageBounds(page)
  const pageWidth = bounds[2] - bounds[0]
  const pageHeight = bounds[3] - bounds[1]
  const x = (rect[0] - bounds[0]) / pageWidth
  const y = (rect[1] - bounds[1]) / pageHeight
  const width = (rect[2] - rect[0]) / pageWidth
  const height = (rect[3] - rect[1]) / pageHeight
  return {
    x: Math.min(Math.max(x, 0), 1),
    y: Math.min(Math.max(y, 0), 1),
    width: Math.min(Math.max(width, 0), 1),
    height: Math.min(Math.max(height, 0), 1),
  }
}

function denormalizeRect(
  page: InstanceType<typeof mupdf.PDFPage>,
  rect: PdfNormalizedRect,
): [number, number, number, number] {
  const bounds = pageBounds(page)
  const pageWidth = bounds[2] - bounds[0]
  const pageHeight = bounds[3] - bounds[1]
  const width = Math.min(Math.max(rect.width, 0.002), 1)
  const height = Math.min(Math.max(rect.height, 0.002), 1)
  const x = Math.min(Math.max(rect.x, 0), 1 - width)
  const y = Math.min(Math.max(rect.y, 0), 1 - height)
  return [
    bounds[0] + x * pageWidth,
    bounds[1] + y * pageHeight,
    bounds[0] + (x + width) * pageWidth,
    bounds[1] + (y + height) * pageHeight,
  ]
}

function readPdfObjectString(object: InstanceType<typeof mupdf.PDFObject>): string | null {
  if (object.isName()) return object.asName()
  if (object.isString()) return object.asString()
  return null
}

function validFontDescriptor(value: unknown): value is PdfFontDescriptor {
  if (!value || typeof value !== 'object') return false
  const font = value as Partial<PdfFontDescriptor>
  return typeof font.fontId === 'string'
    && typeof font.familyName === 'string'
    && Number.isInteger(font.faceIndex)
    && typeof font.weight === 'number'
    && (font.style === 'normal' || font.style === 'italic' || font.style === 'oblique')
}

function validNormalizedRect(value: unknown): value is PdfNormalizedRect {
  if (!value || typeof value !== 'object') return false
  const rect = value as Partial<PdfNormalizedRect>
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && Number(rect.width) > 0
    && Number(rect.height) > 0
}

function readWaeRecord(
  page: InstanceType<typeof mupdf.PDFPage>,
  pageIndex: number,
  annotation: InstanceType<typeof mupdf.PDFAnnotation>,
  includeImagePreview: boolean,
): PdfAnnotationRecord | null {
  const match = WAE_NAME_PATTERN.exec(annotation.getName())
  if (!match) return null

  const annotationObject = annotation.getObject()
  try {
    const metadata = annotationObject.get('WAE')
    if (!metadata.isDictionary()) return null
    const versionObject = metadata.get('Version')
    const kindObject = metadata.get('Kind')
    const payloadObject = metadata.get('Payload')
    try {
      if (!versionObject.isNumber() || versionObject.asNumber() !== WAE_METADATA_VERSION) return null
      const kind = readPdfObjectString(kindObject)
      if (!kind || !payloadObject.isString()) return null
      const payload = JSON.parse(payloadObject.asString()) as Record<string, unknown>
      if (payload.id !== match[1] || !validNormalizedRect(payload.rect)) return null

      const rect = normalizeRect(page, annotation.getRect())
      if (kind === 'Text' && annotation.getType() === 'FreeText' && validFontDescriptor(payload.font)) {
        const color = typeof payload.color === 'string' ? payload.color : '#000000'
        const fontSize = typeof payload.fontSize === 'number' && Number.isFinite(payload.fontSize)
          ? Math.min(Math.max(payload.fontSize, 0.1), 288)
          : 14
        return {
          id: match[1],
          type: 'text',
          pageIndex,
          rect,
          text: annotation.getContents(),
          font: payload.font,
          fontSize,
          baseline: typeof payload.baseline === 'number' && Number.isFinite(payload.baseline)
            && payload.baseline >= 0 ? payload.baseline : undefined,
          lineHeight: typeof payload.lineHeight === 'number' && Number.isFinite(payload.lineHeight)
            && payload.lineHeight > 0 ? payload.lineHeight : undefined,
          firstLineIndent: typeof payload.firstLineIndent === 'number' && Number.isFinite(payload.firstLineIndent)
            && payload.firstLineIndent >= 0 ? payload.firstLineIndent : undefined,
          paragraph: payload.paragraph === true,
          underline: payload.underline === true,
          color,
        }
      }

      if (kind === 'Image' && annotation.getType() === 'Stamp') {
        const mimeType = payload.mimeType === 'image/jpeg' || payload.mimeType === 'image/webp'
          ? payload.mimeType
          : 'image/png'
        const result: PdfImageAnnotationRecord = {
          id: match[1],
          type: 'image',
          pageIndex,
          rect,
          mimeType,
        }
        if (includeImagePreview) {
          const annotationRect = annotation.getRect()
          const width = Math.max(1, annotationRect[2] - annotationRect[0])
          const height = Math.max(1, annotationRect[3] - annotationRect[1])
          const scale = Math.min(2, 2048 / Math.max(width, height), Math.sqrt(4_000_000 / (width * height)))
          const pixmap = annotation.toPixmap(
            mupdf.Matrix.scale(Math.max(scale, 0.1), Math.max(scale, 0.1)),
            mupdf.ColorSpace.DeviceRGB,
            true,
          )
          try {
            result.previewPng = copyArrayBuffer(pixmap.asPNG())
          } finally {
            destroyObject(pixmap)
          }
        }
        return result
      }
      return null
    } finally {
      destroyObject(versionObject)
      destroyObject(kindObject)
      destroyObject(payloadObject)
      destroyObject(metadata)
    }
  } catch {
    return null
  } finally {
    destroyObject(annotationObject)
  }
}

function listAnnotations(state: OpenDocumentState): PdfAnnotationRecord[] {
  const records: PdfAnnotationRecord[] = []
  for (let pageIndex = 0; pageIndex < state.document.countPages(); pageIndex += 1) {
    const page = state.document.loadPage(pageIndex)
    try {
      for (const annotation of page.getAnnotations()) {
        try {
          const record = readWaeRecord(page, pageIndex, annotation, true)
          if (record) records.push(record)
        } finally {
          destroyObject(annotation)
        }
      }
    } finally {
      destroyObject(page)
    }
  }
  return records
}

function pageInfos(state: OpenDocumentState): PdfPageInfo[] {
  const pages: PdfPageInfo[] = []
  for (let index = 0; index < state.document.countPages(); index += 1) {
    const page = state.document.loadPage(index)
    try {
      const bounds = pageBounds(page)
      pages.push({
        index,
        width: bounds[2] - bounds[0],
        height: bounds[3] - bounds[1],
      })
    } finally {
      destroyObject(page)
    }
  }
  return pages
}

function hasSignatureFields(state: OpenDocumentState): boolean {
  for (let index = 0; index < state.document.countPages(); index += 1) {
    const page = state.document.loadPage(index)
    try {
      for (const widget of page.getWidgets()) {
        try {
          if (widget.getFieldType() === 'signature') return true
        } finally {
          destroyObject(widget)
        }
      }
    } finally {
      destroyObject(page)
    }
  }
  return false
}

function journalState(state: OpenDocumentState): Pick<PdfMutationResult, 'canUndo' | 'canRedo' | 'dirty'> {
  if (!state.journalEnabled) return { canUndo: false, canRedo: false, dirty: false }
  const journal = state.document.getJournal()
  return {
    canUndo: state.document.canUndo(),
    canRedo: state.document.canRedo(),
    dirty: journal.position > 0,
  }
}

function openResult(state: OpenDocumentState): PdfOpenResult {
  requireAuthenticated(state)
  if (!state.journalEnabled) {
    try {
      state.document.enableJournal()
      state.journalEnabled = true
    } catch {
      state.journalEnabled = false
    }
  }
  const journal = journalState(state)
  return {
    needsPassword: false,
    encrypted: state.encrypted,
    canAnnotate: state.journalEnabled && state.document.hasPermission('annotate'),
    hasSignatures: hasSignatureFields(state),
    pages: pageInfos(state),
    annotations: listAnnotations(state),
    ...journal,
  }
}

function mutationResult(state: OpenDocumentState): PdfMutationResult {
  return {
    annotations: listAnnotations(state),
    ...journalState(state),
  }
}

function findEditableAnnotation(state: OpenDocumentState, annotationId: string): LocatedAnnotation | null {
  for (let pageIndex = 0; pageIndex < state.document.countPages(); pageIndex += 1) {
    const page = state.document.loadPage(pageIndex)
    for (const annotation of page.getAnnotations()) {
      const record = readWaeRecord(page, pageIndex, annotation, false)
      if (record?.id === annotationId) return { page, annotation }
      destroyObject(annotation)
    }
    destroyObject(page)
  }
  return null
}

function withOperation(
  state: OpenDocumentState,
  name: string,
  operation: () => void,
): void {
  if (!state.journalEnabled || !state.document.hasPermission('annotate')) {
    throw new PdfWorkerError('annotation-denied', 'This PDF does not permit annotation changes')
  }
  state.document.beginOperation(name)
  try {
    operation()
    state.document.endOperation()
  } catch (error) {
    state.document.abandonOperation()
    throw error
  }
}

function colorComponents(value: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value)
  if (!match) return [0, 0, 0]
  const number = Number.parseInt(match[1], 16)
  return [
    ((number >> 16) & 0xff) / 255,
    ((number >> 8) & 0xff) / 255,
    (number & 0xff) / 255,
  ]
}

function loadFont(
  state: OpenDocumentState,
  descriptor: PdfFontDescriptor,
  fontData?: ArrayBuffer,
): InstanceType<typeof mupdf.Font> {
  const cached = state.fonts.get(descriptor.fontId)
  if (cached) return cached

  let font: InstanceType<typeof mupdf.Font>
  if (descriptor.fontId.startsWith('builtin:')) {
    const name = descriptor.fontId.slice('builtin:'.length)
    if (!BUILTIN_PDF_FONTS.has(name)) {
      throw new PdfWorkerError('invalid-font', 'The PDF annotation uses an unsupported built-in font')
    }
    font = new mupdf.Font(name)
  } else {
    if (!fontData || fontData.byteLength === 0) {
      throw new PdfWorkerError('font-data-required', 'The selected font has not been loaded')
    }
    if (fontData.byteLength > MAX_FONT_BYTES) {
      throw new PdfWorkerError('font-too-large', 'The selected font exceeds 32 MiB')
    }
    font = new mupdf.Font(descriptor.familyName, fontData, descriptor.faceIndex)
  }
  state.fonts.set(descriptor.fontId, font)
  return font
}

function glyphAdvance(font: InstanceType<typeof mupdf.Font>, text: string, fontSize: number): number {
  let width = 0
  for (const character of text) {
    const glyph = font.encodeCharacter(character)
    width += Math.max(font.advanceGlyph(glyph), 0.25) * fontSize
  }
  return width
}

function wrapText(
  font: InstanceType<typeof mupdf.Font>,
  text: string,
  fontSize: number,
  maxWidth: number,
  firstLineIndent = 0,
  wrapWords = false,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.replaceAll('\r\n', '\n').split('\n')) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    let line = ''
    for (const character of paragraph) {
      const candidate = line + character
      const availableWidth = Math.max(1, maxWidth - (lines.length === 0 ? firstLineIndent : 0))
      if (line && glyphAdvance(font, candidate, fontSize) > availableWidth + PDF_TEXT_WRAP_TOLERANCE) {
        const breakAt = wrapWords ? candidate.lastIndexOf(' ') : -1
        if (breakAt > 0) {
          lines.push(candidate.slice(0, breakAt))
          line = candidate.slice(breakAt + 1)
        } else {
          lines.push(line)
          line = character
        }
      } else {
        line = candidate
      }
    }
    lines.push(line)
  }
  return lines
}

function writeMetadata(
  state: OpenDocumentState,
  annotation: InstanceType<typeof mupdf.PDFAnnotation>,
  record: PdfAnnotationRecord,
): void {
  const metadata = state.document.newDictionary()
  metadata.put('Version', WAE_METADATA_VERSION)
  metadata.put('Kind', state.document.newName(record.type === 'text' ? 'Text' : 'Image'))
  const payload = record.type === 'text'
    ? record
    : {
        id: record.id,
        type: record.type,
        pageIndex: record.pageIndex,
        rect: record.rect,
        mimeType: record.mimeType,
      }
  metadata.put('Payload', state.document.newString(JSON.stringify(payload)))
  const object = annotation.getObject()
  try {
    object.put('WAE', metadata)
  } finally {
    destroyObject(object)
  }
}

function applyTextAppearance(
  state: OpenDocumentState,
  page: InstanceType<typeof mupdf.PDFPage>,
  annotation: InstanceType<typeof mupdf.PDFAnnotation>,
  record: PdfTextAnnotationRecord,
  fontData?: ArrayBuffer,
): void {
  const rect = denormalizeRect(page, record.rect)
  const width = Math.max(1, rect[2] - rect[0])
  const height = Math.max(1, rect[3] - rect[1])
  const fontSize = Math.min(Math.max(record.fontSize, 0.1), 288)
  const color = colorComponents(record.color)
  const font = loadFont(state, record.font, fontData)
  const displayList = new mupdf.DisplayList([0, 0, width, height])
  const device = new mupdf.DisplayListDevice(displayList)
  const clip = new mupdf.Path()
  try {
    clip.rect(0, 0, width, height)
    device.clipPath(clip, false, mupdf.Matrix.identity)
    const padding = record.baseline === undefined ? Math.min(4, width / 8, height / 8) : 0
    const lineHeight = record.lineHeight ?? fontSize * 1.2
    const firstLineIndent = record.firstLineIndent ?? 0
    const lines = record.baseline === undefined || record.paragraph
      ? wrapText(font, record.text, fontSize, Math.max(1, width - padding * 2), firstLineIndent, record.paragraph)
      : record.text.replaceAll('\r\n', '\n').split('\n')
    let baseline = record.baseline ?? padding + fontSize
    for (const [lineIndex, line] of lines.entries()) {
      if (baseline > height - padding + fontSize * 0.25) break
      const left = padding + (lineIndex === 0 ? firstLineIndent : 0)
      const text = new mupdf.Text()
      try {
        text.showString(font, [fontSize, 0, 0, -fontSize, left, baseline], line)
        device.fillText(text, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, color, 1)
      } finally {
        destroyObject(text)
      }
      if (record.underline && line) {
        const path = new mupdf.Path()
        const lineWidth = Math.min(glyphAdvance(font, line, fontSize), width - padding - left)
        path.moveTo(left, baseline + Math.max(1, fontSize * 0.08))
        path.lineTo(left + lineWidth, baseline + Math.max(1, fontSize * 0.08))
        const stroke = new mupdf.StrokeState({
          lineCap: 'Butt',
          lineJoin: 'Miter',
          lineWidth: Math.max(0.6, fontSize / 18),
          miterLimit: 10,
        })
        try {
          device.strokePath(path, stroke, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, color, 1)
        } finally {
          destroyObject(stroke)
          destroyObject(path)
        }
      }
      baseline += lineHeight
    }
    device.popClip()
    device.close()
    annotation.setRect(rect)
    annotation.setContents(record.text)
    annotation.setBorderWidth(0)
    annotation.setDefaultAppearance('Helvetica', fontSize, color)
    annotation.setFlags(annotation.getFlags() | mupdf.PDFAnnotation.IS_PRINT)
    annotation.setModificationDate(new Date())
    // Finish automatic FreeText updates before installing our exact baseline
    // and clipping. Later setters/update() would regenerate the stock layout.
    annotation.update()
    writeMetadata(state, annotation, record)
    annotation.setAppearanceFromDisplayList(
      null,
      null,
      mupdf.Matrix.translate(rect[0], rect[1]),
      displayList,
    )
  } finally {
    destroyObject(clip)
    destroyObject(device)
    destroyObject(displayList)
  }
}

function imageType(bytes: Uint8Array): PdfImageAnnotationRecord['mimeType'] | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) return 'image/webp'
  return null
}

function createImageAnnotation(
  state: OpenDocumentState,
  record: PdfImageAnnotationRecord,
  imageData: ArrayBuffer,
): void {
  if (imageData.byteLength === 0 || imageData.byteLength > MAX_IMAGE_BYTES) {
    throw new PdfWorkerError('image-too-large', 'Images must be no larger than 25 MiB')
  }
  const detectedType = imageType(new Uint8Array(imageData))
  if (!detectedType || detectedType !== record.mimeType) {
    throw new PdfWorkerError('invalid-image', 'The image MIME type does not match its file signature')
  }
  const page = state.document.loadPage(record.pageIndex)
  try {
    const image = new mupdf.Image(imageData)
    try {
      if (image.getWidth() * image.getHeight() > MAX_IMAGE_PIXELS) {
        throw new PdfWorkerError('image-too-large', 'Images must contain no more than 40 million pixels')
      }
      const annotation = page.createAnnotation('Stamp')
      try {
        annotation.setName(`WAE:${record.id}`)
        annotation.setRect(denormalizeRect(page, record.rect))
        annotation.setStampImage(image)
        annotation.setFlags(annotation.getFlags() | mupdf.PDFAnnotation.IS_PRINT)
        annotation.setModificationDate(new Date())
        annotation.update()
        writeMetadata(state, annotation, record)
      } finally {
        destroyObject(annotation)
      }
    } finally {
      destroyObject(image)
    }
  } finally {
    destroyObject(page)
  }
}

function updateImageAnnotation(
  state: OpenDocumentState,
  record: PdfImageAnnotationRecord,
): void {
  const located = findEditableAnnotation(state, record.id)
  if (!located) throw new PdfWorkerError('annotation-not-found', 'The image annotation no longer exists')
  try {
    located.annotation.setRect(denormalizeRect(located.page, record.rect))
    located.annotation.setModificationDate(new Date())
    located.annotation.update()
    writeMetadata(state, located.annotation, record)
  } finally {
    destroyObject(located.annotation)
    destroyObject(located.page)
  }
}

function updateAnnotationGeometry(
  state: OpenDocumentState,
  record: PdfAnnotationRecord,
): void {
  const located = findEditableAnnotation(state, record.id)
  if (!located) throw new PdfWorkerError('annotation-not-found', 'The annotation no longer exists')
  try {
    located.annotation.setRect(denormalizeRect(located.page, record.rect))
    located.annotation.setModificationDate(new Date())
    located.annotation.update()
    writeMetadata(state, located.annotation, record)
  } finally {
    destroyObject(located.annotation)
    destroyObject(located.page)
  }
}

function upsertTextAnnotation(
  state: OpenDocumentState,
  record: PdfTextAnnotationRecord,
  fontData?: ArrayBuffer,
): void {
  const located = findEditableAnnotation(state, record.id)
  if (located) {
    try {
      applyTextAppearance(state, located.page, located.annotation, record, fontData)
    } finally {
      destroyObject(located.annotation)
      destroyObject(located.page)
    }
    return
  }

  const page = state.document.loadPage(record.pageIndex)
  try {
    const annotation = page.createAnnotation('FreeText')
    try {
      annotation.setName(`WAE:${record.id}`)
      annotation.setCreationDate(new Date())
      applyTextAppearance(state, page, annotation, record, fontData)
    } finally {
      destroyObject(annotation)
    }
  } finally {
    destroyObject(page)
  }
}

/**
 * 直接修改 PDF 正文段落：在同一个 journal 操作内
 * 1) 按各源行的范围抹除原有字形（不涂黑块、不动图片与矢量内容）；
 * 2) 在同位置创建 WAE FreeText 注释写入新文字。空文本表示仅抹除。
 */
function replaceBodyText(
  state: OpenDocumentState,
  pageIndex: number,
  redactionRect: PdfNormalizedRect,
  record: PdfTextAnnotationRecord,
  fontData?: ArrayBuffer,
  redactionRects: PdfNormalizedRect[] = [redactionRect],
): void {
  const page = state.document.loadPage(pageIndex)
  try {
    const redactions: InstanceType<typeof mupdf.PDFAnnotation>[] = []
    try {
      // Redact each source line, so gaps/indents in a paragraph cannot erase nearby text.
      for (const rect of redactionRects) {
        const sourceRect = denormalizeRect(page, rect)
        const lineHeight = sourceRect[3] - sourceRect[1]
        const padding = Math.min(1, Math.max(0.2, lineHeight * 0.12))
        const redaction = page.createAnnotation('Redact')
        redactions.push(redaction)
        redaction.setRect([
          sourceRect[0] - padding, sourceRect[1] - padding,
          sourceRect[2] + padding, sourceRect[3] + padding,
        ])
        redaction.update()
      }
      // black_boxes=false：不绘制填充块；图片/矢量保持原样（NONE）；只移除文字。
      page.applyRedactions(
        false,
        mupdf.PDFPage.REDACT_IMAGE_NONE,
        mupdf.PDFPage.REDACT_LINE_ART_NONE,
        mupdf.PDFPage.REDACT_TEXT_REMOVE,
      )
    } finally {
      // applyRedactions 会一并删除 Redact 注释本身；这里兜底释放引用。
      for (const redaction of redactions) {
        try {
          page.deleteAnnotation(redaction)
        } catch {
          // 注释已被 applyRedactions 移除。
        }
        destroyObject(redaction)
      }
    }

    if (record.text) {
      const annotation = page.createAnnotation('FreeText')
      try {
        annotation.setName(`WAE:${record.id}`)
        annotation.setCreationDate(new Date())
        applyTextAppearance(state, page, annotation, record, fontData)
      } finally {
        destroyObject(annotation)
      }
    }
  } finally {
    destroyObject(page)
  }
}

function deleteAnnotation(state: OpenDocumentState, annotationId: string): void {
  const located = findEditableAnnotation(state, annotationId)
  if (!located) throw new PdfWorkerError('annotation-not-found', 'The annotation no longer exists')
  try {
    located.page.deleteAnnotation(located.annotation)
  } finally {
    destroyObject(located.annotation)
    destroyObject(located.page)
  }
}

function rotationMatrix(rotation: PdfRotation, scale: number): [number, number, number, number, number, number] {
  return mupdf.Matrix.concat(mupdf.Matrix.rotate(rotation), mupdf.Matrix.scale(scale, scale))
}

function renderPage(
  state: OpenDocumentState,
  pageIndex: number,
  targetWidth: number,
  rotation: PdfRotation,
): PdfRenderResult {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= state.document.countPages()) {
    throw new PdfWorkerError('invalid-page', 'The requested PDF page is out of range')
  }
  const page = state.document.loadPage(pageIndex)
  try {
    const bounds = pageBounds(page)
    const baseWidth = bounds[2] - bounds[0]
    const baseHeight = bounds[3] - bounds[1]
    const rotatedWidth = rotation === 90 || rotation === 270 ? baseHeight : baseWidth
    const rotatedHeight = rotation === 90 || rotation === 270 ? baseWidth : baseHeight
    const requestedScale = Math.max(0.05, targetWidth / rotatedWidth)
    const pixelScale = Math.sqrt(MAX_PAGE_PIXELS / (rotatedWidth * rotatedHeight))
    const sideScale = MAX_PAGE_SIDE / Math.max(rotatedWidth, rotatedHeight)
    const scale = Math.min(requestedScale, pixelScale, sideScale)
    const matrix = rotationMatrix(rotation, scale)
    const transformedBounds = mupdf.Rect.transform(bounds, matrix)
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, transformedBounds, false)
    const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap)
    try {
      pixmap.clear(255)
      page.runPageContents(device, matrix)
      for (const annotation of page.getAnnotations()) {
        try {
          if (!readWaeRecord(page, pageIndex, annotation, false)) annotation.run(device, matrix)
        } finally {
          destroyObject(annotation)
        }
      }
      page.runPageWidgets(device, matrix)
      device.close()
      return {
        pageIndex,
        width: pixmap.getWidth(),
        height: pixmap.getHeight(),
        png: copyArrayBuffer(pixmap.asPNG()),
      }
    } finally {
      destroyObject(device)
      destroyObject(pixmap)
    }
  } finally {
    destroyObject(page)
  }
}

const MAX_TEXT_LINES_PER_PAGE = 8_000
const MAX_TEXT_LINE_CHARS = 4_096

/** MuPDF 结构化文本里的子集字体会带 6 字母前缀，如 "LNUHNF+SimSun"。 */
function stripSubsetFontPrefix(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, '')
}

function colorToHex(color: number[] | null | undefined): string | undefined {
  if (!Array.isArray(color) || color.length < 3) return undefined
  const channel = (value: number) => Math.min(Math.max(Math.round(value * 255), 0), 255)
    .toString(16)
    .padStart(2, '0')
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`
}

interface ActiveTextLine {
  bbox: [number, number, number, number]
  wmode: number
  horizontal: boolean
  text: string
  fontFamily?: string
  fontSize?: number
  baseline?: number
  fontBold?: boolean
  fontItalic?: boolean
  color?: string
}

/**
 * 把 MuPDF 结构化文本转成行与段落数据，分别供浏览选择与整段编辑使用，
 * 同时携带每行首个字符的字体/字号/颜色，供「点原文直接改」就地编辑时匹配样式。
 * 坐标与注释共用同一套 CropBox 归一化空间（未旋转系，旋转由 CSS 层处理）。
 */
function textLayerForPage(
  state: OpenDocumentState,
  pageIndex: number,
): PdfTextLayer {
  const page = state.document.loadPage(pageIndex)
  try {
    const structuredText = page.toStructuredText({})
    const lines: PdfTextLine[] = []
    const paragraphs: PdfTextLayer['paragraphs'] = []
    const bounds = pageBounds(page)
    let blockStart = 0
    let active: ActiveTextLine | null = null
    // walk 在整个 span 期间复用同一个 Font 对象，不能在 onChar 里提前销毁，
    // 否则后续字符/行的取字会失效；统一在遍历结束后释放。
    const seenFonts: InstanceType<typeof mupdf.Font>[] = []
    const finalizeLine = () => {
      if (!active) return
      const line = active
      active = null
      if (lines.length >= MAX_TEXT_LINES_PER_PAGE || line.wmode === 1 || !line.horizontal) return
      const text = line.text.trim()
      const [x0, y0, x1, y1] = line.bbox
      if (!text || x1 - x0 <= 0 || y1 - y0 <= 0) return
      const rect = normalizeRect(page, line.bbox)
      if (rect.width <= 0 || rect.height <= 0) return
      lines.push({
        text: text.length > MAX_TEXT_LINE_CHARS ? `${text.slice(0, MAX_TEXT_LINE_CHARS)}…` : text,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        fontFamily: line.fontFamily,
        fontSize: typeof line.fontSize === 'number' && Number.isFinite(line.fontSize)
          ? Math.min(Math.max(line.fontSize, 0.1), 288)
          : undefined,
        baseline: line.baseline,
        fontBold: line.fontBold,
        fontItalic: line.fontItalic,
        color: line.color,
      })
    }
    try {
      structuredText.walk({
        beginTextBlock() {
          blockStart = lines.length
        },
        beginLine(bbox, wmode, direction) {
          finalizeLine()
          active = {
            bbox: [bbox[0], bbox[1], bbox[2], bbox[3]],
            wmode,
            horizontal: Math.abs(direction[1]) <= 0.1 && Math.abs(direction[0]) >= 0.9,
            text: '',
          }
        },
        onChar(c, origin, font, size, _quad, color) {
          if (!active) return
          if (active.text.length < MAX_TEXT_LINE_CHARS) active.text += c
          if (!seenFonts.includes(font)) seenFonts.push(font)
          if (active.fontFamily === undefined) {
            active.fontFamily = stripSubsetFontPrefix(font.getName())
            active.fontSize = size
            active.baseline = origin[1] - active.bbox[1]
            active.fontBold = font.isBold()
            active.fontItalic = font.isItalic()
            active.color = colorToHex(color)
          }
        },
        endLine() {
          finalizeLine()
        },
        endTextBlock() {
          finalizeLine()
          paragraphs.push(...textParagraphs(
            lines.slice(blockStart), bounds[2] - bounds[0], bounds[3] - bounds[1],
          ))
        },
      })
      finalizeLine()
    } finally {
      for (const font of seenFonts) destroyObject(font)
      destroyObject(structuredText)
    }
    return { pageIndex, lines, paragraphs }
  } finally {
    destroyObject(page)
  }
}

function extractText(state: OpenDocumentState): string {
  const pages: string[] = []
  for (let index = 0; index < state.document.countPages(); index += 1) {
    const page = state.document.loadPage(index)
    try {
      const structuredText = page.toStructuredText({})
      try {
        pages.push(structuredText.asText())
      } finally {
        destroyObject(structuredText)
      }
    } finally {
      destroyObject(page)
    }
  }
  return pages.join('\n\n')
}

function saveDocument(state: OpenDocumentState): PdfSaveResult {
  // subsetFonts()/garbage 收集会改写 PDF 对象，必须处于 operation 中，否则 MuPDF
  // 会对每次改写报 “Can't alter an object other than in an operation”。
  // 用隐式操作：保存属于内部维护，不应进入用户的撤销栈。
  state.document.beginImplicitOperation()
  let buffer: InstanceType<typeof mupdf.Buffer>
  try {
    try {
      state.document.subsetFonts()
    } catch (error) {
      throw new PdfWorkerError(
        'font-subset-failed',
        error instanceof Error ? error.message : 'Could not subset embedded fonts',
      )
    }
    buffer = state.document.saveToBuffer(
      'compress=yes,compress-fonts=yes,garbage=deduplicate,encrypt=keep',
    )
    if (buffer.length <= 0) {
      throw new PdfWorkerError('save-failed', 'MuPDF returned an empty PDF')
    }
    if (buffer.length > MAX_SAVE_BYTES) {
      throw new PdfWorkerError('pdf-too-large', 'The edited PDF exceeds the 100 MiB save limit')
    }
  } catch (error) {
    state.document.abandonOperation()
    throw error
  }
  state.document.endOperation()
  try {
    return { data: copyArrayBuffer(buffer.asUint8Array()) }
  } finally {
    destroyObject(buffer)
  }
}

async function handleRequest(request: PdfWorkerRequest): Promise<WorkerResult> {
  await initializeMuPdf()
  if (request.type === 'open') {
    disposeCurrent()
    let document: InstanceType<typeof mupdf.PDFDocument>
    try {
      document = new mupdf.PDFDocument(request.data)
    } catch (error) {
      throw new PdfWorkerError(
        'invalid-pdf',
        error instanceof Error ? error.message : 'Could not open the PDF',
      )
    }
    current = {
      documentId: request.documentId,
      document,
      encrypted: document.needsPassword()
        || Boolean(document.getMetaData(mupdf.Document.META_ENCRYPTION)),
      journalEnabled: false,
      fonts: new Map(),
    }
    if (document.needsPassword()) {
      const result: PdfOpenResult = {
        needsPassword: true,
        encrypted: true,
        canAnnotate: false,
        hasSignatures: false,
        pages: [],
        annotations: [],
        canUndo: false,
        canRedo: false,
        dirty: false,
      }
      return { result }
    }
    return { result: openResult(current) }
  }

  const state = requireDocument(request.documentId)
  if (request.type === 'close') {
    disposeCurrent()
    return { result: { closed: true } }
  }
  if (request.type === 'authenticate') {
    if (!state.document.needsPassword()) return { result: openResult(state) }
    if (state.document.authenticatePassword(request.password) <= 0) {
      return { result: { authenticated: false } }
    }
    return { result: { authenticated: true, document: openResult(state) } }
  }

  requireAuthenticated(state)
  if (request.type === 'render') {
    const result = renderPage(
      state,
      request.pageIndex,
      request.targetWidth,
      request.rotation,
    )
    return { result, transfer: [result.png] }
  }
  if (request.type === 'extractText') return { result: extractText(state) }
  if (request.type === 'loadTextLayer') {
    if (
      !Number.isInteger(request.pageIndex)
      || request.pageIndex < 0
      || request.pageIndex >= state.document.countPages()
    ) {
      throw new PdfWorkerError('invalid-page', 'The requested PDF page is out of range')
    }
    return { result: textLayerForPage(state, request.pageIndex) }
  }
  if (request.type === 'upsertText') {
    withOperation(state, 'Edit PDF text', () => {
      upsertTextAnnotation(state, request.annotation, request.fontData)
    })
    const result = mutationResult(state)
    return {
      result,
      transfer: result.annotations.flatMap((record) => (
        record.type === 'image' && record.previewPng ? [record.previewPng] : []
      )),
    }
  }
  if (request.type === 'replaceBodyText') {
    withOperation(state, 'Edit PDF text', () => {
      replaceBodyText(
        state,
        request.pageIndex,
        request.redactionRect,
        request.annotation,
        request.fontData,
        request.redactionRects,
      )
    })
    const result = mutationResult(state)
    return {
      result,
      transfer: result.annotations.flatMap((record) => (
        record.type === 'image' && record.previewPng ? [record.previewPng] : []
      )),
    }
  }
  if (request.type === 'createImage') {
    withOperation(state, 'Insert PDF image', () => {
      createImageAnnotation(state, request.annotation, request.imageData)
    })
    const result = mutationResult(state)
    return {
      result,
      transfer: result.annotations.flatMap((record) => (
        record.type === 'image' && record.previewPng ? [record.previewPng] : []
      )),
    }
  }
  if (request.type === 'updateImage') {
    withOperation(state, 'Move or resize PDF image', () => {
      updateImageAnnotation(state, request.annotation)
    })
    const result = mutationResult(state)
    return {
      result,
      transfer: result.annotations.flatMap((record) => (
        record.type === 'image' && record.previewPng ? [record.previewPng] : []
      )),
    }
  }
  if (request.type === 'updateGeometry') {
    withOperation(state, 'Move or resize PDF annotation', () => {
      updateAnnotationGeometry(state, request.annotation)
    })
    const result = mutationResult(state)
    return {
      result,
      transfer: result.annotations.flatMap((record) => (
        record.type === 'image' && record.previewPng ? [record.previewPng] : []
      )),
    }
  }
  if (request.type === 'deleteAnnotation') {
    withOperation(state, 'Delete PDF annotation', () => {
      deleteAnnotation(state, request.annotationId)
    })
    const result = mutationResult(state)
    return {
      result,
      transfer: result.annotations.flatMap((record) => (
        record.type === 'image' && record.previewPng ? [record.previewPng] : []
      )),
    }
  }
  if (request.type === 'undo' || request.type === 'redo') {
    if (!state.journalEnabled) throw new PdfWorkerError('editing-unavailable', 'PDF editing is unavailable')
    if (request.type === 'undo' && state.document.canUndo()) state.document.undo()
    if (request.type === 'redo' && state.document.canRedo()) state.document.redo()
    const result = mutationResult(state)
    return {
      result,
      transfer: result.annotations.flatMap((record) => (
        record.type === 'image' && record.previewPng ? [record.previewPng] : []
      )),
    }
  }
  if (request.type === 'save') {
    const result = saveDocument(state)
    return { result, transfer: [result.data] }
  }

  throw new PdfWorkerError('unsupported-request', 'Unsupported PDF worker request')
}

function postResponse(response: PdfWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, { transfer })
}

self.addEventListener('message', (event: MessageEvent<PdfWorkerRequest>) => {
  const request = event.data
  requestQueue = requestQueue.then(async () => {
    try {
      const response = await handleRequest(request)
      postResponse({
        requestId: request.requestId,
        documentId: request.documentId,
        ok: true,
        result: response.result,
      }, response.transfer)
    } catch (error) {
      postResponse({
        requestId: request.requestId,
        documentId: request.documentId,
        ok: false,
        error: {
          code: error instanceof PdfWorkerError ? error.code : 'pdf-worker-error',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  })
})
