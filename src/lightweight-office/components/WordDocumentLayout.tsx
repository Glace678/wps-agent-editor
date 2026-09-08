import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { SuperDocInstance } from '@superdoc-dev/react'
import { useDocumentZoom } from '@/components/layout/modules/DocumentZoom'
import { useTranslation } from '@/lib/i18n/runtime'
import {
  WordPageStitch,
  resolvePresentationEditor,
  type PresentationEditorLike,
} from './WordPageStitch'

type WordPageLayoutMode = 'vertical' | 'book'

interface WordDocumentLayoutProps {
  children: ReactNode
  /** WordEditor onReady 后传入的 SuperDoc 实例；切换文件时重建为新实例 */
  superdoc: SuperDocInstance | null
  /** 由 pagination-update 事件上报的总页数；null = 尚未知晓 */
  totalPages: number | null
}

/** Word 的多页视图会同时参考缩放和可用宽度；本应用从 60% 起允许自动双页。 */
const BOOK_MODE_MAX_ZOOM = 0.6
/** SuperDoc 默认 A4 页宽约 816px；真实页面尚未绘制时用于首轮测量。 */
const DEFAULT_PAGE_WIDTH = 816
const BOOK_PAGE_GAP = 24
/** 给双页列两侧保留呼吸空间，避免页面刚好贴住滚动视口。 */
const BOOK_SIDE_GUTTER = 44
const DEFAULT_TWO_PAGE_BASE_WIDTH =
  DEFAULT_PAGE_WIDTH * 2 + BOOK_PAGE_GAP + BOOK_SIDE_GUTTER

/** onReady 后 PresentationEditor / 对开 DOM 可能尚未就绪，轮询等待 */
const APPLY_RETRY_MS = 120
const APPLY_RETRY_LIMIT = 25
/** 缩放停止后等待引擎稳定再测双页适配，避免在缩放手势中途切换排版模式 */
const ZOOM_SETTLE_MS = 180
/**
 * 模式切换后保留克隆覆盖层的时间：引擎重绘提交后新页面里的图片可能还在
 * 解码，覆盖层多留一两帧再撤，保证双页↔单页切换全程无白帧。
 */
const MODE_SWAP_COVER_MS = 180
/** paginationUpdate 事件丢失时的兜底超时（正常在事件回调里立即收尾）。 */
const MODE_SWAP_FALLBACK_MS = 900

function getOrderedPages(container: ParentNode): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.superdoc-page[data-page-index]'))
    .sort((a, b) => {
      const aIndex = Number.parseInt(a.dataset.pageIndex ?? '', 10)
      return aIndex - Number.parseInt(b.dataset.pageIndex ?? '', 10)
    })
}

function measureTwoPageBaseWidth(container: HTMLElement): number {
  const pageWidths = getOrderedPages(container)
    .map((page) => page.offsetWidth)
    .filter((width) => Number.isFinite(width) && width > 0)
    .sort((a, b) => b - a)
  if (pageWidths.length === 0) return DEFAULT_TWO_PAGE_BASE_WIDTH
  const first = pageWidths[0]
  const second = pageWidths[1] ?? first
  return first + second + BOOK_PAGE_GAP + BOOK_SIDE_GUTTER
}

interface ScrollAnchor {
  pageIndex: number
  /** 切换前该页相对视口左上的视距（像素，已含缩放） */
  deltaX: number
  deltaY: number
}

/** 记录切换前沿视口顶部可见的第一页，切换后把它放回同一视觉位置。 */
function captureScrollAnchor(viewport: HTMLElement, pagesHost: HTMLElement): ScrollAnchor | null {
  const vpRect = viewport.getBoundingClientRect()
  for (const page of getOrderedPages(pagesHost)) {
    const rect = page.getBoundingClientRect()
    if (rect.bottom <= vpRect.top + 8) continue
    if (rect.top >= vpRect.bottom) break
    const pageIndex = Number.parseInt(page.dataset.pageIndex ?? '', 10)
    if (!Number.isFinite(pageIndex)) return null
    return {
      pageIndex,
      deltaX: rect.left - vpRect.left,
      deltaY: rect.top - vpRect.top,
    }
  }
  return null
}

