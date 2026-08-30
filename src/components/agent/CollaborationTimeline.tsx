import { useEffect, useRef } from 'react'
import {
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  FileEdit,
  MessageSquare,
  MousePointer2,
  Users,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/runtime'
import type { AgentCollaborationEvent } from '@/types/agent'

interface CollaborationTimelineProps {
  events: AgentCollaborationEvent[]
  collapsed: boolean
  onToggle: () => void
}

function preview(value: string | undefined): string {
  if (!value) return ''
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > 160 ? `${compact.slice(0, 160)}...` : compact
}

export function CollaborationTimeline({
  events,
  collapsed,
  onToggle,
}: CollaborationTimelineProps) {
  const { t } = useTranslation()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' })
  }, [events])

  if (events.length === 0) return null

  return (
    <section
      className={cn(
        'flex min-h-0 shrink-0 flex-col border-t border-border/50 bg-muted/30 transition-all',
      )}
      aria-label={t('agentUi.collaborate')}
      data-testid="agent-collaboration-timeline"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Users className="h-3 w-3" />
          </span>
          <span className="truncate text-[11px] font-semibold tracking-wide text-foreground">
            {t('agentUi.collaborate')}
          </span>
          <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-medium tabular-nums text-muted-foreground">
            {events.length}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-controls="agent-collaboration-content"
          aria-label={`${collapsed ? t('agentUi.expand') : t('agentUi.collapse')} ${t('agentUi.collaborate')}`}
          data-testid="agent-collaboration-collapse"
        >
          <span>{collapsed ? t('agentUi.expand') : t('agentUi.collapse')}</span>
          {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {!collapsed && (
        <ScrollArea id="agent-collaboration-content" className="max-h-36 px-2.5 pb-2">
          <div className="space-y-1.5">
            {events.map((event, index) => {
              const agentLabel = event.agentName || event.fromAgentName || ''
              const isError = event.type === 'error'
              const isHandoff = event.type === 'handoff'
              const isQuestion = event.type === 'agent-question'
              const isAnswer = event.type === 'agent-answer'
              const isAssignment =
                event.type === 'task-created' ||
                event.type === 'task-assigned' ||
                event.type === 'agent-spawned'
              const isDocumentEvent = event.type.startsWith('document-') || event.type === 'conflict'
              const isCancelled = event.type === 'run-cancelled'
              const title =
                event.type === 'run-start'
                  ? t('agentUi.collaborating')
                  : isAssignment
                  ? `${agentLabel} / ${t('agentUi.processing')}`
                  : event.type === 'agent-start'
                  ? t('agentUi.thinking', { agent: agentLabel })
                  : isQuestion
                  ? `${agentLabel} -> ${event.toAgentName || ''}`
                  : isAnswer
                  ? `${agentLabel} -> ${event.toAgentName || ''}`
                  : event.type === 'agent-message' || event.type === 'agent-stream'
                  ? agentLabel
                  : event.type === 'agent-tool'
                  ? `${agentLabel} / ${event.tool || 'tool'}`
                  : isHandoff
                  ? `${event.fromAgentName || ''} -> ${event.toAgentName || ''}`
                  : event.type === 'agent-complete'
                  ? `${agentLabel} / ${t('agentUi.completed')}`
                  : event.type === 'run-complete'
                  ? t('agentUi.completed')
                  : isCancelled
                  ? t('codeEditor.stopDebug')
                  : isDocumentEvent
                  ? `${agentLabel} / ${event.action || event.type.replace('document-', '')}`
                  : t('agentUi.failed')

              const detail = isError
                ? event.error
                : event.type === 'agent-complete' || event.type === 'run-complete' || isCancelled
                ? ''
                : isHandoff
                ? preview(event.content)
                : isAssignment || isQuestion || isAnswer
                ? preview(event.content)
                : event.type === 'agent-tool'
                ? preview(JSON.stringify(event.result))
                : isDocumentEvent
                ? preview(event.result ? JSON.stringify(event.result) : event.message)
                : preview(event.content)

              const isConversation = isQuestion || isAnswer || event.type === 'agent-message' || event.type === 'agent-stream'
              if (isConversation) {
                const alignRight = isQuestion
                return (
                  <div
                    key={`${event.runId}-${event.timestamp}-${index}`}
                    className={cn('flex items-start gap-1.5', alignRight && 'flex-row-reverse')}
                  >
                    <span
                      className={cn(
                        'mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                        alignRight
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
                      )}
                      aria-hidden="true"
                    >
                      <Bot className="h-3 w-3" />
                    </span>
                    <div
                      className={cn(
                        'flex min-w-0 max-w-[85%] flex-col',
                        alignRight ? 'items-end' : 'items-start',
                      )}
                    >
                      <span className="mb-0.5 max-w-full truncate px-0.5 text-[9px] text-muted-foreground">
                        {title}
                      </span>
                      <div
                        className={cn(
                          'max-w-full rounded-xl px-2.5 py-1.5 text-[11px] leading-tight shadow-xs',
                          alignRight
                            ? 'bg-primary text-primary-foreground'
                            : 'border border-border/70 bg-card text-foreground',
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{detail || preview(event.content)}</p>
                      </div>
                    </div>
                  </div>
                )
              }

              return (
                <div
                  key={`${event.runId}-${event.timestamp}-${index}`}
                  className={cn(
                    'rounded-lg border px-2 py-1 text-[11px] transition-colors',
                    isError
                      ? 'border-destructive/30 bg-destructive/5 text-destructive'
                      : 'border-border/60 bg-card/80 text-foreground',
                  )}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    {isError ? (
                      <CircleAlert className="h-3 w-3 shrink-0 text-destructive" />
                    ) : isHandoff ? (
                      <ArrowRight className="h-3 w-3 shrink-0 text-blue-500" />
                    ) : isDocumentEvent ? (
                      <FileEdit className="h-3 w-3 shrink-0 text-fuchsia-500" />
                    ) : event.type === 'agent-tool' ? (
                      <Wrench className="h-3 w-3 shrink-0 text-amber-500" />
                    ) : isQuestion || isAnswer ? (
                      <MessageSquare className="h-3 w-3 shrink-0 text-cyan-500" />
                    ) : event.type === 'agent-message' || event.type === 'agent-stream' ? (
                      <MessageSquare className="h-3 w-3 shrink-0 text-emerald-500" />
                    ) : event.type === 'agent-complete' || event.type === 'run-complete' ? (
                      <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                    ) : isCancelled ? (
                      <MousePointer2 className="h-3 w-3 shrink-0 text-amber-500" />
                    ) : (
                      <Bot className="h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium text-[11px]">{title}</span>
                  </div>
                  {detail && (
                    <p className="mt-0.5 break-words text-[10px] text-muted-foreground">{detail}</p>
                  )}
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      )}
    </section>
  )
}
