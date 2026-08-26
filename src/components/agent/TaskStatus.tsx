import { Loader2, CheckCircle2 } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/runtime'

interface TaskStatusProps {
  status: string
  isRunning: boolean
}

export function TaskStatus({ status, isRunning }: TaskStatusProps) {
  const { t } = useTranslation()

  if (!status && !isRunning) return null

  return (
    <div className="border-t border-border/40 bg-muted/20 px-3 py-1.5 transition-colors">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {isRunning ? (
          <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
        ) : (
          <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
        )}
        <span className="truncate font-medium">{status || t('taskStatus.processing')}</span>
      </div>
    </div>
  )
}
