import {
  PptxViewer,
  RECOMMENDED_ZIP_LIMITS,
  type SlideHandle,
} from '@aiden0z/pptx-renderer'
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MoveHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Presentation,
  RefreshCw,
  Scan,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useTranslation } from '@/lib/i18n/runtime'
import { cn } from '@/lib/utils'
import { documentBridge } from '../agent/document-bridge'
import { getExtension, readPresentationBuffer } from '../utils/file-io'
import './presentation-viewer.css'

const MIN_ZOOM = 50
const MAX_ZOOM = 250
const ZOOM_STEP = 25
const DEFAULT_ASPECT_RATIO = 16 / 9
const PRESENTATION_CONTROLS_HIDE_MS = 1_800
const MIN_THUMBNAIL_PANE_WIDTH = 168
const DEFAULT_THUMBNAIL_PANE_WIDTH = 194
const MAX_THUMBNAIL_PANE_WIDTH = 420
const MIN_PRESENTATION_STAGE_WIDTH = 360
const THUMBNAIL_RESIZER_WIDTH = 6
const THUMBNAIL_RENDER_WIDTH = 372
const THUMBNAIL_ROW_CHROME_WIDTH = 40
const THUMBNAIL_PANE_STORAGE_KEY = 'presentation-thumbnail-pane-width'

interface PresentationViewerProps {
  filePath: string
  onReady?: () => void
  onRegisterSave?: (fn: (() => Promise<void>) | null) => void
}

interface ViewportSize {
  width: number
  height: number
}

type LoadError = 'legacy' | 'document' | null

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function readStoredThumbnailPaneWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_THUMBNAIL_PANE_WIDTH
  const stored = Number.parseFloat(window.localStorage.getItem(THUMBNAIL_PANE_STORAGE_KEY) ?? '')
  return Number.isFinite(stored)
    ? clamp(stored, MIN_THUMBNAIL_PANE_WIDTH, MAX_THUMBNAIL_PANE_WIDTH)
    : DEFAULT_THUMBNAIL_PANE_WIDTH
}

function estimatedThumbnailScale(paneWidth: number): number {
  return Math.max(0.1, (paneWidth - THUMBNAIL_ROW_CHROME_WIDTH) / THUMBNAIL_RENDER_WIDTH)
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

function SlideThumbnail({
  viewer,
  index,
  active,
  label,
  aspectRatio,
  onSelect,
}: {
  viewer: PptxViewer
  index: number
  active: boolean
  label: string
  aspectRatio: number
  onSelect: (index: number) => void
}) {
  const itemRef = useRef<HTMLButtonElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<SlideHandle | null>(null)
  const [renderFailed, setRenderFailed] = useState(false)

  useEffect(() => {
    const item = itemRef.current
    const host = hostRef.current
    if (!item || !host) return

    const dispose = () => {
      handleRef.current?.dispose()
      handleRef.current = null
      host.replaceChildren()
    }
    const render = () => {
      if (handleRef.current) return
      setRenderFailed(false)
      const handle = viewer.renderThumbnailToContainer(index, host, { width: THUMBNAIL_RENDER_WIDTH })
      if (!handle) {
        setRenderFailed(true)
        return
      }
      handleRef.current = handle
      void handle.ready.catch(() => setRenderFailed(true))
    }

    if (typeof IntersectionObserver === 'undefined') {
      render()
      return dispose
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) render()
      },
      { root: null, rootMargin: '500px 0px' },
    )
    observer.observe(item)
    return () => {
      observer.disconnect()
      dispose()
    }
  }, [aspectRatio, index, viewer])

  useEffect(() => {
    if (active) itemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <button
      ref={itemRef}
      type="button"
      className={cn(
        'presentation-thumbnail group flex w-full items-start gap-1 border-l-2 py-2 pl-0.5 pr-1.5 text-left',
        active
          ? 'border-[#d24726] bg-black/[0.06] dark:bg-white/[0.07]'
          : 'border-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.05]',
      )}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      data-testid={`presentation-thumbnail-${index + 1}`}
      onClick={() => onSelect(index)}
    >
      <span className="w-[18px] shrink-0 pt-1 text-right text-[10px] tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <span
        className={cn(
          'presentation-thumbnail-frame relative block min-w-0 flex-1 overflow-hidden bg-white shadow-sm',
          active ? 'ring-2 ring-[#d24726]' : 'ring-1 ring-black/15 dark:ring-white/20',
        )}
        style={{ aspectRatio }}
        aria-hidden="true"
      >
        <span ref={hostRef} className="presentation-thumbnail-host block" />
        {renderFailed ? (
          <span className="absolute inset-0 flex items-center justify-center bg-[#f4f4f4] text-[#888]">
            <Presentation className="h-5 w-5" />
          </span>
        ) : null}
      </span>
    </button>
  )
}

