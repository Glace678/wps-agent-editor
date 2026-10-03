export { escapeHtmlText as escapeNotepadLinkText } from '../notepad-tables'

export function escapeNotepadLinkAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}
