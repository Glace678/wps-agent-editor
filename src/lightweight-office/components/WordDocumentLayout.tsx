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

/** 缩放 ≤ 60% 且容器放得下两页时进入对开双页；继续缩小视口内自然可见 4 页 */
const BOOK_MODE_MAX_ZOOM = 0.6
/** 两页并排所需宽度 ≈ 2 × A4(816px) + 页间距，需求随缩放线性缩小 */
const TWO_PAGE_BASE_WIDTH = 1700
/**
 * 超过此页数不自动进入对开：SuperDoc 的 setLayoutMode 一旦离开 vertical 就把
 * 页面虚拟化永久关闭（#layoutOptions 私有、无恢复 API），大文档会因整篇
 * 页面常驻 DOM 而卡顿；小文档失去虚拟化无感知，故以页数封顶损害。
 */
const BOOK_MODE_MAX_PAGES = 40

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
function patchBookHostGeometry(container: HTMLElement, zoomFactor: number): boolean {
  const viewport = container.querySelector<HTMLElement>('.presentation-editor__viewport')
  const pagesHost = container.querySelector<HTMLElement>('.presentation-editor__pages')
  const overlay = container.querySelector<HTMLElement>('.presentation-editor__selection-overlay')
  const spreads = Array.from(container.querySelectorAll<HTMLElement>('.superdoc-spread'))
  if (!viewport || !pagesHost || spreads.length === 0) return false
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
 * 对开布局（第一页单独居中，之后两页一排），否则回默认 'vertical' 单列。
 *
 * 必须走 SuperDoc 原生 setLayoutMode / setZoom：真正的编辑器位于 body 上的
 * 隐藏宿主，可见页面只是绘制镜像；外部 CSS 缩放/排版会破坏它的指针坐标
 * 换算（点击错位，表现为「无法编辑」）。
 */
export function WordDocumentLayout({ children, superdoc, totalPages }: WordDocumentLayoutProps) {
  const { t } = useTranslation()
  const { zoom } = useDocumentZoom()
  const containerRef = useRef<HTMLDivElement>(null)
  const [fitsTwoPages, setFitsTwoPages] = useState(true)
  const fitsTwoPagesRef = useRef(true)
  const [hint, setHint] = useState<string | null>(null)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appliedRef = useRef<{ superdoc: SuperDocInstance | null; mode: WordPageLayoutMode | null }>({
    superdoc: null,
    mode: null,
  })
  const zoomFactorRef = useRef(zoom)
  zoomFactorRef.current = zoom

  /** 左下角瞬时提示，模式切换与页面拼接共用 */
  const showHint = useCallback((text: string) => {
    setHint(text)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHint(null), 1600)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const next = el.clientWidth >= TWO_PAGE_BASE_WIDTH * zoom
      if (next === fitsTwoPagesRef.current) return
      fitsTwoPagesRef.current = next
      setFitsTwoPages(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [zoom])

  // 页数未知（事件未到）时保持 vertical，避免在超大文档上误关虚拟化
  const bookEligible =
    totalPages !== null && totalPages >= 2 && totalPages <= BOOK_MODE_MAX_PAGES
  const mode: WordPageLayoutMode =
    zoom <= BOOK_MODE_MAX_ZOOM && fitsTwoPages && bookEligible ? 'book' : 'vertical'

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

    const patch = (): boolean => {
      if (cancelled || mode !== 'book') return true
      const container = containerRef.current
      return container ? patchBookHostGeometry(container, zoomFactorRef.current) : false
    }
    // 引擎每次 #applyZoom / 重排版都会覆写宿主宽度，事后补拍两次确保修正生效
    const patchSoon = () => {
      patch()
      requestAnimationFrame(() => {
        if (!cancelled) patch()
      })
      later(() => patch(), 80)
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
      for (const id of timers) clearTimeout(id)
      presentation?.off?.('zoomChange', patchSoon)
      presentation?.off?.('paginationUpdate', patchSoon)
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
      className="word-document-layout relative h-full w-full"
      data-word-layout-mode={mode}
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
