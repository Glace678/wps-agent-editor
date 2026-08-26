import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

interface NotepadScrollbarProps {
  scrollElement: HTMLElement | null
  className?: string
}

const MIN_THUMB_HEIGHT = 20
const ARROW_BUTTON_HEIGHT = 16
const SCROLL_STEP = 40
const REPEAT_INITIAL_DELAY_MS = 250
const REPEAT_INTERVAL_MS = 40

export function NotepadScrollbar({ scrollElement, className = '' }: NotepadScrollbarProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState({
    visible: false,
    thumbHeight: 0,
    thumbTop: 0,
  })
  const repeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dragStartRef = useRef<{ startY: number; startScrollTop: number; maxScroll: number; travel: number } | null>(null)

  const updateMetrics = useCallback(() => {
    const el = scrollElement
    const track = trackRef.current
    if (!el || !track) {
      setMetrics({ visible: false, thumbHeight: 0, thumbTop: 0 })
      return
    }

    const { scrollTop, scrollHeight, clientHeight } = el
    const trackHeight = track.clientHeight
    const maxScroll = scrollHeight - clientHeight

    if (maxScroll <= 1 || trackHeight <= 0 || clientHeight <= 0) {
      setMetrics({ visible: false, thumbHeight: 0, thumbTop: 0 })
      return
    }

    const thumbHeight = Math.max(
      MIN_THUMB_HEIGHT,
      Math.min(trackHeight, (clientHeight / scrollHeight) * trackHeight),
    )
    const travel = trackHeight - thumbHeight
    const ratio = Math.min(1, Math.max(0, scrollTop / maxScroll))
    const thumbTop = ratio * travel

    setMetrics({
      visible: true,
      thumbHeight,
      thumbTop,
    })
  }, [scrollElement])

  useEffect(() => {
    const el = scrollElement
    if (!el) return

    updateMetrics()
    el.addEventListener('scroll', updateMetrics, { passive: true })

    const observer = new ResizeObserver(() => {
      updateMetrics()
    })
    observer.observe(el)
    if (trackRef.current) observer.observe(trackRef.current)

    return () => {
      el.removeEventListener('scroll', updateMetrics)
      observer.disconnect()
    }
  }, [scrollElement, updateMetrics])

  const scrollByDelta = useCallback(
    (delta: number) => {
      if (!scrollElement) return
      scrollElement.scrollTop += delta
    },
    [scrollElement],
  )

  const stopRepeat = useCallback(() => {
    if (repeatTimerRef.current !== null) {
      clearTimeout(repeatTimerRef.current)
      repeatTimerRef.current = null
    }
    if (repeatIntervalRef.current !== null) {
      clearInterval(repeatIntervalRef.current)
      repeatIntervalRef.current = null
    }
  }, [])

  const startRepeat = useCallback(
    (delta: number) => {
      stopRepeat()
      scrollByDelta(delta)
      repeatTimerRef.current = setTimeout(() => {
        repeatIntervalRef.current = setInterval(() => {
          scrollByDelta(delta)
        }, REPEAT_INTERVAL_MS)
      }, REPEAT_INITIAL_DELAY_MS)
    },
    [scrollByDelta, stopRepeat],
  )

  const handleArrowPointerDown = (delta: number) => (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    startRepeat(delta)
    const onPointerUp = () => {
      stopRepeat()
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== trackRef.current || !scrollElement || !trackRef.current) return
    if (event.button !== 0) return
    const rect = trackRef.current.getBoundingClientRect()
    const clickY = event.clientY - rect.top
    const { thumbTop, thumbHeight } = metrics
    const pageStep = scrollElement.clientHeight * 0.85

    if (clickY < thumbTop) {
      scrollByDelta(-pageStep)
    } else if (clickY > thumbTop + thumbHeight) {
      scrollByDelta(pageStep)
    }
  }

  const handleThumbPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !scrollElement || !trackRef.current) return
    event.preventDefault()
    event.stopPropagation()

    const { scrollTop, scrollHeight, clientHeight } = scrollElement
    const maxScroll = scrollHeight - clientHeight
    const trackHeight = trackRef.current.clientHeight
    const thumbHeight = Math.max(
      MIN_THUMB_HEIGHT,
      Math.min(trackHeight, (clientHeight / scrollHeight) * trackHeight),
    )
    const travel = trackHeight - thumbHeight

    dragStartRef.current = {
      startY: event.clientY,
      startScrollTop: scrollTop,
      maxScroll,
      travel: Math.max(1, travel),
    }

    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleThumbPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current
    if (!start || !scrollElement) return
    const deltaY = event.clientY - start.startY
    const scrollDelta = (deltaY / start.travel) * start.maxScroll
    scrollElement.scrollTop = Math.min(start.maxScroll, Math.max(0, start.startScrollTop + scrollDelta))
  }

  const handleThumbPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current) {
      dragStartRef.current = null
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <div
      className={`relative flex h-full w-[14px] shrink-0 select-none flex-col bg-transparent text-[#666] dark:text-[#999] ${className}`}
      data-testid="notepad-fixed-scrollbar"
      role="scrollbar"
      aria-orientation="vertical"
      aria-hidden="true"
    >
      {/* 顶部向上小箭头 */}
      <button
        type="button"
        tabIndex={-1}
        className="flex h-4 w-full shrink-0 cursor-default items-center justify-center text-[8px] opacity-70 hover:bg-black/[0.06] hover:opacity-100 active:bg-black/[0.12] dark:hover:bg-white/[0.08] dark:active:bg-white/[0.15] disabled:opacity-25"
        style={{ height: `${ARROW_BUTTON_HEIGHT}px` }}
        disabled={!metrics.visible}
        onPointerDown={handleArrowPointerDown(-SCROLL_STEP)}
        aria-label="Scroll up"
      >
        ▲
      </button>

      {/* 滚动轨道 */}
      <div
        ref={trackRef}
        className="relative min-h-0 w-full flex-1 cursor-default"
        onPointerDown={handleTrackPointerDown}
      >
        {metrics.visible && (
          <div
            className="absolute left-1/2 w-[6px] -translate-x-1/2 rounded-[3px] bg-black/35 hover:bg-black/55 active:bg-black/75 dark:bg-white/30 dark:hover:bg-white/50 dark:active:bg-white/70"
            style={{
              height: `${metrics.thumbHeight}px`,
              top: `${metrics.thumbTop}px`,
            }}
            onPointerDown={handleThumbPointerDown}
            onPointerMove={handleThumbPointerMove}
            onPointerUp={handleThumbPointerUp}
            onPointerCancel={handleThumbPointerUp}
            data-testid="notepad-fixed-scrollbar-thumb"
          />
        )}
      </div>

      {/* 底部向下小箭头 */}
      <button
        type="button"
        tabIndex={-1}
        className="flex h-4 w-full shrink-0 cursor-default items-center justify-center text-[8px] opacity-70 hover:bg-black/[0.06] hover:opacity-100 active:bg-black/[0.12] dark:hover:bg-white/[0.08] dark:active:bg-white/[0.15] disabled:opacity-25"
        style={{ height: `${ARROW_BUTTON_HEIGHT}px` }}
        disabled={!metrics.visible}
        onPointerDown={handleArrowPointerDown(SCROLL_STEP)}
        aria-label="Scroll down"
      >
        ▼
      </button>
    </div>
  )
}
