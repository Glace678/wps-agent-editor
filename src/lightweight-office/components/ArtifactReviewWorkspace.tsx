import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { SuperDocEditor } from '@superdoc-dev/react'
import { Workbook, type WorkbookInstance } from '@fortune-sheet/react'
import type { Sheet, SingleRange as ExcelRange } from '@fortune-sheet/core'
import * as monaco from 'monaco-editor'
import {
  PptxViewer,
  RECOMMENDED_ZIP_LIMITS,
  type SearchHighlightHandle,
} from '@aiden0z/pptx-renderer'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import officialPdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  LocateFixed,
  MousePointer2,
  Pause,
  Play,
  Redo2,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslation } from '@/lib/i18n/runtime'
import { cn } from '@/lib/utils'
import { getCodeLanguage } from '@/lib/code-languages'
import { useAgentStore } from '@/stores/agent.store'
import type {
  ArtifactDraftManifest,
  ArtifactDraftPayload,
  ArtifactLocation,
  ArtifactOperation,
  ArtifactReviewCommand,
  ArtifactReviewState,
} from '@/types/artifact-review'
import { xlsxBufferToSheets, DEFAULT_SPREADSHEET_FONT_SIZE } from '../utils/xlsx-convert'
import { configurePdfJsWorker } from '../utils/pdfjs-worker'
import { stageCodeBufferSnapshot } from '../editors/code-buffer-registry'
import { codeEditorTheme, configureMonaco } from '../editors/monaco-runtime'
import './artifact-review-workspace.css'

configurePdfJsWorker(pdfjsLib, officialPdfWorkerUrl)

interface ArtifactReviewWorkspaceProps {
  filePath: string
  manifest: ArtifactDraftManifest
  reviewState: ArtifactReviewState
  onReady: () => void
  onSaved: () => void
}

type ReviewSide = 'original' | 'candidate'
type CursorTarget = { x: number; y: number }
const ignoreCursorTarget = (): void => {}

