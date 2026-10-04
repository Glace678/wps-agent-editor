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

let active: ActiveRegistration | null = null
let tokenSeq = 0

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
}

export function getChordOverrides(): Record<string, string> {
  return { ...chordOverrides }
}

export function initChordOverridesFromStorage(): void {
  chordOverrides = loadChordOverrides()
}

/**
 * Register handlers for the active document surface.
 * Returns an unregister function. Only the latest registration is active
 * (one Word / Excel / text editor at a time in this app shell).
 */
export function registerOfficeShortcutHandlers(
  context: ShortcutContext,
  handlers: ShortcutHandlerMap,
): () => void {
  const token = ++tokenSeq
  active = { context, handlers, token }
  return () => {
    if (active?.token === token) active = null
  }
}

export function getActiveShortcutContext(): ShortcutContext | null {
  return active?.context ?? null
}

/**
 * Shared dispatch path for Word / Excel / text.
 * Same catalog + match logic; editors only supply handlers by action id.
 */
export function dispatchOfficeShortcut(event: KeyEventLike): DispatchResult {
  const context = active?.context ?? null
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

  const handler = active?.handlers[resolved.actionId]
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
  const handler = active?.handlers[actionId]
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
    active = null
    return
  }
  active = { context, handlers, token: ++tokenSeq }
}
