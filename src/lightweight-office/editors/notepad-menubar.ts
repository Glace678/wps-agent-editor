/**
 * Windows Notepad-style top menubar interaction (File / Edit / View).
 *
 * Idle: hover does not open a menu.
 * Click: opens that menu and enters active (sticky / hot-track) mode.
 * Active: pointer-enter on another top label switches the open menu.
 * Dismiss: click outside / choose an item / Escape → idle again.
 */

export type MenubarTop = 'file' | 'edit' | 'view'

export const MENUBAR_TOPS: readonly MenubarTop[] = ['file', 'edit', 'view']

export interface MenubarState {
  /** Currently open top-level menu, or null when all closed. */
  open: MenubarTop | null
  /** Sticky/hot-track mode: hover switches between tops. */
  active: boolean
}

export function createMenubarState(): MenubarState {
  return { open: null, active: false }
}

export function isMenubarTop(value: string | null | undefined): value is MenubarTop {
  return value === 'file' || value === 'edit' || value === 'view'
}

/** Click (or keyboard activate) a top-level label. */
export function menubarClickTop(state: MenubarState, top: MenubarTop): MenubarState {
  if (state.open === top) {
    return createMenubarState()
  }
  return { open: top, active: true }
}

/**
 * Pointer entered a top-level label.
 * Idle hover is a no-op; while active (or any menu open), switches the open menu.
 */
export function menubarPointerEnterTop(state: MenubarState, top: MenubarTop): MenubarState {
  // Hot-track if sticky mode OR a menu is currently open (covers race where
  // open was cleared but active should still apply).
  if (!state.active && state.open === null) return state
  if (state.open === top) return state
  return { open: top, active: true }
}

/** Fully dismiss (item selected, Escape, click outside, etc.). */
export function menubarDismiss(_state: MenubarState = createMenubarState()): MenubarState {
  return createMenubarState()
}

/**
 * Controlled open-change from a single top-level menu root (e.g. Radix).
 *
 * - Opening any top enters active mode.
 * - Closing the current top clears `open` but **keeps `active`** so the user
 *   can slide to File/Edit/View and auto-open the next one (Notepad hot-track).
 * - Full dismiss is done via `menubarDismiss` (outside / item / escape).
 * - Stale close events from a previous top after a switch are ignored.
 */
export function menubarOpenChange(
  state: MenubarState,
  top: MenubarTop,
  open: boolean,
): MenubarState {
  if (open) {
    return { open: top, active: true }
  }
  if (state.open !== null && state.open !== top) {
    return state
  }
  if (state.open === top) {
    // Keep hot-track; do not drop `active` here.
    return { open: null, active: true }
  }
  return state
}

/**
 * After a deferred close, either restore the top under the pointer or fully
 * dismiss if the pointer left the menubar strip.
 */
export function menubarSettleAfterClose(
  state: MenubarState,
  pointerOverTop: MenubarTop | null,
): MenubarState {
  if (!state.active) {
    return createMenubarState()
  }
  if (pointerOverTop) {
    return { open: pointerOverTop, active: true }
  }
  // Still active but nothing under the pointer (e.g. moved into a portal menu
  // or outside). Keep active only if a menu is open; otherwise idle.
  if (state.open !== null) {
    return state
  }
  return createMenubarState()
}

/**
 * Simulates enter-then-close-prev (correct order after hover switch).
 */
export function menubarResolveCloseAfterHoverSwitch(
  state: MenubarState,
  prev: MenubarTop,
  next: MenubarTop,
): MenubarState {
  const switched = menubarPointerEnterTop(state, next)
  return menubarOpenChange(switched, prev, false)
}

export function isMenubarTopOpen(state: MenubarState, top: MenubarTop): boolean {
  return state.open === top
}
