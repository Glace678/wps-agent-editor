/**
 * Shared path string helpers for the desktop shell.
 *
 * Frozen contract: these functions are imported by two review shards (platform
 * layer and components/stores layer). Do not change the signatures below.
 * All functions are pure string utilities with no desktop/tauri dependency, so
 * platform/, stores/ and components/ may all import them.
 */

function isWindowsRuntime(): boolean {
  return typeof navigator !== 'undefined' && /win/.test(navigator.platform.toLowerCase())
}

/**
 * Last path component. Both `/` and `\` are treated as separators; trailing
 * separators and empty segments are ignored (e.g. `a/b/` → `b`).
 */
export function baseName(path: string): string {
  const segments = path.split(/[/\\]/).filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1] : ''
}

/**
 * Lowercase extension without the leading dot. Hidden files (e.g. `.gitignore`)
 * and extension-less names return `''`.
 */
export function extensionOf(path: string): string {
  const name = baseName(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  return name.slice(dot + 1).toLowerCase()
}

/** Backslashes → forward slashes; repeated separators collapsed to one. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
}

/**
 * Compare two paths for equality. Separators are normalized first. On Windows
 * runtimes (navigator.platform matches /win/) comparison is case-insensitive,
 * matching the grants / file-session path-key behavior; on other runtimes it is
 * case-sensitive.
 */
export function isSamePath(a: string, b: string): boolean {
  const left = normalizePath(a)
  const right = normalizePath(b)
  return isWindowsRuntime()
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}
