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
  table?.querySelectorAll<HTMLTableRowElement>('tr[data-notepad-row-selected="true"]')
    .forEach((row) => row.removeAttribute('data-notepad-row-selected'))
}

export function markTableRowRangeSelected(
  table: HTMLTableElement,
  start: HTMLTableRowElement | null,
  end: HTMLTableRowElement | null,
): void {
  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'))
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
  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'))
  return rows.find((row) => {
    const rect = row.getBoundingClientRect()
    return clientY >= rect.top && clientY <= rect.bottom
  }) ?? null
}

export function insertTableRowAfter(row: HTMLTableRowElement): HTMLTableRowElement | null {
  const table = row.closest('table') as HTMLTableElement | null
  if (!table) return null

  const columnCount = Math.max(
    1,
    Array.from(row.cells).reduce((count, cell) => count + Math.max(1, cell.colSpan), 0),
  )
  const parentSection = row.parentElement as HTMLTableSectionElement | null
  const body = table.tBodies[0] ?? table.createTBody()
  const inserted = parentSection?.tagName === 'THEAD'
    ? body.insertRow(0)
    : parentSection instanceof HTMLTableSectionElement
      ? parentSection.insertRow(row.sectionRowIndex + 1)
      : table.insertRow(row.rowIndex + 1)
  for (let index = 0; index < columnCount; index += 1) {
    const cell = inserted.insertCell()
    cell.append(document.createElement('br'))
  }
  return inserted
}
