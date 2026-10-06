// Dirty-document guard registry. The document editor registers a handler that
// walks every dirty tab (save / discard / cancel) and returns whether the
// native shell may proceed with a window close, app quit, or reload (wps_10 A1).
// Top-level native-close listeners call runCloseGuard; when no editor mounted a
// handler there is nothing to protect and the action proceeds.

export type CloseGuardHandler = (signal: AbortSignal) => Promise<boolean>

let activeHandler: CloseGuardHandler | null = null

export function registerCloseGuardHandler(handler: CloseGuardHandler): () => void {
  activeHandler = handler
  return () => {
    if (activeHandler === handler) {
      activeHandler = null
    }
  }
}

export async function runCloseGuard(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false
  const handler = activeHandler
  if (!handler) return true
  return handler(signal)
}
