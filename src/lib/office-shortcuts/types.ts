/** Editor surfaces that share the Office-style shortcut catalog. */
export type ShortcutContext = 'word' | 'excel' | 'text'

export type ShortcutCategory =
  | 'file'
  | 'edit'
  | 'format'
  | 'view'
  | 'navigate'
  | 'insert'
  | 'help'

/**
 * Logical command ids shared across Word / Excel / text.
 * Editors register handlers by these ids; they never redefine default chords.
 */
export type OfficeActionId =
  | 'new'
  | 'newWindow'
  | 'newMarkdown'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'saveAll'
  | 'print'
  | 'close'
  | 'closeWindow'
  | 'exit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'pasteTextOnly'
  | 'delete'
  | 'selectAll'
  | 'find'
  | 'findNext'
  | 'findPrevious'
  | 'replace'
  | 'goTo'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'hyperlink'
  | 'clearFormat'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'alignJustify'
  | 'increaseFont'
  | 'decreaseFont'
  | 'fontDialog'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'timeDate'
  | 'help'
  | 'spellCheck'
  | 'nextTab'
  | 'previousTab'

export interface ShortcutBinding {
  /** Unique binding id (one action may have multiple chords). */
  id: string
  actionId: OfficeActionId
  /** Office-style default chord, e.g. "Ctrl+S", "Ctrl+Shift+S", "F12". */
  defaultChord: string
  /** Display name (zh-CN primary for settings UI). */
  label: string
  /** English label from Microsoft docs style naming. */
  labelEn: string
  category: ShortcutCategory
  /**
   * Which document surfaces this binding applies to.
   * `all` means Word + Excel + text.
   */
  contexts: Array<ShortcutContext | 'all'>
  /** Optional note when the action is Office-common but only partially supported. */
  note?: string
}

export interface ParsedChord {
  ctrl: boolean
  alt: boolean
  shift: boolean
  /** Normalized key: lower-case letter/digit, or special like 'f3', 'escape', '+', '-', ' '. */
  key: string
}

export interface KeyEventLike {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export type ShortcutHandler = () => void | boolean | Promise<void>

export type ShortcutHandlerMap = Partial<Record<OfficeActionId, ShortcutHandler>>

export interface DispatchResult {
  /** Whether a catalog chord matched. */
  matched: boolean
  actionId: OfficeActionId | null
  bindingId: string | null
  /** Whether a handler ran (or was found). */
  handled: boolean
  /** Clear outcome when chord matches but active surface has no handler. */
  reason?: 'no-handler' | 'no-match' | 'ok'
}
