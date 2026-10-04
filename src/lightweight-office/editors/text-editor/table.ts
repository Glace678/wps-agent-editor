/**
 * Rows that belong directly to this table's own sections, excluding rows inside
 * nested tables, so outer-table selection/cleanup never reaches inner rows.
 */
function getDirectRows(table: HTMLTableElement): HTMLTableRowElement[] {
  const rows: HTMLTableRowElement[] = []
  for (const child of Array.from(table.children)) {
    if (child.tagName !== 'TBODY' && child.tagName !== 'THEAD' && child.tagName !== 'TFOOT') continue
    for (const row of Array.from(child.children)) {
      if (row instanceof HTMLTableRowElement) rows.push(row)
    }
  }
  return rows
}

export function markTableRowInsertTarget(
  previous: HTMLTableRowElement | null,
  next: HTMLTableRowElement | null,
): void {
  if (previous && previous !== next) {
    previous.removeAttribute('data-notepad-row-insert-after')
  }
  if (next) next.setAttribute('data-notepad-row-insert-after', 'true')
}

export function markTableSelected(
  previous: HTMLTableElement | null,
  next: HTMLTableElement | null,
): void {
  if (previous && previous !== next) {
    previous.removeAttribute('data-notepad-table-selected')
    previous.removeAttribute('aria-selected')
  }
  if (next) {
    next.setAttribute('data-notepad-table-selected', 'true')
    next.setAttribute('aria-selected', 'true')
  }
}

export function clearTableRowSelection(table: HTMLTableElement | null): void {
  if (!table) return
  // Only clear selection on rows owned by this table, never nested-table rows.
  for (const row of getDirectRows(table)) {
    row.removeAttribute('data-notepad-row-selected')
  }
}

export function markTableRowRangeSelected(
  table: HTMLTableElement,
  start: HTMLTableRowElement | null,
  end: HTMLTableRowElement | null,
): void {
  const rows = getDirectRows(table)
  const startIndex = start ? rows.indexOf(start) : -1
  const endIndex = end ? rows.indexOf(end) : -1
  if (startIndex < 0 || endIndex < 0) return

  const first = Math.min(startIndex, endIndex)
  const last = Math.max(startIndex, endIndex)
  clearTableRowSelection(table)
  rows.slice(first, last + 1).forEach((row) => {
    row.setAttribute('data-notepad-row-selected', 'true')
  })
  const allRowsSelected = first === 0 && last === rows.length - 1
  markTableSelected(table, allRowsSelected ? table : null)
}

export function tableRowAtPoint(
  table: HTMLTableElement,
  clientY: number,
): HTMLTableRowElement | null {
  const rows = getDirectRows(table)
  return rows.find((row) => {
    const rect = row.getBoundingClientRect()
    return clientY >= rect.top && clientY <= rect.bottom
  }) ?? null
}

export function insertTableRowAfter(row: HTMLTableRowElement): HTMLTableRowElement | null {
  const table = row.closest('table') as HTMLTableElement | null
  if (!table) return null

  const allRows = getDirectRows(table)
  const insertAt = allRows.indexOf(row)

  // Columns in the new row that are already occupied by cells above carrying a
  // rowspan extending into this row; we must not add a cell there.
  const occupied = new Set<number>()
  for (let r = 0; r < insertAt; r += 1) {
    let cursor = 0
    for (const cell of Array.from(allRows[r].cells)) {
      const span = Math.max(1, cell.colSpan)
      if (cell.rowSpan > 1 && r + cell.rowSpan > insertAt) {
        for (let c = 0; c < span; c += 1) occupied.add(cursor + c)
      }
      cursor += span
    }
  }

  // Total grid width implied by the reference row's own column spans.
  let gridWidth = 0
  for (const cell of Array.from(row.cells)) gridWidth += Math.max(1, cell.colSpan)
  const newCellCount = Math.max(1, gridWidth - occupied.size)

  const parentSection = row.parentElement as HTMLTableSectionElement | null
  const body = table.tBodies[0] ?? table.createTBody()
  const inserted = parentSection?.tagName === 'THEAD'
    ? body.insertRow(0)
    : parentSection instanceof HTMLTableSectionElement
      ? parentSection.insertRow(row.sectionRowIndex + 1)
      : table.insertRow(row.rowIndex + 1)
  for (let index = 0; index < newCellCount; index += 1) {
    const cell = inserted.insertCell()
    cell.append(document.createElement('br'))
  }
  return inserted
}
