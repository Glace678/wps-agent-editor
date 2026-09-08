import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { desktopApi } from '@/platform'
import { WaitingText } from '@/components/ui/animated-ellipsis'
import { useDocumentZoom } from '@/components/layout/modules/DocumentZoom'
import { useTranslation } from '@/lib/i18n/runtime'
import { cn } from '@/lib/utils'
import { useEditorStore } from '@/stores/editor.store'
import type { FileStatInfo } from '@/types/file'
import { documentBridge } from '../agent/document-bridge'
import { PdfToolbar, type PdfEditTool, type PdfFitMode, type PdfPageLayout } from '../components/PdfToolbar'
import { readFileBytes } from '../utils/file-io'
import {
  DEFAULT_OFFICE_FONT_FAMILY,
  loadSystemFontFaces,
  normalizeSystemFontFamilyName,
  type SystemFontFace,
} from '../utils/system-fonts'
import { MuPdfClientError, MuPdfWorkerClient } from '../pdf/mupdf-client'
import {
  normalizePdfRect,
  pdfCanonicalToViewRect,
  pdfViewSize,
  pdfViewToCanonicalRect,
} from '../pdf/pdf-coordinates'
import type {
  PdfAnnotationRecord,
  PdfFontDescriptor,
  PdfImageAnnotationRecord,
  PdfMutationResult,
  PdfNormalizedRect,
  PdfOpenResult,
  PdfPageInfo,
  PdfRotation,
  PdfTextAnnotationRecord,
} from '../pdf/mupdf-protocol'

const MAX_PAGE_CSS_WIDTH = 896
const CONTAINER_H_PADDING = 32
const PAGE_GAP = 16
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_IMAGE_PIXELS = 40_000_000

interface PdfViewerProps {
  filePath: string
  onReady: () => void
  onDirty: () => void
  onSaveSuccess: () => void
  onRegisterSave: (fn: (() => Promise<void>) | null) => void
}

type PdfUiImageAnnotation = Omit<PdfImageAnnotationRecord, 'previewPng'>
type PdfUiAnnotation = PdfTextAnnotationRecord | PdfUiImageAnnotation
type PdfTextPatch = Partial<Omit<PdfTextAnnotationRecord, 'id' | 'type' | 'pageIndex' | 'rect'>>
type PdfTextUpdate = PdfTextPatch | ((record: PdfTextAnnotationRecord) => PdfTextAnnotationRecord)

interface RenderedPage {
  url: string
  targetWidth: number
  rotation: PdfRotation
}

interface DragState {
  annotationId: string
  startX: number
  startY: number
  originalViewRect: PdfNormalizedRect
  pageWidth: number
  pageHeight: number
  resizeCorner: string | null
  moved: boolean
}

