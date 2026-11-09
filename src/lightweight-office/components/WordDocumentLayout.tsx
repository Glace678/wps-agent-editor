import {
  useCallback,
  useEffect,
  useLayoutEffect,
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

export type WordPageLayoutMode = 'vertical' | 'book'

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
/**
 * 模式切换后保留克隆覆盖层的时间：引擎已同步完成重绘与滚动锚定，
 * 透明覆盖层保留短暂窗口供过渡采样与无白帧兜底，随后自动撤除。
 */
const MODE_SWAP_COVER_MS = 180
/** paginationUpdate 事件丢失时的兜底超时（正常在同步重绘或事件回调里立即收尾）。 */
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

/**
 * 解析 SuperDoc 真实的滚动视口容器。
 * Contained 模式下真正产生纵向滚动的是 .super-editor-container.contained
 * （外层 .superdoc__sub-document 的 scrollHeight === clientHeight，内层
 * .presentation-editor__viewport 无 overflow 裁剪）。
 */
export function findWordScrollContainer(root: ParentNode | null): HTMLElement | null {
  if (!root) return null
  const contained = root.querySelector<HTMLElement>('.super-editor-container.contained')
  if (contained) return contained
  const pagesHost = root.querySelector<HTMLElement>('.presentation-editor__pages')
  if (pagesHost) {
    let el: HTMLElement | null = pagesHost.parentElement
    while (el && el !== root) {
      const style = window.getComputedStyle(el)
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        return el
      }
      el = el.parentElement
    }
  }
  return (
    root.querySelector<HTMLElement>('.super-editor-container') ??
    root.querySelector<HTMLElement>('.superdoc__sub-document') ??
    root.querySelector<HTMLElement>('.presentation-editor__viewport')
  )
}

export interface ScrollAnchor {
  pageIndex: number
  /** 切换前该页相对视口左上的视距（像素，已含缩放） */
  deltaX: number
  deltaY: number
  /** 捕获锚点时的缩放倍率，用于缩放与双页/单页同帧切换时按比例还原页内偏移 */
  zoom?: number
  /** 若鼠标指针位于滚动视口内，记录指针相对视口顶部偏移及页顶相对指针的距离 */
  cursorOffsetY?: number
  pageOffsetFromCursorY?: number
}

/** 记录切换前视口内锚定页的位置，切换后按新几何与新缩放比把它放回同一视觉位置。 */
export function captureScrollAnchor(
  viewport: HTMLElement,
  pagesHost: HTMLElement,
  anchorCoords?: { x: number; y: number },
  currentZoom = 1,
): ScrollAnchor | null {
  const vpRect = viewport.getBoundingClientRect()
  const orderedPages = getOrderedPages(pagesHost)
  const hasCursorInViewport =
    anchorCoords != null &&
    Number.isFinite(anchorCoords.x) &&
    Number.isFinite(anchorCoords.y) &&
    (anchorCoords.x !== 0 || anchorCoords.y !== 0) &&
    anchorCoords.y >= vpRect.top &&
    anchorCoords.y <= vpRect.bottom &&
    anchorCoords.x >= vpRect.left &&
    anchorCoords.x <= vpRect.right

  if (hasCursorInViewport && anchorCoords) {
    let bestPage: { pageIndex: number; rect: DOMRect; dist: number } | null = null
    for (const page of orderedPages) {
      const rect = page.getBoundingClientRect()
      if (rect.bottom <= vpRect.top + 8) continue
      if (rect.top >= vpRect.bottom) break
      const pageIndex = Number.parseInt(page.dataset.pageIndex ?? '', 10)
      if (!Number.isFinite(pageIndex)) continue
      const dy =
        anchorCoords.y < rect.top
          ? rect.top - anchorCoords.y
          : anchorCoords.y > rect.bottom
            ? anchorCoords.y - rect.bottom
            : 0
      const dx =
        anchorCoords.x < rect.left
          ? rect.left - anchorCoords.x
          : anchorCoords.x > rect.right
            ? anchorCoords.x - rect.right
            : 0
      const dist = dy * 10 + dx
      if (!bestPage || dist < bestPage.dist) {
        bestPage = { pageIndex, rect, dist }
      }
    }
    if (bestPage) {
      return {
        pageIndex: bestPage.pageIndex,
        deltaX: bestPage.rect.left - vpRect.left,
        deltaY: bestPage.rect.top - vpRect.top,
        zoom: currentZoom,
        cursorOffsetY: anchorCoords.y - vpRect.top,
        pageOffsetFromCursorY: bestPage.rect.top - anchorCoords.y,
      }
    }
  }

  for (const page of orderedPages) {
    const rect = page.getBoundingClientRect()
    if (rect.bottom <= vpRect.top + 8) continue
    if (rect.top >= vpRect.bottom) break
    const pageIndex = Number.parseInt(page.dataset.pageIndex ?? '', 10)
    if (!Number.isFinite(pageIndex)) return null
    return {
      pageIndex,
      deltaX: rect.left - vpRect.left,
      deltaY: rect.top - vpRect.top,
      zoom: currentZoom,
    }
  }
  return null
}

