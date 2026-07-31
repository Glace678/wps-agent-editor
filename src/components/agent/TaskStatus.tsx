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
    <div className="border-t px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {isRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        )}
        <span>{status || t('taskStatus.processing')}</span>
      </div>
    </div>
  )
}
