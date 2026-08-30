import { cn } from '@/lib/utils'
import { resolveFileIconSrc } from '@/lib/file-icons'

interface FileIconProps {
  filePath: string
  isDirectory?: boolean
  className?: string
}

export function FileIcon({ filePath, isDirectory, className }: FileIconProps) {
  const src = resolveFileIconSrc(filePath, isDirectory)

  return (
    <img
      src={src}
      alt=""
      className={cn('h-4 w-4 shrink-0 object-contain', className)}
      draggable={false}
    />
  )
}