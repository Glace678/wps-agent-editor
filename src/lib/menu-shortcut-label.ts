import { desktopApi } from '@/platform'

const isMac = desktopApi.app.platform === 'darwin'

/**
 * Format a shortcut hint for the active platform. Tokens:
 *   'Mod' / 'Ctrl' / 'Alt' / 'Shift' / 'Meta' → platform symbols
 * Any other token is treated as a key name and emitted verbatim.
 *
 * The in-app menu bar is hidden on macOS (the native menu is used there), so
 * today the Windows/Linux branch is the visible one, but this is the single
 * adaptation point the shortcut-display layer was missing (wps_10 C1).
 */
export function shortcutLabel(...parts: readonly string[]): string {
  const formatted = parts.map((part) => {
    switch (part) {
      case 'Mod':
      case 'Ctrl':
        return isMac ? '⌘' : 'Ctrl'
      case 'Meta':
        return isMac ? '⌘' : 'Win'
      case 'Alt':
        return isMac ? '⌥' : 'Alt'
      case 'Shift':
        return isMac ? '⇧' : 'Shift'
      default:
        return part
    }
  })
  return formatted.join(isMac ? '' : '+')
}
