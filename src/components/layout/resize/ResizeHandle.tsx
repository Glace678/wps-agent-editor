import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/runtime'

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void
  onDoubleClick?: (e: React.MouseEvent) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  /** 当前面板宽度，用于 separator 的 ARIA 数值属性。 */
  value?: number
  min?: number
  max?: number
  className?: string
}

export function ResizeHandle({
  onMouseDown,
  onDoubleClick,
  onKeyDown,
  value,
  min,
  max,
  className,
}: ResizeHandleProps) {
  const { t } = useTranslation()
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('appShell.resizePanels')}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative z-10 shrink-0 cursor-col-resize select-none outline-none focus-visible:ring-1 focus-visible:ring-primary',
        'w-1.5 bg-border/60 transition-colors hover:bg-primary/40',
        'before:absolute before:inset-y-0 before:left-0 before:-right-1 before:content-[""]',
        className,
      )}
    />
  )
}
