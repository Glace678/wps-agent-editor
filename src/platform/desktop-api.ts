// Stable public entrypoint for the typed desktop boundary. The implementation
// stays in desktop.ts so migration tests can continue to inject its transport.
export { desktopApi } from './desktop'
export type { DesktopApi } from '@/types/desktop-api'
