interface InlineTransformSnapshot {
  element: HTMLElement
  transform: string
  transformOrigin: string
  willChange: string
}

interface WordZoomPreviewSession {
  baseWidth: number
  baseHeight: number
  baseEditorMinWidth: number | null
  editorContainerChromeWidth: number
  nativeZoom: number
  visualZoom: number
  hasExplicitViewportHeight: boolean
  rulerTransforms: InlineTransformSnapshot[]
  scroller: HTMLElement | null
  /** 滚动容器的视口尺寸在会话创建时读取一次；手势期间逐帧读取会在上一帧
   * 的样式写入后强制同步布局，是滚轮跟手掉帧的主要来源。 */
  scrollerClientWidth: number
  scrollerClientHeight: number
  /** 总滚动尺寸减去视觉内容尺寸的固定开销（滚动容器内边距等），用于解析式
   * 推算每帧的滚动上限，避免读回被浏览器 clamp 后的 scrollTop/scrollLeft。 */
  scrollExtentOverheadX: number
  scrollExtentOverheadY: number
  scrollTop: number
  scrollLeft: number
}

interface WordZoomFrameHold {
  overlay: HTMLElement
  observer: MutationObserver | null
  frame: number | null
  timer: number | null
  dirty: boolean
  quietFrames: number
  startedAt: number
}

const sessions = new WeakMap<HTMLElement, WordZoomPreviewSession>()
/** settle 后的滚动守卫；新一轮预览或用户输入会取消，防止与真实滚动打架 */
const scrollGuards = new WeakMap<HTMLElement, () => void>()
/** 原生缩放重绘时保留的最后一帧，防止 Chromium 重建合成层时露出黑底。 */
const frameHolds = new WeakMap<HTMLElement, WordZoomFrameHold>()

const FRAME_HOLD_MIN_MS = 180
const FRAME_HOLD_MAX_MS = 700
const FRAME_HOLD_QUIET_FRAMES = 3

function findWordScrollContainer(root: HTMLElement): HTMLElement | null {
  const viewport = root.querySelector<HTMLElement>('.presentation-editor__viewport')
  return viewport?.closest<HTMLElement>('.super-editor-container')
    ?? viewport?.closest<HTMLElement>('.superdoc__sub-document')
    ?? root.querySelector<HTMLElement>('.superdoc__sub-document')
}

