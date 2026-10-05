import { Bot, Database, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/runtime'
import { FileIcon } from '@/components/file-manager/FileIcon'
import type { ChatMessage } from '@/types/agent'

export function AgentMessageList({
  messages,
  agentName,
  agentColor,
}: {
  messages: ChatMessage[]
  agentName: string
  agentColor: string
}) {
  const { t } = useTranslation()
  return (
    <>
      {messages.map((msg, i) => {
        const isUser = msg.role === 'user'
        // Stable React key (review §07-26A): role + streaming correlation id +
        // timestamp make the key stable across streaming frame updates, so an
        // in-place content append does not remount or misattach bubble state.
        // The array index is only a tiebreaker for identical timestamps; the key
        // must never degrade to a bare index for normal messages.
        const messageKey = `${msg.role}:${msg.streamingRunId ?? ''}:${msg.timestamp ?? ''}:${i}`
        return (
          <div
            key={messageKey}
            className={cn(
              'group flex flex-col',
              isUser ? 'items-end' : 'items-start',
            )}
          >
            <div
              className={cn(
                'relative max-w-[90%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed transition-all shadow-xs',
                isUser
                  ? 'rounded-tr-xs bg-primary text-primary-foreground font-normal'
                  : 'rounded-tl-xs border border-border/80 bg-card text-card-foreground',
              )}
            >
              {!isUser && (
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                  <span
                    className="flex h-3.5 w-3.5 items-center justify-center rounded-sm"
                    style={{
                      backgroundColor: `${agentColor}22`,
                      color: agentColor,
                    }}
                  >
                    <Bot className="h-2.5 w-2.5" />
                  </span>
                  <span>{agentName || t('agents.agent')}</span>
                </div>
              )}

              {msg.content && (
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              )}

              {/* Attachments within message */}
              {msg.attachments && msg.attachments.length > 0 && (
                <div className={cn('flex flex-wrap gap-1.5', msg.content && 'mt-2')}>
                  {msg.attachments.map((attachment) => (
                    <span
                      key={attachment.path}
                      className={cn(
                        'flex min-w-0 max-w-full items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px]',
                        isUser
                          ? 'bg-primary-foreground/15 text-primary-foreground'
                          : 'border border-border bg-muted/60 text-foreground',
                      )}
                      title={attachment.path}
                    >
                      <FileIcon filePath={attachment.path} className="h-3.5 w-3.5" />
                      <span className="truncate">{attachment.name}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Document operation badge. ChatMessage (types/agent.ts) currently
                  has no structured toolCalls field, so a content sniff is the
                  only available signal. Once the wire message carries structured
                  tool metadata, switch this to `msg.toolCalls?.length`
                  (review §07-26B). */}
              {!isUser && msg.content.includes('```tool') && (
                <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
                  <Wrench className="h-3 w-3 text-amber-500" />
                  <span>{t('agentUi.documentOperationExecuted')}</span>
                </div>
              )}

              {/* Token cache hit rate badge */}
              {!isUser && msg.cacheUsage?.measured && (
                <div
                  className="mt-2 inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400"
                  title={t('agentUi.cacheRate', {
                    rate: `${(msg.cacheUsage.hitRate * 100).toFixed(1)}%`,
                    read: msg.cacheUsage.cacheReadTokens,
                    total: msg.cacheUsage.cacheReadTokens + msg.cacheUsage.cacheMissTokens,
                  })}
                  aria-label={t('agentUi.cacheRate', {
                    rate: `${(msg.cacheUsage.hitRate * 100).toFixed(1)}%`,
                    read: msg.cacheUsage.cacheReadTokens,
                    total: msg.cacheUsage.cacheReadTokens + msg.cacheUsage.cacheMissTokens,
                  })}
                  data-testid="agent-cache-rate"
                >
                  <Database className="h-2.5 w-2.5" />
                  <span>{(msg.cacheUsage.hitRate * 100).toFixed(1)}% Cache</span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
