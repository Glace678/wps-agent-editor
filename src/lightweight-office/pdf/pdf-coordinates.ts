import type {
  PdfNormalizedRect,
  PdfPageInfo,
  PdfRotation,
} from './mupdf-protocol'

function clampUnit(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

export function normalizePdfRect(rect: PdfNormalizedRect): PdfNormalizedRect {
  const width = Math.min(Math.max(rect.width, 0), 1)
  const height = Math.min(Math.max(rect.height, 0), 1)
  return {
    x: Math.min(clampUnit(rect.x), 1 - width),
    y: Math.min(clampUnit(rect.y), 1 - height),
    width,
    height,
  }
}

export function pdfViewSize(
  page: Pick<PdfPageInfo, 'width' | 'height'>,
  rotation: PdfRotation,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height }
}

export function pdfCanonicalToViewRect(
  value: PdfNormalizedRect,
  rotation: PdfRotation,
): PdfNormalizedRect {
  const rect = normalizePdfRect(value)
  switch (rotation) {
    case 90:
      return {
        x: 1 - rect.y - rect.height,
        y: rect.x,
        width: rect.height,
        height: rect.width,
      }
    case 180:
      return {
        x: 1 - rect.x - rect.width,
        y: 1 - rect.y - rect.height,
        width: rect.width,
        height: rect.height,
      }
    case 270:
      return {
        x: rect.y,
        y: 1 - rect.x - rect.width,
        width: rect.height,
        height: rect.width,
      }
    default:
      return rect
  }
}


export function pdfViewToCanonicalRect(
  value: PdfNormalizedRect,
  rotation: PdfRotation,
): PdfNormalizedRect {
  const rect = normalizePdfRect(value)
  switch (rotation) {
    case 90:
      return normalizePdfRect({
        x: rect.y,
        y: 1 - rect.x - rect.width,
        width: rect.height,
        height: rect.width,
      })
    case 180:
      return normalizePdfRect({
        x: 1 - rect.x - rect.width,
        y: 1 - rect.y - rect.height,
        width: rect.width,
        height: rect.height,
      })
    case 270:
      return normalizePdfRect({
        x: 1 - rect.y - rect.height,
        y: rect.x,
        width: rect.height,
        height: rect.width,
      })
    default:
      return rect
  }
}
