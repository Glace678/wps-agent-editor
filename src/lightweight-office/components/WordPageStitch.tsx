import { useCallback, useEffect, useRef, useState } from 'react'
import type { SuperDocInstance } from '@superdoc-dev/react'
import { useTranslation } from '@/lib/i18n/runtime'

export interface VirtualizationOptionsLike {
  enabled?: boolean
  gap?: number
  [key: string]: unknown
}

export interface PresentationEditorLike {
  setLayoutMode?: (mode: 'vertical' | 'horizontal' | 'book') => void
  getLayoutOptions?: () => { virtualization?: VirtualizationOptionsLike } | null | undefined
  on?: (event: string, handler: () => void) => unknown
  off?: (event: string, handler: () => void) => unknown
}

/** activeEditor.presentationEditor 在 superdoc 1.44 的 d.ts 中已公开，但
 * @superdoc-dev/react 暴露的实例类型未必携带完整签名，这里做结构化收窄 */
export function resolvePresentationEditor(superdoc: SuperDocInstance): PresentationEditorLike | null {
  const editor = (
    superdoc as { activeEditor?: { presentationEditor?: PresentationEditorLike | null } | null }
  ).activeEditor
  return editor?.presentationEditor ?? null
}

interface WordPageStitchProps {
  superdoc: SuperDocInstance | null
  /** 仅 vertical 布局启用；进入对开（book）时拼接自动还原 */
  active: boolean
  /** 复用 WordDocumentLayout 左下角的瞬时提示气泡 */
  showHint: (text: string) => void
}

interface Band {
  key: string
  /** 间隙/接缝上方页面的 data-page-index */
  upperIndex: number
  top: number
  left: number
  width: number
  height: number
}

/** 页间距小于此值视为已拼接（不再渲染间隙命中带，只渲染接缝命中带） */
const MIN_GAP_PX = 6
/** 拼接后接缝命中带高度（以接缝为中心） */
const SEAM_BAND_PX = 8
/** 拼接切换后等待引擎异步重排的最大帧数（rAF 轮询滚动锚定） */
const SETTLE_FRAMES = 60