function restoreScrollAnchor(viewport: HTMLElement, pagesHost: HTMLElement, anchor: ScrollAnchor): void {
  const page = pagesHost.querySelector<HTMLElement>(
    `.superdoc-page[data-page-index="${anchor.pageIndex}"]`,
  )
  if (!page) return
  const vpRect = viewport.getBoundingClientRect()
  const rect = page.getBoundingClientRect()
  viewport.scrollLeft += rect.left - vpRect.left - anchor.deltaX
  viewport.scrollTop += rect.top - vpRect.top - anchor.deltaY
}

/**
 * 模式切换会触发引擎全量重绘（setLayoutMode → 异步 measure → paint）。
 * 重绘提交是同步的、旧 DOM 在异步空档期也一直保留，但新页面元素里的
 * 图片需要重新解码，极端情况下会透出一两帧空白。这里把切换前的页面宿主
 * 深克隆一张「截图」盖在布局容器上（不随滚动移动、不接收指针事件），
 * 重绘与滚动锚定都在覆盖层下方完成，到点后撤走——用户全程只看到旧画面
 * 原地变成新画面，与 Word/WPS 的双页↔单页切换一致。
 * 返回撤收函数。
 */
function coverWithPagesClone(container: HTMLElement, pagesHost: HTMLElement): () => void {
  const clone = pagesHost.cloneNode(true) as HTMLElement
  clone.removeAttribute('id')
  clone.setAttribute('aria-hidden', 'true')
  clone.dataset.wordModeSwapCover = 'true'
  const containerRect = container.getBoundingClientRect()
  const hostRect = pagesHost.getBoundingClientRect()
  clone.style.position = 'absolute'
  clone.style.margin = '0'
  clone.style.pointerEvents = 'none'
  clone.style.zIndex = '30'
  clone.style.left = `${hostRect.left - containerRect.left}px`
  clone.style.top = `${hostRect.top - containerRect.top}px`
  container.appendChild(clone)
  return () => clone.remove()
}

/**
 * Word 页面布局模式：缩放 ≤ 60% 且宽度足够时切到 SuperDoc 原生 'book'
 * 布局（引擎已按「从第 1 页起两页一排」输出，并原生处理缩放几何）；
 * 否则回默认 'vertical' 单列。
 *
 * 必须走 SuperDoc 原生 setLayoutMode / setZoom：真正的编辑器位于 body 上的
 * 隐藏宿主，可见页面只是绘制镜像；外部 CSS 缩放/排版会破坏它的指针坐标
 * 换算（点击错位，表现为「无法编辑」）。
 */
