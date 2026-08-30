import { desktopApi } from '@/platform'

/**
 * Adapt the asynchronous Tauri listener registration to React's synchronous
 * effect cleanup contract. Cleanup is safe even when unmount happens before
 * Tauri finishes registering the listener.
 */
export function subscribeDesktopEvent<T>(
  channel: string,
  callback: (payload: T) => void,
): () => void {
  let disposed = false
  let unlisten: (() => void) | undefined

  void desktopApi.app.listen<T>(channel, callback).then((dispose) => {
    if (disposed) dispose()
    else unlisten = dispose
  }).catch((error: unknown) => {
    console.error(`[desktop-event] Failed to listen to ${channel}`, error)
  })

  return () => {
    disposed = true
    unlisten?.()
  }
}