const RESIZE_HANDLE_STYLES: Record<string, CSSProperties> = {
  nw: { top: -4, left: -4, cursor: 'nwse-resize' },
  n: { top: -4, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' },
  ne: { top: -4, right: -4, cursor: 'nesw-resize' },
  e: { top: '50%', right: -4, transform: 'translateY(-50%)', cursor: 'ew-resize' },
  se: { bottom: -4, right: -4, cursor: 'nwse-resize' },
  s: { bottom: -4, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' },
  sw: { bottom: -4, left: -4, cursor: 'nesw-resize' },
  w: { top: '50%', left: -4, transform: 'translateY(-50%)', cursor: 'ew-resize' },
}

function pdfBaseFont(
  fontId: string,
  faceName: string,
  weight: number,
  style: SystemFontFace['style'],
): SystemFontFace {
  return {
    fontId,
    familyName: 'Helvetica',
    displayName: `Helvetica ${faceName}`,
    faceName,
    faceIndex: 0,
    weight,
    style,
    stretch: 5,
    embedding: 'installable',
    subsetAllowed: true,
    outlineEmbeddingAllowed: true,
  }
}

const PDF_BASE_FONTS = [
  pdfBaseFont('builtin:Helvetica', 'Regular', 400, 'normal'),
  pdfBaseFont('builtin:Helvetica-Bold', 'Bold', 700, 'normal'),
  pdfBaseFont('builtin:Helvetica-Oblique', 'Oblique', 400, 'oblique'),
  pdfBaseFont('builtin:Helvetica-BoldOblique', 'Bold Oblique', 700, 'oblique'),
]

const PDF_BASE_FONT = PDF_BASE_FONTS[0]

const PDF_MESSAGES = {
  en: {
    encryptedPrompt: 'This PDF is encrypted. Enter its password to continue.',
    passwordRetry: 'The password was not accepted. Try again.',
    passwordCancelled: 'The encrypted PDF was not opened because no password was provided.',
    readOnly: 'This PDF can be viewed, but its permissions do not allow annotations.',
    signed: 'This PDF contains signature fields. Changes can only be saved to a new file and may change signature verification status.',
    conflict: 'The file changed outside WPS Agent Editor. Select OK to reload it and discard these edits, or Cancel to save the edits as a new PDF.',
    invalidImage: 'Choose a PNG, JPEG, or WebP image whose MIME type matches its file contents.',
    imageTooLarge: 'Images are limited to 25 MiB and 40 million pixels.',
    saveCancelled: 'Save As was cancelled.',
  },
  zh: {
    encryptedPrompt: '此 PDF 已加密。请输入密码以继续。',
    passwordRetry: '密码不正确，请重试。',
    passwordCancelled: '未提供密码，已取消打开加密 PDF。',
    readOnly: '此 PDF 可以查看，但其权限不允许添加或修改注释。',
    signed: '此 PDF 包含签名字段，只能另存为新文件；后续修改可能改变签名验证状态。',
    conflict: '文件已被外部程序修改。选择“确定”将重新加载并放弃当前编辑；选择“取消”将把当前编辑另存为新 PDF。',
    invalidImage: '请选择 MIME 类型与文件内容一致的 PNG、JPEG 或 WebP 图片。',
    imageTooLarge: '图片不得超过 25 MiB 或 4000 万像素。',
    saveCancelled: '已取消另存为。',
  },
} as const

function pdfMessage(language: string, key: keyof typeof PDF_MESSAGES.en): string {
  return (language.toLowerCase().startsWith('zh') ? PDF_MESSAGES.zh : PDF_MESSAGES.en)[key]
}

function basePageWidth(clientWidth: number): number {
  return Math.max(64, Math.min(MAX_PAGE_CSS_WIDTH, clientWidth - CONTAINER_H_PADDING))
}

function clampZoom(value: number): number {
  return Math.min(Math.max(value, 0.1), 5)
}

function samePath(left: string, right: string): boolean {
  return desktopApi.app.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable
    || target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT'
}

function isZoomInKey(event: KeyboardEvent): boolean {
  return event.key === '+' || event.key === '=' || event.code === 'NumpadAdd'
}

function isZoomOutKey(event: KeyboardEvent): boolean {
  return event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract'
}

function isZoomResetKey(event: KeyboardEvent): boolean {
  return event.key === '0' || event.code === 'Digit0' || event.code === 'Numpad0'
}

function isDigitKey(event: KeyboardEvent, digit: 1 | 2): boolean {
  return event.key === String(digit)
    || event.code === `Digit${digit}`
    || event.code === `Numpad${digit}`
}

function standaloneBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function sameNumberArray(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function fontDescriptor(face: SystemFontFace): PdfFontDescriptor {
  return {
    fontId: face.fontId,
    familyName: face.familyName,
    faceIndex: face.faceIndex,
    weight: face.weight,
    style: face.style,
  }
}

function isPdfEmbeddableFont(face: SystemFontFace): boolean {
  return Boolean(face.fontId)
    && (face.embedding === 'installable' || face.embedding === 'editable')
    && face.subsetAllowed
    && face.outlineEmbeddingAllowed
}

function detectImageMime(bytes: Uint8Array): PdfImageAnnotationRecord['mimeType'] | null {
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

async function readImageDimensions(data: ArrayBuffer, mimeType: string): Promise<{ width: number; height: number }> {
  const blob = new Blob([data], { type: mimeType })
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    try {
      return { width: bitmap.width, height: bitmap.height }
    } finally {
      bitmap.close()
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => reject(new Error('Could not decode the image'))
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canonicalLayerStyle(
  rotation: PdfRotation,
  viewWidth: number,
  viewHeight: number,
): CSSProperties {
  const swapped = rotation === 90 || rotation === 270
  const width = swapped ? viewHeight : viewWidth
  const height = swapped ? viewWidth : viewHeight
  if (rotation === 90) {
    return { width, height, transform: `translateX(${viewWidth}px) rotate(90deg)`, transformOrigin: 'top left' }
  }
  if (rotation === 180) {
    return { width, height, transform: `translate(${viewWidth}px, ${viewHeight}px) rotate(180deg)`, transformOrigin: 'top left' }
  }
  if (rotation === 270) {
    return { width, height, transform: `translateY(${viewHeight}px) rotate(-90deg)`, transformOrigin: 'top left' }
  }
  return { width, height }
}

function editedPdfName(path: string): string {
  const name = path.split(/[/\\]/).pop() || 'document.pdf'
  return /\.pdf$/i.test(name) ? name.replace(/\.pdf$/i, '-edited.pdf') : `${name}-edited.pdf`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function PdfViewer({
  filePath,
  onReady,
  onDirty,
  onSaveSuccess,
  onRegisterSave,
}: PdfViewerProps) {
  const { t, language } = useTranslation()
  const setCurrentFile = useEditorStore((state) => state.setCurrentFile)
  const { zoom, zoomIn, zoomOut, zoomReset, setZoomPercent } = useDocumentZoom()

  const [pages, setPages] = useState<PdfPageInfo[]>([])
  const [annotations, setAnnotations] = useState<PdfUiAnnotation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [rotation, setRotation] = useState<PdfRotation>(0)
  const [layout, setLayout] = useState<PdfPageLayout>('single')
  const [fitMode, setFitMode] = useState<PdfFitMode>('custom')
  const [fitZoom, setFitZoom] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [renderTargets, setRenderTargets] = useState<number[]>([])
  const [, setRenderRevision] = useState(0)
  const [canAnnotate, setCanAnnotate] = useState(false)
  const [hasSignatures, setHasSignatures] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  const [editMode, setEditMode] = useState(false)
  const [currentTool, setCurrentTool] = useState<PdfEditTool>(null)
  const [selectedAnnotId, setSelectedAnnotId] = useState<string | null>(null)
  const [editFontFamily, setEditFontFamily] = useState(DEFAULT_OFFICE_FONT_FAMILY)
  const [editFontSize, setEditFontSize] = useState(14)
  const [editFontBold, setEditFontBold] = useState(false)
  const [editFontItalic, setEditFontItalic] = useState(false)
  const [editFontUnderline, setEditFontUnderline] = useState(false)
  const [editFontColor, setEditFontColor] = useState('#000000')
  const [systemFontFaces, setSystemFontFaces] = useState<SystemFontFace[]>([])
  const [canUndoEdit, setCanUndoEdit] = useState(false)
  const [canRedoEdit, setCanRedoEdit] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const focusPageInputRef = useRef<(() => void) | null>(null)
  const clientRef = useRef<MuPdfWorkerClient | null>(null)
  const documentGenerationRef = useRef(0)
  const renderEpochRef = useRef(0)
  const renderedPagesRef = useRef(new Map<number, RenderedPage>())
  const previewUrlsRef = useRef(new Map<string, string>())
  const pagesRef = useRef<PdfPageInfo[]>([])
  const annotationsRef = useRef<PdfUiAnnotation[]>([])
  const baselineRef = useRef<FileStatInfo | null>(null)
  const dirtyRef = useRef(false)
  const currentPageRef = useRef(1)
  const rotationRef = useRef<PdfRotation>(0)
  const layoutRef = useRef<PdfPageLayout>('single')
  const fitModeRef = useRef<PdfFitMode>('custom')
  const fitZoomRef = useRef<number | null>(null)
  const loadedWorkerFontsRef = useRef(new Set<string>())
  const fontBytesRef = useRef(new Map<string, Promise<Uint8Array>>())
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve())
  const dragStateRef = useRef<DragState | null>(null)
  const editStyleRef = useRef({ bold: false, italic: false, underline: false })
  const editModeRef = useRef(editMode)
  const selectedAnnotIdRef = useRef<string | null>(null)

  const setSelectedAnnotationId = useCallback((annotationId: string | null) => {
    selectedAnnotIdRef.current = annotationId
    setSelectedAnnotId(annotationId)
  }, [])

  pagesRef.current = pages
  annotationsRef.current = annotations
  currentPageRef.current = currentPage
  rotationRef.current = rotation
  layoutRef.current = layout
  fitModeRef.current = fitMode
  fitZoomRef.current = fitZoom
  editModeRef.current = editMode
  selectedAnnotIdRef.current = selectedAnnotId

  const eligibleFontFaces = useMemo(
    () => [...PDF_BASE_FONTS, ...systemFontFaces.filter(isPdfEmbeddableFont)],
    [systemFontFaces],
  )

  const syncTextEditState = useCallback((record: PdfTextAnnotationRecord) => {
    const bold = record.font.weight >= 700
    const italic = record.font.style !== 'normal'
    editStyleRef.current = { bold, italic, underline: record.underline }
    setEditFontFamily(record.font.familyName)
    setEditFontSize(record.fontSize)
    setEditFontBold(bold)
    setEditFontItalic(italic)
    setEditFontUnderline(record.underline)
    setEditFontColor(record.color)
  }, [])

  const clearRenderedPages = useCallback(() => {
    renderEpochRef.current += 1
    for (const rendered of renderedPagesRef.current.values()) URL.revokeObjectURL(rendered.url)
    renderedPagesRef.current.clear()
    setRenderRevision((value) => value + 1)
  }, [])

  const clearPreviewUrls = useCallback(() => {
    for (const url of previewUrlsRef.current.values()) URL.revokeObjectURL(url)
    previewUrlsRef.current.clear()
  }, [])

  const installAnnotations = useCallback((records: PdfAnnotationRecord[]) => {
    const previousUrls = previewUrlsRef.current
    const nextUrls = new Map<string, string>()
    const nextRecords: PdfUiAnnotation[] = records.map((record) => {
      if (record.type === 'text') return record
      let previewUrl = previousUrls.get(record.id)
      if (record.previewPng) {
        previewUrl = URL.createObjectURL(new Blob([record.previewPng], { type: 'image/png' }))
      }
      if (previewUrl) nextUrls.set(record.id, previewUrl)
      return {
        id: record.id,
        type: record.type,
        pageIndex: record.pageIndex,
        rect: record.rect,
        mimeType: record.mimeType,
      }
    })
    for (const [id, url] of previousUrls) {
      if (nextUrls.get(id) !== url) URL.revokeObjectURL(url)
    }
    previewUrlsRef.current = nextUrls
    annotationsRef.current = nextRecords
    setAnnotations(nextRecords)
    const selected = selectedAnnotIdRef.current
    if (selected && !nextRecords.some((record) => record.id === selected)) {
      setSelectedAnnotationId(null)
    }
  }, [setSelectedAnnotationId])

  const setDirty = useCallback((dirty: boolean) => {
    if (dirtyRef.current === dirty) return
    dirtyRef.current = dirty
    if (dirty) onDirty()
    else onSaveSuccess()
  }, [onDirty, onSaveSuccess])

  const applyMutationResult = useCallback((result: PdfMutationResult) => {
    installAnnotations(result.annotations)
    setCanUndoEdit(result.canUndo)
    setCanRedoEdit(result.canRedo)
    setDirty(result.dirty)
  }, [installAnnotations, setDirty])

  const showOperationError = useCallback((operation: string, cause: unknown) => {
    console.error(`[PdfViewer] ${operation}:`, cause)
    window.alert(errorMessage(cause))
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadSystemFontFaces(language)
      .then((faces) => {
        if (!cancelled) setSystemFontFaces(faces)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [language])

  useEffect(() => {
    const currentFamily = normalizeSystemFontFamilyName(editFontFamily)
    if (eligibleFontFaces.some((face) => normalizeSystemFontFamilyName(face.familyName) === currentFamily)) return
    const preferred = eligibleFontFaces.find(
      (face) => normalizeSystemFontFamilyName(face.familyName) === normalizeSystemFontFamilyName(DEFAULT_OFFICE_FONT_FAMILY),
    ) ?? eligibleFontFaces[0]
    setEditFontFamily(preferred.familyName)
  }, [editFontFamily, eligibleFontFaces])

  useEffect(() => {
    const generation = ++documentGenerationRef.current
    const client = new MuPdfWorkerClient(crypto.randomUUID())
    clientRef.current?.dispose()
    clientRef.current = client
    loadedWorkerFontsRef.current.clear()
    mutationQueueRef.current = Promise.resolve()
    baselineRef.current = null
    dirtyRef.current = false
    clearRenderedPages()
    clearPreviewUrls()
    documentBridge.clear()
    setPages([])
    setAnnotations([])
    annotationsRef.current = []
    setRenderTargets([])
    setLoading(true)
    setError(null)
    setCanAnnotate(false)
    setHasSignatures(false)
    setCanUndoEdit(false)
    setCanRedoEdit(false)
    setEditMode(false)
    setCurrentTool(null)
    setSelectedAnnotationId(null)
    setEditFontFamily(DEFAULT_OFFICE_FONT_FAMILY)
    setEditFontSize(14)
    setEditFontBold(false)
    setEditFontItalic(false)
    setEditFontUnderline(false)
    setEditFontColor('#000000')
    editStyleRef.current = { bold: false, italic: false, underline: false }
    setRotation(0)
    rotationRef.current = 0
    setCurrentPage(1)
    currentPageRef.current = 1
    let extractTimer: number | null = null

    const applyOpenResult = (result: PdfOpenResult, stat: FileStatInfo) => {
      if (documentGenerationRef.current !== generation || clientRef.current !== client) return
      pagesRef.current = result.pages
      setPages(result.pages)
      installAnnotations(result.annotations)
      setCanAnnotate(result.canAnnotate)
      setHasSignatures(result.hasSignatures)
      setCanUndoEdit(result.canUndo)
      setCanRedoEdit(result.canRedo)
      setRenderTargets(result.pages.slice(0, 3).map((page) => page.index))
      baselineRef.current = stat
      setLoading(false)
      onReady()
      extractTimer = window.setTimeout(() => {
        void client.extractText()
          .then((text) => {
            if (documentGenerationRef.current === generation && clientRef.current === client) {
              documentBridge.setPdf(text, filePath)
            }
          })
          .catch((cause) => console.warn('[PdfViewer] text extraction failed:', cause))
      }, 750)
    }

    void (async () => {
      try {
        const [bytes, stat] = await Promise.all([
          readFileBytes(filePath),
          desktopApi.files.stat(filePath),
        ])
        if (documentGenerationRef.current !== generation || clientRef.current !== client) return
        let result = await client.open(standaloneBuffer(bytes))
        let retry = false
        while (result.needsPassword) {
          const password = window.prompt(pdfMessage(language, retry ? 'passwordRetry' : 'encryptedPrompt'))
          if (password == null) {
            throw new MuPdfClientError('password-cancelled', pdfMessage(language, 'passwordCancelled'))
          }
          const authenticated = await client.authenticate(password)
          if (!authenticated.authenticated || !authenticated.document) {
            retry = true
            continue
          }
          result = authenticated.document
        }
        applyOpenResult(result, stat)
      } catch (cause) {
        if (documentGenerationRef.current !== generation || clientRef.current !== client) return
        console.error('[PdfViewer] load error:', cause)
        setLoading(false)
        setError(errorMessage(cause))
      }
    })()

    return () => {
      documentGenerationRef.current += 1
      if (extractTimer != null) window.clearTimeout(extractTimer)
      if (clientRef.current === client) clientRef.current = null
      client.dispose()
      clearRenderedPages()
      clearPreviewUrls()
      documentBridge.clear()
    }
  }, [clearPreviewUrls, clearRenderedPages, filePath, installAnnotations, language, onReady, reloadToken, setSelectedAnnotationId])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const update = () => setContainerWidth(element.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const effectiveZoom = fitMode !== 'custom' && fitZoom != null ? fitZoom : clampZoom(zoom)
  const displayWidth = Math.max(64, Math.round(basePageWidth(containerWidth) * effectiveZoom))
  const displayPercent = Math.round(effectiveZoom * 100)

  const applyFit = useCallback((mode: 'page' | 'width') => {
    const element = scrollRef.current
    const page = pagesRef.current[currentPageRef.current - 1] ?? pagesRef.current[0]
    if (!element || !page) return
    const view = pdfViewSize(page, rotationRef.current)
    const innerWidth = element.clientWidth - CONTAINER_H_PADDING
    const innerHeight = element.clientHeight - CONTAINER_H_PADDING
    const baseWidth = basePageWidth(element.clientWidth)
    if (innerWidth <= 40 || innerHeight <= 40 || baseWidth <= 0) return
    const perPageWidth = layoutRef.current === 'two' ? (innerWidth - PAGE_GAP) / 2 : innerWidth
    let next = perPageWidth / baseWidth
    if (mode === 'page') {
      next = Math.min(next, innerHeight / (baseWidth * (view.height / view.width)))
    }
    next = clampZoom(next)
    fitZoomRef.current = next
    setFitZoom(next)
  }, [])

  useEffect(() => {
    if (fitMode !== 'custom') applyFit(fitMode)
  }, [applyFit, containerWidth, currentPage, fitMode, layout, rotation])

  const exitFitMode = useCallback(() => {
    if (fitModeRef.current === 'custom') return
    const currentFit = fitZoomRef.current
    fitModeRef.current = 'custom'
    fitZoomRef.current = null
    setFitMode('custom')
    setFitZoom(null)
    if (currentFit != null) setZoomPercent(Math.round(currentFit * 100))
  }, [setZoomPercent])

  const zoomInPdf = useCallback(() => {
    exitFitMode()
    zoomIn()
  }, [exitFitMode, zoomIn])
  const zoomOutPdf = useCallback(() => {
    exitFitMode()
    zoomOut()
  }, [exitFitMode, zoomOut])
  const zoomResetPdf = useCallback(() => {
    exitFitMode()
    zoomReset()
  }, [exitFitMode, zoomReset])

  const toggleFit = useCallback((mode: 'page' | 'width') => {
    if (fitModeRef.current === mode) {
      exitFitMode()
      return
    }
    fitModeRef.current = mode
    setFitMode(mode)
    applyFit(mode)
  }, [applyFit, exitFitMode])

  const setLayoutMode = useCallback((mode: PdfPageLayout) => {
    layoutRef.current = mode
    setLayout(mode)
  }, [])

  const goToPage = useCallback((value: number) => {
    const element = scrollRef.current
    const total = pagesRef.current.length
    if (!element || total === 0) return
    const pageNumber = Math.min(Math.max(Math.round(value) || 1, 1), total)
    const page = element.querySelector<HTMLElement>(`[data-page-num="${pageNumber}"]`)
    if (!page) return
    const top = page.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop
    element.scrollTo({ top: Math.max(0, top - PAGE_GAP) })
    currentPageRef.current = pageNumber
    setCurrentPage(pageNumber)
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element || pages.length === 0) return
    let frame = 0
    const update = () => {
      frame = 0
      const viewport = element.getBoundingClientRect()
      const visible: number[] = []
      let nearest = currentPageRef.current - 1
      let nearestDistance = Number.POSITIVE_INFINITY
      element.querySelectorAll<HTMLElement>('[data-page-num]').forEach((page) => {
        const index = Math.max(0, Number(page.dataset.pageNum) - 1)
        const rect = page.getBoundingClientRect()
        if (rect.bottom >= viewport.top && rect.top <= viewport.bottom) visible.push(index)
        const distance = Math.abs((rect.top + rect.bottom) / 2 - (viewport.top + viewport.height / 2))
        if (distance < nearestDistance) {
          nearest = index
          nearestDistance = distance
        }
      })
      const pageNumber = nearest + 1
      if (pageNumber !== currentPageRef.current) {
        currentPageRef.current = pageNumber
        setCurrentPage(pageNumber)
      }
      const first = visible.length > 0 ? Math.min(...visible) : nearest
      const last = visible.length > 0 ? Math.max(...visible) : nearest
      const targets: number[] = []
      for (let index = Math.max(0, first - 2); index <= Math.min(pages.length - 1, last + 2); index += 1) {
        targets.push(index)
      }
      setRenderTargets((previous) => sameNumberArray(previous, targets) ? previous : targets)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    element.addEventListener('scroll', schedule, { passive: true })
    update()
    return () => {
      element.removeEventListener('scroll', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [displayWidth, layout, pages.length, rotation])

  useEffect(() => {
    const client = clientRef.current
    if (!client || pages.length === 0) return
    const epoch = ++renderEpochRef.current
    const targets = new Set(renderTargets)
    let changed = false
    for (const [index, rendered] of renderedPagesRef.current) {
      if (!targets.has(index)) {
        URL.revokeObjectURL(rendered.url)
        renderedPagesRef.current.delete(index)
        changed = true
      }
    }
    if (changed) setRenderRevision((value) => value + 1)

    const deviceScale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3)
    const targetWidth = Math.max(64, Math.round(displayWidth * deviceScale))
    for (const pageIndex of renderTargets) {
      const currentRendered = renderedPagesRef.current.get(pageIndex)
      if (
        currentRendered
        && currentRendered.rotation === rotation
        && targetWidth >= currentRendered.targetWidth * 0.9
        && targetWidth <= currentRendered.targetWidth * 1.1
      ) continue
      void client.render(pageIndex, targetWidth, rotation)
        .then((result) => {
          if (renderEpochRef.current !== epoch || clientRef.current !== client || !targets.has(pageIndex)) return
          const url = URL.createObjectURL(new Blob([result.png], { type: 'image/png' }))
          const previous = renderedPagesRef.current.get(pageIndex)
          renderedPagesRef.current.set(pageIndex, { url, targetWidth, rotation })
          if (previous) URL.revokeObjectURL(previous.url)
          setRenderRevision((value) => value + 1)
        })
        .catch((cause) => console.error('[PdfViewer] page render failed:', pageIndex + 1, cause))
    }
  }, [displayWidth, pages.length, renderTargets, rotation])

  const selectFontFace = useCallback((family: string, bold: boolean, italic: boolean): SystemFontFace => {
    const key = normalizeSystemFontFamilyName(family)
    const familyFaces = eligibleFontFaces.filter(
      (face) => normalizeSystemFontFamilyName(face.familyName) === key,
    )
    if (familyFaces.length === 0) return PDF_BASE_FONT
    const targetWeight = bold ? 700 : 400
    return [...familyFaces].sort((left, right) => {
      const leftItalic = left.style !== 'normal'
      const rightItalic = right.style !== 'normal'
      return Math.abs(left.weight - targetWeight) - Math.abs(right.weight - targetWeight)
        || Number(leftItalic !== italic) - Number(rightItalic !== italic)
    })[0]
  }, [eligibleFontFaces])

  const fontTransfer = useCallback(async (font: PdfFontDescriptor): Promise<ArrayBuffer | undefined> => {
    if (font.fontId.startsWith('builtin:') || loadedWorkerFontsRef.current.has(font.fontId)) return undefined
    let request = fontBytesRef.current.get(font.fontId)
    if (!request) {
      request = desktopApi.documents.readFont(font.fontId)
      fontBytesRef.current.set(font.fontId, request)
    }
    return standaloneBuffer(await request)
  }, [])

  const queueMutation = useCallback((
    client: MuPdfWorkerClient,
    operation: () => Promise<PdfMutationResult>,
    description: string,
    synchronizeSelection = false,
  ) => {
    const run = async () => {
      if (clientRef.current !== client) return
      try {
        const result = await operation()
        if (clientRef.current === client) {
          applyMutationResult(result)
          if (synchronizeSelection && selectedAnnotIdRef.current) {
            const selected = result.annotations.find(
              (record) => record.id === selectedAnnotIdRef.current,
            )
            if (!selected) setSelectedAnnotationId(null)
            else if (selected.type === 'text') syncTextEditState(selected)
          }
        }
      } catch (cause) {
        if (clientRef.current === client) showOperationError(description, cause)
      }
    }
    const next = mutationQueueRef.current.then(run, run)
    mutationQueueRef.current = next.catch(() => {})
  }, [applyMutationResult, setSelectedAnnotationId, showOperationError, syncTextEditState])

  const upsertText = useCallback(async (
    client: MuPdfWorkerClient,
    record: PdfTextAnnotationRecord,
  ): Promise<PdfMutationResult> => {
    const data = await fontTransfer(record.font)
    const result = await client.upsertText(record, data)
    if (!record.font.fontId.startsWith('builtin:')) {
      loadedWorkerFontsRef.current.add(record.font.fontId)
    }
    return result
  }, [fontTransfer])

  const commitText = useCallback((record: PdfTextAnnotationRecord) => {
    const client = clientRef.current
    if (!client) return
    queueMutation(client, () => upsertText(client, record), 'edit text')
  }, [queueMutation, upsertText])

  const selectAnnotation = useCallback((record: PdfUiAnnotation) => {
    setSelectedAnnotationId(record.id)
    if (record.type !== 'text') return
    syncTextEditState(record)
  }, [setSelectedAnnotationId, syncTextEditState])

  const updateSelectedText = useCallback((update: PdfTextUpdate) => {
    const client = clientRef.current
    const annotationId = selectedAnnotIdRef.current
    if (!client || !annotationId) return
    queueMutation(client, () => {
      const record = annotationsRef.current.find(
        (annotation): annotation is PdfTextAnnotationRecord => (
          annotation.id === annotationId && annotation.type === 'text'
        ),
      )
      if (!record) {
        throw new MuPdfClientError('annotation-not-found', 'The selected PDF text no longer exists')
      }
      const next = typeof update === 'function' ? update(record) : { ...record, ...update }
      return upsertText(client, next)
    }, 'edit text')
  }, [queueMutation, upsertText])

  const toggleBold = useCallback(() => {
    const bold = !editStyleRef.current.bold
    editStyleRef.current.bold = bold
    setEditFontBold(bold)
    updateSelectedText((record) => ({
      ...record,
      font: fontDescriptor(selectFontFace(
        record.font.familyName,
        bold,
        record.font.style !== 'normal',
      )),
    }))
  }, [selectFontFace, updateSelectedText])

  const toggleItalic = useCallback(() => {
    const italic = !editStyleRef.current.italic
    editStyleRef.current.italic = italic
    setEditFontItalic(italic)
    updateSelectedText((record) => ({
      ...record,
      font: fontDescriptor(selectFontFace(
        record.font.familyName,
        record.font.weight >= 700,
        italic,
      )),
    }))
  }, [selectFontFace, updateSelectedText])

  const toggleUnderline = useCallback(() => {
    const underline = !editStyleRef.current.underline
    editStyleRef.current.underline = underline
    setEditFontUnderline(underline)
    updateSelectedText({ underline })
  }, [updateSelectedText])

  const addTextAnnotation = useCallback((
    pageIndex: number,
    viewX: number,
    viewY: number,
    pageWidth: number,
    pageHeight: number,
  ) => {
    const face = selectFontFace(editFontFamily, editFontBold, editFontItalic)
    const viewRect = normalizePdfRect({
      x: viewX,
      y: viewY,
      width: Math.min(0.42, 180 / Math.max(pageWidth, 1)),
      height: Math.min(0.2, Math.max(28, editFontSize * 1.8) / Math.max(pageHeight, 1)),
    })
    const record: PdfTextAnnotationRecord = {
      id: crypto.randomUUID(),
      type: 'text',
      pageIndex,
      rect: pdfViewToCanonicalRect(viewRect, rotationRef.current),
      text: t('pdfViewer.editTextPlaceholder'),
      font: fontDescriptor(face),
      fontSize: editFontSize,
      underline: editFontUnderline,
      color: editFontColor,
    }
    setSelectedAnnotationId(record.id)
    commitText(record)
  }, [commitText, editFontBold, editFontColor, editFontFamily, editFontItalic, editFontSize, editFontUnderline, selectFontFace, setSelectedAnnotationId, t])

  const handleImageFile = useCallback(async (file: File) => {
    try {
      if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
        throw new Error(pdfMessage(language, 'imageTooLarge'))
      }
      const declared = file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp'
        ? file.type
        : null
      const data = await file.arrayBuffer()
      const detected = detectImageMime(new Uint8Array(data))
      if (!declared || declared !== detected) throw new Error(pdfMessage(language, 'invalidImage'))
      const dimensions = await readImageDimensions(data, declared)
      if (dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
        throw new Error(pdfMessage(language, 'imageTooLarge'))
      }
      const pageIndex = Math.max(0, currentPageRef.current - 1)
      const pageElement = scrollRef.current?.querySelector<HTMLElement>(`[data-page-num="${pageIndex + 1}"]`)
      const pageRect = pageElement?.getBoundingClientRect()
      if (!pageRect) throw new Error('The active PDF page is not available')
      const width = Math.min(0.6, Math.max(0.08, dimensions.width / pageRect.width))
      const height = Math.min(
        0.8,
        Math.max(0.04, width * pageRect.width * (dimensions.height / dimensions.width) / pageRect.height),
      )
      const viewRect = normalizePdfRect({ x: (1 - width) / 2, y: 0.06, width, height })
      const record: PdfImageAnnotationRecord = {
        id: crypto.randomUUID(),
        type: 'image',
        pageIndex,
        rect: pdfViewToCanonicalRect(viewRect, rotationRef.current),
        mimeType: declared,
      }
      const client = clientRef.current
      if (!client) return
      setSelectedAnnotationId(record.id)
      setCurrentTool(null)
      queueMutation(client, () => client.createImage(record, data), 'insert image')
    } catch (cause) {
      showOperationError('insert image', cause)
    }
  }, [language, queueMutation, setSelectedAnnotationId, showOperationError])

  const removeSelectedAnnotation = useCallback(() => {
    const id = selectedAnnotIdRef.current
    if (!id) return
    const client = clientRef.current
    if (!client) return
    setSelectedAnnotationId(null)
    queueMutation(client, () => client.deleteAnnotation(id), 'delete annotation')
  }, [queueMutation, setSelectedAnnotationId])

  const undoEdit = useCallback(() => {
    const client = clientRef.current
    if (client) queueMutation(client, () => client.undo(), 'undo', true)
  }, [queueMutation])

  const redoEdit = useCallback(() => {
    const client = clientRef.current
    if (client) queueMutation(client, () => client.redo(), 'redo', true)
  }, [queueMutation])

  const editShortcutActionsRef = useRef({
    redoEdit,
    removeSelectedAnnotation,
    toggleBold,
    toggleItalic,
    toggleUnderline,
    undoEdit,
  })
  editShortcutActionsRef.current = {
    redoEdit,
    removeSelectedAnnotation,
    toggleBold,
    toggleItalic,
    toggleUnderline,
    undoEdit,
  }

  const startAnnotationDrag = useCallback((
    event: React.PointerEvent<HTMLDivElement>,
    annotation: PdfUiAnnotation,
  ) => {
    if (!editMode || event.button !== 0) return
    if ((event.target as HTMLElement).isContentEditable) return
    event.preventDefault()
    event.stopPropagation()
    selectAnnotation(annotation)
    const pageElement = scrollRef.current?.querySelector<HTMLElement>(
      `[data-page-num="${annotation.pageIndex + 1}"]`,
    )
    const pageRect = pageElement?.getBoundingClientRect()
    if (!pageRect) return
    const target = event.target as HTMLElement
    dragStateRef.current = {
      annotationId: annotation.id,
      startX: event.clientX,
      startY: event.clientY,
      originalViewRect: pdfCanonicalToViewRect(annotation.rect, rotationRef.current),
      pageWidth: pageRect.width,
      pageHeight: pageRect.height,
      resizeCorner: target.classList.contains('pdf-annot-resize-handle')
        ? target.dataset.corner ?? null
        : null,
      moved: false,
    }

    const onMove = (moveEvent: PointerEvent) => {
      const state = dragStateRef.current
      if (!state || state.annotationId !== annotation.id) return
      const dx = (moveEvent.clientX - state.startX) / state.pageWidth
      const dy = (moveEvent.clientY - state.startY) / state.pageHeight
      if (Math.abs(dx) + Math.abs(dy) > 0.001) state.moved = true
      const original = state.originalViewRect
      let next = { ...original }
      const minWidth = 20 / state.pageWidth
      const minHeight = 20 / state.pageHeight
      if (state.resizeCorner) {
        if (state.resizeCorner.includes('e')) next.width = original.width + dx
        if (state.resizeCorner.includes('w')) {
          next.width = original.width - dx
          next.x = original.x + dx
        }
        if (state.resizeCorner.includes('s')) next.height = original.height + dy
        if (state.resizeCorner.includes('n')) {
          next.height = original.height - dy
          next.y = original.y + dy
        }
        next.width = Math.max(next.width, minWidth)
        next.height = Math.max(next.height, minHeight)
      } else {
        next.x = original.x + dx
        next.y = original.y + dy
      }
      next = normalizePdfRect(next)
      const canonical = pdfViewToCanonicalRect(next, rotationRef.current)
      const updated = annotationsRef.current.map((record) => (
        record.id === annotation.id ? { ...record, rect: canonical } : record
      ))
      annotationsRef.current = updated
      setAnnotations(updated)
    }

    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      const state = dragStateRef.current
      dragStateRef.current = null
      if (!state?.moved) return
      const currentAnnotation = annotationsRef.current.find((record) => record.id === annotation.id)
      const client = clientRef.current
      if (currentAnnotation && client) {
        queueMutation(client, () => client.updateGeometry(currentAnnotation), 'move or resize annotation')
      }
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [editMode, queueMutation, selectAnnotation])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!editModeRef.current) return
      const actions = editShortcutActionsRef.current
      const key = event.key.toLowerCase()
      const commandKey = event.ctrlKey || event.metaKey
      const formatShortcut = commandKey && !event.altKey && !event.shiftKey
        && (key === 'b' || key === 'i' || key === 'u')
      if (isEditableTarget(event.target) && !formatShortcut) return
      if (event.key === 'Escape') {
        setSelectedAnnotationId(null)
        setCurrentTool(null)
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedAnnotIdRef.current) {
        event.preventDefault()
        actions.removeSelectedAnnotation()
        return
      }
      if (!commandKey || event.altKey) return
      if (!event.shiftKey && key === 'b') {
        event.preventDefault()
        actions.toggleBold()
      } else if (!event.shiftKey && key === 'i') {
        event.preventDefault()
        actions.toggleItalic()
      } else if (!event.shiftKey && key === 'u') {
        event.preventDefault()
        actions.toggleUnderline()
      } else if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) actions.redoEdit()
        else actions.undoEdit()
      } else if (key === 'y') {
        event.preventDefault()
        actions.redoEdit()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [setSelectedAnnotationId])

  useEffect(() => {
    const element = rootRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return
      event.preventDefault()
      event.stopPropagation()
      if (event.deltaY < 0) zoomInPdf()
      else zoomOutPdf()
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [zoomInPdf, zoomOutPdf])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const editable = isEditableTarget(event.target)
      if (event.shiftKey) {
        if (isDigitKey(event, 1) && !editable) {
          event.preventDefault()
          setLayoutMode('single')
        } else if (isDigitKey(event, 2) && !editable) {
          event.preventDefault()
          setLayoutMode('two')
        } else if (isZoomInKey(event)) {
          event.preventDefault()
          setRotation((value) => ((value + 90) % 360) as PdfRotation)
        } else if (isZoomOutKey(event)) {
          event.preventDefault()
          setRotation((value) => ((value + 270) % 360) as PdfRotation)
        }
        return
      }
      if (isDigitKey(event, 1) && !editable) {
        event.preventDefault()
        toggleFit('page')
      } else if (isDigitKey(event, 2) && !editable) {
        event.preventDefault()
        toggleFit('width')
      } else if ((event.key.toLowerCase() === 'g' || event.code === 'KeyG') && !editable) {
        event.preventDefault()
        focusPageInputRef.current?.()
      } else if (isZoomInKey(event)) {
        event.preventDefault()
        zoomInPdf()
      } else if (isZoomOutKey(event)) {
        event.preventDefault()
        zoomOutPdf()
      } else if (isZoomResetKey(event)) {
        event.preventDefault()
        zoomResetPdf()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [setLayoutMode, toggleFit, zoomInPdf, zoomOutPdf, zoomResetPdf])

  const saveDocument = useCallback(async () => {
    const client = clientRef.current
    if (!client || !dirtyRef.current || saving) return
    setSaving(true)
    try {
      await mutationQueueRef.current
      if (clientRef.current !== client) {
        throw new MuPdfClientError('stale-document', 'The PDF changed before it could be saved')
      }
      let targetPath = filePath
      let saveAs = hasSignatures
      if (hasSignatures) window.alert(pdfMessage(language, 'signed'))

      if (!saveAs && baselineRef.current) {
        const latest = await desktopApi.files.stat(filePath)
        const baseline = baselineRef.current
        if (latest.size !== baseline.size || latest.modifiedAt !== baseline.modifiedAt) {
          const reload = window.confirm(pdfMessage(language, 'conflict'))
          if (reload) {
            dirtyRef.current = false
            onSaveSuccess()
            setReloadToken((value) => value + 1)
            return
          }
          saveAs = true
        }
      }

      if (saveAs) {
        const selected = await desktopApi.files.selectSaveFile(editedPdfName(filePath))
        if (!selected) throw new MuPdfClientError('save-cancelled', pdfMessage(language, 'saveCancelled'))
        targetPath = selected.path
      }

      const result = await client.save()
      await desktopApi.documents.saveBinary(targetPath, new Uint8Array(result.data))
      dirtyRef.current = false
      onSaveSuccess()
      if (samePath(targetPath, filePath)) {
        baselineRef.current = await desktopApi.files.stat(filePath)
        setReloadToken((value) => value + 1)
      } else {
        void desktopApi.files.open(targetPath)
        setCurrentFile(targetPath, targetPath.split(/[/\\]/).pop() || targetPath)
      }
    } catch (error) {
      if (!(error instanceof MuPdfClientError && error.code === 'save-cancelled')) {
        window.alert(errorMessage(error))
      }
      throw error
    } finally {
      setSaving(false)
    }
  }, [filePath, hasSignatures, language, onSaveSuccess, saving, setCurrentFile])

  useEffect(() => {
    onRegisterSave(saveDocument)
    return () => onRegisterSave(null)
  }, [onRegisterSave, saveDocument])

  const previousDisplayWidthRef = useRef(0)
  useLayoutEffect(() => {
    const element = scrollRef.current
    const previous = previousDisplayWidthRef.current
    previousDisplayWidthRef.current = displayWidth
    if (!element || previous <= 0 || previous === displayWidth || pages.length === 0) return
    const ratio = displayWidth / previous
    const centerY = element.scrollTop + element.clientHeight / 2
    element.scrollTop = centerY * ratio - element.clientHeight / 2
    const centerX = element.scrollLeft + element.clientWidth / 2
    element.scrollLeft = centerX * ratio - element.clientWidth / 2
  }, [displayWidth, pages.length])

  const selectedText = selectedAnnotId
    ? annotations.find((record): record is PdfTextAnnotationRecord => (
        record.id === selectedAnnotId && record.type === 'text'
      ))
    : undefined

  return (
    <div ref={rootRef} data-manages-document-zoom className="flex h-full min-h-0 flex-col">
      <PdfToolbar
        currentPage={currentPage}
        totalPages={pages.length}
        percent={displayPercent}
        fitMode={fitMode}
        layout={layout}
        editMode={editMode}
        editEnabled={canAnnotate && !loading && !saving}
        currentTool={currentTool}
        fontSize={editFontSize}
        fontWeight={editFontBold ? 700 : 400}
        fontItalic={editFontItalic}
        fontUnderline={editFontUnderline}
        fontColor={editFontColor}
        fontFamily={editFontFamily}
        fontFaces={eligibleFontFaces}
        canUndoEdit={canUndoEdit}
        canRedoEdit={canRedoEdit}
        onPrevPage={() => goToPage(currentPageRef.current - 1)}
        onNextPage={() => goToPage(currentPageRef.current + 1)}
        onGoToPage={goToPage}
        onZoomIn={zoomInPdf}
        onZoomOut={zoomOutPdf}
        onZoomReset={zoomResetPdf}
        onFitPage={() => toggleFit('page')}
        onFitWidth={() => toggleFit('width')}
        onRotateLeft={() => setRotation((value) => ((value + 270) % 360) as PdfRotation)}
        onRotateRight={() => setRotation((value) => ((value + 90) % 360) as PdfRotation)}
        onLayoutSingle={() => setLayoutMode('single')}
        onLayoutTwo={() => setLayoutMode('two')}
        onToggleEditMode={() => {
          if (!canAnnotate) {
            window.alert(pdfMessage(language, 'readOnly'))
            return
          }
          setEditMode((value) => !value)
          setCurrentTool(null)
          setSelectedAnnotationId(null)
        }}
        onSetTool={setCurrentTool}
        onSetFontFamily={(family) => {
          setEditFontFamily(family)
          if (selectedText) {
            const face = selectFontFace(family, editFontBold, editFontItalic)
            updateSelectedText({ font: fontDescriptor(face) })
          }
        }}
        onSetFontSize={(fontSize) => {
          setEditFontSize(fontSize)
          updateSelectedText({ fontSize })
        }}
        onToggleBold={toggleBold}
        onToggleItalic={toggleItalic}
        onToggleUnderline={toggleUnderline}
        onSetFontColor={(color) => {
          setEditFontColor(color)
          updateSelectedText({ color })
        }}
        onInsertImage={() => fileInputRef.current?.click()}
        onUndoEdit={undoEdit}
        onRedoEdit={redoEdit}
        onRegisterFocusPageInput={(focus) => { focusPageInputRef.current = focus }}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleImageFile(file)
          event.target.value = ''
        }}
      />

      {(hasSignatures || (!loading && pages.length > 0 && !canAnnotate)) && (
        <div className="shrink-0 border-b border-amber-300/70 bg-amber-50 px-3 py-1.5 text-xs text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-100">
          {hasSignatures ? pdfMessage(language, 'signed') : pdfMessage(language, 'readOnly')}
        </div>
      )}

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto bg-muted/30 p-4 [scrollbar-gutter:stable]"
      >
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-destructive">
            <p className="font-medium">{t('pdfViewer.cannotLoadPdf')}</p>
            <p className="max-w-xl text-xs opacity-80">{error}</p>
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <WaitingText text={t('pdfViewer.loadingPdf')} />
          </div>
        ) : (
          <div
            className={cn(
              'mx-auto gap-4',
              layout === 'two' ? 'grid grid-cols-2 items-start' : 'flex flex-col',
            )}
            style={{ width: layout === 'two' ? displayWidth * 2 + PAGE_GAP : displayWidth }}
          >
            {pages.map((page, pageIndex) => {
              const view = pdfViewSize(page, rotation)
              const pageHeight = Math.max(64, Math.round(displayWidth * view.height / view.width))
              const canonicalWidth = rotation === 90 || rotation === 270 ? pageHeight : displayWidth
              const rendered = renderedPagesRef.current.get(pageIndex)
              const pageAnnotations = annotations.filter((record) => record.pageIndex === pageIndex)
              return (
                <div
                  key={`${filePath}-${pageIndex}`}
                  data-page-num={pageIndex + 1}
                  className="relative w-full overflow-hidden bg-white shadow-md"
                  style={{ height: pageHeight }}
                >
                  {rendered ? (
                    <img
                      src={rendered.url}
                      alt={t('pdfViewer.pageNumber', { number: pageIndex + 1 })}
                      className="h-full w-full select-none object-fill"
                      decoding="async"
                      draggable={false}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                      <WaitingText text={t('pdfViewer.renderingPage', { number: pageIndex + 1 })} />
                    </div>
                  )}

                  <div
                    className="absolute inset-0"
                    data-edit-page={pageIndex}
                    style={{
                      cursor: editMode && currentTool === 'text' ? 'text' : 'default',
                      pointerEvents: editMode ? 'auto' : 'none',
                    }}
                    onPointerDown={(event) => {
                      if (!editMode || (event.target as HTMLElement).closest('[data-annot-id]')) return
                      if (currentTool !== 'text') {
                        setSelectedAnnotationId(null)
                        return
                      }
                      event.preventDefault()
                      const rect = event.currentTarget.getBoundingClientRect()
                      addTextAnnotation(
                        pageIndex,
                        (event.clientX - rect.left) / rect.width,
                        (event.clientY - rect.top) / rect.height,
                        rect.width,
                        rect.height,
                      )
                    }}
                  >
                    <div
                      className="absolute left-0 top-0"
                      style={canonicalLayerStyle(rotation, displayWidth, pageHeight)}
                    >
                      {pageAnnotations.map((annotation) => {
                        const selected = selectedAnnotId === annotation.id
                        const previewUrl = annotation.type === 'image'
                          ? previewUrlsRef.current.get(annotation.id)
                          : undefined
                        const fontScale = canonicalWidth / page.width
                        return (
                          <div
                            key={annotation.id}
                            data-annot-id={annotation.id}
                            className={cn(
                              'absolute cursor-move',
                              selected && 'ring-2 ring-[#0f6cbd] ring-offset-1 dark:ring-[#60a5fa]',
                            )}
                            style={{
                              left: `${annotation.rect.x * 100}%`,
                              top: `${annotation.rect.y * 100}%`,
                              width: `${annotation.rect.width * 100}%`,
                              height: `${annotation.rect.height * 100}%`,
                            }}
                            onPointerDown={(event) => startAnnotationDrag(event, annotation)}
                            onDoubleClick={(event) => {
                              if (!editMode || annotation.type !== 'text') return
                              const text = event.currentTarget.querySelector<HTMLElement>('.pdf-annot-text')
                              if (!text) return
                              text.contentEditable = 'true'
                              text.focus()
                              const range = document.createRange()
                              range.selectNodeContents(text)
                              const selection = window.getSelection()
                              selection?.removeAllRanges()
                              selection?.addRange(range)
                            }}
                          >
                            {annotation.type === 'text' ? (
                              <div
                                className="pdf-annot-text h-full w-full whitespace-pre-wrap break-words outline-none"
                                dir="auto"
                                suppressContentEditableWarning
                                style={{
                                  color: annotation.color,
                                  fontFamily: annotation.font.familyName,
                                  fontSize: `${Math.max(4, annotation.fontSize * fontScale)}px`,
                                  fontStyle: annotation.font.style === 'normal' ? 'normal' : 'italic',
                                  fontWeight: annotation.font.weight,
                                  lineHeight: 1.2,
                                  textDecoration: annotation.underline ? 'underline' : 'none',
                                  userSelect: editMode ? 'text' : 'none',
                                }}
                                onBlur={(event) => {
                                  if (!event.currentTarget.isContentEditable) return
                                  event.currentTarget.contentEditable = 'false'
                                  const text = event.currentTarget.innerText
                                  if (text !== annotation.text) commitText({ ...annotation, text })
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Escape') {
                                    event.preventDefault()
                                    event.currentTarget.blur()
                                  }
                                }}
                              >
                                {annotation.text}
                              </div>
                            ) : previewUrl ? (
                              <img src={previewUrl} alt="" className="h-full w-full object-fill" draggable={false} />
                            ) : (
                              <div className="h-full w-full bg-muted/40" />
                            )}

                            {selected && (
                              <>
                                {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((corner) => (
                                  <div
                                    key={corner}
                                    className="pdf-annot-resize-handle absolute z-10 h-2 w-2 rounded-sm border border-white bg-[#0f6cbd] shadow dark:bg-[#60a5fa]"
                                    data-corner={corner}
                                    style={RESIZE_HANDLE_STYLES[corner]}
                                  />
                                ))}
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
