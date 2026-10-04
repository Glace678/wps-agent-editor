import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'

export interface PopoverPosition {
  left: number
  top: number
  width: number
}

interface UsePopoverOptions {
  /** Minimum popover width; it still grows to match the trigger when wider. */
  minWidth: number
  /**
   * When provided, opening is blocked whenever it returns true. Use this for
   * disabled triggers or empty option sets. Defaults to always allowed.
   */
  blocked?: () => boolean
  /**
   * Optional value that changes when the option set changes. Supplying it keeps
   * the open popover aligned as the content grows or shrinks.
   */
  contentKey?: number | string
  /** Called with the popover content on open; typically focuses a search box. */
  onContentReady?: () => void
}

interface PopoverKeyboardResult {
  /** Place on a focusable container that wraps the `[role="option"]` elements. */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
  /** Move keyboard focus to the option at the given index, wrapping around. */
  focusOption: (index: number) => void
}

const POPUP_GAP = 4
const VIEWPORT_PADDING = 12

/**
 * Shared mechanics for a button-triggered, portalled popover: viewport-clamped
 * positioning (flipping above the trigger when space is tight), outside-click,
 * Escape and focus-leak dismissal, scroll/resize repositioning, and roving
 * keyboard focus across `[role="option"]` children.
 *
 * The hook owns only the interaction mechanics. Each consumer keeps its own
 * trigger styling, search filtering, rendered content and accessibility text.
 */
export function usePopover({
  minWidth,
  blocked,
  contentKey,
  onContentReady,
}: UsePopoverOptions) {
  const triggerRef = useRef<HTMLElement | null>(null)
  const popoverRef = useRef<HTMLElement | null>(null)
  const initialFocusRef = useRef<HTMLElement | null>(null)
  const optionsRef = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PopoverPosition | null>(null)

  const reposition = useCallback(() => {
    const trigger = triggerRef.current
    const popover = popoverRef.current
    if (!trigger || !popover) return
    const triggerRect = trigger.getBoundingClientRect()
    const popoverHeight = popover.getBoundingClientRect().height
    const width = Math.min(
      Math.max(triggerRect.width, minWidth),
      window.innerWidth - VIEWPORT_PADDING * 2,
    )
    const left = Math.min(
      Math.max(VIEWPORT_PADDING, triggerRect.left),
      window.innerWidth - width - VIEWPORT_PADDING,
    )
    const below = triggerRect.bottom + POPUP_GAP
    const above = triggerRect.top - POPUP_GAP - popoverHeight
    const top = below + popoverHeight <= window.innerHeight - VIEWPORT_PADDING
      ? below
      : Math.max(VIEWPORT_PADDING, above)
    setPosition({ left, top, width })
  }, [minWidth])

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    setPosition(null)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const show = useCallback(() => {
    if (blocked?.()) return
    setPosition(null)
    setOpen(true)
  }, [blocked])

  const focusOption = useCallback((index: number) => {
    const options = [
      ...(optionsRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
    ]
    if (options.length === 0) return
    options[(index + options.length) % options.length].focus()
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    reposition()
    const frame = requestAnimationFrame(() => {
      reposition()
      if (onContentReady) onContentReady()
      else initialFocusRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
    // contentKey intentionally re-runs the effect so the open popover tracks
    // changes to its option set.
  }, [open, reposition, contentKey, onContentReady])

  useEffect(() => {
    if (!open) return
    const isInside = (target: EventTarget | null) => target instanceof Node
      && (popoverRef.current?.contains(target) || triggerRef.current?.contains(target))

    const handlePointerDown = (event: PointerEvent) => {
      if (!isInside(event.target)) close()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(true)
      }
    }
    const handleFocusIn = (event: FocusEvent) => {
      if (!isInside(event.target)) close()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('focusin', handleFocusIn, true)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('focusin', handleFocusIn, true)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [close, open, reposition])

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const options = [
      ...(optionsRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
    ]
    const currentIndex = options.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusOption(currentIndex + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (currentIndex <= 0) initialFocusRef.current?.focus()
      else focusOption(currentIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusOption(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusOption(options.length - 1)
    }
  }, [focusOption])

  const keyboard: PopoverKeyboardResult = { onKeyDown, focusOption }

  return {
    open,
    position,
    triggerRef,
    popoverRef,
    initialFocusRef,
    optionsRef,
    keyboard,
    show,
    close,
  }
}