function positivePixels(value: string): number | null {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function intersectsViewport(rect: DOMRect, viewport: DOMRect): boolean {
  return rect.width > 0
    && rect.height > 0
    && rect.right > viewport.left
    && rect.left < viewport.right
    && rect.bottom > viewport.top
    && rect.top < viewport.bottom
}

function copyCanvasPixels(source: HTMLElement, clone: HTMLElement): void {
  const sourceCanvases = Array.from(source.querySelectorAll('canvas'))
  const clonedCanvases = Array.from(clone.querySelectorAll('canvas'))
  for (let index = 0; index < sourceCanvases.length; index += 1) {
    const sourceCanvas = sourceCanvases[index]
    const clonedCanvas = clonedCanvases[index]
    if (!clonedCanvas) continue
    clonedCanvas.width = sourceCanvas.width
    clonedCanvas.height = sourceCanvas.height
    try {
      clonedCanvas.getContext('2d')?.drawImage(sourceCanvas, 0, 0)
    } catch {
      /* A tainted embedded canvas can stay blank in the short-lived fallback frame. */
    }
  }
}

function disposeFrameHold(root: HTMLElement, hold: WordZoomFrameHold): void {
  const win = root.ownerDocument.defaultView
  hold.observer?.disconnect()
  if (hold.frame !== null) win?.cancelAnimationFrame(hold.frame)
  if (hold.timer !== null) win?.clearTimeout(hold.timer)
  hold.overlay.remove()
  if (frameHolds.get(root) === hold) {
    frameHolds.delete(root)
    delete root.dataset.wordZoomFrameHeld
  }
}

function removeFrameHold(root: HTMLElement, fade: boolean): void {
  const hold = frameHolds.get(root)
  if (!hold) return
  if (!fade) {
    disposeFrameHold(root, hold)
    return
  }

  hold.observer?.disconnect()
  hold.observer = null
  const win = root.ownerDocument.defaultView
  if (hold.frame !== null) win?.cancelAnimationFrame(hold.frame)
  hold.frame = null
  hold.overlay.dataset.releasing = 'true'
  hold.timer = win?.setTimeout(() => disposeFrameHold(root, hold), 64) ?? null
}

function hasVisibleNativePage(root: HTMLElement): boolean {
  const layout = root.querySelector<HTMLElement>('.word-document-layout')
  const scroller = findWordScrollContainer(root)
  if (!layout || !scroller) return false
  const viewportRect = scroller.getBoundingClientRect()
  return Array.from(
    layout.querySelectorAll<HTMLElement>('.presentation-editor__pages .superdoc-page'),
  ).some((page) => intersectsViewport(page.getBoundingClientRect(), viewportRect))
}

function scheduleFrameHoldRelease(root: HTMLElement): void {
  const hold = frameHolds.get(root)
  const layout = root.querySelector<HTMLElement>('.word-document-layout')
  const win = root.ownerDocument.defaultView
  if (!hold || !layout || !win) {
    if (hold) disposeFrameHold(root, hold)
    return
  }

  hold.observer?.disconnect()
  hold.observer = new MutationObserver(() => {
    hold.dirty = true
  })
  hold.observer.observe(layout, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-word-layout-mode'],
  })

  const tick = (now: number) => {
    hold.frame = null
    if (frameHolds.get(root) !== hold || !hold.overlay.isConnected) return

    if (hold.dirty) {
      hold.dirty = false
      hold.quietFrames = 0
    } else {
      hold.quietFrames += 1
    }

    const elapsed = now - hold.startedAt
    const nativeFrameReady = !layout.hasAttribute('data-word-zoom-preview')
      && hold.quietFrames >= FRAME_HOLD_QUIET_FRAMES
      && hasVisibleNativePage(root)
    if ((elapsed >= FRAME_HOLD_MIN_MS && nativeFrameReady) || elapsed >= FRAME_HOLD_MAX_MS) {
      removeFrameHold(root, true)
      return
    }
    hold.frame = win.requestAnimationFrame(tick)
  }
  hold.frame = win.requestAnimationFrame(tick)
}

/**
 * Freeze only the currently visible painted pages before SuperDoc adopts the
 * settled zoom. The clone is inert and sits outside WordDocumentLayout, so its
 * mutation observers and pointer mapping continue to see only the live editor.
 */