function toArrayBuffer(data: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data.slice(0)
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

function decodeCodeArtifact(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  const source = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    ? bytes.subarray(3)
    : bytes
  return new TextDecoder('utf-8', { fatal: true }).decode(source)
}

function operationText(operation: ArtifactOperation, side: ReviewSide): string | undefined {
  return side === 'original' ? operation.before?.text : operation.after?.text
}

function visibleOperations(
  operations: ArtifactOperation[],
  state: ArtifactReviewState,
): ArtifactOperation[] {
  return operations.filter((operation) => {
    const decision = state.decisions[operation.id]?.decision
    return decision === 'pending' || decision === 'conflict'
  })
}

function operationClass(operation: ArtifactOperation, state: ArtifactReviewState): string {
  const decision = state.decisions[operation.id]?.decision ?? 'pending'
  return cn(
    'artifact-change-marker',
    `is-${operation.visual}`,
    `is-${decision}`,
    operation.id === state.currentOperationId && 'is-current',
  )
}

function normalizedRectForOperation(
  operation: ArtifactOperation,
  operationIndex: number,
  total: number,
): { x: number; y: number; width: number; height: number } {
  const location = operation.location
  if ('rect' in location && location.rect) return location.rect
  if (location.kind === 'excel') {
    const cell = location.range.replace(/\$/g, '').match(/^([A-Z]+)(\d+)/i)
    let column = 0
    for (const char of cell?.[1]?.toUpperCase() ?? '') column = column * 26 + char.charCodeAt(0) - 64
    const row = Number(cell?.[2] ?? 1)
    return {
      x: Math.min(0.82, 0.08 + Math.max(0, column - 1) * 0.075),
      y: Math.min(0.88, 0.03 + Math.max(0, row - 1) * 0.026),
      width: 0.12,
      height: 0.03,
    }
  }
  const ratio = (operationIndex + 1) / (Math.max(1, total) + 1)
  return { x: 0.08, y: Math.min(0.9, Math.max(0.06, ratio)), width: 0.84, height: 0.035 }
}

function OperationMarker({
  operation,
  state,
  side,
  style,
}: {
  operation: ArtifactOperation
  state: ArtifactReviewState
  side: ReviewSide
  style: CSSProperties
}) {
  const text = operationText(operation, side)
  const deletionGhost = side === 'candidate'
    && state.decisions[operation.id]?.decision === 'pending'
    && (operation.visual === 'deletion' || operation.visual === 'replacement')
  return (
    <div
      className={operationClass(operation, state)}
      style={style}
      data-operation-id={operation.id}
      aria-label={operation.label}
    >
      <span className="artifact-change-symbol" aria-hidden="true">
        {operation.visual === 'deletion' ? '−' : operation.visual === 'addition' ? '+' : '±'}
      </span>
      {deletionGhost && text && (
        <span className="artifact-deletion-ghost"><del>{operation.before?.text}</del></span>
      )}
    </div>
  )
}

function NormalizedOperationLayer({
  operations,
  state,
  side,
  filter,
  operationStyles,
}: {
  operations: ArtifactOperation[]
  state: ArtifactReviewState
  side: ReviewSide
  filter?: (operation: ArtifactOperation) => boolean
  operationStyles?: Record<string, CSSProperties>
}) {
  const shown = visibleOperations(operations, state).filter((operation) => filter?.(operation) ?? true)
  return (
    <div className="artifact-operation-layer" aria-hidden="true">
      {shown.map((operation) => {
        const index = operations.findIndex(({ id }) => id === operation.id)
        const rect = normalizedRectForOperation(operation, index, operations.length)
        return (
          <OperationMarker
            key={operation.id}
            operation={operation}
            state={state}
            side={side}
            style={operationStyles?.[operation.id] ?? {
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${Math.max(0.02, rect.width) * 100}%`,
              height: `${Math.max(0.018, rect.height) * 100}%`,
            }}
          />
        )
      })}
    </div>
  )
}

function findTextElement(root: HTMLElement, needle: string): HTMLElement | null {
  const query = needle.trim().slice(0, 240)
  if (!query) return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (!node.nodeValue?.includes(query)) continue
    return node.parentElement
  }
  return null
}

function WordReviewSurface({
  data,
  side,
  operations,
  state,
  locateToken,
  onUserNavigate,
  onCursorTarget,
}: ReviewSurfaceProps) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const programmaticRef = useRef(false)
  const [operationStyles, setOperationStyles] = useState<Record<string, CSSProperties>>({})
  const file = useMemo(() => new File(
    [data],
    `${side}.docx`,
    { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  ), [data, side])
  const current = operations.find(({ id }) => id === state.currentOperationId)

  useEffect(() => {
    const root = rootRef.current
    if (!root || !current) return
    const editorHost = root.querySelector<HTMLElement>('.artifact-superdoc-instance') ?? root
    let frame = 0
    let located = false
    const timers: number[] = []
    const update = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const rootRect = root.getBoundingClientRect()
        const nextStyles: Record<string, CSSProperties> = {}
        let currentTarget: HTMLElement | null = null
        for (const operation of visibleOperations(operations, state)) {
          const text = operationText(operation, side)
            ?? (operation.location.kind === 'word' ? operation.location.search : undefined)
          const target = text ? findTextElement(editorHost, text) : null
          if (!target) continue
          const targetRect = target.getBoundingClientRect()
          nextStyles[operation.id] = {
            left: Math.max(0, targetRect.left - rootRect.left + root.scrollLeft - 3),
            top: Math.max(0, targetRect.top - rootRect.top + root.scrollTop - 2),
            width: Math.max(18, targetRect.width + 6),
            height: Math.max(18, targetRect.height + 4),
          }
          if (operation.id === current.id) currentTarget = target
        }
        setOperationStyles((previous) => JSON.stringify(previous) === JSON.stringify(nextStyles) ? previous : nextStyles)
        if (currentTarget && !located) {
          located = true
          programmaticRef.current = true
          currentTarget.scrollIntoView({ block: 'center', behavior: state.paused ? 'auto' : 'smooth' })
          timers.push(window.setTimeout(() => { programmaticRef.current = false }, 450))
          timers.push(window.setTimeout(update, state.paused ? 0 : 460))
        }
        if (side === 'candidate') {
          const targetRect = currentTarget?.getBoundingClientRect()
          const showDeletionGhost = current.visual === 'deletion' || current.visual === 'replacement'
          onCursorTarget({
            x: targetRect ? Math.max(24, Math.min(rootRect.width - 24, targetRect.right - rootRect.left + 8)) : rootRect.width * 0.72,
            y: targetRect ? Math.max(24, Math.min(rootRect.height - 24, (showDeletionGhost ? targetRect.bottom + 18 : targetRect.top + targetRect.height / 2) - rootRect.top)) : rootRect.height * 0.4,
          })
        }
      })
    }
    const observer = new MutationObserver(update)
    observer.observe(editorHost, { childList: true, subtree: true, characterData: true })
    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(root)
    update()
    timers.push(...[100, 350, 900].map((delay) => window.setTimeout(update, delay)))
    return () => {
      window.cancelAnimationFrame(frame)
      timers.forEach((timer) => window.clearTimeout(timer))
      observer.disconnect()
      resizeObserver.disconnect()
    }
  }, [current?.id, data, locateToken, onCursorTarget, operations, side, state.decisions, state.paused])

  return (
    <div
      ref={rootRef}
      className="artifact-format-surface artifact-word-surface"
      onWheelCapture={() => { if (!programmaticRef.current) onUserNavigate() }}
      onPointerDownCapture={onUserNavigate}
    >
      <SuperDocEditor
        key={`${side}:${file.size}:${state.candidateHash}`}
        contained
        document={file}
        documentMode="viewing"
        hideToolbar
        rulers={false}
        role="viewer"
        user={{ name: t('wordEditor.user'), email: 'review@local' }}
        className="artifact-superdoc-instance"
        style={{ height: '100%', minHeight: 0 }}
      />
      <NormalizedOperationLayer
        operations={operations}
        state={state}
        side={side}
        operationStyles={operationStyles}
      />
    </div>
  )
}

function parseExcelRange(range: string): ExcelRange | null {
  const normalized = range.replace(/\$/g, '')
  const match = normalized.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i)
  if (!match) return null
  const column = (label: string) => {
    let value = 0
    for (const char of label.toUpperCase()) value = value * 26 + char.charCodeAt(0) - 64
    return value - 1
  }
  return {
    row: [Number(match[2]) - 1, Number(match[4] ?? match[2]) - 1],
    column: [column(match[1]), column(match[3] ?? match[1])],
  }
}

function ExcelReviewSurface(props: ReviewSurfaceProps) {
  const { language, t } = useTranslation()
  const [sheets, setSheets] = useState<Sheet[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const apiRef = useRef<WorkbookInstance | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = props.operations.find(({ id }) => id === props.state.currentOperationId)

  useEffect(() => {
    let cancelled = false
    setSheets(null)
    setLoadError('')
    void xlsxBufferToSheets(props.data.slice(0)).then((value) => {
      if (!cancelled) setSheets(value)
    }).catch((error) => {
      console.error('[ArtifactReview] Excel load failed:', error)
      if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
    })
    return () => { cancelled = true }
  }, [props.data])

  useEffect(() => {
    if (!current || current.location.kind !== 'excel' || !apiRef.current) return
    const location = current.location
    const range = parseExcelRange(location.range)
    if (!range) return
    const sheet = sheets?.find((item, index) => (
      item.id === location.sheetId
      || item.name === location.sheetName
      || index === location.sheetIndex
    ))
    const options = sheet?.id ? { id: sheet.id } : undefined
    if (options) apiRef.current.activateSheet(options)
    apiRef.current.scroll({ targetRow: range.row[0], targetColumn: range.column[0] })
    if (props.side === 'candidate') {
      const rect = normalizedRectForOperation(current, props.operations.indexOf(current), props.operations.length)
      const root = rootRef.current
      if (root) props.onCursorTarget({ x: root.clientWidth * (rect.x + rect.width), y: root.clientHeight * (rect.y + rect.height / 2) })
    }
  }, [current?.id, props.locateToken, props.side, sheets, props.data])

  if (loadError) return <div className="artifact-review-loading" role="alert">{t('artifactReview.loadFailed', { error: loadError })}</div>
  if (!sheets) return <ReviewLoading />
  return (
    <div
      ref={rootRef}
      className="artifact-format-surface artifact-excel-surface"
      onWheelCapture={props.onUserNavigate}
      onPointerDownCapture={props.onUserNavigate}
    >
      <Workbook
        key={`${props.side}:${props.state.candidateHash}`}
        ref={apiRef}
        data={sheets}
        allowEdit={false}
        showToolbar={false}
        showFormulaBar={false}
        showSheetTabs
        lang={language === 'zh-CN' ? 'zh' : 'en'}
        defaultFontSize={DEFAULT_SPREADSHEET_FONT_SIZE}
      />
      <NormalizedOperationLayer operations={props.operations} state={props.state} side={props.side} />
    </div>
  )
}

function PdfPageCanvas({ document, pageNumber }: { document: PDFDocumentProxy; pageNumber: number }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(pageNumber === 1)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisible(true)
    }, { rootMargin: '500px' })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !canvasRef.current) return
    let cancelled = false
    let task: { cancel: () => void; promise: Promise<void> } | null = null
    void document.getPage(pageNumber).then((page) => {
      if (cancelled || !canvasRef.current) return
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(1.6, 760 / Math.max(1, base.width))
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`
      task = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }) as typeof task
      return task?.promise
    }).catch((error) => {
      if (!cancelled && error?.name !== 'RenderingCancelledException') console.error('[ArtifactReview] PDF page render failed:', error)
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [document, pageNumber, visible])

  return (
    <div ref={hostRef} className="artifact-pdf-page" data-artifact-page={pageNumber}>
      <canvas ref={canvasRef} />
      {!visible && <div className="artifact-page-placeholder" />}
    </div>
  )
}

function PdfReviewSurface(props: ReviewSurfaceProps) {
  const { t } = useTranslation()
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [loadError, setLoadError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const current = props.operations.find(({ id }) => id === props.state.currentOperationId)

  useEffect(() => {
    let disposed = false
    let loaded: PDFDocumentProxy | null = null
    setDocument(null)
    setLoadError('')
    void Promise.resolve().then(async () => {
      const task = pdfjsLib.getDocument({ data: new Uint8Array(props.data.slice(0)) })
      loaded = await task.promise
      if (disposed) await loaded.destroy()
      else setDocument(loaded)
    }).catch((error) => {
      console.error('[ArtifactReview] PDF load failed:', error)
      if (!disposed) setLoadError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      disposed = true
      setDocument(null)
      void loaded?.destroy()
    }
  }, [props.data])

  useEffect(() => {
    if (!current || current.location.kind !== 'pdf' || !rootRef.current) return
    const page = rootRef.current.querySelector<HTMLElement>(`[data-artifact-page="${current.location.pageNumber}"]`)
    page?.scrollIntoView({ block: 'center', behavior: props.state.paused ? 'auto' : 'smooth' })
    if (props.side === 'candidate' && page) {
      const rootRect = rootRef.current.getBoundingClientRect()
      const pageRect = page.getBoundingClientRect()
      const rect = current.location.rect ?? { x: 0.72, y: 0.4, width: 0.04, height: 0.04 }
      props.onCursorTarget({
        x: pageRect.left - rootRect.left + pageRect.width * (rect.x + rect.width),
        y: pageRect.top - rootRect.top + pageRect.height * (rect.y + rect.height / 2),
      })
    }
  }, [current?.id, props.locateToken, props.side, document])

  if (loadError) return <div className="artifact-review-loading" role="alert">{t('artifactReview.loadFailed', { error: loadError })}</div>
  if (!document) return <ReviewLoading />
  return (
    <div
      ref={rootRef}
      className="artifact-format-surface artifact-pdf-surface"
      onWheelCapture={props.onUserNavigate}
      onPointerDownCapture={props.onUserNavigate}
    >
      {Array.from({ length: document.numPages }, (_, index) => {
        const pageNumber = index + 1
        return (
          <div className="artifact-pdf-page-wrap" key={pageNumber}>
            <PdfPageCanvas document={document} pageNumber={pageNumber} />
            <NormalizedOperationLayer
              operations={props.operations}
              state={props.state}
              side={props.side}
              filter={(operation) => operation.location.kind === 'pdf' && operation.location.pageNumber === pageNumber}
            />
          </div>
        )
      })}
    </div>
  )
}

function PresentationReviewSurface(props: ReviewSurfaceProps) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PptxViewer | null>(null)
  const highlightsRef = useRef<SearchHighlightHandle[]>([])
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [slideCount, setSlideCount] = useState(0)
  const [slideIndex, setSlideIndex] = useState(0)
  const current = props.operations.find(({ id }) => id === props.state.currentOperationId)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    setReady(false)
    setLoadError('')
    const viewer = new PptxViewer(host, {
      fitMode: 'contain',
      zoomPercent: 100,
      zipLimits: RECOMMENDED_ZIP_LIMITS,
      lazyMedia: true,
      lazySlides: true,
      pdfjs: false,
      onSlideChange: (index) => { if (!disposed) setSlideIndex(index) },
    })
    viewerRef.current = viewer
    void viewer.open(props.data.slice(0), { renderMode: 'slide', lazyMedia: true, lazySlides: true })
      .then(() => {
        if (disposed) return
        setSlideCount(viewer.slideCount)
        setSlideIndex(viewer.currentSlideIndex)
        setReady(true)
      })
      .catch((error) => {
        console.error('[ArtifactReview] Presentation load failed:', error)
        if (!disposed) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      disposed = true
      highlightsRef.current = []
      viewer.destroy()
      if (viewerRef.current === viewer) viewerRef.current = null
    }
  }, [props.data])

  useEffect(() => {
    if (!ready || !current || current.location.kind !== 'presentation' || !viewerRef.current) return
    let cancelled = false
    const viewer = viewerRef.current
    const location = current.location
    highlightsRef.current.forEach((highlight) => highlight.dispose())
    highlightsRef.current = []
    void viewer.goToSlide(location.slideIndex).then(async () => {
      if (cancelled) return
      setSlideIndex(location.slideIndex)
      let currentHighlight: SearchHighlightHandle | null = null
      const shown = visibleOperations(props.operations, props.state).filter((operation) => (
        operation.location.kind === 'presentation'
        && operation.location.slideIndex === location.slideIndex
      ))
      for (const operation of shown) {
        const query = operationText(operation, props.side)
        if (!query) continue
        const operationLocation = operation.location
        if (operationLocation.kind !== 'presentation') continue
        const result = viewer.searchText(query, { matchCase: true }).find((match) => (
          match.slideIndex === operationLocation.slideIndex
          && (!operationLocation.nodeId || match.nodeId === operationLocation.nodeId)
        )) ?? viewer.searchText(query).find((match) => match.slideIndex === operationLocation.slideIndex)
        if (!result) continue
        const destructive = operation.visual === 'deletion'
        const highlight = await viewer.highlightSearchResult(result, {
          className: cn(
            'artifact-ppt-node-highlight',
            `is-${operation.visual}`,
            operation.id === props.state.currentOperationId && 'is-current',
          ),
          borderColor: destructive ? '#cf343f' : '#16915b',
          backgroundColor: destructive ? 'rgba(220, 38, 52, 0.14)' : 'rgba(34, 197, 122, 0.2)',
          boxShadow: destructive ? 'inset 3px 0 #cf343f' : 'inset 3px 0 #16915b',
          borderWidth: 2,
          padding: 2,
          zIndex: 12,
          scrollIntoView: false,
        })
        if (!highlight || cancelled) {
          highlight?.dispose()
          continue
        }
        highlight.element.dataset.operationId = operation.id
        highlight.element.dataset.changeSymbol = operation.visual === 'deletion' ? '−' : operation.visual === 'addition' ? '+' : '±'
        highlightsRef.current.push(highlight)
        if (operation.id === props.state.currentOperationId) currentHighlight = highlight
      }
      if (props.side !== 'candidate' || !hostRef.current) return
      const hostRect = hostRef.current.getBoundingClientRect()
      const targetRect = currentHighlight?.element.getBoundingClientRect()
      if (targetRect) {
        props.onCursorTarget({
          x: targetRect.right - hostRect.left,
          y: targetRect.top - hostRect.top + targetRect.height / 2,
        })
        return
      }
      const rect = location.rect ?? { x: 0.72, y: 0.4, width: 0.04, height: 0.04 }
      props.onCursorTarget({ x: hostRect.width * (rect.x + rect.width), y: hostRect.height * (rect.y + rect.height / 2) })
    })
    return () => {
      cancelled = true
      highlightsRef.current.forEach((highlight) => highlight.dispose())
      highlightsRef.current = []
    }
  }, [current?.id, props.locateToken, props.side, props.state.decisions, ready])

  return (
    <div
      className="artifact-format-surface artifact-presentation-surface"
      onWheelCapture={props.onUserNavigate}
      onPointerDownCapture={props.onUserNavigate}
    >
      <div ref={hostRef} className="artifact-presentation-host" />
      {loadError
        ? <div className="artifact-review-loading" role="alert">{t('artifactReview.loadFailed', { error: loadError })}</div>
        : !ready && <ReviewLoading />}
      {ready && (
        <div className="artifact-slide-counter">{slideIndex + 1} / {slideCount}</div>
      )}
      <NormalizedOperationLayer
        operations={props.operations}
        state={props.state}
        side={props.side}
        filter={(operation) => (
          operation.location.kind === 'presentation'
          && operation.location.slideIndex === slideIndex
          && (!operationText(operation, props.side) || operation.visual === 'object')
        )}
      />
    </div>
  )
}

interface ReviewSurfaceProps {
  data: ArrayBuffer
  side: ReviewSide
  operations: ArtifactOperation[]
  state: ArtifactReviewState
  locateToken: number
  onUserNavigate: () => void
  onCursorTarget: (target: CursorTarget) => void
}

function ReviewLoading() {
  const { t } = useTranslation()
  return <div className="artifact-review-loading">{t('artifactReview.loading')}</div>
}

function codeCandidateOffsets(
  target: ArtifactOperation,
  operations: ArtifactOperation[],
  enabledOperationIds: string[],
): { start: number; end: number } {
  if (target.location.kind !== 'code') return { start: 0, end: 0 }
  const enabled = new Set(enabledOperationIds)
  const sorted = operations
    .filter((operation) => operation.location.kind === 'code')
    .slice()
    .sort((left, right) => {
      if (left.location.kind !== 'code' || right.location.kind !== 'code') return 0
      return left.location.originalRange.start.offset - right.location.originalRange.start.offset
        || left.location.originalRange.end.offset - right.location.originalRange.end.offset
        || left.id.localeCompare(right.id)
    })
  let shift = 0
  for (const operation of sorted) {
    if (operation.id === target.id) break
    if (!enabled.has(operation.id) || operation.location.kind !== 'code') continue
    const beforeLength = operation.location.originalRange.end.offset
      - operation.location.originalRange.start.offset
    const afterLength = operation.after?.text?.length
      ?? operation.location.candidateRange.end.offset - operation.location.candidateRange.start.offset
    shift += afterLength - beforeLength
  }
  const start = target.location.originalRange.start.offset + shift
  const originalLength = target.location.originalRange.end.offset
    - target.location.originalRange.start.offset
  const renderedLength = enabled.has(target.id)
    ? target.after?.text?.length
      ?? target.location.candidateRange.end.offset - target.location.candidateRange.start.offset
    : originalLength
  return { start, end: start + renderedLength }
}

function monacoRangeFromOffsets(
  model: monaco.editor.ITextModel,
  startOffset: number,
  endOffset: number,
): monaco.Range {
  const start = model.getPositionAt(Math.max(0, Math.min(model.getValueLength(), startOffset)))
  const end = model.getPositionAt(Math.max(0, Math.min(model.getValueLength(), endOffset)))
  return new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column)
}

interface CodeArtifactReviewSurfaceProps {
  filePath: string
  manifest: ArtifactDraftManifest
  originalData: ArrayBuffer
  candidateData: ArrayBuffer
  operations: ArtifactOperation[]
  state: ArtifactReviewState
  locateToken: number
  onUserNavigate: () => void
  onCursorTarget: (target: CursorTarget) => void
}

function CodeArtifactReviewSurface({
  filePath,
  manifest,
  originalData,
  candidateData,
  operations,
  state,
  locateToken,
  onUserNavigate,
  onCursorTarget,
}: CodeArtifactReviewSurfaceProps) {
  const { t } = useTranslation()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null)
  const candidateModelRef = useRef<monaco.editor.ITextModel | null>(null)
  const originalDecorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const candidateDecorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const programmaticRef = useRef(false)
  const onUserNavigateRef = useRef(onUserNavigate)
  const [inline, setInline] = useState(false)
  const originalText = useMemo(() => decodeCodeArtifact(originalData), [originalData])
  const candidateText = useMemo(() => decodeCodeArtifact(candidateData), [candidateData])
  const languageId = manifest.textMetadata?.languageId
    || getCodeLanguage(filePath)?.language
    || 'plaintext'
  onUserNavigateRef.current = onUserNavigate

  useEffect(() => {
    configureMonaco()
    const host = hostRef.current
    if (!host) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const editor = monaco.editor.createDiffEditor(host, {
      automaticLayout: true,
      theme: codeEditorTheme(),
      readOnly: true,
      originalEditable: false,
      domReadOnly: true,
      renderSideBySide: host.clientWidth >= 720,
      enableSplitViewResizing: true,
      renderIndicators: true,
      renderMarginRevertIcon: false,
      diffCodeLens: false,
      ignoreTrimWhitespace: false,
      glyphMargin: true,
      lineNumbers: 'on',
      folding: true,
      stickyScroll: { enabled: true },
      minimap: { enabled: false },
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontLigatures: true,
      fontSize: 13,
      lineHeight: 21,
      scrollBeyondLastLine: false,
      smoothScrolling: !reducedMotion,
      wordWrap: 'off',
      padding: { top: 8, bottom: 8 },
      originalAriaLabel: t('artifactReview.original'),
      modifiedAriaLabel: t('artifactReview.modified'),
    })
    const uriBase = `${manifest.draftId}/${encodeURIComponent(manifest.sourceName)}`
    const originalModel = monaco.editor.createModel(
      originalText,
      languageId,
      monaco.Uri.from({ scheme: 'inmemory', authority: 'artifact-review', path: `/${uriBase}/original` }),
    )
    const candidateModel = monaco.editor.createModel(
      candidateText,
      languageId,
      monaco.Uri.from({
        scheme: 'inmemory',
        authority: 'artifact-review',
        path: `/${uriBase}/candidate`,
        query: state.candidateHash,
      }),
    )
    editor.setModel({ original: originalModel, modified: candidateModel })
    diffEditorRef.current = editor
    originalModelRef.current = originalModel
    candidateModelRef.current = candidateModel
    originalDecorationsRef.current = editor.getOriginalEditor().createDecorationsCollection()
    candidateDecorationsRef.current = editor.getModifiedEditor().createDecorationsCollection()

    const scrollDisposable = editor.getModifiedEditor().onDidScrollChange((event) => {
      if (programmaticRef.current || (!event.scrollTopChanged && !event.scrollLeftChanged)) return
      onUserNavigateRef.current()
    })
    const themeObserver = new MutationObserver(() => monaco.editor.setTheme(codeEditorTheme()))
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    const resizeObserver = new ResizeObserver(([entry]) => {
      const nextInline = entry.contentRect.width < 720
      setInline(nextInline)
      editor.updateOptions({ renderSideBySide: !nextInline })
    })
    resizeObserver.observe(host)
    setInline(host.clientWidth < 720)

    return () => {
      scrollDisposable.dispose()
      themeObserver.disconnect()
      resizeObserver.disconnect()
      originalDecorationsRef.current?.clear()
      candidateDecorationsRef.current?.clear()
      editor.setModel(null)
      editor.dispose()
      originalModel.dispose()
      candidateModel.dispose()
      if (diffEditorRef.current === editor) diffEditorRef.current = null
      if (originalModelRef.current === originalModel) originalModelRef.current = null
      if (candidateModelRef.current === candidateModel) candidateModelRef.current = null
    }
  }, [candidateText, languageId, manifest.draftId, manifest.sourceName, originalText, state.candidateHash, t])

  useEffect(() => {
    const originalModel = originalModelRef.current
    const candidateModel = candidateModelRef.current
    if (!originalModel || !candidateModel) return
    const originalDecorations: monaco.editor.IModelDeltaDecoration[] = []
    const candidateDecorations: monaco.editor.IModelDeltaDecoration[] = []
    for (const operation of visibleOperations(operations, state)) {
      if (operation.location.kind !== 'code') continue
      const current = operation.id === state.currentOperationId
      const originalStart = operation.location.originalRange.start.offset
      const originalEnd = operation.location.originalRange.end.offset
      const candidateOffsets = codeCandidateOffsets(operation, operations, state.enabledOperationIds)
      if (originalEnd > originalStart) {
        originalDecorations.push({
          range: monacoRangeFromOffsets(originalModel, originalStart, originalEnd),
          options: {
            isWholeLine: true,
            className: cn('artifact-code-removed-line', current && 'is-current'),
            inlineClassName: 'artifact-code-removed-text',
            linesDecorationsClassName: 'artifact-code-lines-remove',
            glyphMarginClassName: 'artifact-code-glyph-remove',
            glyphMarginHoverMessage: { value: `− ${operation.label}` },
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        })
      }
      if (candidateOffsets.end > candidateOffsets.start) {
        candidateDecorations.push({
          range: monacoRangeFromOffsets(candidateModel, candidateOffsets.start, candidateOffsets.end),
          options: {
            isWholeLine: true,
            className: cn('artifact-code-added-line', current && 'is-current'),
            inlineClassName: 'artifact-code-added-text',
            linesDecorationsClassName: 'artifact-code-lines-add',
            glyphMarginClassName: 'artifact-code-glyph-add',
            glyphMarginHoverMessage: { value: `+ ${operation.label}` },
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        })
      } else {
        const anchor = monacoRangeFromOffsets(candidateModel, candidateOffsets.start, candidateOffsets.start)
        candidateDecorations.push({
          range: new monaco.Range(anchor.startLineNumber, 1, anchor.startLineNumber, 1),
          options: {
            isWholeLine: true,
            className: cn('artifact-code-deletion-anchor', current && 'is-current'),
            linesDecorationsClassName: 'artifact-code-lines-remove',
            glyphMarginClassName: 'artifact-code-glyph-remove',
            glyphMarginHoverMessage: { value: `− ${operation.label}` },
          },
        })
      }
    }
    originalDecorationsRef.current?.set(originalDecorations)
    candidateDecorationsRef.current?.set(candidateDecorations)
  }, [candidateText, operations, state.currentOperationId, state.decisions, state.enabledOperationIds])

  useEffect(() => {
    if (!state.followAgent) return
    const current = operations.find((operation) => operation.id === state.currentOperationId)
    const editor = diffEditorRef.current?.getModifiedEditor()
    const model = candidateModelRef.current
    const host = hostRef.current
    if (!current || current.location.kind !== 'code' || !editor || !model || !host) return
    const offsets = codeCandidateOffsets(current, operations, state.enabledOperationIds)
    const position = model.getPositionAt(Math.max(0, Math.min(model.getValueLength(), offsets.start)))
    programmaticRef.current = true
    editor.revealPositionInCenter(position, monaco.editor.ScrollType.Smooth)
    const timer = window.setTimeout(() => {
      const visible = editor.getScrolledVisiblePosition(position)
      const editorNode = editor.getDomNode()
      if (visible && editorNode) {
        const rootRect = (surfaceRef.current ?? host).getBoundingClientRect()
        const editorRect = editorNode.getBoundingClientRect()
        onCursorTarget({
          x: editorRect.left - rootRect.left + visible.left + 16,
          y: editorRect.top - rootRect.top + visible.top + visible.height / 2,
        })
      }
      programmaticRef.current = false
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180)
    return () => window.clearTimeout(timer)
  }, [candidateText, locateToken, onCursorTarget, operations, state.currentOperationId, state.enabledOperationIds, state.followAgent])

  return (
    <div
      ref={surfaceRef}
      className="artifact-code-review-surface"
      data-inline={inline ? 'true' : 'false'}
      onWheelCapture={() => { if (!programmaticRef.current) onUserNavigateRef.current() }}
      onPointerDownCapture={() => onUserNavigateRef.current()}
      data-testid="code-artifact-diff"
    >
      <div className="artifact-code-review-headings" aria-hidden="true">
        <span><FileText /> {t('artifactReview.original')}</span>
        <span><Sparkles /> {t('artifactReview.modified')}</span>
      </div>
      <div ref={hostRef} className="artifact-code-diff-host" />
    </div>
  )
}

function FormatSurface({ kind, ...props }: ReviewSurfaceProps & { kind: ArtifactDraftManifest['kind'] }) {
  if (kind === 'word') return <WordReviewSurface {...props} />
  if (kind === 'excel') return <ExcelReviewSurface {...props} />
  if (kind === 'pdf') return <PdfReviewSurface {...props} />
  if (kind === 'presentation') return <PresentationReviewSurface {...props} />
  return <ReviewLoading />
}

function ReviewIconButton({
  label,
  disabled,
  onClick,
  children,
  testId,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
  testId?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="artifact-review-icon-button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          data-testid={testId}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function ArtifactReviewWorkspace({
  filePath,
  manifest,
  reviewState,
  onReady,
  onSaved,
}: ArtifactReviewWorkspaceProps) {
  const { t } = useTranslation()
  const setArtifactReview = useAgentStore((store) => store.setArtifactReview)
  const finishArtifactReview = useAgentStore((store) => store.finishArtifactReview)
  const [state, setState] = useState(reviewState)
  const [payload, setPayload] = useState<ArtifactDraftPayload | null>(null)
  const [mobileSide, setMobileSide] = useState<ReviewSide>('candidate')
  const [locateToken, setLocateToken] = useState(0)
  const [cursorTarget, setCursorTarget] = useState<CursorTarget>({ x: 120, y: 160 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const readyRef = useRef(false)
  const lastNavigationRef = useRef(0)
  const pendingCommandsRef = useRef(0)

  useEffect(() => setState(reviewState), [reviewState])

  useEffect(() => {
    let cancelled = false
    setPayload(null)
    void window.api.artifact.getPayload(manifest.draftId).then((result) => {
      if (cancelled) return
      setPayload(result)
      if (!readyRef.current) {
        readyRef.current = true
        onReady()
      }
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { cancelled = true }
  }, [manifest.draftId, state.candidateHandle])

  const runCommand = useCallback(async (command: ArtifactReviewCommand) => {
    pendingCommandsRef.current += 1
    setBusy(true)
    setError('')
    try {
      let codeBuffer: { text: string; dirty: boolean } | null = null
      if (manifest.kind === 'code' && (command.type === 'save' || command.type === 'discard')) {
        const latestPayload = await window.api.artifact.getPayload(manifest.draftId)
        const bytes = command.type === 'save' ? latestPayload.candidateData : latestPayload.originalData
        codeBuffer = {
          text: decodeCodeArtifact(toArrayBuffer(bytes)),
          dirty: command.type === 'discard' ? Boolean(manifest.textMetadata?.dirty) : false,
        }
      }
      const next = await window.api.artifact.command(manifest.draftId, command)
      setState(next)
      setArtifactReview(manifest, next)
      if (command.type === 'locate' || command.type === 'previous' || command.type === 'next') {
        setLocateToken((value) => value + 1)
      }
      if (codeBuffer && (next.phase === 'saved' || next.phase === 'discarded')) {
        stageCodeBufferSnapshot(filePath, {
          text: codeBuffer.text,
          metadata: {
            encoding: 'utf-8',
            hasBom: manifest.textMetadata?.hasBom ?? false,
            eol: manifest.textMetadata?.eol ?? (codeBuffer.text.includes('\r\n') ? 'crlf' : 'lf'),
            languageId: manifest.textMetadata?.languageId ?? getCodeLanguage(filePath)?.language ?? 'plaintext',
            dirty: codeBuffer.dirty,
          },
        })
      }
      if (next.phase === 'saved' || next.phase === 'discarded') {
        finishArtifactReview(manifest.draftId, next)
      }
      if (next.phase === 'saved') onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      pendingCommandsRef.current = Math.max(0, pendingCommandsRef.current - 1)
      if (pendingCommandsRef.current === 0) setBusy(false)
    }
  }, [filePath, finishArtifactReview, manifest, onSaved, setArtifactReview])

  const handleUserNavigate = useCallback(() => {
    const now = Date.now()
    if (now - lastNavigationRef.current < 250 || state.paused) return
    lastNavigationRef.current = now
    void runCommand({ type: 'pause' })
  }, [runCommand, state.paused])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLocaleLowerCase()
      if (key === 's') {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        if (state.canSave) void runCommand({ type: 'save' })
        return
      }
      if (key !== 'z' && key !== 'y') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      void runCommand({ type: key === 'y' || event.shiftKey ? 'redo' : 'undo' })
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [runCommand, state.canSave])

  const operations = manifest.operations
  const historyMode = manifest.reviewMode === 'history-withdrawal'
  const current = operations.find(({ id }) => id === state.currentOperationId)
  const currentDecision = current ? state.decisions[current.id]?.decision : undefined
  const data = useMemo(() => payload ? {
    original: toArrayBuffer(payload.originalData),
    candidate: toArrayBuffer(payload.candidateData),
  } : null, [payload])

  const surface = (side: ReviewSide) => data ? (
    <FormatSurface
      kind={manifest.kind}
      data={data[side]}
      side={side}
      operations={operations}
      state={state}
      locateToken={locateToken}
      onUserNavigate={handleUserNavigate}
      onCursorTarget={side === 'candidate' ? setCursorTarget : ignoreCursorTarget}
    />
  ) : <ReviewLoading />

  return (
    <TooltipProvider delayDuration={350}>
      <section
        className="artifact-review-workspace"
        data-kind={manifest.kind}
        data-mobile-side={mobileSide}
        data-testid="artifact-review-workspace"
      >
        <div className="artifact-review-mobile-switch" role="tablist">
          <button type="button" role="tab" aria-selected={mobileSide === 'original'} onClick={() => setMobileSide('original')}>
            <FileText className="h-3.5 w-3.5" /> {t('artifactReview.original')}
          </button>
          <button type="button" role="tab" aria-selected={mobileSide === 'candidate'} onClick={() => setMobileSide('candidate')}>
            <Sparkles className="h-3.5 w-3.5" /> {t('artifactReview.modified')}
          </button>
        </div>

        <div className={cn('artifact-review-compare-grid', manifest.kind === 'code' && 'is-code')}>
          {manifest.kind === 'code' ? (
            <div className="artifact-code-review-wrap">
              {data ? (
                <CodeArtifactReviewSurface
                  filePath={filePath}
                  manifest={manifest}
                  originalData={data.original}
                  candidateData={data.candidate}
                  operations={operations}
                  state={state}
                  locateToken={locateToken}
                  onUserNavigate={handleUserNavigate}
                  onCursorTarget={setCursorTarget}
                />
              ) : <ReviewLoading />}
              <div
                className="artifact-agent-cursor"
                style={{ transform: `translate3d(${cursorTarget.x}px, ${cursorTarget.y}px, 0)` }}
                aria-hidden="true"
              >
                <MousePointer2 />
                <span>{state.agentName ?? t('agents.agent')}</span>
              </div>
            </div>
          ) : (
            <>
              <article className="artifact-review-pane is-original" data-review-side="original">
                <header><FileText className="h-3.5 w-3.5" /> {t('artifactReview.original')}</header>
                <div className="artifact-review-pane-body">{surface('original')}</div>
              </article>
              <article className="artifact-review-pane is-candidate" data-review-side="candidate">
                <header><Sparkles className="h-3.5 w-3.5" /> {t('artifactReview.modified')}</header>
                <div className="artifact-review-pane-body">
                  {surface('candidate')}
                  <div
                    className="artifact-agent-cursor"
                    style={{ transform: `translate3d(${cursorTarget.x}px, ${cursorTarget.y}px, 0)` }}
                    aria-hidden="true"
                  >
                    <MousePointer2 />
                    <span>{state.agentName ?? t('agents.agent')}</span>
                  </div>
                </div>
              </article>
            </>
          )}
        </div>

        {error && <div className="artifact-review-error" role="alert">{t('artifactReview.commandFailed', { error })}</div>}

        <footer className="artifact-review-bar">
          <div className="artifact-review-progress-block">
            <div className="artifact-review-agent-line">
              <span className="artifact-review-agent-dot" />
              <strong>{state.agentName ?? t('agents.agent')}</strong>
              <span className="artifact-review-current-label">{current?.label ?? t('artifactReview.noCurrentChange')}</span>
              <span className="artifact-review-count">{state.decided}/{state.total}</span>
            </div>
            <div className="artifact-review-progress" aria-label={t('artifactReview.progress')}>
              <span style={{ width: `${state.total ? state.decided / state.total * 100 : 0}%` }} />
            </div>
          </div>

          <div className="artifact-review-controls">
            <ReviewIconButton label={t('artifactReview.previous')} disabled={state.currentIndex <= 0 || busy} onClick={() => void runCommand({ type: 'previous' })}>
              <ChevronLeft />
            </ReviewIconButton>
            <ReviewIconButton label={t('artifactReview.next')} disabled={state.currentIndex >= state.total - 1 || busy} onClick={() => void runCommand({ type: 'next' })}>
              <ChevronRight />
            </ReviewIconButton>
            <ReviewIconButton label={t('artifactReview.locateCurrent')} disabled={!current || busy} onClick={() => void runCommand({ type: 'locate', operationId: current?.id })} testId="artifact-review-locate">
              <LocateFixed />
            </ReviewIconButton>
            <ReviewIconButton label={state.paused ? t('artifactReview.resume') : t('artifactReview.pause')} disabled={busy} onClick={() => void runCommand({ type: state.paused ? 'resume' : 'pause' })}>
              {state.paused ? <Play /> : <Pause />}
            </ReviewIconButton>
            <ReviewIconButton label={t('artifactReview.undo')} disabled={!state.canUndo || busy} onClick={() => void runCommand({ type: 'undo' })}>
              <Undo2 />
            </ReviewIconButton>
            <ReviewIconButton label={t('artifactReview.redo')} disabled={!state.canRedo || busy} onClick={() => void runCommand({ type: 'redo' })}>
              <Redo2 />
            </ReviewIconButton>
          </div>

          <div className="artifact-review-decisions">
            <button
              type="button"
              className="artifact-review-command is-reject"
              disabled={!current || currentDecision === 'conflict' || busy}
              onClick={() => current && void runCommand({ type: 'reject', operationId: current.id })}
              data-testid="artifact-review-reject"
            >
              <X /> {t(historyMode ? 'artifactReview.withdrawChange' : 'artifactReview.reject')}
            </button>
            <button
              type="button"
              className="artifact-review-command is-accept"
              disabled={!current || currentDecision === 'conflict' || busy}
              onClick={() => current && void runCommand({ type: 'accept', operationId: current.id })}
              data-testid="artifact-review-accept"
            >
              <Check /> {t(historyMode ? 'artifactReview.keepChange' : 'artifactReview.accept')}
            </button>
            <button
              type="button"
              className="artifact-review-command is-save"
              disabled={!state.canSave || busy}
              onClick={() => void runCommand({ type: 'save' })}
              data-testid="artifact-review-save"
            >
              <Save /> {t('artifactReview.saveSelected')}
            </button>
            <ReviewIconButton label={t('artifactReview.discardDraft')} disabled={busy} onClick={() => void runCommand({ type: 'discard' })}>
              <Trash2 />
            </ReviewIconButton>
          </div>
        </footer>
      </section>
    </TooltipProvider>
  )
}
