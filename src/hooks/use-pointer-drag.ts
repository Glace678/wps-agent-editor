import { useCallback, useEffect, useRef } from 'react'

/**
 * Start a document-level drag (panel resize handles and similar).
 *
 * While dragging, mouse listeners live on `document` so the drag keeps tracking
 * even when the cursor leaves the handle; the body cursor and text selection
 * are managed for the duration. Cleanup is idempotent (safe against double
 * start) and also runs on unmount.
 *
 * Review §1.4: extracted from BottomPanel's inline resize handler.
 * ResizableThreeColumnLayout's richer split drag is intentionally NOT migrated
 * (tracked as a second-batch item).
 */
export function useDocumentDrag(
  onMove: (event: MouseEvent) => void,
  options: { cursor?: string } = {},
): { start: () => void } {
  const moveRef = useRef(onMove)
  moveRef.current = onMove
  const cleanupRef = useRef<(() => void) | null>(null)
  const cursor = options.cursor ?? 'ns-resize'

  const start = useCallback(() => {
    if (cleanupRef.current) return
    const move = (event: MouseEvent) => moveRef.current(event)
    const stop = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', stop)
      window.removeEventListener('blur', stop)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      cleanupRef.current = null
    }
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', stop)
    window.addEventListener('blur', stop)
    cleanupRef.current = stop
  }, [cursor])

  useEffect(() => () => {
    cleanupRef.current?.()
  }, [])

  return { start }
}
