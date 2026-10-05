import { desktopApi } from '@/platform'

export type ThemePreference = 'system' | 'light' | 'dark'

export const APP_THEME_KEY = 'app-theme'
export const APP_THEME_EVENT = 'app-theme-change'

function syncNativeTheme(preference: ThemePreference): void {
  void desktopApi.app.setTheme(preference).catch(() => {
    // The browser preview does not expose the Tauri desktop transport.
  })
}

export function getThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(APP_THEME_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
  } catch {
    // Storage can be unavailable (private mode / sandboxed renderer). Fall back
    // to the system preference rather than throwing during startup.
    return 'system'
  }
}

export function resolveDarkTheme(preference: ThemePreference): boolean {
  return preference === 'dark'
    || (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(APP_THEME_KEY, preference)
  } catch {
    // Keep the in-memory preference and native sync even if persistence fails.
  }
  syncNativeTheme(preference)
  window.dispatchEvent(new CustomEvent<ThemePreference>(APP_THEME_EVENT, { detail: preference }))
}

/** Keep native menus, dialogs, and window chrome in the same theme as React. */
export function syncNativeThemePreference(): void {
  syncNativeTheme(getThemePreference())
}
