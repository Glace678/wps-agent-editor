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
/** 吸收 ResizeObserver / 缩放换算产生的亚像素抖动，避免在临界点反复切换模式。 */
const TWO_PAGE_FIT_EPSILON = 1

/** onReady 后 PresentationEditor / 对开 DOM 可能尚未就绪，轮询等待 */
const APPLY_RETRY_MS = 120
const APPLY_RETRY_LIMIT = 25

/**
 * 修正 book 模式的宿主几何：SuperDoc 1.44 的 #applyZoom 只有 horizontal 与
 * 默认（vertical）两个分支，book 模式落入默认分支——
 * - 宽度按单页算 → 对开的两页左右各被裁掉约半页（取所有 spread 最大宽度修正）；
 * - 高度按单列堆叠总高算 → 末尾多出约一半的空白滚动区（按实际内容高度修正）。
 * 引擎的指针换算基于 client rect 与页面元素实际偏移，几何改写后依然自洽
 *（由 electron-verify-word-zoom.mjs 实测）。
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
    // SuperDoc 把 book 当成 vertical 计算宿主高度；从单页模式跨到双页模式时，
    // 它留下的是整篇单列高度。若只修 pagesHost 而不同时覆盖 viewport 与
    // marginBottom，缩放预览的旧高度会形成一大段无效滚动尾部，后续每次缩放
    // 都要为这块不可见区域参与布局/合成。
    const scaledContentHeight = contentHeight * zoomFactor
    pagesHost.style.marginBottom =
      zoomFactor !== 1 ? `${scaledContentHeight - contentHeight}px` : ''
    viewport.style.height = `${scaledContentHeight}px`
    viewport.style.minHeight = `${scaledContentHeight}px`
    if (overlay) overlay.style.height = `${contentHeight}px`
  }
  return true
}

const RULER_MIRROR_CLASS = 'word-ruler-mirror'

function removeBookRulerMirror(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>(`.${RULER_MIRROR_CLASS}`).forEach((node) => node.remove())
}

/**
 * SuperDoc 的水平标尺只有一条（宽度 = 当前节单页宽 × 缩放），双页并排时右页
 * 上方没有刻度。这里把主标尺整棵克隆一份挂进同一个 .ruler-host，按
 * 「右页左边 − 主标尺左边」的实测视口距离平移到右页上方，与左页标尺共用同一
 * 个 flex 起点（宿主在 book 模式下被钉为 flex-start，见 word-editor.css）。
 * 克隆是静态快照，由调用方在缩放/分页变化和主标尺 DOM 变化时整体重建。
 * 返回主标尺元素供调用方继续观察；画面未就绪时返回 null。
 */
