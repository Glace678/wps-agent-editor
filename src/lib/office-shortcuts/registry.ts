import { resolveActionFromEvent } from './match'
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

/** Chord overrides: binding id → chord string. */
let chordOverrides: Record<string, string> = {}

const OVERRIDES_KEY = 'office-shortcut-overrides'

export function loadChordOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, string>
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
