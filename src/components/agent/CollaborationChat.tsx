import { useEffect, useMemo, useRef } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Layers,
  Loader2,
  Network,
  Square,
  Users,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AnimatedEllipsis } from '@/components/ui/animated-ellipsis'
import { ProviderLogo } from './ProviderLogo'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/runtime'
import {
  buildCollaborationTranscript,
  isSystemLineKey,
  type SystemTranscriptItem,
} from '@/lib/collaboration-transcript'
import { modelDisplayName, type AgentIdentity } from '@/lib/agent-model'
import type {
  AgentCollaborationEvent,
  AgentConfig,
  CollaborationMode,
} from '@/types/agent'
import type { ProviderDefinition } from '@/types/provider'

interface CollaborationChatProps {
  events: AgentCollaborationEvent[]
  agents: AgentConfig[]
  providers: ProviderDefinition[]
  mode: CollaborationMode
  isRunning: boolean
  isStopping: boolean
  onStop: () => void
  onClose: () => void
}

function AgentAvatar({
  identity,
  providers,
  size = 'h-8 w-8',
}: {
  identity: AgentIdentity
  providers: ProviderDefinition[]
  size?: string
}) {
  // Custom providers carry `custom-<uuid>` ids: brand aliases (e.g. 豆包)
  // match against the provider's configured display name.
  const providerName = providers.find((item) => item.id === identity.providerId)?.name
    ?? identity.agentName
  return (
    <ProviderLogo
      providerId={identity.providerId ?? ''}
      providerName={providerName}
      className={cn('rounded-lg border border-border/30', size)}
      decorative
    />
  )
}

function SpeakerHeader({
  identity,
  providers,
}: {
  identity: AgentIdentity
  providers: ProviderDefinition[]
}) {
  const modelLabel = modelDisplayName(identity.providerId, identity.model, providers)
  return (
    <div className="mb-0.5 flex max-w-full items-baseline gap-1.5 px-0.5">
      <span className="shrink-0 text-[11px] font-medium text-foreground">
        {identity.agentName || identity.agentId}
      </span>
      {modelLabel && (
        <span
          className="truncate text-[10px] text-muted-foreground/80"
          title={`${identity.providerId ?? ''} / ${identity.model ?? ''}`}
        >
          {modelLabel}
        </span>
      )}
    </div>
  )
}

