import type { PdfTextLine, PdfTextParagraph } from './mupdf-protocol'

// PDF/browser font metrics and CSS subpixel rounding differ slightly. Allow a
// fraction of a point for wrapping; the original rectangle still clips ink.
export const PDF_TEXT_WRAP_TOLERANCE = 0.1

/** Split a MuPDF text block at columns, paragraph gaps, or changes of body style. */
export function textParagraphs(lines: PdfTextLine[], pageWidth: number, pageHeight: number): PdfTextParagraph[] {
  const groups: PdfTextLine[][] = []
  for (const line of lines) {
    const group = groups.at(-1)
    const previous = group?.at(-1)
    const fontSize = line.fontSize ?? 12
    const baseline = (item: PdfTextLine) => item.y * pageHeight + (item.baseline ?? 0)
    const advance = previous ? baseline(line) - baseline(previous) : 0
    const leftDelta = previous ? Math.abs(line.x - previous.x) * pageWidth : 0
    const sameStyle = previous && previous.fontFamily === line.fontFamily
      && Math.abs((previous.fontSize ?? 12) - fontSize) <= 0.01
      && previous.fontBold === line.fontBold && previous.fontItalic === line.fontItalic
      && previous.color === line.color
    // The first line may be indented. Later lines should share a left edge.
    const aligned = group && leftDelta <= fontSize * (group.length === 1 ? 3 : 0.25)
    const overlaps = previous && Math.min(previous.x + previous.width, line.x + line.width)
      > Math.max(previous.x, line.x)
    const previousAdvance = group && group.length > 1
      ? baseline(previous!) - baseline(group[group.length - 2]) : advance
    if (group && sameStyle && aligned && overlaps
      && advance >= fontSize * 0.75 && advance <= fontSize * 2.2
      && Math.abs(advance - previousAdvance) <= fontSize * 0.3) {
      group.push(line)
    } else {
      groups.push([line])
    }
  }
  return groups.map((group) => {
    const first = group[0]
    const last = group[group.length - 1]
    const x = Math.min(...group.map((line) => line.x))
    const y = Math.min(...group.map((line) => line.y))
    return {
      ...first,
      x,
      y,
      width: Math.max(...group.map((line) => line.x + line.width)) - x,
      height: Math.max(...group.map((line) => line.y + line.height)) - y,
      text: group.map((line) => line.text).join('\n'),
      baseline: (first.baseline ?? 0) + (first.y - y) * pageHeight,
      lineHeight: group.length > 1
        ? ((last.y - first.y) * pageHeight + (last.baseline ?? 0) - (first.baseline ?? 0)) / (group.length - 1)
        : undefined,
      firstLineIndent: (first.x - x) * pageWidth,
      lines: group,
    }
  })
}
