/**
 * Thin re-export shim (review R1).
 *
 * The disposed/unlisten race-adaptive subscription logic now lives in
 * `src/platform/subscription.ts`: the platform layer owns the Tauri transport,
 * and platform must never depend on lib. Existing `@/lib/desktop-events`
 * imports keep working through this shim.
 */
export { subscribeDesktopEvent } from '@/platform/subscription'
