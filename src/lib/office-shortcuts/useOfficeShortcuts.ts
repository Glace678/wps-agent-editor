import { useEffect } from 'react'
import {
  initChordOverridesFromStorage,
  registerOfficeShortcutHandlers,
} from './registry'
import type { ShortcutContext, ShortcutHandlerMap } from './types'

let storageInitialized = false

/**
 * Register Office-style shortcut handlers for the active editor surface.
 * Parent shell (or this hook) dispatches via the shared catalog — editors
 * only implement action handlers, never redefine default chords.
 */
export function useOfficeShortcuts(
  context: ShortcutContext,
  handlers: ShortcutHandlerMap,
  enabled = true,
): void {
  useEffect(() => {
    if (!storageInitialized) {
      initChordOverridesFromStorage()
      storageInitialized = true
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    return registerOfficeShortcutHandlers(context, handlers)
    // Handlers object is expected to be stable (useMemo) or intentionally refreshed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, enabled, handlers])
}
