import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ensurePdfJsRuntimePolyfills,
  getPdfWorkerPolyfillSource,
} from '../utils/typed-array-polyfill'
import * as pdfjsLib from 'pdfjs-dist'
import officialWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useTranslation } from '@/lib/i18n/runtime'
import { useDocumentZoom } from '@/components/layout/modules/DocumentZoom'
import { cn } from '@/lib/utils'
import { documentBridge } from '../agent/document-bridge'
import { readFileBytes } from '../utils/file-io'
import { PdfToolbar, type PdfFitMode, type PdfPageLayout } from '../components/PdfToolbar'

ensurePdfJsRuntimePolyfills()

/**
 * Worker 与主线程隔离：用 blob 模块先注入 polyfill，再 import 官方 worker。
 */
function installPolyfilledWorkerSrc(workerUrl: string): string {
  const absolute =
    typeof window !== 'undefined'
      ? new URL(workerUrl, window.location.href).href
      : workerUrl

  const source = `${getPdfWorkerPolyfillSource()}\nimport ${JSON.stringify(absolute)};\n`
  const blob = new Blob([source], { type: 'text/javascript' })
  return URL.createObjectURL(blob)
}

pdfjsLib.GlobalWorkerOptions.workerSrc = installPolyfilledWorkerSrc(officialWorkerUrl)

/** 页面显示宽度上限（与旧 max-w-4xl 一致），也是容器测不到宽度时的兜底 */
const MAX_PAGE_CSS_WIDTH = 896
/** 容器 p-4 左右内边距合计 */
const CONTAINER_H_PADDING = 32
/** 页面之间的间距（gap-4） */
const PAGE_GAP = 16
/** 单页位图像素上限（约 4096×4096），限制大文档的内存与编码耗时 */
const MAX_PAGE_PIXELS = 16_777_216
/** 单边长度上限，防止极端长宽比页面超出 canvas 尺寸限制 */
const MAX_PAGE_SIDE = 16_384
/** 整份文档的位图像素预算：数百页的文档摊薄单页上限，避免总内存失控 */
const DOC_PIXEL_BUDGET = 1_600_000_000
/** 预算摊薄后的单页像素下限（约 2000×2000） */
const MIN_DOC_PAGE_PIXELS = 4_000_000
/** 后续页并行渲染并发数 */
const RENDER_CONCURRENCY = 2
/** WebP 质量：同体积下文字边缘比 JPEG 清晰得多 */
const WEBP_QUALITY = 0.9
/** WebP 编码失败时的 JPEG dataURL 兜底质量 */
const JPEG_FALLBACK_QUALITY = 0.92
/** 缩放/容器宽度变化后的防抖，避免连续滚轮触发多轮全量重渲 */
const RERENDER_DEBOUNCE_MS = 250
/** 目标分辨率高于已渲染分辨率该倍数才升清重渲 */
const UPSCALE_RATIO = 1.1
/** 目标分辨率低于已渲染分辨率该倍数才降清重渲（回收内存） */
const DOWNSCALE_RATIO = 0.5

interface PdfViewerProps {
  filePath: string
  onReady: () => void
}

function revokeUrl(url: string) {
  if (!url || url.startsWith('data:')) return
  try {
    URL.revokeObjectURL(url)
  } catch {
    /* ignore */
  }
}

function canvasToBlobUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          try {
            resolve(canvas.toDataURL('image/jpeg', JPEG_FALLBACK_QUALITY))
          } catch (err) {
            reject(err)
          }
          return
        }
        resolve(URL.createObjectURL(blob))
      },
      'image/webp',
      WEBP_QUALITY,
    )
  })
}

/**
 * 按目标设备像素宽度渲染一页（rotation 为用户附加的视图旋转，单位度）。
 * 分辨率贴合「显示宽度 × DPR × 文档缩放」，同时受像素/边长上限约束。
 * 返回的 baseWidth/baseHeight 是未附加旋转（rotation=0）时的页面原始尺寸。
 */