function syncBookRulerMirror(container: HTMLElement): HTMLElement | null {
  const host = container.querySelector<HTMLElement>('.ruler-host')
  const ruler = host?.querySelector<HTMLElement>(
    `:scope > .ruler:not(.${RULER_MIRROR_CLASS})`,
  )
  const spread = container.querySelector<HTMLElement>(
    '.presentation-editor__pages > .superdoc-spread',
  )
  const leftPage = spread?.children[0]
  const rightPage = spread?.children[1]
  if (!host || !ruler || !(leftPage instanceof HTMLElement) || !(rightPage instanceof HTMLElement)) {
    return null
  }
  // 引擎的 scale(zoom) 是异步补上的：主标尺宽（Vue 侧已按新缩放重排）与左页
  // 视觉宽（transform 尚未生效）不一致说明画面还没到位，本轮不同步、等重试，
  // 以免在错误的坐标系里测出平移量
  const rulerRect = ruler.getBoundingClientRect()
  if (Math.abs(rulerRect.width - leftPage.getBoundingClientRect().width) > 2) return null

  const mirror = ruler.cloneNode(true) as HTMLElement
  mirror.classList.add(RULER_MIRROR_CLASS)
  // 深克隆会带出重复 id（左右页边距手柄），清掉保持文档合法
  mirror.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'))
  // 镜像在 flex 行里已排在主标尺之后，margin 只需补上两页间的视觉间隙
  //（= 右页左边 − 主标尺右边；主标尺右缘与左页右缘对齐）
  const gap = rightPage.getBoundingClientRect().left - rulerRect.right
  mirror.style.marginLeft = `${Math.max(0, gap)}px`
  removeBookRulerMirror(container)
  host.appendChild(mirror)
  return ruler
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
  // 滚轮预览期间不切分页模式、不重复修几何；只在手势结束后的提交倍率重排。
  const { settledZoom: zoom } = useDocumentZoom()
  const containerRef = useRef<HTMLDivElement>(null)
  const [twoPageMetrics, setTwoPageMetrics] = useState<{
    superdoc: SuperDocInstance | null
    availableWidth: number
    baseWidth: number
  }>({
    superdoc: null,
    availableWidth: 0,
    baseWidth: DEFAULT_TWO_PAGE_BASE_WIDTH,
  })
  const [hint, setHint] = useState<string | null>(null)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appliedRef = useRef<{ superdoc: SuperDocInstance | null; mode: WordPageLayoutMode | null }>({
    superdoc: null,
    mode: null,
  })
  const zoomFactorRef = useRef(zoom)
  const twoPageBaseWidthRef = useRef(DEFAULT_TWO_PAGE_BASE_WIDTH)
  zoomFactorRef.current = zoom

  /** 左下角瞬时提示，模式切换与页面拼接共用 */
  const showHint = useCallback((text: string) => {
    setHint(text)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHint(null), 1600)
  }, [])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    let measureFrame: number | null = null
    let refreshBaseWidth = true
    const measure = () => {
      measureFrame = null
      if (el.closest('[data-panel-resizing="true"]')) return
      if (el.hasAttribute('data-word-zoom-preview')) return
      if (refreshBaseWidth) {
        twoPageBaseWidthRef.current = measureTwoPageBaseWidth(el)
        refreshBaseWidth = false
      }
      const availableWidth = el.clientWidth
      const baseWidth = twoPageBaseWidthRef.current
      setTwoPageMetrics((current) => {
        if (
          current.superdoc === superdoc
          && Math.abs(current.availableWidth - availableWidth) < 0.5
          && Math.abs(current.baseWidth - baseWidth) < 0.5
        ) {
          return current
        }
        return { superdoc, availableWidth, baseWidth }
      })
    }
    const scheduleMeasure = (refreshWidth = false) => {
      if (refreshWidth) refreshBaseWidth = true
      if (el.hasAttribute('data-word-zoom-preview')) return
      if (measureFrame != null) return
      measureFrame = requestAnimationFrame(measure)
    }
    measure()
    const observer = new ResizeObserver(() => scheduleMeasure(false))
    observer.observe(el)
    const contentObserver = new MutationObserver(() => {
      if (el.hasAttribute('data-word-zoom-preview')) return
      scheduleMeasure(true)
    })
    contentObserver.observe(el, { childList: true, subtree: true })
    const previewObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'data-word-zoom-preview') {
          if (!el.hasAttribute('data-word-zoom-preview')) {
            scheduleMeasure(true)
          }
        }
      }
    })
    previewObserver.observe(el, { attributes: true, attributeFilter: ['data-word-zoom-preview'] })
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
      contentObserver.disconnect()
      previewObserver.disconnect()
      panelResizeObserver?.disconnect()
      if (measureFrame != null) cancelAnimationFrame(measureFrame)
    }
  }, [superdoc])

  // 页数未知（事件未到）或只有一页时保持 vertical。
  const bookEligible = totalPages !== null && totalPages >= 2
  // 宽度和未缩放页宽都是稳定指标；倍率变化时在 render 内直接推导结果。
  // 不能等下一帧再测，否则 40%→50% 会先用旧的 fits=true 做一次 book 重排，
  // 随后再切 vertical 重排，造成明显卡顿和连续闪烁。
  const fitsTwoPages =
    twoPageMetrics.superdoc === superdoc
    && twoPageMetrics.availableWidth + TWO_PAGE_FIT_EPSILON
      >= twoPageMetrics.baseWidth * zoom
  const mode: WordPageLayoutMode =
    zoom <= BOOK_MODE_MAX_ZOOM && fitsTwoPages && bookEligible ? 'book' : 'vertical'

  // setLayoutMode 与 WordEditor 的 setZoom 都会请求整篇重排。放在 layout effect
  // 可确保两者在浏览器下一绘制帧前完成，SuperDoc 会把请求合并为一次 rerender。
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
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const later = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        timers.delete(id)
        fn()
      }, ms)
      timers.add(id)
    }
    let presentation: PresentationEditorLike | null = null
    let patchFrame: number | null = null
    let patchTimer: ReturnType<typeof setTimeout> | null = null

    // 右页标尺镜像：主标尺的刻度位置与页宽由 SuperDoc 的 Vue 侧维护，应用层
    // 拿不到其内部状态，改为观察主标尺 DOM 的变化后整体重建镜像
    let mirrorObserver: MutationObserver | null = null
    let mirrorFrame: number | null = null
    const runMirrorSync = (): boolean => {
      if (cancelled || mode !== 'book') return false
      const container = containerRef.current
      if (!container) return false
      const ruler = syncBookRulerMirror(container)
      if (!ruler) return false
      mirrorObserver ??= new MutationObserver((records) => {
        // 光标指示线随鼠标移动高频刷新，而镜像上它本来就被 CSS 隐藏；
        // 变更只涉及它时跳过重建
        if (records.every(
          (record) => record.target instanceof Element && record.target.closest('.vertical-indicator'),
        )) {
          return
        }
        if (mirrorFrame !== null) return
        mirrorFrame = requestAnimationFrame(() => {
          mirrorFrame = null
          runMirrorSync()
        })
      })
      mirrorObserver.disconnect()
      mirrorObserver.observe(ruler, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['style'],
      })
      return true
    }


    const patch = (): boolean => {
      if (cancelled || mode !== 'book') return true
      const container = containerRef.current
      if (!container) return false
      const geometryReady = patchBookHostGeometry(container, zoomFactorRef.current)
      const host = container.querySelector<HTMLElement>('.ruler-host')
      const ruler = host?.querySelector<HTMLElement>(
        `:scope > .ruler:not(.${RULER_MIRROR_CLASS})`,
      )
      if (!host || !ruler) return geometryReady
      return geometryReady && runMirrorSync()
    }
    // 引擎每次 #applyZoom / 重排版都会覆写宿主宽度。缩放手势期间只在
    // 下一绘制帧修一次，并保留一次尾部修正，避免每个 zoomChange 都强制布局。
    const patchSoon = () => {
      if (patchFrame === null) {
        patchFrame = requestAnimationFrame(() => {
          patchFrame = null
          if (!cancelled) patch()
        })
      }
      if (patchTimer !== null) {
        clearTimeout(patchTimer)
        timers.delete(patchTimer)
      }
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (patchTimer === timer) patchTimer = null
        if (!cancelled) patch()
      }, 80)
      patchTimer = timer
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
        presentation.on?.('zoomChange', patchSoon)
        presentation.on?.('paginationUpdate', patchSoon)
      }
    }
    applyMode()

    return () => {
      cancelled = true
      if (patchFrame !== null) cancelAnimationFrame(patchFrame)
      if (mirrorFrame !== null) cancelAnimationFrame(mirrorFrame)
      mirrorObserver?.disconnect()
      for (const id of timers) clearTimeout(id)
      presentation?.off?.('zoomChange', patchSoon)
      presentation?.off?.('paginationUpdate', patchSoon)
      const container = containerRef.current
      if (container) removeBookRulerMirror(container)
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
      data-word-shrink-zoom={zoom < 1 ? 'true' : undefined}
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
