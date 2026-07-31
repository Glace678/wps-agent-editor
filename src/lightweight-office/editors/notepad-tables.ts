/**
 * Pure table region / serialize / replace helpers for the notepad.
 * Used by TextEditor formatted-view cell editing and unit tests.
 */

export interface TableRegion {
  start: number
  end: number
}

export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function cellPlainText(cell: Pick<HTMLTableCellElement, 'innerText' | 'textContent'>): string {
  return (cell.innerText || cell.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n+$/g, '')
}

/** Serialize a live DOM table to a single HTML table block (no surrounding newlines). */
export function serializeTableElement(table: HTMLTableElement): string {
  const renderRow = (row: HTMLTableRowElement, fallback: 'th' | 'td') => {
    const cells = Array.from(row.cells)
      .map((cell) => {
        const tag = cell.tagName.toLowerCase() === 'th' ? 'th' : fallback
        return `<${tag}>${escapeHtmlText(cellPlainText(cell))}</${tag}>`
      })
      .join('')
    return `<tr>${cells}</tr>`
  }

  const parts: string[] = ['<table class="notepad-md-table">']
  if (table.tHead && table.tHead.rows.length > 0) {
    parts.push('<thead>')
    for (const row of Array.from(table.tHead.rows)) parts.push(renderRow(row, 'th'))
    parts.push('</thead>')
  }

  const bodyRows =
    table.tBodies.length > 0
      ? Array.from(table.tBodies).flatMap((body) => Array.from(body.rows))
      : Array.from(table.rows).filter((row) => !table.tHead || !table.tHead.contains(row))

  parts.push('<tbody>')
  for (const row of bodyRows) parts.push(renderRow(row, 'td'))
  parts.push('</tbody>')
  parts.push('</table>')
  return parts.join('')
}

function isPipeTableRow(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('```')) return false
  return trimmed.includes('|')
}

function isPipeSeparatorRow(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('-')) return false
  return /^\|?[\s|:.-]+\|?$/.test(trimmed)
}

export function findHtmlTableRegions(source: string): TableRegion[] {
  const regions: TableRegion[] = []
  const pattern = /<table\b[\s\S]*?<\/table>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    regions.push({ start: match.index, end: match.index + match[0].length })
  }
  return regions
}

/** Render a TXT document as editable text regions separated by real HTML tables. */
export function renderPlainTextTableDocument(source: string): string {
  const regions = findHtmlTableRegions(source)
  if (regions.length === 0) {
    return `<div data-notepad-text-region="0">${escapeHtmlText(source)}</div>`
  }

  const parts: string[] = []
  let cursor = 0
  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index]
    parts.push(
      `<div data-notepad-text-region="${index}">${escapeHtmlText(source.slice(cursor, region.start))}</div>`,
      source.slice(region.start, region.end),
    )
    cursor = region.end
  }
  parts.push(
    `<div data-notepad-text-region="${regions.length}">${escapeHtmlText(source.slice(cursor))}</div>`,
  )
  return parts.join('')
}

