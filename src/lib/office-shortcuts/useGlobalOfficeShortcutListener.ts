import { useEffect } from 'react'
import { dispatchOfficeShortcut, initChordOverridesFromStorage } from './registry'

let storageInitialized = false

/**
 * Window-level listener that routes key events through the shared Office
 * catalog + active handler registry (Word / Excel / text).
 */
export function useGlobalOfficeShortcutListener(enabled = true): void {
  useEffect(() => {
    if (!storageInitialized) {
      initChordOverridesFromStorage()
      storageInitialized = true
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-code-editor-root]')) {
        return
      }

      // Ignore pure modifier presses
      if (event.key === 'Control' || event.key === 'Shift' || event.key === 'Alt' || event.key === 'Meta') {
        return
      }

      const result = dispatchOfficeShortcut(event)
      if (result.handled) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled])
}
