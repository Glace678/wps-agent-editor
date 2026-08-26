import { useState } from 'react'
import { Bot, Clock, Trash2, User, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/runtime'
import type { ChatMessage } from '@/types/agent'

interface AgentChatHistoryProps {
  messages: ChatMessage[]
  agentName: string
  agentColor?: string
  onClose: () => void
  onClear: () => void
}

export function AgentChatHistory({
  messages,
  agentName,
  agentColor = '#3b82f6',
  onClose,
  onClear,
}: AgentChatHistoryProps) {
  const { t } = useTranslation()
  const [confirmClear, setConfirmClear] = useState(false)

  const handleClear = () => {
    if (confirmClear) {
      onClear()
      setConfirmClear(false)
      onClose()
    } else {
      setConfirmClear(true)
      setTimeout(() => setConfirmClear(false), 3000)
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-background/95 backdrop-blur-sm">
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/50 px-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-semibold text-foreground">
            {t('agentUi.chatHistory')}
          </span>
          {messages.length > 0 && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t('agentUi.messageCount', { count: messages.length })}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {messages.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'h-6 w-6 rounded-md text-muted-foreground hover:text-foreground',
                    confirmClear && 'bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive',
                  )}
                  onClick={handleClear}
                  aria-label={t('agentUi.clearHistory')}
                  data-testid="agent-history-clear"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="whitespace-nowrap rounded-xl border bg-popover px-3 py-1 text-center text-[11px] font-medium text-popover-foreground shadow-md">
                {confirmClear ? t('agentUi.clearHistoryConfirm') : t('agentUi.clearHistory')}
              </TooltipContent>
            </Tooltip>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onClose}
            aria-label={t('providerSettings.close')}
            data-testid="agent-history-close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Message List */}
      <ScrollArea className="min-h-0 flex-1">
        {messages.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-center">
            <Clock className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">{t('agentUi.noHistory')}</p>
          </div>
        ) : (
          <div className="space-y-px p-1.5">
            {messages.map((msg, i) => {
              const isUser = msg.role === 'user'
              const preview = msg.content.slice(0, 80).replace(/\n/g, ' ')
              const timestamp = msg.timestamp
                ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : ''

              return (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50"
                >
                  {/* Role Icon */}
                  <span
                    className={cn(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md',
                      isUser
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground',
                    )}
                    style={!isUser ? { backgroundColor: agentColor + '18', color: agentColor } : undefined}
                  >
                    {isUser ? (
                      <User className="h-3 w-3" />
                    ) : (
                      <Bot className="h-3 w-3" />
                    )}
                  </span>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-foreground">
                        {isUser ? 'You' : agentName}
                      </span>
                      {timestamp && (
                        <span className="text-[10px] text-muted-foreground/60">
                          {timestamp}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                      {preview || '(attachment)'}
                      {msg.content.length > 80 && '…'}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