export function holdWordZoomFrame(root: HTMLElement): boolean {
  const layout = root.querySelector<HTMLElement>('.word-document-layout')
  const scroller = findWordScrollContainer(root)
  const win = root.ownerDocument.defaultView
  if (!layout || !scroller || !win) return false

  const rootRect = root.getBoundingClientRect()
  const scrollerRect = scroller.getBoundingClientRect()
  if (scrollerRect.width <= 0 || scrollerRect.height <= 0) return false

  const visiblePages = Array.from(
    layout.querySelectorAll<HTMLElement>('.presentation-editor__pages .superdoc-page'),
  ).map((page) => ({ page, rect: page.getBoundingClientRect() }))
    .filter(({ rect }) => intersectsViewport(rect, scrollerRect))
  if (visiblePages.length === 0) return false

  const overlay = root.ownerDocument.createElement('div')
  overlay.className = 'word-zoom-frame-hold superdoc-layout'
  overlay.dataset.wordZoomFrameHold = 'true'
  overlay.setAttribute('aria-hidden', 'true')
  overlay.inert = true
  Object.assign(overlay.style, {
    left: `${scrollerRect.left - rootRect.left}px`,
    top: `${scrollerRect.top - rootRect.top}px`,
    width: `${scrollerRect.width}px`,
    height: `${scrollerRect.height}px`,
    backgroundColor: win.getComputedStyle(scroller).backgroundColor,
  })

  for (const { page, rect } of visiblePages) {
    const pageWidth = page.offsetWidth
    const pageHeight = page.offsetHeight
    if (pageWidth <= 0 || pageHeight <= 0) continue
    const pageStyle = win.getComputedStyle(page)
    const visualScale = rect.width / pageWidth

    const shell = root.ownerDocument.createElement('div')
    shell.className = 'word-zoom-frame-hold__page'
    Object.assign(shell.style, {
      left: `${rect.left - scrollerRect.left}px`,
      top: `${rect.top - scrollerRect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })

    const clone = page.cloneNode(true) as HTMLElement
    clone.classList.remove('superdoc-page')
    clone.classList.add('word-zoom-frame-hold__page-copy')
    clone.dataset.wordZoomFrameCopy = 'true'
    clone.removeAttribute('data-page-index')
    clone.removeAttribute('data-page-number')
    clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'))
    clone.querySelectorAll('[contenteditable]').forEach((node) => node.removeAttribute('contenteditable'))
    Object.assign(clone.style, {
      position: 'absolute',
      inset: '0 auto auto 0',
      margin: '0',
      color: pageStyle.color,
      background: pageStyle.background,
      border: pageStyle.border,
      boxShadow: pageStyle.boxShadow,
      boxSizing: pageStyle.boxSizing,
      overflow: pageStyle.overflow,
      transform: Math.abs(visualScale - 1) < 0.0001 ? 'none' : `scale(${visualScale})`,
      transformOrigin: 'top left',
      // CSS zoom 会在 80% 重新命中宋体的 16px 点阵 strike，使冻结帧比
      // 随后的灰度轮廓稳态粗近一倍。缩小帧与 live pages 一样提前进入
      // transform 合成层，确保淡出前后的字形来自同一栅格路径。
      willChange: visualScale < 1 - 0.0001 ? 'transform' : 'auto',
      zoom: '1',
    })
    copyCanvasPixels(page, clone)
    shell.appendChild(clone)
    overlay.appendChild(shell)
  }
  if (overlay.childElementCount === 0) return false

  root.appendChild(overlay)
  const previous = frameHolds.get(root)
  if (previous) disposeFrameHold(root, previous)
  const hold: WordZoomFrameHold = {
    overlay,
    observer: null,
    frame: null,
    timer: null,
    dirty: true,
    quietFrames: 0,
    startedAt: win.performance.now(),
  }
  frameHolds.set(root, hold)
  root.dataset.wordZoomFrameHeld = 'true'
  return true
}

/** Immediately reveal the live editor before a pointer interaction. */
export function releaseWordZoomFrame(root: HTMLElement): void {
  removeFrameHold(root, false)
}

function collectRulerTransformTargets(root: HTMLElement): HTMLElement[] {
  const wrappers = Array.from(root.querySelectorAll<HTMLElement>('.ruler-wrapper'))
  const directMirrors = Array.from(root.querySelectorAll<HTMLElement>('.word-ruler-mirror'))
    .filter((mirror) => !wrappers.some((wrapper) => wrapper.contains(mirror)))
  if (wrappers.length > 0) return [...wrappers, ...directMirrors]
  return Array.from(root.querySelectorAll<HTMLElement>('.ruler-host > .ruler'))
}

function createSession(root: HTMLElement, nativeZoom: number): WordZoomPreviewSession | null {
  const viewport = root.querySelector<HTMLElement>('.presentation-editor__viewport')
  const pages = root.querySelector<HTMLElement>('.presentation-editor__pages')
  if (!viewport || !pages) return null

  const baseWidth = positivePixels(pages.style.width) ?? pages.offsetWidth
  const baseHeight = positivePixels(pages.style.minHeight) ?? pages.scrollHeight
  if (baseWidth <= 0 || baseHeight <= 0) return null

  // 新手势开启前先解除上一个 settle 的滚动守卫，避免守卫覆盖新手势的锚定。
  scrollGuards.get(root)?.()
  scrollGuards.delete(root)
  // 新一轮缩放必须立即显示实时预览，不能被上次的冻结帧遮住。
  releaseWordZoomFrame(root)

  const editorContainer = viewport.closest<HTMLElement>('.super-editor-container')
  const currentEditorMinWidth = editorContainer
    ? positivePixels(getComputedStyle(editorContainer).minWidth)
    : null
  const editorContainerChromeWidth = editorContainer
    ? Math.max(0, editorContainer.getBoundingClientRect().width - viewport.getBoundingClientRect().width)
    : 0

  // 会话创建时一次性读取滚动几何（本手势唯一一次强制布局）。
  const scroller = findWordScrollContainer(root)
  const scrollerClientWidth = scroller?.clientWidth ?? 0
  const scrollerClientHeight = scroller?.clientHeight ?? 0
  const scrollExtentOverheadX = scroller
    ? Math.max(0, scroller.scrollWidth - baseWidth * nativeZoom)
    : 0
  const scrollExtentOverheadY = scroller
    ? Math.max(0, scroller.scrollHeight - baseHeight * nativeZoom)
    : 0

  return {
    baseWidth,
    baseHeight,
    // SuperDoc 用 currentZoom * pageWidth 设置此容器的 min-width。预览阶段也必须
    // 同步它，否则页面仍按旧宽度居中，并会在原生 setZoom 时横向抽动一次。
    baseEditorMinWidth: currentEditorMinWidth && nativeZoom > 0
      ? currentEditorMinWidth / nativeZoom
      : null,
    editorContainerChromeWidth,
    nativeZoom,
    visualZoom: nativeZoom,
    hasExplicitViewportHeight: viewport.style.height !== '',
    scroller,
    scrollerClientWidth,
    scrollerClientHeight,
    scrollExtentOverheadX,
    scrollExtentOverheadY,
    scrollTop: scroller?.scrollTop ?? 0,
    scrollLeft: scroller?.scrollLeft ?? 0,
    rulerTransforms: collectRulerTransformTargets(root).map((element) => ({
      element,
      transform: element.style.transform,
      transformOrigin: element.style.transformOrigin,
      willChange: element.style.willChange,
    })),
  }
}

function anchoredScrollOffset(
  offset: number,
  viewportSize: number,
  scale: number,
): number {
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 0.0001) return offset
  if (offset <= 0) return 0
  return Math.max(0, (offset + viewportSize / 2) * scale - viewportSize / 2)
}

/**
 * Apply the cheap half of SuperDoc's zoom pipeline while Ctrl+wheel is active.
 * It updates only compositor transforms and the viewport geometry; the costly
 * painter invalidation is deliberately left for the gesture's settled value.
 *
 * 稳态帧不读取任何布局属性：滚动位置由会话内解析式推算（含滚动上限的
 * clamp），上一帧写入的样式不再触发本帧的强制同步布局，滚轮逐格跟手。
 */
export function applyWordZoomPreview(
  root: HTMLElement,
  visualZoom: number,
  nativeZoom: number,
): boolean {
  if (!Number.isFinite(visualZoom) || visualZoom <= 0) return false
  let session = sessions.get(root)
  if (!session) {
    const created = createSession(root, nativeZoom)
    if (!created) return false
    session = created
    sessions.set(root, session)
  }

  // setZoom 已采用新的倍率后，后续这一遍调用需要以新倍率为标尺基准；否则
  // 预览 scale 会叠加到 Vue 刚更新的标尺宽度上，形成一帧二次缩放。
  if (Number.isFinite(nativeZoom) && nativeZoom > 0) session.nativeZoom = nativeZoom

  const viewport = root.querySelector<HTMLElement>('.presentation-editor__viewport')
  const pages = root.querySelector<HTMLElement>('.presentation-editor__pages')
  const selection = root.querySelector<HTMLElement>('.presentation-editor__selection-overlay')
  if (!viewport || !pages) return false

  const previousZoom = session.visualZoom

  const scaledWidth = session.baseWidth * visualZoom
  const scaledHeight = session.baseHeight * visualZoom
  viewport.style.width = `${scaledWidth}px`
  viewport.style.minWidth = `${scaledWidth}px`
  viewport.style.minHeight = `${scaledHeight}px`
  if (session.hasExplicitViewportHeight) viewport.style.height = `${scaledHeight}px`

  pages.style.width = `${session.baseWidth}px`
  pages.style.minHeight = `${session.baseHeight}px`
  pages.style.marginBottom = visualZoom === 1 ? '' : `${scaledHeight - session.baseHeight}px`
  pages.style.transformOrigin = 'top left'
  pages.style.transform = visualZoom === 1 ? '' : `scale(${visualZoom})`
  pages.style.willChange = 'transform'

  if (selection) {
    selection.style.width = `${session.baseWidth}px`
    selection.style.height = `${session.baseHeight}px`
    selection.style.transformOrigin = 'top left'
    selection.style.transform = visualZoom === 1 ? '' : `scale(${visualZoom})`
    selection.style.willChange = 'transform'
  }

  const rulerScale = visualZoom / session.nativeZoom
  const bookMode = root.querySelector<HTMLElement>('.word-document-layout')
    ?.dataset.wordLayoutMode === 'book'
  for (const snapshot of session.rulerTransforms) {
    const prefix = snapshot.transform && snapshot.transform !== 'none'
      ? `${snapshot.transform} `
      : ''
    snapshot.element.style.transform = `${prefix}scaleX(${rulerScale})`
    snapshot.element.style.transformOrigin = bookMode ? 'left top' : 'center top'
    snapshot.element.style.willChange = 'transform'
  }

  const layout = root.querySelector<HTMLElement>('.word-document-layout')
  if (layout) {
    layout.dataset.wordZoomPreview = String(visualZoom)
    if (session.baseEditorMinWidth !== null) {
      layout.style.setProperty(
        '--word-zoom-preview-editor-min-width',
        `${session.baseEditorMinWidth * visualZoom}px`,
      )
      layout.style.setProperty(
        '--word-zoom-preview-editor-content-width',
        `${scaledWidth}px`,
      )
      layout.style.setProperty(
        '--word-zoom-preview-editor-outer-width',
        `${scaledWidth + session.editorContainerChromeWidth}px`,
      )
    }
  }

  const scroller = session.scroller?.isConnected === false
    ? findWordScrollContainer(root)
    : session.scroller
  session.scroller = scroller
  if (scroller && previousZoom > 0) {
    const scale = visualZoom / previousZoom
    const maxTop = Math.max(
      0,
      scaledHeight + session.scrollExtentOverheadY - session.scrollerClientHeight,
    )
    const maxLeft = Math.max(
      0,
      scaledWidth + session.scrollExtentOverheadX - session.scrollerClientWidth,
    )
    const nextTop = Math.min(
      Math.max(anchoredScrollOffset(session.scrollTop, session.scrollerClientHeight, scale), 0),
      maxTop,
    )
    const nextLeft = Math.min(
      Math.max(anchoredScrollOffset(session.scrollLeft, session.scrollerClientWidth, scale), 0),
      maxLeft,
    )
    scroller.scrollTop = nextTop
    scroller.scrollLeft = nextLeft
    session.scrollTop = nextTop
    session.scrollLeft = nextLeft
  }
  session.visualZoom = visualZoom
  return true
}

/**
 * settle 后的短滚动守卫：SuperDoc 的 setZoom 会调度一次「光标滚回视口」的
 * 选择层更新，其渲染在某些时序下（如布局未就绪被推迟）会晚于本应用的
 * 滚动恢复，把视口拽向光标形成一次可见抽动。守卫在数帧内把漂移的滚动
 * 位置拉回阅读锚点，任何用户输入立即让位。
 */
function installScrollGuard(
  root: HTMLElement,
  scroller: HTMLElement,
  target: { top: number; left: number },
): void {
  scrollGuards.get(root)?.()
  const win = scroller.ownerDocument?.defaultView
  if (!win) return

  let raf: number | null = null
  let framesLeft = 4
  let stopped = false

  const stop = () => {
    if (stopped) return
    stopped = true
    if (raf !== null) win.cancelAnimationFrame(raf)
    win.removeEventListener('wheel', onUserIntent, true)
    win.removeEventListener('pointerdown', onUserIntent, true)
    win.removeEventListener('keydown', onUserIntent, true)
    if (scrollGuards.get(root) === stop) scrollGuards.delete(root)
  }
  const onUserIntent = () => stop()

  const tick = () => {
    raf = null
    if (stopped || !scroller.isConnected || framesLeft <= 0) {
      stop()
      return
    }
    framesLeft -= 1
    if (
      Math.abs(scroller.scrollTop - target.top) > 2
      || Math.abs(scroller.scrollLeft - target.left) > 2
    ) {
      scroller.scrollTop = target.top
      scroller.scrollLeft = target.left
    }
    raf = win.requestAnimationFrame(tick)
  }

  win.addEventListener('wheel', onUserIntent, { capture: true, passive: true })
  win.addEventListener('pointerdown', onUserIntent, { capture: true, passive: true })
  win.addEventListener('keydown', onUserIntent, { capture: true, passive: true })
  scrollGuards.set(root, stop)
  raf = win.requestAnimationFrame(tick)
}

/** Remove preview-only hints after native setZoom has adopted the same geometry. */
export function finishWordZoomPreview(root: HTMLElement): void {
  const layout = root.querySelector<HTMLElement>('.word-document-layout')
  if (layout) {
    delete layout.dataset.wordZoomPreview
    layout.style.removeProperty('--word-zoom-preview-editor-min-width')
    layout.style.removeProperty('--word-zoom-preview-editor-content-width')
    layout.style.removeProperty('--word-zoom-preview-editor-outer-width')
  }

  const session = sessions.get(root)
  if (session) {
    for (const snapshot of session.rulerTransforms) {
      if (snapshot.element.classList.contains('word-ruler-mirror')) {
        snapshot.element.style.transform = snapshot.transform
      } else {
        snapshot.element.style.removeProperty('transform')
      }
      snapshot.element.style.transformOrigin = snapshot.transformOrigin
      snapshot.element.style.removeProperty('will-change')
    }

    // setZoom 会要求 SuperDoc 把旧光标滚回视口；Ctrl+wheel 的预期是保持
    // 用户正在阅读的位置，因此在其选择层更新之后恢复预览阶段的中心锚点。
    // 当 visualZoom ≈ nativeZoom（即时缩放的恒等预览）时不存在滚动漂移，
    // 跳过守卫减少不必要的帧开销。
    const hadRealPreview = Math.abs(session.visualZoom - session.nativeZoom) >= 0.005
    const scroller = session.scroller?.isConnected === false
      ? findWordScrollContainer(root)
      : session.scroller
    if (hadRealPreview && scroller && session.scrollTop > 0) {
      scroller.scrollTop = session.scrollTop
      scroller.scrollLeft = session.scrollLeft
      installScrollGuard(root, scroller, { top: session.scrollTop, left: session.scrollLeft })
    }
    sessions.delete(root)
  }
  root.querySelector<HTMLElement>('.presentation-editor__pages')?.style.removeProperty('will-change')
  root.querySelector<HTMLElement>('.presentation-editor__selection-overlay')?.style.removeProperty('will-change')
  scheduleFrameHoldRelease(root)
}

/** 撤销尚未生效/仍在守卫期的预览会话（组件卸载等场景）。 */
export function cancelWordZoomPreview(root: HTMLElement): void {
  scrollGuards.get(root)?.()
  scrollGuards.delete(root)
  finishWordZoomPreview(root)
  releaseWordZoomFrame(root)
}

export function hasWordZoomPreview(root: HTMLElement): boolean {
  return sessions.has(root)
}
