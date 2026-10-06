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
      if (target instanceof Element && target.closest('[data-shortcut-recorder]')) {
        return
      }
      if (target instanceof Element && target.closest('[data-code-editor-root]')) {
        return
      }

      // Never touch keys while an IME composition is active (keyCode 229 is the
      // legacy signal on platforms that predate event.isComposing): otherwise
      // chord matching would hijack IME interactions such as Ctrl+Space.
      if (event.isComposing || event.keyCode === 229) {
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
