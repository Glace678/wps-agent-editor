export const LEGACY_CODE_FONT_SIZE_KEY = 'officeagentic-code-editor-font-size'
export const CODE_FONT_SIZE_MIN = 8
export const CODE_FONT_SIZE_MAX = 32
export const CODE_FONT_SIZE_DEFAULT = 14
export const CODE_FONT_LINE_HEIGHT_RATIO = 22 / 14
export const CODE_SCROLLBAR_THUMB_HEIGHT = 48

export const DEBUGGER_EXTENSIONS = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'pyw'])
export const NO_BREAKPOINTS: number[] = []

export function clampCodeFontSize(value: number): number {
  return Math.min(CODE_FONT_SIZE_MAX, Math.max(CODE_FONT_SIZE_MIN, value))
}

export function decodeSource(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  return new TextDecoder('utf-8').decode(bytes)
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function getDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark')
}