async function renderPageImage(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNum: number,
  targetDeviceWidth: number,
  maxPixels: number,
  rotation: number,
): Promise<{ url: string; page: pdfjsLib.PDFPageProxy; baseWidth: number; baseHeight: number }> {
  const page = await pdf.getPage(pageNum)
  const defaultVp = page.getViewport({ scale: 1 })
  const swap = rotation % 180 !== 0
  const rotW = swap ? defaultVp.height : defaultVp.width
  const rotH = swap ? defaultVp.width : defaultVp.height
  const byWidth = targetDeviceWidth / rotW
  const byPixels = Math.sqrt(maxPixels / (rotW * rotH))
  const bySide = MAX_PAGE_SIDE / Math.max(rotW, rotH)
  const scale = Math.min(byWidth, byPixels, bySide)
  const viewport = page.getViewport({
    scale,
    rotation: (defaultVp.rotation + rotation) % 360,
  })
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) {
    return { url: '', page, baseWidth: defaultVp.width, baseHeight: defaultVp.height }
  }

  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvasContext: ctx, viewport, canvas }).promise
  const url = await canvasToBlobUrl(canvas)

  canvas.width = 0
  canvas.height = 0

  return { url, page, baseWidth: defaultVp.width, baseHeight: defaultVp.height }
}

/**
 * 请求宽度经单页像素/边长上限修正后的实际可达宽度。
 * 用于重渲跳过判断：两个都超上限的请求会渲出完全相同的位图，不值得重来。
 */
function achievableWidth(
  target: number,
  pageBase: { width: number; height: number } | null,
  maxPixels: number,
): number {
  if (!pageBase || target <= 0) return target
  const byPixels = pageBase.width * Math.sqrt(maxPixels / (pageBase.width * pageBase.height))
  const bySide = pageBase.width * (MAX_PAGE_SIDE / Math.max(pageBase.width, pageBase.height))
  return Math.min(target, byPixels, bySide)
}

/** 按视图旋转换算页面基准尺寸（90°/270° 时宽高互换） */
function rotatedPageBase(
  pageBase: { width: number; height: number } | null,
  rotation: number,
): { width: number; height: number } | null {
  if (!pageBase) return null
  return rotation % 180 === 0 ? pageBase : { width: pageBase.height, height: pageBase.width }
}

async function extractPageText(page: pdfjsLib.PDFPageProxy): Promise<string> {
  try {
    const textContent = await page.getTextContent()
    return textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
  } finally {
    try {
      page.cleanup()
    } catch {
      /* 渲染进行中 cleanup 可能被拒绝，忽略 */
    }
  }
}

/** 有限并发池 */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onItem?: (result: R, index: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next++
      const result = await worker(items[index]!, index)
      results[index] = result
      onItem?.(result, index)
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () =>
    run(),
  )
  await Promise.all(runners)
  return results
}

/** 由容器可视宽度得到 100% 缩放下的页面显示宽度 */
function basePageWidth(clientWidth: number): number {
  const inner = clientWidth - CONTAINER_H_PADDING
  return inner >= 200 ? Math.min(inner, MAX_PAGE_CSS_WIDTH) : MAX_PAGE_CSS_WIDTH
}

function clampZoom(value: number): number {
  return Math.min(Math.max(value || 1, 0.1), 5)
}

function isZoomInKey(e: KeyboardEvent): boolean {
  return e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd'
}

function isZoomOutKey(e: KeyboardEvent): boolean {
  return e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract'
}

function isZoomResetKey(e: KeyboardEvent): boolean {
  return e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0'
}

/** 数字键按字符+物理键双匹配（覆盖捷克/法语等布局与小键盘） */
function isDigit1Key(e: KeyboardEvent): boolean {
  return e.key === '1' || e.code === 'Digit1' || e.code === 'Numpad1'
}

function isDigit2Key(e: KeyboardEvent): boolean {
  return e.key === '2' || e.code === 'Digit2' || e.code === 'Numpad2'
}

/** 按字符匹配（Dvorak/Colemak 等布局下物理 KeyG 不是字母 G） */
function isGotoPageKey(e: KeyboardEvent): boolean {
  return e.key === 'g' || e.key === 'G'
}

/** 焦点在输入框/文本域/可编辑元素时，不劫持数字/字母类快捷键 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

/** 单个已打开文档的渲染会话；passId 自增即抢占旧的渲染轮次 */
interface RenderSession {
  pdf: pdfjsLib.PDFDocumentProxy | null
  total: number
  urls: (string | null)[]
  renderedWidth: number
  renderedRotation: number
  passId: number
  disposed: boolean
  /** 首个成功渲染页的原始尺寸（rotation=0），用于可达分辨率估算 */
  pageBase: { width: number; height: number } | null
  /** 逐页原始尺寸（rotation=0）；混合尺寸文档的适配以当前页为准 */
  pageDims: ({ width: number; height: number } | null)[]
  /** 按文档页数摊薄后的单页像素上限 */
  maxPixels: number
}

