import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/runtime'

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void
  className?: string
}

export function ResizeHandle({ onMouseDown, className }: ResizeHandleProps) {
  const { t } = useTranslation()
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('appShell.resizePanels')}
      onMouseDown={onMouseDown}
      className={cn(
        'group relative z-10 shrink-0 cursor-col-resize select-none',
        'w-1.5 bg-border/60 transition-colors hover:bg-primary/40',
        'before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-[""]',
        className,
      )}
    />
  )
}
