import { AppError } from './app-error'
import { desktopTransport } from './transport'

/**
 * Adapt Tauri's asynchronous listener registration to a synchronous cleanup
 * contract (used by React effects). Cleanup is safe even when the component
 * unmounts before Tauri finishes registering the listener: the `disposed` flag
 * swallows the then-arriving unlisten, and registration failures are logged.
 *
 * Single source of truth for the shell (review R1): previously this race-adaptive
 * logic existed twice — here inlined in desktop.ts and re-implemented in
 * lib/desktop-events.ts. lib/desktop-events.ts is now a thin re-export shim;
 * platform must never import from lib.
 */
export function subscribeDesktopEvent<T>(
  channel: string,
  callback: (payload: T) => void,
): () => void {
  let disposed = false
  let unlisten: (() => void) | undefined

  void desktopTransport.listen<T>(channel, (payload) => callback(payload)).then((dispose) => {
    if (disposed) dispose()
    else unlisten = dispose
  }).catch((error: unknown) => {
    console.error(`[desktop-event] Failed to listen to ${channel}`, AppError.from(error))
  })

  return () => {
    disposed = true
    unlisten?.()
  }
}