function editableRegionText(region: HTMLElement): string {
  const value = region.innerText ?? region.textContent ?? ''
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

/** Serialize the editable TXT preview without collapsing text-region newlines. */
export function serializePlainTextTableDocument(root: HTMLElement): string {
  return Array.from(root.children).map((child) => {
    if (child instanceof HTMLTableElement) return serializeTableElement(child)
    if (child instanceof HTMLElement && child.hasAttribute('data-notepad-text-region')) {
      return editableRegionText(child)
    }
    return child.textContent ?? ''
  }).join('')
}

export function findMarkdownTableRegions(source: string): TableRegion[] {
  const regions: TableRegion[] = []
  const lines = source.split('\n')
  const lineOffsets: number[] = []
  let offset = 0
  for (let index = 0; index < lines.length; index += 1) {
    lineOffsets.push(offset)
    offset += lines[index].length
    if (index < lines.length - 1) offset += 1
  }

  let index = 0
  while (index < lines.length - 1) {
    if (isPipeTableRow(lines[index]) && isPipeSeparatorRow(lines[index + 1])) {
      let endLine = index + 2
      while (endLine < lines.length && isPipeTableRow(lines[endLine])) endLine += 1
      const last = endLine - 1
      regions.push({
        start: lineOffsets[index],
        end: lineOffsets[last] + lines[last].length,
      })
      index = endLine
    } else {
      index += 1
    }
  }
  return regions
}

export function findTableRegions(source: string): TableRegion[] {
  const htmlRegions = findHtmlTableRegions(source)
  const markdownRegions = findMarkdownTableRegions(source)
  const combined = [...htmlRegions, ...markdownRegions].sort((a, b) => a.start - b.start)
  const regions: TableRegion[] = []
  for (const region of combined) {
    if (regions.some((existing) => region.start < existing.end && region.end > existing.start)) {
      continue
    }
    regions.push(region)
  }
  return regions
}

/**
 * Non-table "shell" of the document — used to detect whether a source change
 * only touched table interiors (so the formatted preview DOM must not be rebuilt).
 */
export function stripTableRegions(source: string): string {
  const regions = findTableRegions(source)
  if (regions.length === 0) return source
  let result = ''
  let cursor = 0
  for (let i = 0; i < regions.length; i += 1) {
    result += source.slice(cursor, regions[i].start)
    result += `\u0000TABLE${i}\u0000`
    cursor = regions[i].end
  }
  result += source.slice(cursor)
  return result
}

/** Collapse insignificant whitespace so multi-line and compact HTML tables compare equal. */
export function normalizeTableHtmlForCompare(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .trim()
    .toLowerCase()
}

/**
 * Remove every detected table region from source (HTML or pipe tables).
 * Body text before/between/after is kept; surrounding newlines are preserved.
 */
export function removeAllTablesFromSource(source: string): string {
  const regions = findTableRegions(source)
  if (regions.length === 0) return source
  let next = source
  for (let index = regions.length - 1; index >= 0; index -= 1) {
    const region = regions[index]
    next = next.slice(0, region.start) + next.slice(region.end)
  }
  return next
}

/**
 * Formatted view only makes table cells contentEditable. With zero tables the
 * preview is a read-only surface — recover to syntax (textarea) so the user
 * can type again after deleting all tables.
 */
export function shouldRecoverSyntaxEditMode(
  source: string,
  markdownView: 'formatted' | 'syntax',
): boolean {
  if (markdownView !== 'formatted') return false
  return findTableRegions(source).length === 0
}

/**
 * Whether the formatted preview can keep its existing table DOM (caret-safe).
 * Returns false when shell changed, table count differs, source is pipe tables,
 * or cell text in source differs from DOM serializations (e.g. undo/redo).
 */
export function shouldSkipPreviewTableRebuild(
  source: string,
  domTableHtmls: string[],
  previousShell: string | null,
): boolean {
  if (previousShell === null) return false
  if (stripTableRegions(source) !== previousShell) return false
  if (domTableHtmls.length === 0) return false

  const regions = findTableRegions(source)
  if (regions.length !== domTableHtmls.length) return false

  for (let i = 0; i < regions.length; i += 1) {
    const slice = source.slice(regions[i].start, regions[i].end)
    // Pipe / non-HTML tables cannot be compared to DOM HTML — rebuild.
    if (!/<table\b/i.test(slice)) return false
    if (
      normalizeTableHtmlForCompare(slice)
      !== normalizeTableHtmlForCompare(domTableHtmls[i] ?? '')
    ) {
      return false
    }
  }
  return true
}

/**
 * Replace each table region in `source` with the corresponding HTML string.
 * Only table spans change; text before/between/after tables is kept byte-for-byte
 * (including every `\n`). When a multi-line table is replaced by a compact one-line
 * table, the character immediately after the original region is preserved as-is,
 * and if body text would otherwise glue onto `</table>`, a boundary `\n` is inserted.
 */
export function replaceTablesInSource(source: string, tableHtmls: string[]): string {
  const regions = findTableRegions(source)
  if (regions.length === 0 || tableHtmls.length === 0) return source

  const count = Math.min(regions.length, tableHtmls.length)
  let next = source

  for (let index = count - 1; index >= 0; index -= 1) {
    const region = regions[index]
    let html = tableHtmls[index] ?? ''
    // Never let surrounding blank lines be absorbed into the table token itself.
    html = html.replace(/^\n+/, '').replace(/\n+$/, '')

    const before = next.slice(0, region.start)
    const after = next.slice(region.end)

    // If body text follows immediately (no newline) and would glue onto </table>,
    // insert a boundary newline so lines stay Notepad-like.
    let insertion = html
    if (after.length > 0 && !after.startsWith('\n') && !after.startsWith('\r')) {
      insertion = `${html}\n`
    }

    // If there was a newline right after the original multi-line table block, keep it
    // (already in `after`). Do not strip leading newlines from `after`.
    next = before + insertion + after
  }

  return next
}

/** Build a real HTML table for insert (leading/trailing blank lines for block separation). */
export function buildHtmlTable(
  rows: number,
  columns: number,
  columnLabel: (number: number) => string = (number) => `Column ${number}`,
  cellContent = 'Content',
): string {
  const safeRows = Math.max(1, Math.min(8, Math.floor(rows)))
  const safeColumns = Math.max(1, Math.min(10, Math.floor(columns)))
  const header = Array.from(
    { length: safeColumns },
    (_, index) => `<th>${escapeHtmlText(columnLabel(index + 1))}</th>`,
  ).join('')
  const body = Array.from({ length: safeRows }, () => {
    const cells = Array.from(
      { length: safeColumns },
      () => `<td>${escapeHtmlText(cellContent)}</td>`,
    ).join('')
    return `<tr>${cells}</tr>`
  }).join('')
  return [
    '',
    '<table class="notepad-md-table">',
    `<thead><tr>${header}</tr></thead>`,
    `<tbody>${body}</tbody>`,
    '</table>',
    '',
  ].join('\n')
}

/**
 * Marked leaves loose text after raw HTML tables unwrapped; browsers then collapse
 * those newlines. Convert that tail into paragraphs with <br> so 已编排格式 keeps
 * separate lines like 记事本.
 */
export function preserveBodyNewlinesInHtml(html: string): string {
  // Soft-break newlines already inside block tags
  let result = html.replace(
    /<(p|li|h[1-6]|td|th|blockquote)(\b[^>]*)>([\s\S]*?)<\/\1>/gi,
    (full, tag: string, attrs: string, inner: string) => {
      if (inner.includes('<') || !inner.includes('\n')) return full
      return `<${tag}${attrs}>${inner.replace(/\n/g, '<br>')}</${tag}>`
    },
  )

  // Loose text immediately after </table> (marked does not wrap it in <p>)
  result = result.replace(/<\/table>(\n*)([^<]+)/gi, (full, nl: string, text: string) => {
    if (!text.trim()) return full
    const paragraphs = text.split(/\n{2,}/).map((para) => {
      const trimmedEnd = para.replace(/\n+$/g, '')
      if (!trimmedEnd.trim()) return ''
      return `<p>${trimmedEnd.replace(/\n/g, '<br>')}</p>`
    })
    return `</table>${nl}${paragraphs.join('')}`
  })

  return result
}
