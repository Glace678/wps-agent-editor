import { resolveActionFromEvent, parseChord } from './match'
import { OFFICE_SHORTCUT_CATALOG } from './catalog'
import type {
  DispatchResult,
  KeyEventLike,
  OfficeActionId,
  ShortcutContext,
  ShortcutHandlerMap,
} from './types'

interface ActiveRegistration {
  context: ShortcutContext
  handlers: ShortcutHandlerMap
  token: number
}

// #12: stack instead of a single slot. On unmount the registration removes
// only itself and dispatch falls back to the most recently surviving handler
// map, instead of leaving an active=null shortcut void.
const registrations: ActiveRegistration[] = []
let tokenSeq = 0

function getActiveRegistration(): ActiveRegistration | null {
  return registrations[registrations.length - 1] ?? null
}

/** Observe a handler that returned a thenable so a rejected async handler
 *  never surfaces as an unhandled promise rejection. The dispatch result is
 *  still reported synchronously; async failures are only logged here. */
function observeHandlerResult(result: unknown, actionId: OfficeActionId): void {
  if (!result || typeof (result as Promise<void>).then !== 'function') return
  Promise.resolve(result).catch((err: unknown) => {
    console.error('[office-shortcuts] async handler error', actionId, err)
  })
}

/** Chord overrides: binding id → chord string. */
let chordOverrides: Record<string, string> = {}

const OVERRIDES_KEY = 'office-shortcut-overrides'
/** Same-window event fired when the settings panel persists new overrides. */
export const CHORD_OVERRIDES_EVENT = 'office-shortcut-overrides-change'

/** Only overrides for bindings that actually exist in the catalog are trusted. */
const KNOWN_BINDING_IDS = new Set(OFFICE_SHORTCUT_CATALOG.map((binding) => binding.id))

function isParseableChord(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  try {
    const parsed = parseChord(trimmed)
    return typeof parsed.key === 'string' && parsed.key.length > 0
  } catch {
    return false
  }
}

export function loadChordOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    // Reject unknown bindings, non-string values, and chords that do not parse.
    // Storage is not trusted: drop invalid entries instead of applying them.
    const result: Record<string, string> = {}
    for (const [bindingId, chord] of Object.entries(parsed as Record<string, unknown>)) {
      if (KNOWN_BINDING_IDS.has(bindingId) && isParseableChord(chord)) {
        result[bindingId] = chord.trim()
      }
    }
    return result
  } catch {
    return {}
  }
}

export function saveChordOverrides(next: Record<string, string>): void {
  chordOverrides = { ...next }
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(chordOverrides))
  } catch {
    /* ignore */
  }
  // #3: notify this window; the 'storage' event only fires in other windows.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHORD_OVERRIDES_EVENT))
  }
}

export function getChordOverrides(): Record<string, string> {
  return { ...chordOverrides }
}

let overrideSyncInitialized = false

/**
 * Load overrides once and keep them in sync afterwards:
 * - 'storage': another window saved new overrides
 * - CHORD_OVERRIDES_EVENT: this window's settings panel saved them
 */
export function initChordOverridesFromStorage(): void {
  chordOverrides = loadChordOverrides()
  if (overrideSyncInitialized || typeof window === 'undefined') return
  overrideSyncInitialized = true
  window.addEventListener('storage', (event) => {
    if (event.key === OVERRIDES_KEY) chordOverrides = loadChordOverrides()
  })
  window.addEventListener(CHORD_OVERRIDES_EVENT, () => {
    chordOverrides = loadChordOverrides()
  })
}

/**
 * Register handlers for a document surface.
 * Returns an unregister function that removes only this registration; the
 * most recently surviving registration stays/ becomes active.
 */
export function registerOfficeShortcutHandlers(
  context: ShortcutContext,
  handlers: ShortcutHandlerMap,
): () => void {
  const token = ++tokenSeq
  registrations.push({ context, handlers, token })
  return () => {
    const index = registrations.findIndex((registration) => registration.token === token)
    if (index !== -1) registrations.splice(index, 1)
  }
}

export function getActiveShortcutContext(): ShortcutContext | null {
  return getActiveRegistration()?.context ?? null
}

/**
 * Shared dispatch path for Word / Excel / text.
 * Same catalog + match logic; editors only supply handlers by action id.
 */
export function dispatchOfficeShortcut(event: KeyEventLike): DispatchResult {
  const activeRegistration = getActiveRegistration()
  const context = activeRegistration?.context ?? null
  const resolved = resolveActionFromEvent(event, {
    context,
    chordOverrides,
    filterByContext: true,
  })

  if (!resolved) {
    return {
      matched: false,
      actionId: null,
      bindingId: null,
      handled: false,
      reason: 'no-match',
    }
  }

  const handler = activeRegistration?.handlers[resolved.actionId]
  if (!handler) {
    return {
      matched: true,
      actionId: resolved.actionId,
      bindingId: resolved.binding.id,
      handled: false,
      reason: 'no-handler',
    }
  }

  try {
    const result = handler()
    // Explicit false means "not handled, let browser continue"
    if (result === false) {
      return {
        matched: true,
        actionId: resolved.actionId,
        bindingId: resolved.binding.id,
        handled: false,
        reason: 'ok',
      }
    }
    observeHandlerResult(result, resolved.actionId)
  } catch (err) {
    console.error('[office-shortcuts] handler error', resolved.actionId, err)
  }

  return {
    matched: true,
    actionId: resolved.actionId,
    bindingId: resolved.binding.id,
    handled: true,
    reason: 'ok',
  }
}

/** Pure resolve without running handlers — used by tests and settings previews. */
export function resolveOfficeShortcut(
  event: KeyEventLike,
  context: ShortcutContext | null,
  overrides: Record<string, string> = chordOverrides,
): { actionId: OfficeActionId; bindingId: string } | null {
  const resolved = resolveActionFromEvent(event, {
    context,
    chordOverrides: overrides,
    filterByContext: Boolean(context),
  })
  if (!resolved) return null
  return { actionId: resolved.actionId, bindingId: resolved.binding.id }
}

/**
 * Invoke a registered action by id (menu bridge / programmatic).
 * Uses the same handler map as keyboard dispatch — no separate chord table.
 */
export function invokeOfficeAction(actionId: OfficeActionId): boolean {
  const handler = getActiveRegistration()?.handlers[actionId]
  if (!handler) return false
  try {
    const result = handler()
    if (result === false) return false
    observeHandlerResult(result, actionId)
  } catch (err) {
    console.error('[office-shortcuts] invoke error', actionId, err)
    return false
  }
  return true
}

/** Test helper: install handlers without React. */
export function __setActiveForTests(
  context: ShortcutContext | null,
  handlers: ShortcutHandlerMap = {},
): void {
  if (!context) {
    registrations.length = 0
    return
  }
  registrations.push({ context, handlers, token: ++tokenSeq })
}
