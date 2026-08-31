export type {
  CapturedShortcutChord,
  DispatchResult,
  KeyEventLike,
  OfficeActionId,
  ParsedChord,
  ShortcutBinding,
  ShortcutCategory,
  ShortcutContext,
  ShortcutHandler,
  ShortcutHandlerMap,
  ShortcutModifier,
} from './types'

export {
  OFFICE_SHORTCUT_CATALOG,
  OFFICE_SHORTCUT_CATALOG_COUNT,
  getBindingById,
  getCatalogBindingsForContext,
  getDefaultChordForAction,
  getOfficeShortcutCatalog,
  getShortcutSettingsRows,
} from './catalog'

export {
  areShortcutChordsEquivalent,
  captureShortcutChord,
  findShortcutConflicts,
  formatChordDisplay,
  getDefaultActionChordMap,
  matchKeyEvent,
  normalizeEventKey,
  parseChord,
  resolveActionFromEvent,
  shortcutChordsConflict,
  shortcutContextsOverlap,
} from './match'

export {
  __setActiveForTests,
  dispatchOfficeShortcut,
  getActiveShortcutContext,
  getChordOverrides,
  initChordOverridesFromStorage,
  invokeOfficeAction,
  loadChordOverrides,
  registerOfficeShortcutHandlers,
  resolveOfficeShortcut,
  saveChordOverrides,
} from './registry'

export { useOfficeShortcuts } from './useOfficeShortcuts'
export { useGlobalOfficeShortcutListener } from './useGlobalOfficeShortcutListener'

export {
  getLocalizedShortcutCommandLabel,
  getShortcutCommandTranslationKey,
} from './i18n'
