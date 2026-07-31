import { OFFICE_SHORTCUT_CATALOG } from './catalog'
import type {
  KeyEventLike,
  OfficeActionId,
  ParsedChord,
  ShortcutBinding,
  ShortcutContext,
} from './types'

/** Normalize event key to a comparable token (case-insensitive letters). */
export function normalizeEventKey(event: KeyEventLike): string {
  const raw = event.key
  if (raw === ' ') return ' '
  if (raw === 'Spacebar') return ' '

  // Numpad / layout-stable codes for zoom and digits
  if (event.code === 'NumpadAdd' || raw === '+') return '+'
  if (event.code === 'NumpadSubtract' || raw === '-' || raw === '_') return '-'
  if (event.code === 'Equal' || raw === '=') return '='
  if (event.code === 'Numpad0' || event.code === 'Digit0') {
    if (raw === '0' || event.code === 'Numpad0' || event.code === 'Digit0') return '0'
  }

  if (raw.length === 1) return raw.toLowerCase()

  const lower = raw.toLowerCase()
  // Function keys, Delete, Tab, Escape, etc.
  return lower
}

/**
 * Parse Office-style chords like "Ctrl+S", "Ctrl++", "Ctrl+Shift+Z", "Alt+F4".
 * Note: naive split('+') breaks on "Ctrl++" (trailing Plus) — peel modifiers instead.
 */
export function parseChord(chord: string): ParsedChord {
  let rest = chord
    .trim()
    .replace(/CmdOrCtrl/gi, 'Ctrl')
    .replace(/Control/gi, 'Ctrl')
    .replace(/Command/gi, 'Ctrl')
    .replace(/Meta/gi, 'Ctrl')
    .replace(/Option/gi, 'Alt')

  let ctrl = false
  let alt = false
  let shift = false

  // Peel leading Modifier+ segments so "Ctrl++" leaves key "+"
  const modRe = /^(Ctrl|Cmd|Alt|Shift)\+/i
  while (modRe.test(rest)) {
    const match = rest.match(modRe)!
    const mod = match[1].toLowerCase()
    if (mod === 'ctrl' || mod === 'cmd') ctrl = true
    else if (mod === 'alt') alt = true
    else if (mod === 'shift') shift = true
    rest = rest.slice(match[0].length)
  }

  let key = rest
  // "Ctrl+" with nothing after last peel shouldn't happen; bare trailing plus
  if (key === '' && chord.trim().endsWith('+')) key = '+'

  const p = key.toLowerCase()
  if (p === 'space' || p === 'spacebar') key = ' '
  else if (p === 'del' || p === 'delete') key = 'delete'
  else if (p === 'esc' || p === 'escape') key = 'escape'
  else if (p === 'plus') key = '+'
  else if (p === 'minus') key = '-'
  else if (p === 'equals') key = '='
  else if (p === 'tab') key = 'tab'
  else if (key.length === 1) key = key.toLowerCase()
  else key = p

  return { ctrl, alt, shift, key }
}

/**
 * Match a keyboard event against a chord string.
 * Ctrl and Meta (Cmd) are treated equivalently (Office-like cross-platform).
 * Letter keys are case-insensitive.
 */
export function matchKeyEvent(event: KeyEventLike, chord: string): boolean {
  const parsed = parseChord(chord)
  const ctrlOrMeta = event.ctrlKey || event.metaKey
  if (parsed.ctrl !== ctrlOrMeta) return false
  if (parsed.alt !== event.altKey) return false

  const eventKey = normalizeEventKey(event)
  // The main-keyboard "+" is physically Shift+= on common layouts. Treat that
  // required Shift as part of the plus key itself, not as an extra chord modifier.
  const shiftedMainKeyboardPlus =
    parsed.key === '+' &&
    event.shiftKey &&
    (eventKey === '+' || event.code === 'Equal')
  if (parsed.shift !== event.shiftKey && !shiftedMainKeyboardPlus) return false

  // Zoom: Ctrl+= and Ctrl++ both produce various key values
  if (parsed.key === '+' || parsed.key === '=') {
    return (
      eventKey === '+'
      || eventKey === '='
      || event.code === 'NumpadAdd'
      || event.code === 'Equal'
    )
  }
  if (parsed.key === '-') {
    return eventKey === '-' || event.code === 'NumpadSubtract' || event.code === 'Minus'
  }
  if (parsed.key === '0') {
    return eventKey === '0' || event.code === 'Digit0' || event.code === 'Numpad0'
  }

  return eventKey === parsed.key
}

export function formatChordDisplay(chord: string): string {
  return chord
    .replace(/CmdOrCtrl/gi, 'Ctrl')
    .replace(/Control/gi, 'Ctrl')
    .replace(/Meta/gi, 'Ctrl')
}

export interface ResolveOptions {
  /** Active editor context — filters which bindings can match. */
  context: ShortcutContext | null
  /** Optional per-binding-id chord overrides (from settings). */
  chordOverrides?: Record<string, string>
  /**
   * If true (default), only bindings whose contexts include the active surface
   * (or `all`) can match. Resolution still uses one shared catalog/map.
   */
  filterByContext?: boolean
}

/**
 * Resolve a key event to an action using the shared catalog.
 * Does not branch default chords by editor kind — same registry for all.
 */
export function resolveActionFromEvent(
  event: KeyEventLike,
  options: ResolveOptions,
): { actionId: OfficeActionId; binding: ShortcutBinding } | null {
  const { context, chordOverrides = {}, filterByContext = true } = options

  for (const binding of OFFICE_SHORTCUT_CATALOG) {
    if (filterByContext && context) {
      const ok =
        binding.contexts.includes('all') || binding.contexts.includes(context)
      if (!ok) continue
    }

    const chord = chordOverrides[binding.id] ?? binding.defaultChord
    if (matchKeyEvent(event, chord)) {
      return { actionId: binding.actionId, binding }
    }
  }
  return null
}

/** Build actionId → defaultChord map (first binding wins) for tests/settings. */
export function getDefaultActionChordMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const b of OFFICE_SHORTCUT_CATALOG) {
    if (!(b.actionId in map)) map[b.actionId] = b.defaultChord
  }
  return map
}
