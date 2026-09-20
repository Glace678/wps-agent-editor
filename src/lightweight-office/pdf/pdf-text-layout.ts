import type { PdfTextAnnotationRecord } from './mupdf-protocol'

let measurementContext: CanvasRenderingContext2D | null = null

export function pdfTextFontFamily(record: PdfTextAnnotationRecord): string {
  // Helvetica is not installed on every platform. Arial is its metric-compatible
  // browser fallback; an unspecified fallback can select a serif font instead.
  return record.font.fontId.startsWith('builtin:')
    ? 'Helvetica, Arial, sans-serif'
    : `${JSON.stringify(record.font.familyName)}, sans-serif`
}

/** Align the browser's alphabetic baseline with the original PDF baseline. */
export function pdfTextBaselineShift(record: PdfTextAnnotationRecord, scale: number): number {
  if (record.baseline === undefined) return 0
  measurementContext ??= document.createElement('canvas').getContext('2d')
  if (!measurementContext) return 0
  const fontSize = record.fontSize * scale
  measurementContext.font = `${record.font.style} ${record.font.weight} ${fontSize}px ${pdfTextFontFamily(record)}`
  const metrics = measurementContext.measureText('Mg')
  const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent
  const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent
  const browserBaseline = (fontSize * 1.2 - ascent - descent) / 2 + ascent
  return record.baseline * scale - browserBaseline
}
