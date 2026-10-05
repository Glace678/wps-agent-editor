/**
 * localStorage wrapper that never throws (review §1.4 / enabled-provider).
 *
 * Storage can be unavailable in private mode / sandboxed renderers, and the app
 * must keep working in-memory in that case. Every consumer used to repeat the
 * same try/catch boilerplate; centralize it here. Failures are swallowed on
 * purpose — callers keep their in-memory state.
 */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // The in-memory preference still applies for this session.
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Ignored: same rationale as set().
    }
  },
}
