export type ThemePreference = 'system' | 'light' | 'dark'

export const APP_THEME_KEY = 'app-theme'
export const APP_THEME_EVENT = 'app-theme-change'

function syncNativeTheme(preference: ThemePreference): void {
  const bridge = (window as Window & {
    api?: { theme?: { setPreference: (value: ThemePreference) => Promise<unknown> } }
  }).api?.theme
  if (!bridge) return
  void bridge.setPreference(preference).catch(() => {
    // The browser preview does not expose Electron IPC.
  })
}

export function getThemePreference(): ThemePreference {
  const value = localStorage.getItem(APP_THEME_KEY)
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

export function resolveDarkTheme(preference: ThemePreference): boolean {
  return preference === 'dark'
    || (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

export function setThemePreference(preference: ThemePreference): void {
  localStorage.setItem(APP_THEME_KEY, preference)
  syncNativeTheme(preference)
  window.dispatchEvent(new CustomEvent<ThemePreference>(APP_THEME_EVENT, { detail: preference }))
}

/** Keep Electron's menus, dialogs, and window chrome in the same theme as React. */
export function syncNativeThemePreference(): void {
  syncNativeTheme(getThemePreference())
}
