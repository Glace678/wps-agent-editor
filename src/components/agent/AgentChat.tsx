import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/runtime'
import type { ChatMessage } from '@/types/agent'

interface AgentChatProps {
  agentId: string | null
  agentName: string
  agentColor: string
  messages: ChatMessage[]
  isRunning: boolean
  onSend: (content: string) => void
}

export function AgentChat({ agentId, agentName, agentColor, messages, isRunning, onSend }: AgentChatProps) {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    if (!input.trim() || !agentId || isRunning) return
    onSend(input.trim())
    setInput('')
  }

  if (!agentId) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
        {t('agentUi.selectAgent')}
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ScrollArea className="flex-1 px-3">
        <div className="space-y-3 py-3">
          {messages.length === 0 && (
            <div className="text-center text-sm text-muted-foreground">
              <p>{t('agentUi.chatWith', { agent: agentName })}</p>
              <p className="mt-1 text-xs">{t('agentUi.canEditDocument')}</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                'rounded-lg px-3 py-2 text-sm',
                msg.role === 'user'
                  ? 'ml-8 bg-primary text-primary-foreground'
                  : 'mr-4 bg-secondary',
              )}
            >
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              {msg.role === 'assistant' && msg.content.includes('```tool') && (
                <div className="mt-2 flex items-center gap-1 text-xs opacity-70">
                  <Wrench className="h-3 w-3" />
                  {t('agentUi.documentOperationExecuted')}
                </div>
              )}
            </div>
          ))}
          {isRunning && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('agentUi.thinking', { agent: agentName })}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="border-t p-3">
        <div className="flex gap-2">
          <Input
            placeholder={t('agentUi.sendInstruction', { agent: agentName })}
            aria-label={t('agentUi.sendInstruction', { agent: agentName })}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            disabled={isRunning}
          />
          <TooltipProvider delayDuration={450}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={isRunning || !input.trim()}
                  aria-label={t('agentUi.send')}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="whitespace-nowrap rounded-[2px] border-0 bg-[#666] px-1.5 py-1.5 text-center text-[12px] leading-normal text-white shadow-none">
                {t('agentUi.send')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  )
}
