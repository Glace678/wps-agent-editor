/**
 * Pure helpers for multi-document tab order and navigation.
 */

export interface DocumentTabBase {
  id: string
}

/** Move the tab with fromId so it sits at the index of toId (before/after by target index). */
export function reorderTabsById<T extends DocumentTabBase>(
  items: readonly T[],
  fromId: string,
  toId: string,
): T[] {
  if (fromId === toId) return [...items]
  const from = items.findIndex((item) => item.id === fromId)
  const to = items.findIndex((item) => item.id === toId)
  if (from < 0 || to < 0) return [...items]
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** Circular next/previous index for tab switching (Ctrl+Tab family). */
export function tabIndexByOffset(
  length: number,
  currentIndex: number,
  offset: 1 | -1,
): number {
  if (length <= 0) return -1
  if (currentIndex < 0) return 0
  return (currentIndex + offset + length) % length
}