/** 已渲出图像的页数（进度以此为准，抢占/失败都不会虚报） */
function countRendered(urls: (string | null)[]): number {
  return urls.reduce((n, u) => (u ? n + 1 : n), 0)
}

export function PdfViewer({ filePath, onReady }: PdfViewerProps) {
  const { t } = useTranslation()
  const { zoom, zoomIn, zoomOut, zoomReset, setZoomPercent } = useDocumentZoom()
  // 固定长度数组，下标 = 页码-1；未完成的页为 null（保持顺序）
  const [pages, setPages] = useState<(string | null)[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState(false)
  const [containerWidth, setContainerWidth] = useState(0)
  const [rotation, setRotation] = useState(0)
  const [layout, setLayout] = useState<PdfPageLayout>('single')
  const [fitMode, setFitMode] = useState<PdfFitMode>('custom')
  // 适配模式下的实际缩放：不写入全局 zoom（那是跨编辑器共享并持久化的手动偏好）
  const [fitZoom, setFitZoom] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)

  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<RenderSession | null>(null)
  const rerenderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusPageInputRef = useRef<(() => void) | null>(null)
  /** goToPage 触发的程序化滚动不参与「当前页」跟踪，避免跳页被跟踪器改写 */
  const suppressTrackRef = useRef(0)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const rotationRef = useRef(rotation)
  const layoutRef = useRef(layout)
  const fitModeRef = useRef(fitMode)
  const fitZoomRef = useRef(fitZoom)
  const currentPageRef = useRef(currentPage)

  /** 100% 缩放下的目标位图宽度（设备像素）= 显示宽度 × DPR */
  const measureBaseTarget = useCallback(() => {
    const el = scrollRef.current
    const cssWidth = basePageWidth(el ? el.clientWidth : 0)
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3)
    return Math.round(cssWidth * dpr)
  }, [])

  /** 当前生效缩放：适配模式用 fitZoom，否则用全局手动缩放 */
  const effectiveZoomValue = useCallback(() => {
    const fz = fitZoomRef.current
    if (fitModeRef.current !== 'custom' && fz != null) return fz
    return clampZoom(zoomRef.current)
  }, [])

  /**
   * 当前期望位图宽度 = 基准 × max(生效缩放, 1)。
   * 缩小（zoom<1）时浏览器降采样不损清晰度，故不低于 1 倍渲染。
   */
  const measureDesiredTarget = useCallback(
    () => Math.round(measureBaseTarget() * Math.max(1, effectiveZoomValue())),
    [measureBaseTarget, effectiveZoomValue],
  )

  /** 按当前目标清晰度/旋转全量重渲（视口中心页优先）；可达分辨率差异不大时跳过 */
  const requestRerender = useCallback(() => {
    const session = sessionRef.current
    if (!session || !session.pdf || session.disposed || session.total === 0) return

    const viewRotation = rotationRef.current
    const target = measureDesiredTarget()
    if (viewRotation === session.renderedRotation) {
      // 上限修正后再比较：两个都被限幅的请求渲出的位图相同，跳过无效重渲
      const rb = rotatedPageBase(session.pageBase, viewRotation)
      const desired = achievableWidth(target, rb, session.maxPixels)
      const current = achievableWidth(session.renderedWidth, rb, session.maxPixels)
      if (current > 0 && desired < current * UPSCALE_RATIO && desired > current * DOWNSCALE_RATIO) {
        return
      }
    }

    session.renderedWidth = target
    session.renderedRotation = viewRotation
    session.passId += 1
    const myPass = session.passId
    const pdf = session.pdf
    const total = session.total

    // 以视口中心估算当前页，向两侧扩散，先重渲用户正在看的页
    const el = scrollRef.current
    let center = 0
    if (el && el.scrollHeight > 0) {
      center = Math.round(((el.scrollTop + el.clientHeight / 2) / el.scrollHeight) * (total - 1))
    }
    const order = Array.from({ length: total }, (_, i) => i + 1).sort(
      (a, b) => Math.abs(a - 1 - center) - Math.abs(b - 1 - center),
    )

    void mapPool(order, RENDER_CONCURRENCY, async (pageNum) => {
      if (session.disposed || session.passId !== myPass) return
      try {
        const rendered = await renderPageImage(pdf, pageNum, target, session.maxPixels, viewRotation)
        try {
          rendered.page.cleanup()
        } catch {
          /* ignore */
        }
        if (session.disposed || session.passId !== myPass) {
          revokeUrl(rendered.url)
          return
        }
        if (rendered.url) {
          if (!session.pageBase) {
            session.pageBase = { width: rendered.baseWidth, height: rendered.baseHeight }
          }
          session.pageDims[pageNum - 1] = { width: rendered.baseWidth, height: rendered.baseHeight }
          const old = session.urls[pageNum - 1]
          session.urls[pageNum - 1] = rendered.url
          setPages([...session.urls])
          setProgress({ done: countRendered(session.urls), total: session.total })
          if (old) revokeUrl(old)
        }
      } catch (err) {
        // 单页重渲失败保留旧图
        console.error('[PdfViewer] rerender page failed:', pageNum, err)
      }
    })
  }, [measureDesiredTarget])

  const scheduleRerender = useCallback(() => {
    if (rerenderTimerRef.current) clearTimeout(rerenderTimerRef.current)
    rerenderTimerRef.current = setTimeout(() => {
      rerenderTimerRef.current = null
      requestRerender()
    }, RERENDER_DEBOUNCE_MS)
  }, [requestRerender])

  /**
   * 适合页面 / 适合宽度：由容器尺寸、当前页纵横比（含旋转）与布局推算精确缩放，
   * 存入本地 fitZoom（不取整、不写全局手动缩放）。返回计算出的缩放值。
   * fitZoomRef 同步更新，调用方可立刻用正确目标分辨率重渲。
   */
  const applyFit = useCallback((mode: 'page' | 'width'): number | null => {
    const session = sessionRef.current
    const el = scrollRef.current
    if (!session || !el) return null
    const dims = session.pageDims[currentPageRef.current - 1] ?? session.pageBase
    const pb = rotatedPageBase(dims, rotationRef.current)
    if (!pb) return null
    const innerW = el.clientWidth - CONTAINER_H_PADDING
    const innerH = el.clientHeight - CONTAINER_H_PADDING
    const base = basePageWidth(el.clientWidth)
    if (innerW <= 40 || innerH <= 40 || base <= 0) return null
    const perPageW = layoutRef.current === 'two' ? (innerW - PAGE_GAP) / 2 : innerW
    let z = perPageW / base
    if (mode === 'page') {
      const pageAspect = pb.height / pb.width
      z = Math.min(z, innerH / (base * pageAspect))
    }
    z = Math.min(Math.max(z, 0.1), 5)
    const prev = fitZoomRef.current
    if (prev != null && Math.abs(prev - z) < 0.002) return prev
    fitZoomRef.current = z
    setFitZoom(z)
    return z
  }, [])

  /** 手动缩放退出适配模式：把适配缩放收编为手动缩放基准，避免视觉跳变 */
  const exitFitToZoom = useCallback(() => {
    if (fitModeRef.current === 'custom') return
    const fz = fitZoomRef.current
    fitModeRef.current = 'custom'
    setFitMode('custom')
    fitZoomRef.current = null
    setFitZoom(null)
    if (fz != null) setZoomPercent(Math.round(fz * 100))
  }, [setZoomPercent])

  const toggleFit = useCallback(
    (mode: 'page' | 'width') => {
      if (fitModeRef.current === mode) {
        exitFitToZoom()
        return
      }
      fitModeRef.current = mode
      setFitMode(mode)
      applyFit(mode)
    },
    [applyFit, exitFitToZoom],
  )

  const zoomInCustom = useCallback(() => {
    exitFitToZoom()
    zoomIn()
  }, [exitFitToZoom, zoomIn])
  const zoomOutCustom = useCallback(() => {
    exitFitToZoom()
    zoomOut()
  }, [exitFitToZoom, zoomOut])
  const zoomResetCustom = useCallback(() => {
    exitFitToZoom()
    zoomReset()
  }, [exitFitToZoom, zoomReset])

  const rotateLeft = useCallback(() => setRotation((r) => (r + 270) % 360), [])
  const rotateRight = useCallback(() => setRotation((r) => (r + 90) % 360), [])

  const goToPage = useCallback((n: number) => {
    const el = scrollRef.current
    const session = sessionRef.current
    if (!el || !session || session.total === 0) return
    const page = Math.min(Math.max(Math.round(n) || 1, 1), session.total)
    const cell = el.querySelector<HTMLElement>(`[data-page-num="${page}"]`)
    if (!cell) return
    const top =
      cell.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - PAGE_GAP
    const targetTop = Math.max(0, top)
    // 程序化滚动会触发 scroll 事件；跳过一次跟踪，否则目标页无法居中时
    // （文档末尾/短页）跟踪器会立刻把页码改回去
    if (Math.abs(el.scrollTop - targetTop) > 1) suppressTrackRef.current += 1
    el.scrollTo({ top: targetTop })
    currentPageRef.current = page
    setCurrentPage(page)
  }, [])

  const goPrevPage = useCallback(() => goToPage(currentPageRef.current - 1), [goToPage])
  const goNextPage = useCallback(() => goToPage(currentPageRef.current + 1), [goToPage])

  const setLayoutMode = useCallback(
    (mode: PdfPageLayout) => {
      if (layoutRef.current === mode) return
      layoutRef.current = mode
      setLayout(mode)
      if (fitModeRef.current !== 'custom') applyFit(fitModeRef.current)
      // 布局切换后行高变化，重新定位到当前页
      const anchor = currentPageRef.current
      requestAnimationFrame(() => goToPage(anchor))
    },
    [applyFit, goToPage],
  )

  const registerFocusPageInput = useCallback((fn: (() => void) | null) => {
    focusPageInputRef.current = fn
  }, [])

  // 文档缩放（手动/适配）变化 → 防抖后按需以更高/更低分辨率重渲
  useEffect(() => {
    scheduleRerender()
  }, [zoom, fitZoom, scheduleRerender])

  // 旋转变化 → 立即重渲（不防抖，旋转需要即时反馈）。
  // 适配模式下先重算缩放（fitZoomRef 同步更新），重渲直接用正确的目标分辨率，
  // 避免「旧缩放渲一遍、250ms 后新缩放再渲一遍」的双倍开销
  useEffect(() => {
    rotationRef.current = rotation
    if (fitModeRef.current !== 'custom') applyFit(fitModeRef.current)
    requestRerender()
  }, [rotation, requestRerender, applyFit])

  // 窗口拖到不同缩放比的显示器（DPR 变化）→ 重渲，否则会一直模糊
  useEffect(() => {
    let mql: MediaQueryList | null = null
    let disposed = false
    const onChange = () => {
      mql?.removeEventListener('change', onChange)
      scheduleRerender()
      attach()
    }
    const attach = () => {
      if (disposed || typeof window.matchMedia !== 'function') return
      mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      mql.addEventListener('change', onChange)
    }
    attach()
    return () => {
      disposed = true
      mql?.removeEventListener('change', onChange)
    }
  }, [scheduleRerender])

  // PDF 自管缩放（data-manages-document-zoom）：Ctrl+滚轮。
  // 挂在根容器上，工具栏区域的 Ctrl+滚轮同样生效（DocumentZoom 已让位）
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.deltaY === 0) return
      e.preventDefault()
      e.stopPropagation()
      if (e.deltaY < 0) zoomInCustom()
      else zoomOutCustom()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomInCustom, zoomOutCustom])

  // PDF 自管快捷键（DocumentZoom 检测到自管标记后不再处理）：
  // Ctrl+=/- 缩放、Ctrl+0 复位、Ctrl+1/2 适合页面/宽度、Ctrl+G 跳页、
  // Ctrl+Shift+=/− 旋转、Ctrl+Shift+1/2 单页/双页
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const editable = isEditableTarget(e.target)
      // 数字/字母类先于 +/- 判断：某些布局（如捷克语）数字键的字符是 '+'，
      // 若先判缩放键，Ctrl+1 的适配功能会被永久遮蔽
      if (e.shiftKey) {
        if (isDigit1Key(e) && !editable) {
          e.preventDefault()
          e.stopPropagation()
          setLayoutMode('single')
        } else if (isDigit2Key(e) && !editable) {
          e.preventDefault()
          e.stopPropagation()
          setLayoutMode('two')
        } else if (isZoomInKey(e)) {
          e.preventDefault()
          e.stopPropagation()
          rotateRight()
        } else if (isZoomOutKey(e)) {
          e.preventDefault()
          e.stopPropagation()
          rotateLeft()
        }
        return
      }
      if (isDigit1Key(e) && !editable) {
        e.preventDefault()
        e.stopPropagation()
        toggleFit('page')
      } else if (isDigit2Key(e) && !editable) {
        e.preventDefault()
        e.stopPropagation()
        toggleFit('width')
      } else if (isGotoPageKey(e) && !editable) {
        e.preventDefault()
        e.stopPropagation()
        focusPageInputRef.current?.()
      } else if (isZoomInKey(e)) {
        e.preventDefault()
        zoomInCustom()
      } else if (isZoomOutKey(e)) {
        e.preventDefault()
        zoomOutCustom()
      } else if (isZoomResetKey(e)) {
        e.preventDefault()
        zoomResetCustom()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [rotateLeft, rotateRight, setLayoutMode, toggleFit, zoomInCustom, zoomOutCustom, zoomResetCustom])

  // 容器宽度变化（侧栏开合、窗口尺寸）→ 更新显示宽度、维持适配模式并按需重渲
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setContainerWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    let first = true
    const observer = new ResizeObserver(() => {
      setContainerWidth(el.clientWidth)
      if (first) {
        first = false
        return
      }
      if (fitModeRef.current !== 'custom') applyFit(fitModeRef.current)
      scheduleRerender()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [scheduleRerender, applyFit])

  // 滚动 → 以视口中心所在页更新当前页码（rAF 节流）
  useEffect(() => {
    const el = scrollRef.current
    if (!el || pages.length === 0) return
    let raf = 0
    const update = () => {
      raf = 0
      const rect = el.getBoundingClientRect()
      const centerY = rect.top + rect.height / 2
      let best = currentPageRef.current
      let bestDist = Infinity
      el.querySelectorAll<HTMLElement>('[data-page-num]').forEach((cell) => {
        const r = cell.getBoundingClientRect()
        const d = Math.abs((r.top + r.bottom) / 2 - centerY)
        if (d < bestDist) {
          bestDist = d
          best = Number(cell.dataset.pageNum) || best
        }
      })
      if (best !== currentPageRef.current) {
        currentPageRef.current = best
        setCurrentPage(best)
      }
    }
    const onScroll = () => {
      if (suppressTrackRef.current > 0) {
        suppressTrackRef.current -= 1
        return
      }
      if (!raf) raf = requestAnimationFrame(update)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [pages.length])

  useEffect(() => {
    return () => {
      if (rerenderTimerRef.current) clearTimeout(rerenderTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const session: RenderSession = {
      pdf: null,
      total: 0,
      urls: [],
      renderedWidth: 0,
      renderedRotation: 0,
      passId: 0,
      disposed: false,
      pageBase: null,
      pageDims: [],
      maxPixels: MAX_PAGE_PIXELS,
    }
    sessionRef.current = session
    let readyCalled = false

    setPages([])
    setProgress({ done: 0, total: 0 })
    setError(false)
    // 旋转是按文档的视图状态，换文档即复位；布局与适配模式作为阅读偏好保留
    rotationRef.current = 0
    setRotation(0)
    currentPageRef.current = 1
    setCurrentPage(1)
    documentBridge.clear()

    const callReadyOnce = () => {
      if (readyCalled || session.disposed) return
      readyCalled = true
      onReady()
    }

    async function load() {
      try {
        // 1) 二进制读取（无 base64 编解码）
        const data = await readFileBytes(filePath)
        if (session.disposed) return

        // 2) 解析 PDF
        const pdf = await pdfjsLib.getDocument({
          data,
          useSystemFonts: true,
          // 本地已完整缓冲，关闭流式/预取开销
          disableStream: true,
          disableAutoFetch: true,
        }).promise

        if (session.disposed) {
          await pdf.loadingTask.destroy()
          return
        }
        session.pdf = pdf

        const total = pdf.numPages
        session.total = total
        setProgress({ done: 0, total })

        if (total === 0) {
          setPages([])
          callReadyOnce()
          return
        }

        session.urls = new Array<string | null>(total).fill(null)
        session.pageDims = new Array<{ width: number; height: number } | null>(total).fill(null)
        const textParts = new Array<string>(total).fill('')
        // 数百页的文档摊薄单页像素上限，锁定总内存
        session.maxPixels = Math.min(
          MAX_PAGE_PIXELS,
          Math.max(MIN_DOC_PAGE_PIXELS, Math.floor(DOC_PIXEL_BUDGET / total)),
        )
        // 首轮按 100% 基准渲染（不乘上次会话残留的缩放值，避免大文档按上限全量渲染）；
        // 加载完成后若当前缩放 > 1 再由 scheduleRerender 渐进升清
        const target = measureBaseTarget()
        session.renderedWidth = target
        session.renderedRotation = 0
        session.passId += 1
        const myPass = session.passId

        // 3) 先渲第 1 页图像 → 立刻上屏（文本后抽，不挡首屏）；
        //    单页失败只留占位，不拖垮整份文档
        const textJobs: Promise<void>[] = []
        let first: Awaited<ReturnType<typeof renderPageImage>> | null = null
        try {
          first = await renderPageImage(pdf, 1, target, session.maxPixels, 0)
        } catch (err) {
          console.error('[PdfViewer] render page failed:', 1, err)
        }
        if (first) {
          session.pageBase = { width: first.baseWidth, height: first.baseHeight }
          session.pageDims[0] = { width: first.baseWidth, height: first.baseHeight }
          textJobs.push(
            extractPageText(first.page)
              .then((text) => {
                if (!session.disposed) textParts[0] = text
              })
              .catch(() => {}),
          )
        }
        if (session.disposed || session.passId !== myPass) {
          if (first) revokeUrl(first.url)
        } else {
          if (first?.url) session.urls[0] = first.url
          setPages([...session.urls])
          setProgress({ done: countRendered(session.urls), total })
          callReadyOnce()
          // 处于适配模式时，首页尺寸一到手就应用（缩放变化只影响显示宽度，
          // 升清由加载完成后的 scheduleRerender 统一处理）
          if (fitModeRef.current !== 'custom') applyFit(fitModeRef.current)
        }

        // 4) 其余页有限并发；即便渲染轮次被缩放重渲抢占，文本抽取也要完成；
        //    任何单页失败只影响该页（占位保留），不翻整份文档为错误态
        if (total > 1) {
          const rest = Array.from({ length: total - 1 }, (_, i) => i + 2)

          await mapPool(
            rest,
            RENDER_CONCURRENCY,
            async (pageNum) => {
              if (session.disposed) return
              try {
                if (session.passId !== myPass) {
                  // 图像交给新一轮 pass；这里只补文本
                  const page = await pdf.getPage(pageNum)
                  textJobs.push(
                    extractPageText(page)
                      .then((text) => {
                        if (!session.disposed) textParts[pageNum - 1] = text
                      })
                      .catch(() => {}),
                  )
                  return
                }
                const rendered = await renderPageImage(pdf, pageNum, target, session.maxPixels, 0)
                // 页面尺寸与渲染轮次无关，先记录；首页渲染失败时也要有 pageBase 兜底
                session.pageDims[pageNum - 1] = {
                  width: rendered.baseWidth,
                  height: rendered.baseHeight,
                }
                if (!session.pageBase) {
                  session.pageBase = { width: rendered.baseWidth, height: rendered.baseHeight }
                }
                textJobs.push(
                  extractPageText(rendered.page)
                    .then((text) => {
                      if (!session.disposed) textParts[pageNum - 1] = text
                    })
                    .catch(() => {}),
                )
                if (session.disposed || session.passId !== myPass) {
                  revokeUrl(rendered.url)
                  return
                }
                if (rendered.url) {
                  session.urls[pageNum - 1] = rendered.url
                }
              } catch (err) {
                console.error('[PdfViewer] render page failed:', pageNum, err)
              }
            },
            () => {
              if (session.disposed) return
              setPages([...session.urls])
              setProgress({ done: countRendered(session.urls), total })
            },
          )
        }

        await Promise.all(textJobs)
        if (session.disposed) return

        // 5) 全文交给 Agent bridge（不阻塞首屏）
        documentBridge.setPdf(textParts.join('\n\n'), filePath)
        setProgress({ done: countRendered(session.urls), total })
        callReadyOnce()
        // 若当前缩放 > 1（或加载期间用户已缩放/旋转），此时再升清
        scheduleRerender()
      } catch (err) {
        console.error('[PdfViewer] load error:', err)
        if (!session.disposed) setError(true)
      }
    }

    void load()

    return () => {
      session.disposed = true
      session.passId += 1
      documentBridge.clear()
      for (const url of session.urls) {
        if (url) revokeUrl(url)
      }
      session.urls = []
      const pdf = session.pdf
      session.pdf = null
      if (pdf) {
        pdf.loadingTask.destroy().catch(() => {})
      }
      if (sessionRef.current === session) sessionRef.current = null
    }
  }, [filePath, onReady, measureBaseTarget, scheduleRerender, applyFit])

  const stillLoading = progress.total > 0 && progress.done < progress.total
  fitZoomRef.current = fitZoom
  // 生效缩放：适配模式用 fitZoom（精确浮点，不会因取整溢出容器），否则用全局手动缩放
  const effZoom = fitMode !== 'custom' && fitZoom != null ? fitZoom : clampZoom(zoom)
  // 显示宽度 = 100% 基准宽 × 生效缩放；不用 CSS zoom（对百分比自适应布局无效，还会波及外层 UI）
  const displayWidth = Math.max(64, Math.round(basePageWidth(containerWidth) * effZoom))
  const displayPercent = Math.round(effZoom * 100)

  // 缩放时锚定视口中心，避免放大后内容漂移。
  // 只有页面内容随宽度缩放，顶部内边距与页间距固定，按当前页所在行扣除后再缩放
  const prevDisplayWidthRef = useRef(0)
  useLayoutEffect(() => {
    const el = scrollRef.current
    const prev = prevDisplayWidthRef.current
    prevDisplayWidthRef.current = displayWidth
    if (!el || prev <= 0 || prev === displayWidth || pages.length === 0) return
    const ratio = displayWidth / prev
    const rowIndex =
      layoutRef.current === 'two'
        ? Math.floor((currentPageRef.current - 1) / 2)
        : currentPageRef.current - 1
    const fixedY = PAGE_GAP + rowIndex * PAGE_GAP
    const centerY = el.scrollTop + el.clientHeight / 2
    el.scrollTop = (centerY - fixedY) * ratio + fixedY - el.clientHeight / 2
    const centerX = el.scrollLeft + el.clientWidth / 2
    el.scrollLeft = (centerX - PAGE_GAP / 2) * ratio + PAGE_GAP / 2 - el.clientWidth / 2
  }, [displayWidth, pages.length])

  return (
    <div ref={rootRef} data-manages-document-zoom className="flex h-full min-h-0 flex-col">
      <PdfToolbar
        currentPage={currentPage}
        totalPages={progress.total}
        percent={displayPercent}
        fitMode={fitMode}
        layout={layout}
        onPrevPage={goPrevPage}
        onNextPage={goNextPage}
        onGoToPage={goToPage}
        onZoomIn={zoomInCustom}
        onZoomOut={zoomOutCustom}
        onZoomReset={zoomResetCustom}
        onFitPage={() => toggleFit('page')}
        onFitWidth={() => toggleFit('width')}
        onRotateLeft={rotateLeft}
        onRotateRight={rotateRight}
        onLayoutSingle={() => setLayoutMode('single')}
        onLayoutTwo={() => setLayoutMode('two')}
        onRegisterFocusPageInput={registerFocusPageInput}
      />
      {/* scrollbar-gutter:stable：滚动条出现/消失不改变 clientWidth，
          否则适配模式会与 ResizeObserver 形成缩放振荡循环 */}
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto bg-muted/30 p-4 [scrollbar-gutter:stable]"
      >
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-destructive">
            <p className="font-medium">{t('pdfViewer.cannotLoadPdf')}</p>
          </div>
        ) : pages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <p>{t('pdfViewer.loadingPdf')}</p>
            {progress.total > 0 && (
              <p className="text-xs">
                {t('appShell.pageProgress', {
                  rendered: progress.done,
                  total: progress.total,
                })}
              </p>
            )}
          </div>
        ) : (
          <div
            className={cn(
              'mx-auto gap-4',
              layout === 'two' ? 'grid grid-cols-2' : 'flex flex-col',
            )}
            style={{ width: layout === 'two' ? displayWidth * 2 + PAGE_GAP : displayWidth }}
          >
            {pages.map((src, index) => (
              <div key={`${filePath}-${index}`} data-page-num={index + 1} className="w-full">
                {src ? (
                  <img
                    src={src}
                    alt={t('pdfViewer.pageNumber', { number: index + 1 })}
                    className="w-full shadow-md"
                    decoding="async"
                    loading={index < 2 ? 'eager' : 'lazy'}
                  />
                ) : (
                  <div className="flex h-48 w-full items-center justify-center rounded-sm bg-muted text-xs text-muted-foreground shadow-md">
                    {t('pdfViewer.renderingPage', { number: index + 1 })}
                  </div>
                )}
              </div>
            ))}
            {stillLoading && (
              <p
                className={cn(
                  'py-2 text-center text-xs text-muted-foreground',
                  layout === 'two' && 'col-span-2',
                )}
              >
                {t('pdfViewer.renderingRemaining', {
                  rendered: progress.done,
                  total: progress.total,
                })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