/** 仿 Word「隐藏空白」光标：两枚箭头指向中线（拼接）/背离中线（拆分），白描边保证深浅背景均可见 */
function makeCursor(paths: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>` +
    `<g fill='none' stroke-linecap='round' stroke-linejoin='round'>` +
    `<path d='${paths}' stroke='#ffffff' stroke-width='3.5'/>` +
    `<path d='${paths}' stroke='#1f2937' stroke-width='1.6'/>` +
    `</g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, row-resize`
}
const CURSOR_STITCH = makeCursor('M12 2v6M9 5.5 12 8.5 15 5.5M12 22v-6M9 18.5 12 15.5 15 18.5M4 12h16')
const CURSOR_SPLIT = makeCursor('M12 8V2M9 5 12 2 15 5M12 16v6M9 19 12 22 15 19M4 12h16')

/**
 * 从页面宿主向上解析真实的滚动容器与裁剪盒。superdoc 的多层包装大多
 * shrink-to-fit（sub-document 等层 scrollHeight == clientHeight，滚不动），
 * 实际滚动者是内层的 .super-editor-container——与引擎 #findScrollableAncestor
 * 一致地按能力探测，不硬编码类名。
 */
function resolveHostBoxes(host: HTMLElement, stopAt: HTMLElement | null) {
  let scrollEl: HTMLElement | null = null
  let clipEl: HTMLElement | null = null
  let el: HTMLElement | null = host.parentElement
  while (el) {
    const overflowY = getComputedStyle(el).overflowY
    if (overflowY !== 'visible') {
      if (!clipEl) clipEl = el
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
        scrollEl = el
        break
      }
    }
    if (el === stopAt) break
    el = el.parentElement
  }
  return { scrollEl, clipEl }
}

function bandsEqual(a: Band[], b: Band[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.key !== y.key ||
      Math.abs(x.top - y.top) > 0.5 ||
      Math.abs(x.left - y.left) > 0.5 ||
      Math.abs(x.width - y.width) > 0.5 ||
      Math.abs(x.height - y.height) > 0.5
    ) {
      return false
    }
  }
  return true
}

/**
 * Word 风格「隐藏空白」：双击相邻两页之间的黑边，所有页面无缝拼接；
 * 再次双击接缝处，恢复原始页间距。
 *
 * 页间距必须改在引擎内部而不能用外部 CSS 压缩：SuperDoc 的选区/光标 overlay
 * 与滚动定位按 layout.pageGap 公式计算，外部改排版会让高亮与点击逐页漂移。
 * 引擎每轮排版把 #getEffectivePageGap()（虚拟化开启时取
 * layoutOptions.virtualization.gap）写进 layout.pageGap，painter 与全部坐标
 * 公式都从这一个值派生；而 getLayoutOptions() 返回浅拷贝，其 virtualization
 * 是活引用——改它 + 重建 painter 即可让视觉与几何整体一致地换挡。
 */
export function WordPageStitch({ superdoc, active, showHint }: WordPageStitchProps) {
  const { t } = useTranslation()
  const overlayRef = useRef<HTMLDivElement>(null)
  const [bands, setBands] = useState<Band[]>([])
  const [stitched, setStitched] = useState(false)
  const [ready, setReady] = useState(false)
  const stitchedRef = useRef(stitched)
  stitchedRef.current = stitched
  /** 首次拼接前记录原始配置，拆分时按原值恢复 */
  const originalRef = useRef<{ gap: number | undefined; enabled: boolean } | null>(null)
  const rafRef = useRef<number | null>(null)

  const refresh = useCallback(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    const container = overlay.parentElement
    const host = container?.querySelector<HTMLElement>('.presentation-editor__pages')
    if (!host) {
      setBands((prev) => (prev.length ? [] : prev))
      return
    }
    // 引擎自身也用该选择器枚举页面；虚拟化只挂载视口附近的页
    const pages = Array.from(host.querySelectorAll<HTMLElement>('.superdoc-page[data-page-index]'))
      .map((el) => ({ el, index: Number.parseInt(el.getAttribute('data-page-index') ?? '', 10) }))
      .filter((p) => Number.isFinite(p.index))
      .sort((a, b) => a.index - b.index)
    const overlayRect = overlay.getBoundingClientRect()
    // 页面矩形不受滚动裁剪影响，需按滚动视口裁剪，避免命中带盖到工具栏
    const { clipEl } = resolveHostBoxes(host, container)
    const viewRect = (clipEl ?? host).getBoundingClientRect()
    const next: Band[] = []
    for (let i = 0; i + 1 < pages.length; i++) {
      const a = pages[i]
      const b = pages[i + 1]
      // 虚拟化 pinned 页与窗口页之间隔着占位 spacer，不是真实相邻间隙
      if (b.index !== a.index + 1) continue
      const ra = a.el.getBoundingClientRect()
      const rb = b.el.getBoundingClientRect()
      const gap = rb.top - ra.bottom
      let bandTop: number
      let bandHeight: number
      if (stitchedRef.current) {
        const seamY = (ra.bottom + rb.top) / 2
        bandTop = seamY - SEAM_BAND_PX / 2
        bandHeight = SEAM_BAND_PX
      } else {
        if (gap < MIN_GAP_PX) continue
        bandTop = ra.bottom
        bandHeight = gap
      }
      const clipTop = Math.max(bandTop, viewRect.top)
      const clipBottom = Math.min(bandTop + bandHeight, viewRect.bottom)
      if (clipBottom - clipTop < 2) continue
      const left = Math.min(ra.left, rb.left)
      const width = Math.max(ra.right, rb.right) - left
      if (width <= 0) continue
      next.push({
        key: `${stitchedRef.current ? 's' : 'g'}${a.index}`,
        upperIndex: a.index,
        top: clipTop - overlayRect.top,
        left: left - overlayRect.left,
        width,
        height: clipBottom - clipTop,
      })
    }
    setBands((prev) => (bandsEqual(prev, next) ? prev : next))
  }, [])

  const scheduleRefresh = useCallback(() => {
    // Computing page hit bands requires several forced layout reads. Their
    // invisible geometry can be refreshed once after the sidebar drag ends.
    if (overlayRef.current?.closest('[data-panel-resizing="true"]')) return
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      if (overlayRef.current?.closest('[data-panel-resizing="true"]')) return
      refresh()
    })
  }, [refresh])

  // 换文件（新实例）时回到未拼接状态
  useEffect(() => {
    setStitched(false)
    originalRef.current = null
  }, [superdoc])

  // 进入对开时引擎已把 virtualization 关掉、间距回到默认，拼接状态同步归零
  useEffect(() => {
    if (!active) setStitched(false)
  }, [active])

  // 刚从 book 切回 vertical 时引擎正在重建单列 DOM，延迟激活命中带计算，
  // 避免在过渡关键帧抢布局资源造成卡顿。
  useEffect(() => {
    if (!active) {
      setReady(false)
      return
    }
    const timer = setTimeout(() => setReady(true), 180)
    return () => clearTimeout(timer)
  }, [active])

  // 拼接态标记挂在布局容器上，供 word-editor.css 去掉页面投影
  useEffect(() => {
    const container = overlayRef.current?.parentElement
    if (!container) return
    if (stitched) container.setAttribute('data-word-stitched', 'true')
    else container.removeAttribute('data-word-stitched')
    return () => container.removeAttribute('data-word-stitched')
  }, [stitched])

  useEffect(() => {
    if (!active || !superdoc) {
      setBands((prev) => (prev.length ? [] : prev))
      return
    }
    const overlay = overlayRef.current
    const container = overlay?.parentElement
    if (!overlay || !container) return
    scheduleRefresh()
    const panelLayout = container.closest('[data-panel="document-editor"]')?.parentElement ?? null
    const panelResizeObserver = panelLayout
      ? new MutationObserver(() => {
          if (panelLayout.getAttribute('data-panel-resizing') !== 'true') scheduleRefresh()
        })
      : null
    if (panelLayout) {
      panelResizeObserver?.observe(panelLayout, {
        attributes: true,
        attributeFilter: ['data-panel-resizing'],
      })
    }
    const ro = new ResizeObserver(scheduleRefresh)
    ro.observe(container)
    // scroll 不冒泡但可捕获：在容器上捕获内部 .superdoc__sub-document 的滚动
    container.addEventListener('scroll', scheduleRefresh, { capture: true, passive: true })
    window.addEventListener('resize', scheduleRefresh)
    // 虚拟化随滚动增删页、编辑时 painter 补写样式，DOM 观察兜底所有重绘时机
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.target instanceof Node && overlay.contains(m.target)) continue
        scheduleRefresh()
        return
      }
    })
    mo.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
    const presentation = superdoc ? resolvePresentationEditor(superdoc) : null
    presentation?.on?.('zoomChange', scheduleRefresh)
    presentation?.on?.('paginationUpdate', scheduleRefresh)
    return () => {
      ro.disconnect()
      mo.disconnect()
      panelResizeObserver?.disconnect()
      container.removeEventListener('scroll', scheduleRefresh, { capture: true })
      window.removeEventListener('resize', scheduleRefresh)
      presentation?.off?.('zoomChange', scheduleRefresh)
      presentation?.off?.('paginationUpdate', scheduleRefresh)
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [active, superdoc, scheduleRefresh])

  const toggle = useCallback(
    (upperIndex: number) => {
      if (!superdoc) return
      const presentation = resolvePresentationEditor(superdoc)
      if (!presentation?.setLayoutMode || !presentation.getLayoutOptions) return
      const virtualization = presentation.getLayoutOptions()?.virtualization
      if (!virtualization || typeof virtualization !== 'object') {
        // 没有 virtualization 配置就没有可安全改写的间距开关（间距会退回引擎常量）
        console.warn('[WordPageStitch] 实例缺少 virtualization 配置，无法调整页间距')
        return
      }
      const goStitch = !stitchedRef.current
      if (!originalRef.current) {
        originalRef.current = {
          gap: typeof virtualization.gap === 'number' ? virtualization.gap : undefined,
          enabled: virtualization.enabled === true,
        }
      }

      // 滚动锚定：记录被双击间隙上方页面相对滚动容器的位置，重排后校正
      const container = overlayRef.current?.parentElement
      const host = container?.querySelector<HTMLElement>('.presentation-editor__pages')
      const scrollEl = host ? resolveHostBoxes(host, container ?? null).scrollEl : null
      const anchorEl =
        host?.querySelector<HTMLElement>(`.superdoc-page[data-page-index="${upperIndex}"]`) ?? null
      const anchorDelta =
        anchorEl && scrollEl
          ? anchorEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top
          : null

      try {
        // 同模式调用会早退，往返 horizontal 是唯一公开的 painter 重建通道；
        // 重排由 rAF 合并成一次，中间的 horizontal 状态不会被绘制
        presentation.setLayoutMode('horizontal')
        // 离开 vertical 时引擎会以 {enabled:false} 重建 virtualization 对象，重取活引用
        const current = presentation.getLayoutOptions()?.virtualization ?? virtualization
        current.enabled = goStitch ? true : originalRef.current.enabled
        current.gap = goStitch ? 0 : originalRef.current.gap
        presentation.setLayoutMode('vertical')
      } catch (err) {
        console.warn('[WordPageStitch] 切换页间距失败:', err)
        return
      }

      setStitched(goStitch)
      showHint(t(goStitch ? 'wordLayout.whiteSpaceHidden' : 'wordLayout.whiteSpaceShown'))

      if (anchorDelta != null && scrollEl && host) {
        let attempts = 0
        const settle = () => {
          if (!host.isConnected) return
          const el = host.querySelector<HTMLElement>(`.superdoc-page[data-page-index="${upperIndex}"]`)
          if (el) {
            const delta = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top
            const drift = delta - anchorDelta
            if (Math.abs(drift) > 1) {
              scrollEl.scrollTop += drift
              scheduleRefresh()
              return
            }
          }
          if (++attempts < SETTLE_FRAMES) requestAnimationFrame(settle)
        }
        requestAnimationFrame(settle)
      }
    },
    [superdoc, showHint, t, scheduleRefresh],
  )

  if (!active || !ready) return null

  const hint = t(stitched ? 'wordLayout.seamHint' : 'wordLayout.gapHint')
  return (
    <div
      ref={overlayRef}
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
      data-testid="word-page-stitch-overlay"
    >
      {bands.map((band) => (
        <div
          key={band.key}
          data-testid={stitched ? 'word-page-seam' : 'word-page-gap'}
          data-upper-page-index={band.upperIndex}
          role="separator"
          aria-label={hint}
          title={hint}
          className="group absolute"
          style={{
            top: band.top,
            left: band.left,
            width: band.width,
            height: band.height,
            pointerEvents: 'auto',
            cursor: stitched ? CURSOR_SPLIT : CURSOR_STITCH,
          }}
          // 单击吞掉，避免焦点/光标交给编辑器；双击触发拼接或拆分
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onDoubleClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            toggle(band.upperIndex)
          }}
        >
          {stitched && (
            <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-foreground/25 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
          )}
        </div>
      ))}
    </div>
  )
}
