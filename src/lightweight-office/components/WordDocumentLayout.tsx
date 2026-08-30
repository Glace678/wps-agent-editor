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
/** 缩放/模式切换后等待引擎稳定再测双页、再补几何，避免在缩放手势末尾闪跳 */
const ZOOM_SETTLE_MS = 180

/**
 * 修正 book 模式的宿主几何：SuperDoc 1.44 的 #applyZoom 只有 horizontal 与
 * 默认（vertical）两个分支，book 模式落入默认分支——
 * - 宽度按单页算 → 对开的两页左右各被裁掉约半页（取所有 spread 最大宽度修正）；
 * - 高度按单列堆叠总高算 → 末尾多出约一半的空白滚动区（按实际内容高度修正）。
 * 引擎的指针换算基于 client rect 与页面元素实际偏移，几何改写后依然自洽
 *（由文档缩放金丝雀测试覆盖）。
 */
function getOrderedPages(container: ParentNode): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.superdoc-page[data-page-index]'))
    .sort((a, b) => {
      const aIndex = Number.parseInt(a.dataset.pageIndex ?? '', 10)
      const bIndex = Number.parseInt(b.dataset.pageIndex ?? '', 10)
      return aIndex - bIndex
    })
}

/**
 * SuperDoc 的 book 模式把封面页单独放在第一行。Word「多页」则从第 1 页开始
 * 每两页一行，因此复用引擎创建的 spread，只移动页面节点、不复制页面内容。
 */
