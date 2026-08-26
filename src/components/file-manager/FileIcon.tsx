import { cn } from '@/lib/utils'
import { resolveFileIconSrc, getExtensionFromPath } from '@/lib/file-icons'
import { CodeOfficialIcon, hasCodeOfficialIcon } from '@/lib/code-official-icons'

interface FileIconProps {
  filePath: string
  isDirectory?: boolean
  className?: string
  size?: number
}

const DOCUMENT_EXTENSIONS = new Set([
  '.docx',
  '.doc',
  '.xlsx',
  '.xls',
  '.csv',
  '.pptx',
  '.ppt',
  '.pdf',
  '.odt',
  '.ods',
  '.txt',
  '.md',
])

export function FileIcon({ filePath, isDirectory, className, size = 16 }: FileIconProps) {
  if (isDirectory) {
    return (
      <img
        src={resolveFileIconSrc(filePath, true)}
        alt=""
        className={cn('h-4 w-4 shrink-0 object-contain', className)}
        draggable={false}
      />
    )
  }

  const ext = getExtensionFromPath(filePath)
  if (!DOCUMENT_EXTENSIONS.has(ext) && hasCodeOfficialIcon(filePath)) {
    return (
      <CodeOfficialIcon
        filePath={filePath}
        size={size}
        className={cn('h-4 w-4 shrink-0', className)}
      />
    )
  }

  const src = resolveFileIconSrc(filePath, false)

  return (
    <img
      src={src}
      alt=""
      className={cn('h-4 w-4 shrink-0 object-contain', className)}
      draggable={false}
    />
  )
}