import * as monaco from 'monaco-editor'
import { CODE_SCROLLBAR_THUMB_HEIGHT } from './code-editor-constants'

const IMMEDIATE_SCROLL_TYPE = 1 as monaco.editor.ScrollType

export function installFixedVerticalScrollbar(
  editor: monaco.editor.IStandaloneCodeEditor,
  host: HTMLElement,
): monaco.IDisposable {
  const editorRoot = editor.getDomNode()
  if (!editorRoot) return { dispose() {} }

  const track = document.createElement('div')
  const thumb = document.createElement('div')
  track.className = 'officeagentic-code-fixed-scrollbar'
  track.dataset.testid = 'code-fixed-scrollbar'
  track.setAttribute('role', 'presentation')
  track.setAttribute('aria-hidden', 'true')
  thumb.className = 'officeagentic-code-fixed-scrollbar-thumb'
  thumb.dataset.testid = 'code-fixed-scrollbar-thumb'
  track.appendChild(thumb)
  editorRoot.appendChild(track)

  let disposed = false
  let frame = 0
  const hiddenNativeThumbs = new Set<HTMLElement>()

  const getMetrics = () => {
    const trackHeight = track.clientHeight
    const scale = editorRoot.offsetHeight > 0
      ? editorRoot.getBoundingClientRect().height / editorRoot.offsetHeight
      : Number(host.dataset.codeZoom) || 1
    const thumbHeight = Math.min(trackHeight, CODE_SCROLLBAR_THUMB_HEIGHT / Math.max(scale, 0.01))
    const maxScrollTop = Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height)
    return {
      maxScrollTop,
      thumbHeight,
      travel: Math.max(0, trackHeight - thumbHeight),
    }
  }

  const sync = () => {
    frame = 0
    if (disposed) return

    const verticalScrollbars = Array.from(
      editorRoot.querySelectorAll<HTMLElement>('.monaco-scrollable-element > .scrollbar.vertical'),
    )
    const nativeScrollbar = verticalScrollbars.reduce<HTMLElement | null>(
      (largest, candidate) => !largest || candidate.clientHeight > largest.clientHeight ? candidate : largest,
      null,
    )
    const nativeThumb = nativeScrollbar?.querySelector<HTMLElement>(':scope > .slider')
    if (nativeThumb && !hiddenNativeThumbs.has(nativeThumb)) {
      nativeThumb.classList.add('officeagentic-code-native-scrollbar-thumb')
      hiddenNativeThumbs.add(nativeThumb)
    }

    const { maxScrollTop, thumbHeight, travel } = getMetrics()
    track.hidden = maxScrollTop <= 0 || track.clientHeight <= 0
    thumb.style.height = `${thumbHeight}px`
    const ratio = maxScrollTop > 0 ? Math.min(1, Math.max(0, editor.getScrollTop() / maxScrollTop)) : 0
    thumb.style.top = `${ratio * travel}px`
  }

  const scheduleSync = () => {
    if (disposed || frame) return
    frame = requestAnimationFrame(sync)
  }

  const setScrollRatio = (ratio: number) => {
    const { maxScrollTop } = getMetrics()
    editor.setScrollTop(Math.min(1, Math.max(0, ratio)) * maxScrollTop, IMMEDIATE_SCROLL_TYPE)
    scheduleSync()
  }

  const onTrackPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.target === thumb) return
    event.preventDefault()
    const rect = track.getBoundingClientRect()
    const physicalThumbHeight = thumb.getBoundingClientRect().height
    const travel = Math.max(0, rect.height - physicalThumbHeight)
    setScrollRatio(travel > 0 ? (event.clientY - rect.top - physicalThumbHeight / 2) / travel : 0)
  }

  const onThumbPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const startY = event.clientY
    const { maxScrollTop } = getMetrics()
    const startScrollTop = editor.getScrollTop()
    const physicalTravel = Math.max(
      0,
      track.getBoundingClientRect().height - thumb.getBoundingClientRect().height,
    )
    thumb.classList.add('active')
    thumb.setPointerCapture(event.pointerId)

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (physicalTravel <= 0) return
      editor.setScrollTop(
        startScrollTop + (moveEvent.clientY - startY) / physicalTravel * maxScrollTop,
        IMMEDIATE_SCROLL_TYPE,
      )
      scheduleSync()
    }
    const finishDrag = () => {
      thumb.classList.remove('active')
      thumb.removeEventListener('pointermove', onPointerMove)
      thumb.removeEventListener('pointerup', finishDrag)
      thumb.removeEventListener('pointercancel', finishDrag)
    }
    thumb.addEventListener('pointermove', onPointerMove)
    thumb.addEventListener('pointerup', finishDrag)
    thumb.addEventListener('pointercancel', finishDrag)
  }

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) return
    event.preventDefault()
    const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight)
    const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? event.deltaY * lineHeight
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? event.deltaY * editor.getLayoutInfo().height
        : event.deltaY
    editor.setScrollTop(editor.getScrollTop() + delta, IMMEDIATE_SCROLL_TYPE)
    scheduleSync()
  }

  track.addEventListener('pointerdown', onTrackPointerDown)
  thumb.addEventListener('pointerdown', onThumbPointerDown)
  track.addEventListener('wheel', onWheel, { passive: false })
  const scrollDisposable = editor.onDidScrollChange(scheduleSync)
  const layoutDisposable = editor.onDidLayoutChange(scheduleSync)
  const contentDisposable = editor.onDidChangeModelContent(scheduleSync)
  const resizeObserver = new ResizeObserver(scheduleSync)
  resizeObserver.observe(editorRoot)
  const zoomObserver = MutationObserver ? new MutationObserver(scheduleSync) : null
  zoomObserver?.observe(host, { attributes: true, attributeFilter: ['data-code-zoom', 'style'] })
  scheduleSync()

  return {
    dispose() {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      scrollDisposable.dispose()
      layoutDisposable.dispose()
      contentDisposable.dispose()
      resizeObserver.disconnect()
      zoomObserver?.disconnect()
      track.removeEventListener('pointerdown', onTrackPointerDown)
      thumb.removeEventListener('pointerdown', onThumbPointerDown)
      track.removeEventListener('wheel', onWheel)
      hiddenNativeThumbs.forEach((element) => element.classList.remove('officeagentic-code-native-scrollbar-thumb'))
      track.remove()
    },
  }
}