export function CollaborationChat({
  events,
  agents,
  providers,
  mode,
  isRunning,
  isStopping,
  onStop,
  onClose,
}: CollaborationChatProps) {
  const { t } = useTranslation()
  const bottomRef = useRef<HTMLDivElement>(null)

  const items = useMemo(
    () => buildCollaborationTranscript(events, agents, mode),
    [events, agents, mode],
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [items, isRunning])

  const systemText = (item: SystemTranscriptItem): string => {
    const p = item.params
    // Narrow at runtime instead of asserting: an unknown key renders nothing.
    if (!isSystemLineKey(item.messageKey)) return ''
    switch (item.messageKey) {
      case 'directorReady':
        return t('agentUi.lineDirectorReady', { agent: p.agent })
      case 'synthesizerReady':
        return t('agentUi.lineSynthesizerReady', { agent: p.agent })
      case 'taskAssigned':
        return t('agentUi.lineTaskAssigned', { agent: p.agent })
      case 'handoff':
        return t('agentUi.lineHandoff', { from: p.from, to: p.to })
      case 'toolInvoked':
        return t('agentUi.lineToolInvoked', { agent: p.agent, tool: p.tool })
      case 'documentApplied':
        return t('agentUi.lineDocumentApplied', { agent: p.agent, action: p.action })
      case 'documentRejected':
        return t('agentUi.lineDocumentRejected', { agent: p.agent, action: p.action })
      case 'runComplete':
        return t('agentUi.lineRunComplete')
      case 'runCancelled':
        return t('agentUi.lineRunCancelled')
      case 'conflict':
        return p.detail || t('agentUi.lineConflict')
      case 'error':
        return t('agentUi.lineError', { error: p.error })
      default:
        return ''
    }
  }

  return (
    <TooltipProvider delayDuration={350}>
      <section
        className="flex h-full min-h-0 flex-col bg-background/30"
        aria-label={t('agentUi.collaborationChat')}
        data-testid="collaboration-chat"
      >
        {/* Header */}
        <header className="flex h-9 shrink-0 items-center justify-between gap-1 border-b border-border/50 bg-background/50 px-2.5 backdrop-blur-xs">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Users className="h-3 w-3" />
            </span>
            <span className="truncate text-xs font-semibold tracking-wide text-foreground">
              {t('agentUi.collaborationChat')}
            </span>
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {mode === 'directed' ? <Network className="h-2.5 w-2.5" /> : <Layers className="h-2.5 w-2.5" />}
              {mode === 'directed' ? t('agentUi.modeDirected') : t('agentUi.modeParallel')}
            </span>
            {isRunning && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {isRunning && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                    onClick={onStop}
                    disabled={isStopping}
                    aria-label={t('agentUi.stopCollaboration')}
                    data-testid="collaboration-stop"
                  >
                    <Square className="h-3 w-3 fill-current" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="rounded-xl border bg-popover px-3 py-1 text-[11px] font-medium text-popover-foreground shadow-md">
                  {t('agentUi.stopCollaboration')}
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                  onClick={onClose}
                  disabled={isRunning}
                  aria-label={t('agentUi.backToChat')}
                  data-testid="collaboration-close"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="rounded-xl border bg-popover px-3 py-1 text-[11px] font-medium text-popover-foreground shadow-md">
                {t('agentUi.backToChat')}
              </TooltipContent>
            </Tooltip>
          </div>
        </header>

        {/* WeChat-style transcript */}
        <ScrollArea className="min-h-0 flex-1" data-testid="collaboration-transcript">
          <div className="space-y-3 px-3 py-3">
            {items.map((item) => {
              if (item.kind === 'task') {
                return (
                  <div key={item.key} className="flex justify-end" data-testid="collaboration-task">
                    <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-xs bg-primary px-3 py-2 text-xs leading-relaxed text-primary-foreground shadow-xs">
                      {item.text}
                    </div>
                  </div>
                )
              }

              if (item.kind === 'system') {
                const tone = item.tone
                return (
                  <div key={item.key} className="flex justify-center">
                    <span
                      className={cn(
                        'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-center text-[10px] leading-relaxed',
                        tone === 'success' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                        tone === 'warning' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                        tone === 'error' && 'bg-destructive/10 text-destructive',
                        tone === 'info' && 'bg-muted text-muted-foreground',
                      )}
                    >
                      {tone === 'success' && <CheckCircle2 className="h-2.5 w-2.5 shrink-0" />}
                      {tone === 'warning' && <AlertTriangle className="h-2.5 w-2.5 shrink-0" />}
                      {tone === 'error' && <CircleAlert className="h-2.5 w-2.5 shrink-0" />}
                      <span className="break-words">{systemText(item)}</span>
                    </span>
                  </div>
                )
              }

              if (item.kind === 'delegation') {
                return (
                  <div key={item.key} className="flex items-start gap-2" data-testid="collaboration-delegation">
                    <span className="w-8 shrink-0" />
                    <div className="min-w-0 flex-1 rounded-xl border border-blue-500/25 bg-blue-500/5 px-2.5 py-2">
                      <div className="flex min-w-0 items-center gap-1.5 text-[10px]">
                        <AgentAvatar identity={item.from} providers={providers} size="h-4 w-4 rounded" />
                        <span className="max-w-[6rem] truncate font-medium text-foreground">
                          {item.from.agentName || item.from.agentId}
                        </span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-blue-500" />
                        <AgentAvatar identity={item.to} providers={providers} size="h-4 w-4 rounded" />
                        <span className="max-w-[6rem] truncate font-medium text-foreground">
                          {item.to.agentName || item.to.agentId}
                        </span>
                        <span className="ml-auto shrink-0 rounded-full bg-blue-500/10 px-1.5 py-0.5 font-medium text-blue-600 dark:text-blue-400">
                          {t('agentUi.delegationTag')}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground/90">
                        {item.text}
                      </p>
                    </div>
                  </div>
                )
              }

              if (item.kind === 'typing') {
                return (
                  <div key={item.key} className="flex items-start gap-2" data-testid="collaboration-typing">
                    {item.clusterHead
                      ? <AgentAvatar identity={item.agent} providers={providers} />
                      : <span className="w-8 shrink-0" />}
                    <div className="min-w-0">
                      {item.clusterHead && <SpeakerHeader identity={item.agent} providers={providers} />}
                      <div className="inline-flex items-center rounded-2xl rounded-tl-xs border border-border/80 bg-card px-3 py-2 text-xs shadow-xs">
                        <span className="inline-flex items-center text-muted-foreground">
                          <AnimatedEllipsis />
                        </span>
                      </div>
                    </div>
                  </div>
                )
              }

              // speech
              return (
                <div key={item.key} className="flex items-start gap-2" data-testid="collaboration-speech">
                  {item.clusterHead
                    ? <AgentAvatar identity={item.agent} providers={providers} />
                    : <span className="w-8 shrink-0" />}
                  <div className="min-w-0 max-w-[calc(100%-2.5rem)]">
                    {item.clusterHead && <SpeakerHeader identity={item.agent} providers={providers} />}
                    <div className="inline-block rounded-2xl rounded-tl-xs border border-border/80 bg-card px-3 py-2 text-xs leading-relaxed text-card-foreground shadow-xs">
                      <p className="whitespace-pre-wrap break-words">{item.text}</p>
                      {item.streaming && (
                        <AnimatedEllipsis className="text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </section>
    </TooltipProvider>
  )
}
