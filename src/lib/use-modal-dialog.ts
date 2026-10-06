import { useEffect, useRef, type RefObject } from 'react'

// Reusable modal-dialog behavior (wps_05 #10): initial focus, Escape to close
// and simple Tab focus cycling, plus focus restoration on unmount. Pair with
// role="dialog" aria-modal="true" on the container.

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  )
}

export interface ModalDialogOptions {
  onClose?: () => void
  closeOnEsc?: boolean
  /** 'first': focus the first control; 'container': focus the container itself */
  initialFocus?: 'first' | 'container'
}

export function useModalDialog<T extends HTMLElement>(
  options: ModalDialogOptions = {},
): RefObject<T> {
  const containerRef = useRef<T>(null)
  const onCloseRef = useRef(options.onClose)
  onCloseRef.current = options.onClose

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    if (options.initialFocus === 'first') {
      const focusables = getFocusableElements(container)
      ;(focusables[0] ?? container).focus()
    } else {
      container.focus()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Let the shortcut recorder's own Escape handler cancel recording.
        if (event.target instanceof Element && event.target.closest('[data-shortcut-recorder]')) {
          return
        }
        if (options.closeOnEsc === false) return
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current?.()
        return
      }

      if (event.key !== 'Tab') return
      const focusables = getFocusableElements(container)
      if (focusables.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      const inside = container.contains(document.activeElement)
      if (event.shiftKey) {
        if (!inside || document.activeElement === first) {
          event.preventDefault()
          last.focus()
        }
      } else if (!inside || document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
    // Mount-once behavior; latest onClose is read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return containerRef
}