export function restoreScrollAnchor(
  viewport: HTMLElement,
  pagesHost: HTMLElement,
  anchor: ScrollAnchor,
  nextZoom?: number,
): void {
  const page = pagesHost.querySelector<HTMLElement>(
    `.superdoc-page[data-page-index="${anchor.pageIndex}"]`,
  )
  if (!page) return
  const vpRect = viewport.getBoundingClientRect()
  const rect = page.getBoundingClientRect()
  const scale =
    typeof nextZoom === 'number' &&
    nextZoom > 0 &&
    typeof anchor.zoom === 'number' &&
    anchor.zoom > 0
      ? nextZoom / anchor.zoom
      : 1
  if (
    typeof anchor.cursorOffsetY === 'number' &&
    typeof anchor.pageOffsetFromCursorY === 'number'
  ) {
    const desiredTop = vpRect.top + anchor.cursorOffsetY + anchor.pageOffsetFromCursorY * scale
    viewport.scrollTop += rect.top - desiredTop
  } else {
    viewport.scrollTop += rect.top - vpRect.top - anchor.deltaY * scale
  }
  if (viewport.scrollWidth > viewport.clientWidth + 2) {
    viewport.scrollLeft += rect.left - vpRect.left - anchor.deltaX * scale
  } else {
    viewport.scrollLeft = 0
  }
}

/**
 * 模式切换时挂载页面宿主深克隆覆盖层（不随滚动移动、不接收指针事件），
 * 配合引擎同步 setLayoutMode 重绘与同步滚动锚定，保证双页↔单页切换全程无闪跳。
 * 返回撤收函数。
 */
function coverWithPagesClone(container: HTMLElement, pagesHost: HTMLElement): () => void {
  const clone = pagesHost.cloneNode(true) as HTMLElement
  clone.removeAttribute('id')
  clone.classList.remove('presentation-editor__pages')
  for (const el of Array.from(
    clone.querySelectorAll<HTMLElement>('.superdoc-page, .superdoc-spread, [data-page-index]'),
  )) {
    el.classList.remove('superdoc-page', 'superdoc-spread')
    el.removeAttribute('data-page-index')
  }
  clone.setAttribute('aria-hidden', 'true')
  clone.dataset.wordModeSwapCover = 'true'
  const containerRect = container.getBoundingClientRect()
  const hostRect = pagesHost.getBoundingClientRect()
  clone.style.position = 'absolute'
  clone.style.margin = '0'
  clone.style.pointerEvents = 'none'
  clone.style.opacity = '0'
  clone.style.zIndex = '30'
  clone.style.left = `${hostRect.left - containerRect.left}px`
  clone.style.top = `${hostRect.top - containerRect.top}px`
  container.appendChild(clone)
  return () => clone.remove()
}

