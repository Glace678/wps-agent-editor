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

  const flush = () => {
    frame = null
    if (!pending) return
    pending = false
    scan()
  }

  const schedule = () => {
    pending = true
    if (frame !== null) return
    frame = requestAnimationFrame(flush)
  }

  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  scan()

  return () => {
    observer.disconnect()
    pending = false
    if (frame !== null) {
      cancelAnimationFrame(frame)
      frame = null
    }
  }
}
