/**
 * Shared path string helpers for the desktop shell.
 *
 * Frozen contract: these functions are imported by two review shards (platform
 * layer and components/stores layer). Do not change the signatures below.
 * All functions are pure string utilities with no desktop/tauri dependency, so
 * platform/, stores/ and components/ may all import them.
 */

function hostPlatform(): string {
  if (typeof navigator === 'undefined') return ''
  // Prefer the non-deprecated Client Hints API; fall back to navigator.platform
  // (browsers without UA Client Hints, and the WebView2 defaults in some configs).
  const modern = (navigator as Navigator & {
    userAgentData?: { platform?: string }
  }).userAgentData?.platform
  return (modern ?? navigator.platform ?? '').toLowerCase()
}

function isWindowsRuntime(): boolean {
  return /win/.test(hostPlatform())
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
 * Stable key for path equality and dedup (grant lookup, file sessions).
 * Separators are normalized first. Case folding is bound to the runtime
 * platform: Windows runtimes fold; other runtimes — including macOS, whose
 * volumes may legitimately be case-sensitive — do not. This is the single
 * key implementation shared by the grant table and every comparison
 * (wps_10 C2).
 */
export function pathKey(path: string): string {
  const normalized = normalizePath(path)
  return isWindowsRuntime() ? normalized.toLowerCase() : normalized
}

/**
 * Compare two paths for equality via {@link pathKey}. On Windows runtimes the
 * comparison is case-insensitive; on other runtimes it is case-sensitive.
 */
export function isSamePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b)
}
