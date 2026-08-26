/**
 * Pure layout helpers for the notepad command bar (no React / DOM).
 * Kept separate so unit tests can import without loading the full command-bar UI.
 */

/**
 * Map command-bar client width → how many format icons to show.
 * Returns null when width is not usable (caller should keep the previous tier).
 * That protects against detached ResizeObserver targets reporting 0 on language remount.
 */
export function formattingTierFromWidth(width: number): number | null {
  if (!(width > 0)) return null
  return width >= 708 ? 6
    : width >= 608 ? 5
      : width >= 558 ? 4
        : width >= 508 ? 3
          : width >= 458 ? 2
            : width >= 408 ? 1
              : 0
}
