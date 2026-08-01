import { flushSync } from 'react-dom'

const SCROLLBAR_SELECTOR = '.luckysheet-scrollbar-x, .luckysheet-scrollbar-y'

/**
 * Fortune updates its entire workbook context for every native scroll event.
 * A scrollbar-thumb drag can emit several events inside one display frame,
 * leaving canvas rendering behind the pointer. Forward only the latest event
 * for each scrollbar in requestAnimationFrame and flush it before that frame
 * is painted.
 */
export function attachExcelFrameScroll(shell: HTMLElement): () => void {
  const pendingTargets = new Set<HTMLElement>()
  let frame: number | null = null
  let forwarding = false
  let rawEventCount = 0
  let renderedFrameCount = 0
  let pendingSince = 0
  let maxFrameLatency = 0

  const flush = () => {
    frame = null
    if (pendingTargets.size === 0) return
    const targets = [...pendingTargets]
    pendingTargets.clear()

    forwarding = true
    try {
      flushSync(() => {
        for (const target of targets) {
          target.dispatchEvent(new Event('scroll'))
        }
      })
    } finally {
      forwarding = false
    }

    renderedFrameCount += 1
    const frameLatency = performance.now() - pendingSince
    maxFrameLatency = Math.max(maxFrameLatency, frameLatency)
    shell.dataset.excelScrollRawEvents = String(rawEventCount)
    shell.dataset.excelScrollFrames = String(renderedFrameCount)
    shell.dataset.excelScrollLastFrameMs = frameLatency.toFixed(2)
    shell.dataset.excelScrollMaxFrameMs = maxFrameLatency.toFixed(2)
  }

  const onScrollCapture = (event: Event) => {
    if (forwarding) return
    const target = event.target instanceof HTMLElement ? event.target : null
    if (!target?.matches(SCROLLBAR_SELECTOR)) return

    // Stop Fortune's unthrottled target listener. The synthetic event emitted
    // by flush() is allowed through by the forwarding guard.
    event.stopPropagation()
    rawEventCount += 1
    pendingTargets.add(target)
    if (frame === null) {
      pendingSince = performance.now()
      frame = requestAnimationFrame(flush)
    }
  }

  shell.addEventListener('scroll', onScrollCapture, true)
  return () => {
    shell.removeEventListener('scroll', onScrollCapture, true)
    if (frame !== null) cancelAnimationFrame(frame)
    pendingTargets.clear()
  }
}
