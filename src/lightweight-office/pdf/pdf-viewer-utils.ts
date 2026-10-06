import type { CSSProperties } from 'react'
import { desktopApi } from '@/platform'
import { errorMessage as platformErrorMessage } from '@/platform/app-error'
import type {
  PdfFontDescriptor,
  PdfRotation,
} from './mupdf-protocol'
import type { SystemFontFace } from '../utils/system-fonts'

export const RESIZE_HANDLE_STYLES: Record<string, CSSProperties> = {
  nw: { top: -4, left: -4, cursor: 'nwse-resize' },
  n: { top: -4, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' },
  ne: { top: -4, right: -4, cursor: 'nesw-resize' },
  e: { top: '50%', right: -4, transform: 'translateY(-50%)', cursor: 'ew-resize' },
  se: { bottom: -4, right: -4, cursor: 'nwse-resize' },
  s: { bottom: -4, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' },
  sw: { bottom: -4, left: -4, cursor: 'nesw-resize' },
  w: { top: '50%', left: -4, transform: 'translateY(-50%)', cursor: 'ew-resize' },
}

export function clampZoom(value: number): number {
  return Math.min(Math.max(value, 0.1), 5)
}

export function samePath(left: string, right: string): boolean {
  return desktopApi.app.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable
    || target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT'
}

export function isZoomInKey(event: KeyboardEvent): boolean {
  return event.key === '+' || event.key === '=' || event.code === 'NumpadAdd'
}

export function isZoomOutKey(event: KeyboardEvent): boolean {
  return event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract'
}

export function isZoomResetKey(event: KeyboardEvent): boolean {
  return event.key === '0' || event.code === 'Digit0' || event.code === 'Numpad0'
}

export function isDigitKey(event: KeyboardEvent, digit: 1 | 2): boolean {
  return event.key === String(digit)
    || event.code === `Digit${digit}`
    || event.code === `Numpad${digit}`
}

export function standaloneBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export function sameNumberArray(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function fontDescriptor(face: SystemFontFace): PdfFontDescriptor {
  return {
    fontId: face.fontId,
    familyName: face.familyName,
    faceIndex: face.faceIndex,
    weight: face.weight,
    style: face.style,
  }
}

export function isPdfEmbeddableFont(face: SystemFontFace): boolean {
  return Boolean(face.fontId)
    && (face.embedding === 'installable' || face.embedding === 'editable')
    && face.subsetAllowed
    && face.outlineEmbeddingAllowed
}

export function canonicalLayerStyle(
  rotation: PdfRotation,
  viewWidth: number,
  viewHeight: number,
): CSSProperties {
  const swapped = rotation === 90 || rotation === 270
  const width = swapped ? viewHeight : viewWidth
  const height = swapped ? viewWidth : viewHeight
  if (rotation === 90) {
    return { width, height, transform: `translateX(${viewWidth}px) rotate(90deg)`, transformOrigin: 'top left' }
  }
  if (rotation === 180) {
    return { width, height, transform: `translate(${viewWidth}px, ${viewHeight}px) rotate(180deg)`, transformOrigin: 'top left' }
  }
  if (rotation === 270) {
    return { width, height, transform: `translateY(${viewHeight}px) rotate(-90deg)`, transformOrigin: 'top left' }
  }
  return { width, height }
}

export function editedPdfName(path: string): string {
  const name = path.split(/[/\\]/).pop() || 'document.pdf'
  return /\.pdf$/i.test(name) ? name.replace(/\.pdf$/i, '-edited.pdf') : `${name}-edited.pdf`
}

export function errorMessage(error: unknown): string {
  return platformErrorMessage(error)
}
