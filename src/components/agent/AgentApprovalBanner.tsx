import { useState } from 'react'
import { ChevronDown, ChevronUp, FilePenLine, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n/runtime'
import type { AgentApprovalRequest } from '@/types/document'

interface AgentApprovalBannerProps {
  approval: AgentApprovalRequest | null
  status: 'idle' | 'submitting' | 'expired'
  onContinue: (approval: AgentApprovalRequest) => void
  onEnd: (approval: AgentApprovalRequest) => void
}

export function AgentApprovalBanner({ approval, status, onContinue, onEnd }: AgentApprovalBannerProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  if (!approval && status !== 'expired') return null
  if (!approval) {
    return (
      <div className="border-y border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/45 dark:text-amber-100">
        {t('wordAgent.approvalExpired')}
      </div>
    )
  }

  const submitting = status === 'submitting'
  return (
    <section
      className="border-y border-blue-200 bg-blue-50/80 px-3 py-2.5 dark:border-blue-900 dark:bg-blue-950/35"
      aria-label={t('wordAgent.approvalTitle')}
      data-testid="word-agent-approval"
    >
      <div className="flex min-w-0 items-start gap-2">
        <FilePenLine className="mt-0.5 h-4 w-4 shrink-0 text-blue-700 dark:text-blue-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            {t('wordAgent.approvalTitle')}
          </div>
          <p className="mt-0.5 text-[11px] leading-4 text-slate-600 dark:text-slate-300">
            {t('wordAgent.approvalDescription', {
              agent: approval.agentName || t('wordAgent.agent'),
              count: approval.remainingSteps,
            })}
          </p>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 max-h-28 overflow-y-auto border-l-2 border-blue-300 pl-2 text-[10px] leading-4 text-slate-600 dark:border-blue-700 dark:text-slate-300">
          {(approval.changes ?? []).map((change) => (
            <div key={change.id} className="flex min-w-0 gap-2">
              <span className="w-4 shrink-0 text-right tabular-nums">
                {(approval.changes?.indexOf(change) ?? 0) + 1}
              </span>
              <span className="truncate">{change.label || change.operationId}</span>
            </div>
          ))}
          {!approval.changes?.length && approval.summary && <div>{approval.summary}</div>}
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="col-span-2 h-7 justify-start gap-1 px-2 text-[11px]"
          onClick={() => setExpanded((value) => !value)}
          disabled={submitting}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {t('wordAgent.viewChanges')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-auto min-h-7 whitespace-normal px-2 py-1 text-[11px] leading-3"
          onClick={() => onEnd(approval)}
          disabled={submitting}
          data-testid="word-agent-approval-end"
        >
          {t('wordAgent.endTask')}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-auto min-h-7 gap-1 whitespace-normal px-2 py-1 text-[11px] leading-3"
          onClick={() => onContinue(approval)}
          disabled={submitting}
          data-testid="word-agent-approval-continue"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {t('wordAgent.continueEditing')}
        </Button>
      </div>
    </section>
  )
}
