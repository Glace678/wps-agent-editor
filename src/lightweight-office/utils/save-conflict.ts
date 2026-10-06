import type { FileStatInfo } from '@/types/generated/FileStatInfo'

/** The subset of file stat used to detect an external modification. */
export type FileBaselineStat = Pick<FileStatInfo, 'size' | 'modifiedAt'>

export type SaveConflictDecision = 'proceed' | 'reload' | 'save-as'

/**
 * Compare the file on disk against the stat captured when it was opened.
 *
 * When the size or modified time differs, another program (or another window)
 * has changed the file since this editor loaded it; overwriting it would
 * silently destroy those changes. The caller asks the user:
 * - confirm  → discard local edits and reload the external version;
 * - cancel   → keep local edits, forcing a Save As instead.
 *
 * Mirrors the policy PdfViewer already implements (wps_04 F5).
 */
export async function checkSaveConflict(args: {
  filePath: string
  baseline: FileBaselineStat | null | undefined
  stat: (path: string) => Promise<FileStatInfo>
  confirm: (message: string) => boolean
  conflictMessage: string
}): Promise<SaveConflictDecision> {
  if (!args.baseline) return 'proceed'
  const latest = await args.stat(args.filePath)
  if (
    latest.exists
    && latest.size === args.baseline.size
    && latest.modifiedAt === args.baseline.modifiedAt
  ) {
    return 'proceed'
  }
  return args.confirm(args.conflictMessage) ? 'reload' : 'save-as'
}
