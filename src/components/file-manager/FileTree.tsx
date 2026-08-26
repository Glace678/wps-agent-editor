import { ChevronRight } from 'lucide-react'
import { FileHoverCard } from './FileHoverCard'
import { FileIcon } from './FileIcon'
import { FILE_LIST_ROW_HOVER_BORDER } from './file-list-row-styles'
import { useTranslation } from '@/lib/i18n/runtime'
import { cn } from '@/lib/utils'
import type { FileEntry } from '@/types/file'
import { createAgentAttachment, writeAgentAttachmentDragData } from '@/lib/agent-attachments'

interface FileTreeProps {
  entries: FileEntry[]
  onOpenFile: (path: string) => void
  onOpenDir: (path: string) => void
  currentDir: string
}

/** 浏览列表悬停：只显示完整名称 */
function NameOnlyTip({ name }: { name: string }) {
  return (
    <div
      style={{
        fontWeight: 600,
        fontSize: 14.5,
        lineHeight: 1.4,
        color: 'hsl(var(--card-foreground))',
        wordBreak: 'break-all',
      }}
    >
      {name}
    </div>
  )
}

export function FileTree({ entries, onOpenFile, onOpenDir }: FileTreeProps) {
  const { t } = useTranslation()
  const dirs = entries.filter((e) => e.isDirectory)
  const files = entries.filter((e) => !e.isDirectory)

  return (
    <div className="space-y-0.5 px-1 py-1">
      {dirs.map((entry) => (
        <FileHoverCard
          key={entry.path}
          openDelay={250}
          content={<NameOnlyTip name={entry.name} />}
        >
          <button
            type="button"
            className={cn(
              'flex w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left text-sm transition-colors',
              FILE_LIST_ROW_HOVER_BORDER,
            )}
            onClick={() => onOpenDir(entry.path)}
          >
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            <FileIcon filePath={entry.path} isDirectory />
            <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
          </button>
        </FileHoverCard>
      ))}

      {files.map((entry) => (
        <FileHoverCard
          key={entry.path}
          openDelay={250}
          content={<NameOnlyTip name={entry.name} />}
        >
          <button
            type="button"
            draggable
            data-agent-attachment-path={entry.path}
            className={cn(
              'flex w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1.5 pl-5 text-left text-sm transition-colors',
              FILE_LIST_ROW_HOVER_BORDER,
            )}
            onClick={() => onOpenFile(entry.path)}
            onDragStart={(event) => {
              writeAgentAttachmentDragData(
                event.dataTransfer,
                [createAgentAttachment(entry.path, 'browse')],
              )
            }}
          >
            <FileIcon filePath={entry.path} />
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
          </button>
        </FileHoverCard>
      ))}

      {entries.length === 0 && (
        <p className="px-2 py-4 text-center text-sm text-muted-foreground">{t('appShell.emptyFolder')}</p>
      )}
    </div>
  )
}