export function PresentationViewer({
  filePath,
  onReady,
  onRegisterSave,
}: PresentationViewerProps) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const thumbnailPaneRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLElement>(null)
  const slideHostRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PptxViewer | null>(null)
  const controlsTimerRef = useRef<number | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const thumbnailResizeCleanupRef = useRef<(() => void) | null>(null)

  const [viewer, setViewer] = useState<PptxViewer | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<LoadError>(null)
  const [errorDetail, setErrorDetail] = useState('')
  const [retryToken, setRetryToken] = useState(0)
  const [slideCount, setSlideCount] = useState(0)
  const [currentSlide, setCurrentSlide] = useState(0)
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT_RATIO)
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(100)
  const [pageInput, setPageInput] = useState('1')
  const [showThumbnails, setShowThumbnails] = useState(true)
  const [thumbnailPaneWidth, setThumbnailPaneWidth] = useState(readStoredThumbnailPaneWidth)
  const [isPresenting, setIsPresenting] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const thumbnailPaneWidthRef = useRef(thumbnailPaneWidth)
  const preferredThumbnailPaneWidthRef = useRef(thumbnailPaneWidth)

  useEffect(() => {
    onRegisterSave?.(null)
    return () => onRegisterSave?.(null)
  }, [onRegisterSave])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    let animationFrame: number | null = null
    const update = () => {
      if (animationFrame !== null) return
      animationFrame = requestAnimationFrame(() => {
        animationFrame = null
        const width = stage.clientWidth
        const height = stage.clientHeight
        setViewportSize((current) => (
          current.width === width && current.height === height
            ? current
            : { width, height }
        ))
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => {
      observer.disconnect()
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
    }
  }, [])

  const getThumbnailPaneMaxWidth = useCallback(() => {
    const rootWidth = rootRef.current?.clientWidth ?? 0
    if (rootWidth <= 0) return MAX_THUMBNAIL_PANE_WIDTH
    return Math.max(
      MIN_THUMBNAIL_PANE_WIDTH,
      Math.min(
        MAX_THUMBNAIL_PANE_WIDTH,
        rootWidth - MIN_PRESENTATION_STAGE_WIDTH - THUMBNAIL_RESIZER_WIDTH,
      ),
    )
  }, [])

  const commitThumbnailPaneWidth = useCallback((requestedWidth: number) => {
    const nextWidth = clamp(
      requestedWidth,
      MIN_THUMBNAIL_PANE_WIDTH,
      getThumbnailPaneMaxWidth(),
    )
    thumbnailPaneWidthRef.current = nextWidth
    preferredThumbnailPaneWidthRef.current = nextWidth
    setThumbnailPaneWidth(nextWidth)
    window.localStorage.setItem(THUMBNAIL_PANE_STORAGE_KEY, String(Math.round(nextWidth)))
  }, [getThumbnailPaneMaxWidth])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const update = () => {
      if (thumbnailResizeCleanupRef.current) return
      const nextWidth = clamp(
        preferredThumbnailPaneWidthRef.current,
        MIN_THUMBNAIL_PANE_WIDTH,
        getThumbnailPaneMaxWidth(),
      )
      thumbnailPaneWidthRef.current = nextWidth
      setThumbnailPaneWidth((current) => current === nextWidth ? current : nextWidth)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(root)
    return () => observer.disconnect()
  }, [getThumbnailPaneMaxWidth])

  useEffect(() => {
    if (!showThumbnails || isPresenting) return
    const pane = thumbnailPaneRef.current
    if (!pane) return

    const updateScale = () => {
      const frame = pane.querySelector<HTMLElement>('.presentation-thumbnail-frame')
      const previewWidth = frame?.clientWidth
        ?? Math.max(1, pane.clientWidth - THUMBNAIL_ROW_CHROME_WIDTH)
      pane.style.setProperty(
        '--presentation-thumbnail-scale',
        String(previewWidth / THUMBNAIL_RENDER_WIDTH),
      )
    }
    updateScale()
    const observer = new ResizeObserver(updateScale)
    observer.observe(pane)
    return () => observer.disconnect()
  }, [aspectRatio, isPresenting, showThumbnails, viewer])

  const slideSize = useMemo(() => {
    const padding = isPresenting ? 24 : 48
    const availableWidth = Math.max(1, viewportSize.width - padding)
    const availableHeight = Math.max(1, viewportSize.height - padding)
    const fitWidth = Math.min(availableWidth, availableHeight * aspectRatio)
    const fitHeight = fitWidth / aspectRatio
    const scale = zoom / 100
    return {
      fitWidth,
      fitHeight,
      width: Math.max(1, Math.round(fitWidth * scale)),
      height: Math.max(1, Math.round(fitHeight * scale)),
    }
  }, [aspectRatio, isPresenting, viewportSize.height, viewportSize.width, zoom])

  const animateSlide = useCallback(() => {
    const host = slideHostRef.current
    if (!host) return
    host.classList.remove('presentation-slide-host--changing')
    void host.offsetWidth
    host.classList.add('presentation-slide-host--changing')
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null
    })
  }, [])

  const goToSlide = useCallback(async (index: number) => {
    const activeViewer = viewerRef.current
    if (!activeViewer || activeViewer.slideCount === 0) return
    const next = Math.max(0, Math.min(index, activeViewer.slideCount - 1))
    await activeViewer.goToSlide(next)
    setCurrentSlide(next)
    animateSlide()
  }, [animateSlide])

  useEffect(() => {
    const host = slideHostRef.current
    if (!host) return

    let cancelled = false
    const abortController = new AbortController()
    documentBridge.clear()
    viewerRef.current?.destroy()
    viewerRef.current = null
    setViewer(null)
    setLoading(true)
    setLoadError(null)
    setErrorDetail('')
    setSlideCount(0)
    setCurrentSlide(0)
    setPageInput('1')
    setZoom(100)

    const nextViewer = new PptxViewer(host, {
      fitMode: 'contain',
      zoomPercent: 100,
      zipLimits: RECOMMENDED_ZIP_LIMITS,
      lazyMedia: true,
      lazySlides: true,
      pdfjs: false,
      onSlideChange: (index) => {
        if (!cancelled) setCurrentSlide(index)
      },
      onSlideError: (_index, error) => {
        console.error('[PresentationViewer] Slide render failed:', error)
      },
      onNodeError: (nodeId, error) => {
        console.warn(`[PresentationViewer] Node ${nodeId} render failed:`, error)
      },
    })
    viewerRef.current = nextViewer

    void (async () => {
      try {
        const prepared = await readPresentationBuffer(filePath)
        if (cancelled) return
        await nextViewer.open(prepared.buffer, {
          renderMode: 'slide',
          signal: abortController.signal,
          lazyMedia: true,
          lazySlides: true,
        })
        if (cancelled) return

        const count = nextViewer.slideCount
        if (count === 0) throw new Error('The presentation contains no slides')
        setSlideCount(count)
        setCurrentSlide(nextViewer.currentSlideIndex)
        setAspectRatio(
          nextViewer.slideWidth > 0 && nextViewer.slideHeight > 0
            ? nextViewer.slideWidth / nextViewer.slideHeight
            : DEFAULT_ASPECT_RATIO,
        )
        setViewer(nextViewer)
        setLoading(false)
        onReady?.()
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return
        console.error('[PresentationViewer] Unable to open presentation:', error)
        const message = error instanceof Error ? error.message : String(error)
        setLoadError(
          getExtension(filePath) === 'ppt' && message.includes('PRESENTATION_CONVERTER_UNAVAILABLE')
            ? 'legacy'
            : 'document',
        )
        setErrorDetail(message.replace(/^Error invoking remote method '[^']+':\s*/i, ''))
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      abortController.abort()
      nextViewer.destroy()
      if (viewerRef.current === nextViewer) viewerRef.current = null
      documentBridge.clear()
    }
  }, [filePath, onReady, retryToken])

  useEffect(() => {
    setPageInput(String(currentSlide + 1))
  }, [currentSlide])

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement === rootRef.current
      setIsPresenting(active)
      setControlsVisible(true)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const clearControlsTimer = useCallback(() => {
    if (controlsTimerRef.current !== null) {
      window.clearTimeout(controlsTimerRef.current)
      controlsTimerRef.current = null
    }
  }, [])

  const revealPresentationControls = useCallback(() => {
    if (!isPresenting) return
    clearControlsTimer()
    setControlsVisible(true)
    controlsTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false)
      controlsTimerRef.current = null
    }, PRESENTATION_CONTROLS_HIDE_MS)
  }, [clearControlsTimer, isPresenting])

  useEffect(() => clearControlsTimer, [clearControlsTimer])

  const startPresentation = useCallback(async (fromBeginning: boolean) => {
    if (fromBeginning) await goToSlide(0)
    setIsPresenting(true)
    setControlsVisible(true)
    const root = rootRef.current
    if (root?.requestFullscreen && document.fullscreenElement !== root) {
      try {
        await root.requestFullscreen()
      } catch (error) {
        console.warn('[PresentationViewer] Fullscreen request failed:', error)
      }
    }
  }, [goToSlide])

  const stopPresentation = useCallback(async () => {
    clearControlsTimer()
    setIsPresenting(false)
    setControlsVisible(true)
    if (document.fullscreenElement === rootRef.current) {
      try {
        await document.exitFullscreen()
      } catch (error) {
        console.warn('[PresentationViewer] Unable to exit fullscreen:', error)
      }
    }
  }, [clearControlsTimer])

  const setClampedZoom = useCallback((next: number) => {
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next)))
  }, [])

  const startThumbnailResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return
    const pane = thumbnailPaneRef.current
    const root = rootRef.current
    if (!pane || !root) return

    event.preventDefault()
    thumbnailResizeCleanupRef.current?.()

    const pointerId = event.pointerId
    const startX = event.clientX
    const startWidth = pane.getBoundingClientRect().width
    const maxWidth = getThumbnailPaneMaxWidth()
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    let latestWidth = startWidth
    let animationFrame: number | null = null
    let finished = false

    root.setAttribute('data-thumbnail-resizing', 'true')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const flushWidth = () => {
      animationFrame = null
      pane.style.width = `${latestWidth}px`
      thumbnailPaneWidthRef.current = latestWidth
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      const nextWidth = clamp(
        startWidth + moveEvent.clientX - startX,
        MIN_THUMBNAIL_PANE_WIDTH,
        maxWidth,
      )
      if (nextWidth === latestWidth) return
      latestWidth = nextWidth
      if (animationFrame === null) animationFrame = requestAnimationFrame(flushWidth)
    }

    const finishResize = (commit: boolean) => {
      if (finished) return
      finished = true
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerCancel)
      document.removeEventListener('keydown', onResizeKeyDown, true)
      window.removeEventListener('blur', onWindowBlur)
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame)
        flushWidth()
      }

      const finalWidth = commit ? latestWidth : startWidth
      pane.style.width = `${finalWidth}px`
      thumbnailPaneWidthRef.current = finalWidth
      setThumbnailPaneWidth(finalWidth)
      if (commit) {
        preferredThumbnailPaneWidthRef.current = finalWidth
        window.localStorage.setItem(THUMBNAIL_PANE_STORAGE_KEY, String(Math.round(finalWidth)))
      }

      root.removeAttribute('data-thumbnail-resizing')
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      thumbnailResizeCleanupRef.current = null
    }

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === pointerId) finishResize(true)
    }
    const onPointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === pointerId) finishResize(false)
    }
    const onResizeKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return
      keyEvent.preventDefault()
      finishResize(false)
    }
    const onWindowBlur = () => finishResize(true)

    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerCancel)
    document.addEventListener('keydown', onResizeKeyDown, true)
    window.addEventListener('blur', onWindowBlur)
    thumbnailResizeCleanupRef.current = () => finishResize(false)
  }, [getThumbnailPaneMaxWidth])

  const onThumbnailResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | null = null
    if (event.key === 'ArrowLeft') nextWidth = thumbnailPaneWidthRef.current - 12
    else if (event.key === 'ArrowRight') nextWidth = thumbnailPaneWidthRef.current + 12
    else if (event.key === 'Home') nextWidth = MIN_THUMBNAIL_PANE_WIDTH
    else if (event.key === 'End') nextWidth = getThumbnailPaneMaxWidth()
    if (nextWidth === null) return
    event.preventDefault()
    event.stopPropagation()
    commitThumbnailPaneWidth(nextWidth)
  }, [commitThumbnailPaneWidth, getThumbnailPaneMaxWidth])

  useEffect(() => () => {
    thumbnailResizeCleanupRef.current?.()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const root = rootRef.current
      if (!root) return
      const isInside = root.contains(event.target as Node)
      if (!isPresenting && !isInside) return
      if (
        event.target instanceof HTMLElement
        && event.target.closest('[data-presentation-thumbnail-resizer]')
      ) return

      if (event.key === 'Escape' && isPresenting) {
        event.preventDefault()
        void stopPresentation()
        return
      }
      if (event.key === 'F5') {
        event.preventDefault()
        void startPresentation(!event.shiftKey)
        return
      }
      if (isEditableTarget(event.target)) return

      if (event.ctrlKey && (event.key === '+' || event.key === '=')) {
        event.preventDefault()
        setClampedZoom(zoom + ZOOM_STEP)
        return
      }
      if (event.ctrlKey && event.key === '-') {
        event.preventDefault()
        setClampedZoom(zoom - ZOOM_STEP)
        return
      }
      if (event.ctrlKey && event.key === '0') {
        event.preventDefault()
        setZoom(100)
        return
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return

      if (['ArrowRight', 'ArrowDown', 'PageDown'].includes(event.key) || (isPresenting && (event.key === ' ' || event.key === 'Enter'))) {
        event.preventDefault()
        void goToSlide(currentSlide + 1)
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
        event.preventDefault()
        void goToSlide(currentSlide - 1)
      } else if (event.key === 'Home') {
        event.preventDefault()
        void goToSlide(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        void goToSlide(slideCount - 1)
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [currentSlide, goToSlide, isPresenting, setClampedZoom, slideCount, startPresentation, stopPresentation, zoom])

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
    }
  }, [])

  const commitPageInput = () => {
    const requested = Number.parseInt(pageInput, 10)
    if (!Number.isFinite(requested)) {
      setPageInput(String(currentSlide + 1))
      return
    }
    void goToSlide(requested - 1)
  }

  const onPageInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitPageInput()
      event.currentTarget.select()
    }
  }

  const onStageClick = (event: ReactMouseEvent<HTMLElement>) => {
    rootRef.current?.focus({ preventScroll: true })
    if (!isPresenting || event.button !== 0) return
    const target = event.target instanceof HTMLElement ? event.target : null
    if (target?.closest('a, button, input, video, audio, [role="link"]')) return
    void goToSlide(currentSlide + 1)
  }

  const surfaceInset = isPresenting ? 12 : 24
  // clientWidth is integer-rounded while the flex track may be fractional. Keep
  // the fitted surface just inside that track so a sub-pixel does not create a
  // meaningless scrollbar at 100% zoom.
  const surfaceWidth = Math.max(viewportSize.width - 2, slideSize.width + surfaceInset)
  const surfaceHeight = Math.max(viewportSize.height - 2, slideSize.height + surfaceInset)
  const thumbnailPaneMaxWidth = getThumbnailPaneMaxWidth()
  const thumbnailPaneStyle = {
    width: thumbnailPaneWidth,
    '--presentation-thumbnail-scale': String(estimatedThumbnailScale(thumbnailPaneWidth)),
  } as CSSProperties

  return (
    <div
      ref={rootRef}
      className={cn(
        'presentation-viewer relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-[#ececec] text-foreground outline-none dark:bg-[#111315]',
        isPresenting && 'presentation-viewer--presenting fixed inset-0 z-[250] bg-black',
        isPresenting && !controlsVisible && 'presentation-viewer--controls-hidden',
      )}
      tabIndex={-1}
      data-testid="presentation-viewer"
      data-presentation-state={loading ? 'loading' : loadError ? 'error' : 'ready'}
      onMouseMove={revealPresentationControls}
    >
      <div
        className="presentation-toolbar flex h-11 shrink-0 items-center gap-1 border-b border-black/10 bg-[#f8f8f8] px-2 dark:border-white/10 dark:bg-[#202224]"
        role="toolbar"
        aria-label={t('presentationViewer.toolbar')}
      >
        {!isPresenting ? (
          <button
            type="button"
            className="presentation-icon-button"
            aria-label={showThumbnails ? t('presentationViewer.hideThumbnails') : t('presentationViewer.showThumbnails')}
            title={showThumbnails ? t('presentationViewer.hideThumbnails') : t('presentationViewer.showThumbnails')}
            data-testid="presentation-thumbnail-toggle"
            onClick={() => setShowThumbnails((visible) => !visible)}
          >
            {showThumbnails ? <PanelLeftClose /> : <PanelLeftOpen />}
          </button>
        ) : null}

        <div className="presentation-toolbar-separator" />
        <button
          type="button"
          className="presentation-icon-button"
          disabled={loading || currentSlide <= 0}
          aria-label={t('presentationViewer.previousSlide')}
          title={t('presentationViewer.previousSlide')}
          data-testid="presentation-previous-slide"
          onClick={() => void goToSlide(currentSlide - 1)}
        >
          <ChevronLeft />
        </button>
        <div className="flex h-8 items-center gap-1 px-1 text-[12px] tabular-nums">
          <input
            className="h-7 w-12 rounded-[4px] border border-black/15 bg-white px-1.5 text-center text-[12px] text-[#222] outline-none focus:border-[#d24726] dark:border-white/15"
            type="text"
            inputMode="numeric"
            aria-label={t('presentationViewer.slideNumber')}
            value={pageInput}
            disabled={loading || slideCount === 0}
            data-testid="presentation-page-input"
            onChange={(event) => setPageInput(event.target.value.replace(/\D/g, '').slice(0, 5))}
            onBlur={commitPageInput}
            onKeyDown={onPageInputKeyDown}
          />
          <span className="min-w-[44px] text-muted-foreground">/ {slideCount || 0}</span>
        </div>
        <button
          type="button"
          className="presentation-icon-button"
          disabled={loading || currentSlide >= slideCount - 1}
          aria-label={t('presentationViewer.nextSlide')}
          title={t('presentationViewer.nextSlide')}
          data-testid="presentation-next-slide"
          onClick={() => void goToSlide(currentSlide + 1)}
        >
          <ChevronRight />
        </button>

        {!isPresenting ? (
          <div className="presentation-zoom-controls contents">
            <div className="presentation-toolbar-separator" />
            <button
              type="button"
              className="presentation-icon-button"
              disabled={zoom <= MIN_ZOOM}
              aria-label={t('menu.zoomOut')}
              title={t('menu.zoomOut')}
              data-testid="presentation-zoom-out"
              onClick={() => setClampedZoom(zoom - ZOOM_STEP)}
            >
              <ZoomOut />
            </button>
            <button
              type="button"
              className="presentation-zoom-value"
              title={t('presentationViewer.fitSlide')}
              data-testid="presentation-zoom-value"
              onClick={() => setZoom(100)}
            >
              {zoom}%
            </button>
            <button
              type="button"
              className="presentation-icon-button"
              disabled={zoom >= MAX_ZOOM}
              aria-label={t('menu.zoomIn')}
              title={t('menu.zoomIn')}
              data-testid="presentation-zoom-in"
              onClick={() => setClampedZoom(zoom + ZOOM_STEP)}
            >
              <ZoomIn />
            </button>
            <button
              type="button"
              className="presentation-icon-button"
              aria-label={t('presentationViewer.fitSlide')}
              title={t('presentationViewer.fitSlide')}
              data-testid="presentation-fit-slide"
              onClick={() => setZoom(100)}
            >
              <Scan />
            </button>
          </div>
        ) : null}

        <div className="flex-1" />
        {isPresenting ? (
          <button
            type="button"
            className="presentation-icon-button"
            aria-label={t('presentationViewer.exitSlideshow')}
            title={t('presentationViewer.exitSlideshow')}
            data-testid="presentation-exit-slideshow"
            onClick={() => void stopPresentation()}
          >
            <Minimize2 />
          </button>
        ) : (
          <button
            type="button"
            className="presentation-command-button presentation-slideshow-button"
            disabled={loading || slideCount === 0}
            title={t('presentationViewer.startSlideshow')}
            data-testid="presentation-start-slideshow"
            onClick={() => void startPresentation(false)}
          >
            <Play className="h-4 w-4 fill-current" />
            <span>{t('presentationViewer.slideshow')}</span>
            <Maximize2 className="h-3.5 w-3.5 opacity-65" />
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!isPresenting && showThumbnails ? (
          <>
            <aside
              ref={thumbnailPaneRef}
              className="presentation-thumbnail-pane shrink-0 overflow-x-hidden overflow-y-auto bg-[#f5f5f5] py-1 dark:bg-[#191b1d]"
              style={thumbnailPaneStyle}
              aria-label={t('presentationViewer.thumbnails')}
              data-testid="presentation-thumbnails"
            >
              {viewer
                ? Array.from({ length: slideCount }, (_, index) => (
                    <SlideThumbnail
                      key={index}
                      viewer={viewer}
                      index={index}
                      active={index === currentSlide}
                      label={t('presentationViewer.slideLabel', { number: index + 1 })}
                      aspectRatio={aspectRatio}
                      onSelect={(next) => void goToSlide(next)}
                    />
                  ))
                : null}
            </aside>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('presentationViewer.resizeThumbnails')}
              aria-valuemin={MIN_THUMBNAIL_PANE_WIDTH}
              aria-valuemax={Math.round(thumbnailPaneMaxWidth)}
              aria-valuenow={Math.round(thumbnailPaneWidth)}
              tabIndex={0}
              className="presentation-thumbnail-resizer"
              title={t('presentationViewer.resizeThumbnails')}
              data-testid="presentation-thumbnail-resizer"
              data-presentation-thumbnail-resizer
              onPointerDown={startThumbnailResize}
              onKeyDown={onThumbnailResizeKeyDown}
              onDoubleClick={() => commitThumbnailPaneWidth(DEFAULT_THUMBNAIL_PANE_WIDTH)}
            >
              <span className="presentation-thumbnail-resizer-indicator" aria-hidden="true">
                <MoveHorizontal />
              </span>
            </div>
          </>
        ) : null}

        <main
          ref={stageRef}
          className="presentation-stage relative min-h-0 min-w-0 flex-1 overflow-auto bg-[#d8dadd] dark:bg-[#0c0d0e]"
          data-testid="presentation-stage"
          onClick={onStageClick}
          onWheel={(event) => {
            if (!event.ctrlKey || isPresenting) return
            event.preventDefault()
            setClampedZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP))
          }}
        >
          <div
            className="presentation-zoom-surface flex items-center justify-center"
            style={{ width: surfaceWidth, height: surfaceHeight }}
          >
            <div
              ref={slideHostRef}
              className="presentation-slide-host shrink-0 overflow-hidden bg-white shadow-[0_4px_22px_rgba(0,0,0,0.24)]"
              style={{ width: slideSize.width, height: slideSize.height }}
              data-testid="presentation-slide-host"
            />
          </div>

          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[#e7e8ea]/95 dark:bg-[#101214]/95">
              <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground" role="status">
                <LoaderCircle className="h-7 w-7 animate-spin text-[#d24726]" />
                <span>{t('presentationViewer.loading')}</span>
              </div>
            </div>
          ) : null}

          {loadError ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[#e7e8ea] p-6 dark:bg-[#101214]">
              <div className="flex max-w-[520px] flex-col items-center gap-3 text-center">
                <Presentation className="h-11 w-11 text-[#d24726]" />
                <h2 className="text-[16px] font-semibold">{t('presentationViewer.openFailed')}</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  {loadError === 'legacy'
                    ? t('presentationViewer.legacyUnavailable')
                    : t('presentationViewer.invalidPresentation')}
                </p>
                {errorDetail && loadError !== 'legacy' ? (
                  <p className="max-w-full break-words text-[11px] text-muted-foreground/70">{errorDetail}</p>
                ) : null}
                <button
                  type="button"
                  className="presentation-command-button mt-1"
                  onClick={() => setRetryToken((value) => value + 1)}
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>{t('presentationViewer.retry')}</span>
                </button>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}
