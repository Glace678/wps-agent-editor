import { useMemo, useState } from 'react'
import {
  Archive,
  Check,
  Clock,
  Download,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/runtime'
import type { CodexImportResult, ConversationSummary } from '@/types/generated'

interface AgentChatHistoryProps {
  conversations: ConversationSummary[]
  activeConversationId?: string
  currentMessageCount: number
  isImportingCodex: boolean
  importResult: CodexImportResult | null
  onClose: () => void
  onClear: () => Promise<void> | void
  onNew: () => void
  onImportCodex: () => Promise<void> | void
  onSelect: (conversationId: string) => Promise<void> | void
}

export function AgentChatHistory({
  conversations,
  activeConversationId,
  currentMessageCount,
  isImportingCodex,
  importResult,
  onClose,
  onClear,
  onNew,
  onImportCodex,
  onSelect,
}: AgentChatHistoryProps) {
  const { t } = useTranslation()
  const [confirmClear, setConfirmClear] = useState(false)
  const [query, setQuery] = useState('')
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return conversations
    return conversations.filter((conversation) => [
      conversation.title,
      conversation.projectPath,
      conversation.originalModel,
      conversation.originalProvider,
    ].some((value) => value?.toLocaleLowerCase().includes(normalized)))
  }, [conversations, query])

  const handleClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true)
      setTimeout(() => setConfirmClear(false), 3000)
      return
    }
    setError(null)
    try {
      await onClear()
      setConfirmClear(false)
    } catch (cause) {
      console.error('[AgentChatHistory] Failed to delete conversation:', cause)
      setError(t('agentUi.conversationDeleteFailed'))
    }
  }

  const handleSelect = async (conversationId: string) => {
    if (loadingId || conversationId === activeConversationId) return
    setLoadingId(conversationId)
    setError(null)
    try {
      await onSelect(conversationId)
      onClose()
    } catch (cause) {
      console.error('[AgentChatHistory] Failed to load conversation:', cause)
      setError(t('agentUi.conversationLoadFailed'))
    } finally {
      setLoadingId(null)
    }
  }

  const handleImport = async () => {
    setError(null)
    try {
      await onImportCodex()
    } catch (cause) {
      console.error('[AgentChatHistory] Failed to import Codex conversations:', cause)
      setError(t('agentUi.codexImportFailed'))
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-background/95 backdrop-blur-sm">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/50 px-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-semibold text-foreground">
            {t('agentUi.conversationLibrary')}
          </span>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {conversations.length}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
                onClick={() => void handleImport()}
                disabled={isImportingCodex}
                aria-label={t('agentUi.importCodex')}
                data-testid="agent-history-import-codex"
              >
                {isImportingCodex
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="whitespace-nowrap rounded-xl border bg-popover px-3 py-1 text-center text-[11px] font-medium text-popover-foreground shadow-md">
              {t('agentUi.importCodex')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
                onClick={() => { onNew(); onClose() }}
                aria-label={t('agentUi.newConversation')}
                data-testid="agent-history-new"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="whitespace-nowrap rounded-xl border bg-popover px-3 py-1 text-center text-[11px] font-medium text-popover-foreground shadow-md">
              {t('agentUi.newConversation')}
            </TooltipContent>
          </Tooltip>
          {currentMessageCount > 0 && activeConversationId && (
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
                  onClick={() => void handleClear()}
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

      <div className="shrink-0 space-y-1.5 border-b border-border/40 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('agentUi.searchConversations')}
            className="h-7 rounded-md pl-7 text-[11px]"
            data-testid="agent-history-search"
          />
        </div>
        {isImportingCodex && (
          <div className="flex items-center gap-1.5 rounded-md bg-primary/5 px-2 py-1.5 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
            {t('agentUi.importingCodex')}
          </div>
        )}
        {!isImportingCodex && importResult && (
          <div className="rounded-md bg-muted/60 px-2 py-1.5 text-[10px] text-muted-foreground">
            {t('agentUi.codexImportSummary', {
              count: importResult.discovered - importResult.failed,
              failed: importResult.failed,
            })}
          </div>
        )}
        {error && <p className="text-[10px] text-destructive">{error}</p>}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {filtered.length === 0 ? (
          <div className="flex h-36 flex-col items-center justify-center gap-2 px-4 text-center">
            <MessageSquare className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              {query ? t('agentUi.noConversationResults') : t('agentUi.noHistory')}
            </p>
          </div>
        ) : (
          <div className="space-y-1 p-1.5">
            {filtered.map((conversation) => {
              const active = conversation.id === activeConversationId
              const loading = conversation.id === loadingId
              const date = new Date(conversation.updatedAt).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
                year: conversation.updatedAt < Date.now() - 300 * 24 * 60 * 60 * 1000
                  ? 'numeric'
                  : undefined,
              })
              return (
                <button
                  type="button"
                  key={conversation.id}
                  className={cn(
                    'group flex w-full items-start gap-2 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-border/60 hover:bg-muted/50',
                    active && 'border-primary/20 bg-primary/5',
                  )}
                  onClick={() => void handleSelect(conversation.id)}
                  disabled={Boolean(loadingId)}
                  data-testid="agent-history-conversation"
                >
                  <span className={cn(
                    'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                    conversation.source === 'codex'
                      ? 'bg-foreground/5 text-foreground'
                      : 'bg-primary/10 text-primary',
                  )}>
                    {loading
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : conversation.archived
                        ? <Archive className="h-3.5 w-3.5" />
                        : <MessageSquare className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[11px] font-medium text-foreground">
                        {conversation.title}
                      </span>
                      {active && <Check className="h-3 w-3 shrink-0 text-primary" />}
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="shrink-0">
                        {conversation.source === 'codex' ? 'Codex' : t('agentUi.appConversation')}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0">{t('agentUi.messageCount', { count: conversation.messageCount })}</span>
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0">{date}</span>
                    </span>
                    {(conversation.projectPath || conversation.originalModel) && (
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/70">
                        {[conversation.projectPath, conversation.originalModel].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
