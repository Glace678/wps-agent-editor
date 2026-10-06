import { useEffect, useRef } from 'react'
import { desktopApi } from '@/platform'
import { runCloseGuard } from './close-guard'

// Native shell event names; must match the constants in
// src-tauri/src/commands/app.rs (wps_10 A1).
const CLOSE_REQUESTED_EVENT = 'app:close-requested'
const QUIT_REQUESTED_EVENT = 'app:quit-requested'
const QUIT_CANCEL_EVENT = 'app:quit-cancel'
const RELOAD_REQUEST_EVENT = 'app:reload-request'

type ReloadPayload = { force?: boolean } | null

/**
 * Subscribes to native close / quit / reload requests and runs the registered
 * dirty-document handler before letting the native shell proceed. A new request
 * replaces the previous flow (its prompts abort).
 *
 * Mounted once at the application root so it answers even while no document
 * editor is rendered (no handler → proceed immediately).
 */
export function useNativeCloseGuard(): void {
  const flowRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let disposed = false
    const unlistenList: Array<() => void> = []

    const beginFlow = (onProceed: () => void, onCancel?: () => void): void => {
      flowRef.current?.abort()
      const controller = new AbortController()
      flowRef.current = controller
      void (async () => {
        let allowed: boolean
        try {
          allowed = await runCloseGuard(controller.signal)
        } catch (error) {
          console.error('[close-guard] Dirty-document check failed', error)
          allowed = false
        }
        if (disposed || controller.signal.aborted) return
        if (allowed) {
          onProceed()
        } else {
          onCancel?.()
        }
      })()
    }

    const subscriptions: Array<[string, (payload?: unknown) => void]> = [
      [CLOSE_REQUESTED_EVENT, () => {
        beginFlow(() => desktopApi.app.confirmClose())
      }],
      [QUIT_REQUESTED_EVENT, () => {
        beginFlow(
          () => desktopApi.app.confirmQuit(),
          () => desktopApi.app.cancelQuit(),
        )
      }],
      [RELOAD_REQUEST_EVENT, (payload) => {
        const force = Boolean((payload as ReloadPayload)?.force)
        beginFlow(() => desktopApi.app.confirmReload(force))
      }],
      [QUIT_CANCEL_EVENT, () => {
        // Another window cancelled the quit: close this window's prompt.
        flowRef.current?.abort()
        flowRef.current = null
      }],
    ]

    for (const [event, handler] of subscriptions) {
      desktopApi.app
        .listen(event, handler)
        .then((unlisten) => {
          if (!disposed) unlistenList.push(unlisten)
        })
        .catch((error: unknown) => {
          console.error(`[close-guard] Failed to listen for ${event}`, error)
        })
    }

    return () => {
      disposed = true
      flowRef.current?.abort()
      for (const unlisten of unlistenList) unlisten()
    }
  }, [])
}
