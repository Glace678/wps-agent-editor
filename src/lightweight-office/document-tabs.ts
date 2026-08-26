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

/**
 * Calculate horizontal translation for tab displacement animation during drag-and-drop reordering.
 * When dragging a tab across others, unaffected tabs remain at 0, while tabs between from and to
 * smoothly shift left or right to open a slot for the incoming tab.
 */
export function getTabTransformX<T extends DocumentTabBase>(
  tabId: string,
  tabIndex: number,
  draggingId: string | null,
  dropTargetId: string | null,
  tabs: readonly T[],
  tabWidths: Record<string, number>,
  gap = 4,
): number {
  if (!draggingId || !dropTargetId || draggingId === dropTargetId) return 0
  const fromIndex = tabs.findIndex((t) => t.id === draggingId)
  const targetIndex = tabs.findIndex((t) => t.id === dropTargetId)
  if (fromIndex === -1 || targetIndex === -1) return 0

  // The dragged tab itself doesn't translate horizontally in the track because the user is holding it
  if (tabId === draggingId) return 0

  const draggedWidth = (tabWidths[draggingId] || 120) + gap

  if (fromIndex < targetIndex) {
    // Dragging forward (to the right): tabs between fromIndex and targetIndex shift left
    if (tabIndex > fromIndex && tabIndex <= targetIndex) {
      return -draggedWidth
    }
  } else if (fromIndex > targetIndex) {
    // Dragging backward (to the left): tabs between targetIndex and fromIndex shift right
    if (tabIndex >= targetIndex && tabIndex < fromIndex) {
      return draggedWidth
    }
  }

  return 0
}