export function WordDocumentLayout({ children, superdoc, totalPages }: WordDocumentLayoutProps) {
  const { t } = useTranslation()
  const { zoom } = useDocumentZoom()
  const containerRef = useRef<HTMLDivElement>(null)
  const [fitsTwoPages, setFitsTwoPages] = useState(false)
  const fitsTwoPagesRef = useRef(false)
  const [hint, setHint] = useState<string | null>(null)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appliedRef = useRef<{ superdoc: SuperDocInstance | null; mode: WordPageLayoutMode | null }>({
    superdoc: null,
    mode: null,
  })
  const zoomFactorRef = useRef(zoom)
  const modeRef = useRef<WordPageLayoutMode>('vertical')
  const twoPageBaseWidthRef = useRef(DEFAULT_TWO_PAGE_BASE_WIDTH)
  const scheduleTwoPageMeasureRef = useRef<(refreshBase?: boolean) => void>(() => {})
  const coverCleanupRef = useRef<(() => void) | null>(null)
  zoomFactorRef.current = zoom

  /** 左下角瞬时提示，模式切换与页面拼接共用 */
  const showHint = useCallback((text: string) => {
    setHint(text)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHint(null), 1600)
  }, [])

  const lastZoomChangeRef = useRef(-ZOOM_SETTLE_MS)
  const pendingMeasureRef = useRef<{ refreshBase: boolean } | null>(null)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 双页适配测量：缩放/容器尺寸稳定后，比对容器宽度与双页所需宽度。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let measureFrame: number | null = null
    let refreshBaseWidth = true

    const runMeasure = () => {
      measureFrame = null
      if (el.closest('[data-panel-resizing="true"]')) return
      const pending = pendingMeasureRef.current
      pendingMeasureRef.current = null
      if (pending?.refreshBase) refreshBaseWidth = true
      if (refreshBaseWidth) {
        twoPageBaseWidthRef.current = measureTwoPageBaseWidth(el)
        refreshBaseWidth = false
      }
      const requiredWidth = twoPageBaseWidthRef.current * zoomFactorRef.current
      const next = el.clientWidth >= requiredWidth
      if (next !== fitsTwoPagesRef.current) {
        fitsTwoPagesRef.current = next
        setFitsTwoPages(next)
      }
    }

    const scheduleMeasure = (refreshWidth = false) => {
      if (refreshWidth) refreshBaseWidth = true
      pendingMeasureRef.current = {
        refreshBase: refreshBaseWidth || pendingMeasureRef.current?.refreshBase || false,
      }
      if (settleTimerRef.current) return
      const elapsed = performance.now() - lastZoomChangeRef.current
      const wait = Math.max(0, ZOOM_SETTLE_MS - elapsed)
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null
        measureFrame = requestAnimationFrame(runMeasure)
      }, wait)
    }

    scheduleTwoPageMeasureRef.current = (refreshWidth = false) => scheduleMeasure(refreshWidth)
    scheduleMeasure(false)

    const observer = new ResizeObserver(() => scheduleMeasure(false))
    observer.observe(el)
    const panelLayout = el.closest('[data-panel="document-editor"]')?.parentElement ?? null
    const panelResizeObserver = panelLayout
      ? new MutationObserver(() => scheduleMeasure(false))
      : null
    if (panelLayout) {
      panelResizeObserver?.observe(panelLayout, {
        attributes: true,
        attributeFilter: ['data-panel-resizing'],
      })
    }
    return () => {
      observer.disconnect()
      panelResizeObserver?.disconnect()
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
      if (measureFrame != null) cancelAnimationFrame(measureFrame)
      pendingMeasureRef.current = null
      scheduleTwoPageMeasureRef.current = () => {}
    }
  }, [superdoc])

  // 缩放变化：重置稳定计时，手势结束后再重新评估双页适配
  useEffect(() => {
    lastZoomChangeRef.current = performance.now()
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
    scheduleTwoPageMeasureRef.current()
  }, [zoom])

  // 总页数已知且页面已渲染后，用真实页面宽度再量一次双页基宽。
  useEffect(() => {
    if (totalPages != null && totalPages >= 2) {
      scheduleTwoPageMeasureRef.current(true)
    }
  }, [totalPages])

  // 页数未知（事件未到）或只有一页时保持 vertical。
  const bookEligible = totalPages !== null && totalPages >= 2
  const mode: WordPageLayoutMode =
    zoom <= BOOK_MODE_MAX_ZOOM && fitsTwoPages && bookEligible ? 'book' : 'vertical'
  modeRef.current = mode

  // 模式应用：setLayoutMode 前后做滚动锚定与克隆覆盖，保证切换无白帧。
  useEffect(() => {
    if (!superdoc) {
      appliedRef.current = { superdoc: null, mode: null }
      return
    }
    if (appliedRef.current.superdoc !== superdoc) {
      // 新实例的画布默认就是 vertical
      appliedRef.current = { superdoc, mode: 'vertical' }
    }

    let cancelled = false
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const later = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        timers.delete(id)
        fn()
      }, ms)
      timers.add(id)
    }
    let presentation: PresentationEditorLike | null = null
    let paginationHandler: (() => void) | null = null
    let modeAttempts = 0

    const swapMode = (next: WordPageLayoutMode) => {
      const container = containerRef.current
      const viewport = container?.querySelector<HTMLElement>('.presentation-editor__viewport') ?? null
      const pagesHost = container?.querySelector<HTMLElement>('.presentation-editor__pages') ?? null
      const anchor = viewport && pagesHost ? captureScrollAnchor(viewport, pagesHost) : null
      const removeCover = container && pagesHost ? coverWithPagesClone(container, pagesHost) : null
      coverCleanupRef.current = removeCover
      try {
        presentation?.setLayoutMode?.(next)
      } catch (err) {
        console.warn('[WordDocumentLayout] setLayoutMode 失败:', err)
        removeCover?.()
        coverCleanupRef.current = null
        return
      }
      appliedRef.current = { superdoc, mode: next }
      showHint(next === 'book' ? t('wordLayout.twoPages') : t('wordLayout.singlePage'))

      let settled = false
      const finish = () => {
        if (settled || cancelled) return
        settled = true
        if (paginationHandler) presentation?.off?.('paginationUpdate', paginationHandler)
        paginationHandler = null
        // 新 DOM 已提交：立刻按锚点校正滚动（覆盖层不随滚动移动，
        // 校正过程用户不可见），下一帧布局稳定后再补一次。
        const correct = () => {
          const c = containerRef.current
          const vp = c?.querySelector<HTMLElement>('.presentation-editor__viewport') ?? null
          const ph = c?.querySelector<HTMLElement>('.presentation-editor__pages') ?? null
          if (vp && ph && anchor) restoreScrollAnchor(vp, ph, anchor)
        }
        correct()
        requestAnimationFrame(() => {
          if (cancelled) return
          correct()
          later(() => {
            removeCover?.()
            if (coverCleanupRef.current === removeCover) coverCleanupRef.current = null
          }, MODE_SWAP_COVER_MS)
        })
      }
      paginationHandler = () => finish()
      presentation?.on?.('paginationUpdate', paginationHandler)
      later(finish, MODE_SWAP_FALLBACK_MS)
    }

    const applyMode = () => {
      if (cancelled) return
      presentation = resolvePresentationEditor(superdoc)
      if (!presentation?.setLayoutMode) {
        if (modeAttempts < APPLY_RETRY_LIMIT) {
          modeAttempts += 1
          later(applyMode, APPLY_RETRY_MS)
        }
        return
      }
      if (appliedRef.current.mode !== modeRef.current) {
        swapMode(modeRef.current)
      }
    }
    applyMode()

    return () => {
      cancelled = true
      for (const id of timers) clearTimeout(id)
      if (paginationHandler) presentation?.off?.('paginationUpdate', paginationHandler)
      coverCleanupRef.current?.()
      coverCleanupRef.current = null
    }
  }, [superdoc, mode, t, showHint])

  useEffect(
    () => () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
      coverCleanupRef.current?.()
      coverCleanupRef.current = null
    },
    [],
  )

  return (
    <div
      ref={containerRef}
      className="word-document-layout relative min-h-0 w-full flex-1 overflow-hidden"
      data-word-layout-mode={mode}
      data-word-page-count={totalPages ?? undefined}
      data-word-two-page-fit={fitsTwoPages ? 'true' : 'false'}
    >
      {children}
      {/* 双击页间黑边拼接所有页面 / 双击接缝恢复（Word「隐藏空白」） */}
      <WordPageStitch superdoc={superdoc} active={mode === 'vertical'} showHint={showHint} />
      {/* 挂左下角：右下角被快捷键设置悬浮按钮（z-20）占用，会盖住本气泡 */}
      {hint && (
        <div
          className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-md bg-foreground/80 px-2 py-1 text-[10px] font-medium text-background"
          role="status"
          aria-live="polite"
        >
          {hint}
        </div>
      )}
    </div>
  )
}
