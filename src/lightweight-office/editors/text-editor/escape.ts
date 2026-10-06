export { escapeHtmlText as escapeNotepadLinkText } from '../notepad-tables'

export function escapeNotepadLinkAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

/**
 * F11: notepad links are restricted to http/https/mailto/tel, in-page
 * anchors (`#…`) and root-relative paths (`/…`, including protocol-relative
 * `//host`). Explicit `javascript:`/`data:`/`vbscript:`/`file:` schemes are
 * rejected at insertion instead of relying on downstream DOMPurify.
 */
export function isSafeNotepadLink(value: string): boolean {
  return /^(?:https?:|mailto:|tel:|#|\/)/i.test(value)
}