function pairBookPages(pagesHost: HTMLElement): boolean {
  const pages = getOrderedPages(pagesHost)
  const existingSpreads = Array.from(
    pagesHost.querySelectorAll<HTMLElement>(':scope > .superdoc-spread'),
  )
  if (pages.length < 2 || existingSpreads.length === 0) return false

  const spreadCount = Math.ceil(pages.length / 2)
  const directChildren = Array.from(pagesHost.children)
  const alreadyPaired =
    directChildren.length === spreadCount &&
    directChildren.every((child, spreadIndex) => {
      if (!(child instanceof HTMLElement) || !child.classList.contains('superdoc-spread')) {
        return false
      }
      const expectedPages = pages.slice(spreadIndex * 2, spreadIndex * 2 + 2)
      const actualPages = Array.from(child.children)
      return (
        actualPages.length === expectedPages.length &&
        actualPages.every((page, pageIndex) => page === expectedPages[pageIndex])
      )
    })
  if (alreadyPaired) {
    pagesHost.style.gap = `${BOOK_PAGE_GAP}px`
    return true
  }

  const template = existingSpreads[0]
  const spreads = existingSpreads.slice(0, spreadCount)
  while (spreads.length < spreadCount) {
    spreads.push(template.cloneNode(false) as HTMLElement)
  }
  for (let index = 0; index < spreadCount; index += 1) {
    spreads[index].replaceChildren(...pages.slice(index * 2, index * 2 + 2))
  }
  pagesHost.replaceChildren(...spreads)
  pagesHost.style.gap = `${BOOK_PAGE_GAP}px`
  return true
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

/** 切回 vertical 前清掉 book 模式写死的内联尺寸，避免旧几何继续影响单列重排。 */
function resetBookHostGeometry(container: HTMLElement): void {
  const viewport = container.querySelector<HTMLElement>('.presentation-editor__viewport')
  const pagesHost = container.querySelector<HTMLElement>('.presentation-editor__pages')
  const overlay = container.querySelector<HTMLElement>('.presentation-editor__selection-overlay')
  if (pagesHost) {
    pagesHost.style.width = ''
    pagesHost.style.minHeight = ''
    pagesHost.style.marginBottom = ''
    pagesHost.style.gap = ''
  }
  if (viewport) {
    viewport.style.width = ''
    viewport.style.minWidth = ''
    viewport.style.height = ''
    viewport.style.minHeight = ''
  }
  if (overlay) {
    overlay.style.width = ''
    overlay.style.height = ''
  }
}

function patchBookHostGeometry(container: HTMLElement, zoomFactor: number): boolean {
  const viewport = container.querySelector<HTMLElement>('.presentation-editor__viewport')
  const pagesHost = container.querySelector<HTMLElement>('.presentation-editor__pages')
  const overlay = container.querySelector<HTMLElement>('.presentation-editor__selection-overlay')
  if (!viewport || !pagesHost || !pairBookPages(pagesHost)) return false
  const spreads = Array.from(pagesHost.querySelectorAll<HTMLElement>(':scope > .superdoc-spread'))
  const baseWidth = parseFloat(pagesHost.style.width) || pagesHost.clientWidth
  const spreadWidth = Math.max(baseWidth, ...spreads.map((el) => el.scrollWidth))
  if (!spreadWidth || !Number.isFinite(spreadWidth)) return false
  pagesHost.style.width = `${spreadWidth}px`
  viewport.style.width = `${spreadWidth * zoomFactor}px`
  viewport.style.minWidth = `${spreadWidth * zoomFactor}px`
  if (overlay) overlay.style.width = `${spreadWidth}px`

  // scrollHeight 是布局像素、与 transform 是否已应用无关（rect 会因引擎异步
  // 补 transform 的时序而失真）；先清掉引擎写入的 minHeight 再测真实内容高
  pagesHost.style.minHeight = '0px'
  const contentHeight = pagesHost.scrollHeight
  if (Number.isFinite(contentHeight) && contentHeight > 0) {
    pagesHost.style.minHeight = `${contentHeight}px`
    // 引擎公式：marginBottom 补偿「布局高(未缩放) vs 视觉高(已缩放)」的差；
    // 但作为末子元素它会与父级底边塌陷、逃逸到视口外，不参与视口高度，
    // 所以视口必须显式写 height（视觉高度），不能只写 minHeight
    pagesHost.style.marginBottom =
      zoomFactor !== 1 ? `${contentHeight * zoomFactor - contentHeight}px` : ''
    viewport.style.height = `${contentHeight * zoomFactor}px`
    viewport.style.minHeight = `${contentHeight * zoomFactor}px`
    if (overlay) overlay.style.height = `${contentHeight}px`
  }
  return true
}

/**
 * Word 页面布局模式：缩放 ≤ 60% 且宽度足够时切到 SuperDoc 原生 'book'
 * 布局，并把引擎默认的「封面单页」整理为 Word 多页视图的「从第 1 页起两页一排」；
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
      // 缩放稳定后，如果仍在 book 模式，补一次几何修正
      if (modeRef.current === 'book') {
        patchBookHostGeometry(el, zoomFactorRef.current)
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
    let paginationPatchTimer: ReturnType<typeof setTimeout> | null = null

    const patch = (): boolean => {
      if (cancelled || modeRef.current !== 'book') return true
      const container = containerRef.current
      return container ? patchBookHostGeometry(container, zoomFactorRef.current) : false
    }

    const schedulePatch = () => {
      if (paginationPatchTimer !== null) {
        clearTimeout(paginationPatchTimer)
        timers.delete(paginationPatchTimer)
      }
      const timer = setTimeout(() => {
        timers.delete(timer)
        paginationPatchTimer = null
        if (!cancelled) patch()
      }, 150)
      paginationPatchTimer = timer
      timers.add(timer)
    }

    let modeAttempts = 0
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
      if (appliedRef.current.mode !== mode) {
        // 从 book 切回 vertical 前先把写死的几何清掉，避免引擎用旧尺寸重排导致卡顿/闪跳
        if (mode === 'vertical' && appliedRef.current.mode === 'book') {
          const container = containerRef.current
          if (container) resetBookHostGeometry(container)
        }
        try {
          presentation.setLayoutMode(mode)
          appliedRef.current = { superdoc, mode }
          showHint(mode === 'book' ? t('wordLayout.twoPages') : t('wordLayout.singlePage'))
        } catch (err) {
          console.warn('[WordDocumentLayout] setLayoutMode 失败:', err)
          return
        }
      }
      if (mode === 'book') {
        // setLayoutMode 的重绘是异步的，轮询到对开 DOM 出现后修宽
        let patchAttempts = 0
        const tryPatch = () => {
          if (cancelled) return
          if (patch()) {
            // 引擎会异步补 transform/样式，稍后再修一拍
            later(() => patch(), 200)
          } else if (patchAttempts < APPLY_RETRY_LIMIT) {
            patchAttempts += 1
            later(tryPatch, APPLY_RETRY_MS)
          }
        }
        tryPatch()
        // 缩放手势已由 measure effect 在稳定后统一补几何；这里只处理内容分页变化
        presentation.on?.('paginationUpdate', schedulePatch)
      }
    }
    applyMode()

    return () => {
      cancelled = true
      for (const id of timers) clearTimeout(id)
      presentation?.off?.('paginationUpdate', schedulePatch)
    }
  }, [superdoc, mode, t, showHint])

  useEffect(
    () => () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    },
    [],
  )

  return (
    <div
      ref={containerRef}
      className="word-document-layout relative min-h-0 w-full flex-1"
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
