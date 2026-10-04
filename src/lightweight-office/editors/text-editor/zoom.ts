export const NOTEPAD_MIN_ZOOM = 10
export const NOTEPAD_MAX_ZOOM = 500
export const NOTEPAD_ZOOM_STEP = 10
export const NOTEPAD_WHEEL_ZOOM_IDLE_MS = 160
export const NOTEPAD_FONT_POINT_TO_PIXEL = 96 / 72

export function applyNotepadTextZoom(
  root: HTMLElement | null,
  fontSizePoints: number,
  percent: number,
): void {
  if (!root) return
  const pixels = fontSizePoints * NOTEPAD_FONT_POINT_TO_PIXEL * (percent / 100)
  root.style.setProperty('--notepad-editor-font-size', `${pixels}px`)
}

export function clampNotepadZoom(value: number): number {
  if (!Number.isFinite(value)) return NOTEPAD_MIN_ZOOM
  const stepped = Math.round(value / NOTEPAD_ZOOM_STEP) * NOTEPAD_ZOOM_STEP
  return Math.min(NOTEPAD_MAX_ZOOM, Math.max(NOTEPAD_MIN_ZOOM, stepped))
}

export interface NotepadZoomAnchor {
  surface: HTMLElement
  viewportX: number
  viewportY: number
  scrollLeft: number
  scrollTop: number
  scrollWidth: number
  scrollHeight: number
}

export function restoreNotepadZoomAnchor(
  anchor: NotepadZoomAnchor | null,
  wordWrap: boolean,
): void {
  if (!anchor?.surface.isConnected) return
  const { surface } = anchor

  const verticalProgress = (
    anchor.scrollTop + anchor.viewportY
  ) / Math.max(1, anchor.scrollHeight)
  const nextScrollTop = verticalProgress * surface.scrollHeight - anchor.viewportY
  surface.scrollTop = Math.min(
    Math.max(0, nextScrollTop),
    Math.max(0, surface.scrollHeight - surface.clientHeight),
  )

  if (wordWrap) {
    surface.scrollLeft = 0
    return
  }

  const horizontalProgress = (
    anchor.scrollLeft + anchor.viewportX
  ) / Math.max(1, anchor.scrollWidth)
  const nextScrollLeft = horizontalProgress * surface.scrollWidth - anchor.viewportX
  surface.scrollLeft = Math.min(
    Math.max(0, nextScrollLeft),
    Math.max(0, surface.scrollWidth - surface.clientWidth),
  )
}
