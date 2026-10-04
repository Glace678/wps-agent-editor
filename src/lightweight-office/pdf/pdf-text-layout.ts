import type { PdfTextAnnotationRecord } from './mupdf-protocol'

let measurementContext: CanvasRenderingContext2D | null | undefined

export function pdfTextFontFamily(record: PdfTextAnnotationRecord): string {
  // Helvetica is not installed on every platform. Arial is its metric-compatible
  // browser fallback; an unspecified fallback can select a serif font instead.
  return record.font.fontId.startsWith('builtin:')
    ? 'Helvetica, Arial, sans-serif'
    : `${JSON.stringify(record.font.familyName)}, sans-serif`
}

/** True only when a 2D canvas measurement context can be obtained (browser). */
function getMeasurementContext(): CanvasRenderingContext2D | null {
  // Guarded for non-browser (SSR/Node) environments where `document` is absent.
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return null
  }
  if (measurementContext === undefined) {
    measurementContext = document.createElement('canvas').getContext('2d')
  }
  return measurementContext
}

/** Align the browser's alphabetic baseline with the original PDF baseline. */
export function pdfTextBaselineShift(record: PdfTextAnnotationRecord, scale: number): number {
  if (record.baseline === undefined) return 0
  const measurement = getMeasurementContext()
  if (!measurement) return 0
  const fontSize = record.fontSize * scale
  measurement.font = `${record.font.style} ${record.font.weight} ${fontSize}px ${pdfTextFontFamily(record)}`
  const metrics = measurement.measureText('Mg')
  const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent
  const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent
  const lineHeight = (record.lineHeight ?? record.fontSize * 1.2) * scale
  const browserBaseline = (lineHeight - ascent - descent) / 2 + ascent
  return record.baseline * scale - browserBaseline
}
