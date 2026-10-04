/**
 * Coalesces a document-wide `MutationObserver` into at most one scan per
 * animation frame.
 *
 * Word installs several of these (font picker search, alignment state, table
 * picker). ProseMirror mutates the document on every keystroke, so an
 * unthrottled observer runs its document-wide query several times inside a
 * single display frame and shows up as dropped frames while typing. This is the
 * same coalescing the Excel frame-scroll path already uses.
 *
 * The first scan still runs synchronously so a freshly mounted popup is
 * decorated before the browser paints.
 */
export function observeDocumentMutations(scan: () => void): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => {}
  }

  let frame: number | null = null
  let pending = false
  let disposed = false
  let observer: MutationObserver | null = null

  // Not every WebView exposes requestAnimationFrame; feature-detect and degrade
  // to setTimeout instead of throwing in the mutation callback.
  const hasRaf = typeof window.requestAnimationFrame === 'function'
    && typeof window.cancelAnimationFrame === 'function'

  const flush = () => {
    frame = null
    if (!pending || disposed) return
    pending = false
    scan()
  }

  const cancelFrame = () => {
    if (frame === null) return
    if (hasRaf) cancelAnimationFrame(frame)
    else clearTimeout(frame)
    frame = null
  }

  const schedule = () => {
    pending = true
    if (frame !== null) return
    if (hasRaf) {
      frame = requestAnimationFrame(flush)
    } else {
      frame = window.setTimeout(flush, 0)
    }
  }

  const start = () => {
    if (disposed) return
    observer = new MutationObserver(schedule)
    // Observe the whole document (not just the body subtree) so body replacement
    // and mutations outside <body> are also observed, matching the documented
    // "document-wide" behavior.
    observer.observe(document, { childList: true, subtree: true })
    scan()
  }

  // document.body may not exist yet during early init; wait for it instead of
  // throwing on observe().
  if (document.body) {
    start()
  } else if (typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    return () => {}
  }

  return () => {
    disposed = true
    observer?.disconnect()
    pending = false
    cancelFrame()
  }
}
