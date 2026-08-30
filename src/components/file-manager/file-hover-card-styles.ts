/**
 * Hover card outline for 最近 / 浏览 file popups.
 * box-shadow stroke (not CSS border) — more reliable in WebView compositing.
 *
 * Light and dark MUST share the same outline width (dark white ring is the
 * visual reference). Only the stroke *color* changes with theme.
 */
export const FILE_HOVER_CARD_OUTLINE_PX = 1

/**
 * Soft elevation only — spread is negative so it sits outside the 1px ring and
 * does not visually fatten the black light-mode edge relative to the white
 * dark-mode edge.
 */
const ELEVATION_SHADOW = '0 10px 28px -6px rgba(0,0,0,0.35)'

/** Light: black ring; dark: white ring — identical thickness. */
export function fileHoverCardBoxShadow(isDark: boolean): string {
  const outline = isDark ? '#ffffff' : '#000000'
  return `0 0 0 ${FILE_HOVER_CARD_OUTLINE_PX}px ${outline}, ${ELEVATION_SHADOW}`
}

/** Parse the outline width (px) from a box-shadow string produced by this module. */
export function parseHoverCardOutlineWidthPx(boxShadow: string): number {
  const m = boxShadow.match(/0\s+0\s+0\s+(\d+(?:\.\d+)?)px\s+#(?:000000|ffffff)/i)
  if (!m) throw new Error(`no theme outline ring in box-shadow: ${boxShadow}`)
  return Number(m[1])
}
