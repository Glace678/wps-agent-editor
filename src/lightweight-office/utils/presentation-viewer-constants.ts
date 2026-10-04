export const MIN_ZOOM = 50
export const MAX_ZOOM = 250
export const ZOOM_STEP = 25
export const DEFAULT_ASPECT_RATIO = 16 / 9
export const PRESENTATION_CONTROLS_HIDE_MS = 1_800
export const MIN_THUMBNAIL_PANE_WIDTH = 168
export const DEFAULT_THUMBNAIL_PANE_WIDTH = 194
export const MAX_THUMBNAIL_PANE_WIDTH = 420
export const MIN_PRESENTATION_STAGE_WIDTH = 360
export const THUMBNAIL_RESIZER_WIDTH = 6
export const THUMBNAIL_RENDER_WIDTH = 372
export const THUMBNAIL_ROW_CHROME_WIDTH = 40
export const THUMBNAIL_PANE_STORAGE_KEY = 'presentation-thumbnail-pane-width'
export const WHEEL_NAVIGATION_THRESHOLD = 32
export const WHEEL_NAVIGATION_IDLE_MS = 160
export const MAX_OUTLINE_SLIDES = 100

export const presentationMenuContentClass =
  'z-[10000] min-w-[210px] rounded-[4px] border border-black/15 bg-[#f9f9f9] p-1 text-[12px] text-[#202020] shadow-xl dark:border-white/15 dark:bg-[#2c2c2c] dark:text-[#f4f4f4]'
export const presentationMenuItemClass =
  'flex h-8 cursor-default select-none items-center gap-2 rounded-[3px] px-2 outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-black/[0.07] dark:data-[highlighted]:bg-white/[0.1]'

export const NON_EDITABLE_PLACEHOLDER_TYPES = new Set(['dt', 'ftr', 'sldNum'])

import { getExtension } from './file-io'

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function resolvePresentationSavePath(filePath: string): string {
  return ['ppt', 'odp'].includes(getExtension(filePath))
    ? filePath.replace(/\.(?:ppt|odp)$/i, '.pptx')
    : filePath
}

export function readStoredThumbnailPaneWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_THUMBNAIL_PANE_WIDTH
  const stored = Number.parseFloat(window.localStorage.getItem(THUMBNAIL_PANE_STORAGE_KEY) ?? '')
  return Number.isFinite(stored)
    ? clamp(stored, MIN_THUMBNAIL_PANE_WIDTH, MAX_THUMBNAIL_PANE_WIDTH)
    : DEFAULT_THUMBNAIL_PANE_WIDTH
}

export function estimatedThumbnailScale(paneWidth: number): number {
  return Math.max(0.1, (paneWidth - THUMBNAIL_ROW_CHROME_WIDTH) / THUMBNAIL_RENDER_WIDTH)
}

export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

export function copyBinaryData(data: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data.slice(0)
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy.buffer
}