export interface WordLayoutZoomSyncOptions {
  nextPercent: number
  anchorCoords?: { x: number; y: number }
}

const layoutZoomHandlers = new WeakMap<
  SuperDocInstance,
  (options: WordLayoutZoomSyncOptions) => boolean
>()

/**
 * 供 WordEditor 在缩放瞬间同步协同布局模式：
 * 当缩放跨越 60% 双页阈值时，在同一次同步调用栈内完成
 * 「捕获滚动锚点 → 同步更新缩放与排版模式 → 同步恢复滚动锚点」，
 * 彻底消除先缩放旧模式再延迟切换新模式造成的闪动。
 */
export function syncWordLayoutWithZoom(
  superdoc: SuperDocInstance | null,
  options: WordLayoutZoomSyncOptions,
): boolean {
  if (!superdoc) return false
  const handler = layoutZoomHandlers.get(superdoc)
  return handler ? handler(options) : false
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
  const [containerWidth, setContainerWidth] = useState(0)
  const [twoPageBaseWidth, setTwoPageBaseWidth] = useState(DEFAULT_TWO_PAGE_BASE_WIDTH)
  const fitsTwoPagesRef = useRef(false)
  const [hint, setHint] = useState<string | null>(null)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appliedRef = useRef<{ superdoc: SuperDocInstance | null; mode: WordPageLayoutMode | null }>({
    superdoc: null,
    mode: null,
  })
  const zoomFactorRef = useRef(zoom)
  const totalPagesRef = useRef(totalPages)
  const modeRef = useRef<WordPageLayoutMode>('vertical')
  const twoPageBaseWidthRef = useRef(DEFAULT_TWO_PAGE_BASE_WIDTH)
  const coverCleanupRef = useRef<(() => void) | null>(null)
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  zoomFactorRef.current = zoom
  totalPagesRef.current = totalPages

  /** 左下角瞬时提示，模式切换与页面拼接共用 */
  const showHint = useCallback((text: string) => {
    setHint(text)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHint(null), 1600)
  }, [])

  // 容器尺寸与真实页宽测量：立即可用，不加延迟定时器，确保缩放跨越 60% 时同帧判定双页适配。
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    let refreshBaseWidth = true

    const runMeasure = (forceRefreshBase = false) => {
      if (el.closest('[data-panel-resizing="true"]')) return
      if (forceRefreshBase || refreshBaseWidth) {
        const nextBase = measureTwoPageBaseWidth(el)
        twoPageBaseWidthRef.current = nextBase
        setTwoPageBaseWidth((prev) => (prev === nextBase ? prev : nextBase))
        refreshBaseWidth = false
      }
      const nextWidth = el.clientWidth
      if (nextWidth > 0) {
        setContainerWidth((prev) => (prev === nextWidth ? prev : nextWidth))
      }
    }

    runMeasure(true)

    const observer = new ResizeObserver(() => runMeasure(false))
    observer.observe(el)
    const panelLayout = el.closest('[data-panel="document-editor"]')?.parentElement ?? null
    const panelResizeObserver = panelLayout
      ? new MutationObserver(() => runMeasure(false))
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
    }
  }, [superdoc])

  // 总页数已知且页面已渲染后，用真实页面宽度再量一次双页基宽。
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || totalPages == null || totalPages < 2) return
    const nextBase = measureTwoPageBaseWidth(el)
    twoPageBaseWidthRef.current = nextBase
    setTwoPageBaseWidth((prev) => (prev === nextBase ? prev : nextBase))
    if (el.clientWidth > 0) {
      setContainerWidth((prev) => (prev === el.clientWidth ? prev : el.clientWidth))
    }
  }, [totalPages])

  const liveClientWidth = containerRef.current?.clientWidth ?? 0
  const effectiveContainerWidth = liveClientWidth > 0 ? liveClientWidth : containerWidth
  const effectiveBaseWidth = twoPageBaseWidthRef.current || twoPageBaseWidth
  const fitsTwoPages =
    effectiveContainerWidth > 0 && effectiveContainerWidth >= effectiveBaseWidth * zoom
  fitsTwoPagesRef.current = fitsTwoPages

  // 页数未知（事件未到）时回退读取已挂载页数，少于 2 页时保持 vertical。
  const effectivePageCount =
    totalPages ?? (containerRef.current ? getOrderedPages(containerRef.current).length : 0)
  const bookEligible = effectivePageCount >= 2
  const mode: WordPageLayoutMode =
    zoom <= BOOK_MODE_MAX_ZOOM && fitsTwoPages && bookEligible ? 'book' : 'vertical'
  modeRef.current = mode

  const swapModeInternal = useCallback(
    (
      next: WordPageLayoutMode,
      options?: {
        targetPercent?: number
        anchorCoords?: { x: number; y: number }
        fitsTwoPagesOverride?: boolean
      },
    ): boolean => {
      if (!superdoc) return false
      const presentation: PresentationEditorLike | null = resolvePresentationEditor(superdoc)
      if (!presentation?.setLayoutMode) return false
      const container = containerRef.current
      if (!container) return false

      const prevZoom =
        typeof presentation.zoom === 'number' &&
        Number.isFinite(presentation.zoom) &&
        presentation.zoom > 0
          ? presentation.zoom
          : (superdoc.getZoom?.() ?? Math.round(zoomFactorRef.current * 100)) / 100
      const targetPercent =
        options?.targetPercent ?? Math.round(zoomFactorRef.current * 100)
      const nextZoom = targetPercent / 100

      const viewport = findWordScrollContainer(container)
      const pagesHost = container.querySelector<HTMLElement>('.presentation-editor__pages')
      const anchor =
        viewport && pagesHost
          ? captureScrollAnchor(viewport, pagesHost, options?.anchorCoords, prevZoom)
          : null

      coverCleanupRef.current?.()
      const removeCover = container && pagesHost ? coverWithPagesClone(container, pagesHost) : null
      coverCleanupRef.current = removeCover

      try {
        if (Math.round(superdoc.getZoom()) !== targetPercent) {
          superdoc.setZoom(targetPercent)
        }
        presentation.setZoom?.(nextZoom)
        presentation.setLayoutMode(next)
      } catch (err) {
        console.warn('[WordDocumentLayout] setLayoutMode 失败:', err)
        removeCover?.()
        if (coverCleanupRef.current === removeCover) coverCleanupRef.current = null
        return false
      }

      container.dataset.wordLayoutMode = next
      if (typeof options?.fitsTwoPagesOverride === 'boolean') {
        container.dataset.wordTwoPageFit = options.fitsTwoPagesOverride ? 'true' : 'false'
      }
      appliedRef.current = { superdoc, mode: next }
      modeRef.current = next
      showHint(next === 'book' ? t('wordLayout.twoPages') : t('wordLayout.singlePage'))

      const later = (fn: () => void, ms: number) => {
        const id = setTimeout(() => {
          timersRef.current.delete(id)
          fn()
        }, ms)
        timersRef.current.add(id)
      }

      const correct = (): boolean => {
        const c = containerRef.current
        const vp = findWordScrollContainer(c)
        const ph = c?.querySelector<HTMLElement>('.presentation-editor__pages') ?? null
        if (!vp || !ph || !anchor) return true
        const page = ph.querySelector<HTMLElement>(
          `.superdoc-page[data-page-index="${anchor.pageIndex}"]`,
        )
        if (!page) return false
        restoreScrollAnchor(vp, ph, anchor, nextZoom)
        return true
      }

      // 同步重绘已在 setLayoutMode 内完成，立即在当前帧恢复滚动锚点
      const anchoredImmediately = correct()

      let settled = false
      let paginationHandler: (() => void) | null = null
      const finish = () => {
        if (settled) return
        settled = true
        if (paginationHandler) presentation.off?.('paginationUpdate', paginationHandler)
        paginationHandler = null
        if (!anchoredImmediately) {
          correct()
        }
        later(() => {
          removeCover?.()
          if (coverCleanupRef.current === removeCover) coverCleanupRef.current = null
        }, MODE_SWAP_COVER_MS)
      }

      if (anchoredImmediately) {
        finish()
      } else {
        paginationHandler = () => finish()
        presentation.on?.('paginationUpdate', paginationHandler)
        later(finish, MODE_SWAP_FALLBACK_MS)
      }

      return true
    },
    [superdoc, showHint, t],
  )

  // 注册同步缩放+布局协同器，供 WordEditor 在滚轮/快捷键缩放的同一同步调用栈内直接触发模式切换。
  useLayoutEffect(() => {
    if (!superdoc) return
    const handler = ({ nextPercent, anchorCoords }: WordLayoutZoomSyncOptions): boolean => {
      const container = containerRef.current
      if (!container) return false
      const nextZoom = nextPercent / 100
      if (!container.closest('[data-panel-resizing="true"]')) {
        const measuredBase = measureTwoPageBaseWidth(container)
        twoPageBaseWidthRef.current = measuredBase
      }
      const nextFits =
        container.clientWidth > 0 &&
        container.clientWidth >= twoPageBaseWidthRef.current * nextZoom
      const pageCount = totalPagesRef.current ?? getOrderedPages(container).length
      const nextEligible = pageCount >= 2
      const nextMode: WordPageLayoutMode =
        nextZoom <= BOOK_MODE_MAX_ZOOM && nextFits && nextEligible ? 'book' : 'vertical'

      fitsTwoPagesRef.current = nextFits
      zoomFactorRef.current = nextZoom
      modeRef.current = nextMode
      container.dataset.wordTwoPageFit = nextFits ? 'true' : 'false'

      if (appliedRef.current.superdoc !== superdoc) {
        appliedRef.current = { superdoc, mode: 'vertical' }
      }
      if (appliedRef.current.mode === nextMode) {
        return false
      }
      return swapModeInternal(nextMode, {
        targetPercent: nextPercent,
        anchorCoords,
        fitsTwoPagesOverride: nextFits,
      })
    }
    layoutZoomHandlers.set(superdoc, handler)
    return () => {
      if (layoutZoomHandlers.get(superdoc) === handler) {
        layoutZoomHandlers.delete(superdoc)
      }
    }
  }, [superdoc, swapModeInternal])

  // 模式应用：状态栏滑块/预设或窗口尺寸变化导致 mode 改变时，在浏览器绘制前（useLayoutEffect）同步完成切换。
  useLayoutEffect(() => {
    if (!superdoc) {
      appliedRef.current = { superdoc: null, mode: null }
      return
    }
    if (appliedRef.current.superdoc !== superdoc) {
      // 新实例的画布默认就是 vertical
      appliedRef.current = { superdoc, mode: 'vertical' }
    }

    let cancelled = false
    let modeAttempts = 0
    const retryTimers = new Set<ReturnType<typeof setTimeout>>()

    const applyMode = () => {
      if (cancelled) return
      const presentation = resolvePresentationEditor(superdoc)
      if (!presentation?.setLayoutMode) {
        if (modeAttempts < APPLY_RETRY_LIMIT) {
          modeAttempts += 1
          const id = setTimeout(() => {
            retryTimers.delete(id)
            applyMode()
          }, APPLY_RETRY_MS)
          retryTimers.add(id)
        }
        return
      }
      if (appliedRef.current.mode !== modeRef.current) {
        swapModeInternal(modeRef.current, {
          targetPercent: Math.round(zoomFactorRef.current * 100),
          fitsTwoPagesOverride: fitsTwoPagesRef.current,
        })
      }
    }
    applyMode()

    return () => {
      cancelled = true
      for (const id of retryTimers) clearTimeout(id)
    }
  }, [superdoc, mode, swapModeInternal])

  useEffect(
    () => () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
      for (const id of timersRef.current) clearTimeout(id)
      timersRef.current.clear()
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
