/**
 * Shared hover outline for file/folder rows on 最近 and 浏览 lists.
 * Default border is transparent so layout does not shift; hover draws a full
 * rectangular box — black in light mode, white in dark mode (.dark).
 */
export const FILE_LIST_ROW_HOVER_BORDER =
  'border border-transparent hover:border-border/80 hover:bg-accent/60'
