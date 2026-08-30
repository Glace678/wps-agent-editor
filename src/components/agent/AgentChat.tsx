import { desktopApi } from '@/platform'
import { useRef, useEffect, useState, type DragEvent, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowUp,
  Bot,
  CheckCheck,
  Clock,
  Database,
  FileText,
  ListTree,
  Loader2,
  Plus,
  Sparkles,
  Square,
  Wrench,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/runtime'
import type { ChatMessage, AgentAttachment, AgentReasoningSelection } from '@/types/agent'
import type { CodexImportResult, ConversationSummary } from '@/types/generated'
import { useAgentStore } from '@/stores/agent.store'
import { FileIcon } from '@/components/file-manager/FileIcon'
import {
  createAgentAttachment,
  hasAgentAttachmentDragData,
  readAgentAttachmentDragData,
} from '@/lib/agent-attachments'
import { selectAgentAttachmentPaths } from '@/lib/agent-attachment-picker'
import { AgentModelPicker } from './AgentModelPicker'
import { AgentReasoningPicker } from './AgentReasoningPicker'
import { AgentChatHistory } from './AgentChatHistory'

const EMPTY_AGENT_ATTACHMENTS: AgentAttachment[] = []

interface AgentChatProps {
  agentId: string | null
  agentName: string
  providerId: string
  model: string
  reasoning: AgentReasoningSelection | undefined
  messages: ChatMessage[]
  conversations: ConversationSummary[]
  activeConversationId?: string
  isImportingCodex: boolean
  codexImportResult: CodexImportResult | null
  isRunning: boolean
  onStop: () => void
  onSend: (content: string, attachments: AgentAttachment[]) => void
  onSelectModel: (providerId: string, model: string) => Promise<void>
  onSelectReasoning: (selection: AgentReasoningSelection) => Promise<void>
  onConfigureProviders: () => void
  onEditAgent: () => void
  onClearHistory: () => Promise<void> | void
  onNewConversation: () => void
  onImportCodex: () => Promise<void> | void
  onLoadConversation: (conversationId: string) => Promise<void> | void
  beforeComposer?: ReactNode
}

const STARTER_PROMPTS = [
  {
    id: 'summarize',
    icon: FileText,
    labelKey: 'agentUi.promptSummarize' as const,
    defaultText: {
      'zh-CN': '请总结当前文档的核心要点和关键信息。',
      en: 'Please summarize the key points and core takeaways of the current document.',
      ja: '現在のドキュメントの要点と重要な情報を要約してください。',
      es: 'Por favor, resume los puntos clave y la información fundamental del documento actual.',
      pt: 'Por favor, resuma os pontos principais e as informações essenciais do documento atual.',
      de: 'Bitte fassen Sie die Kernpunkte und wichtigsten Informationen des aktuellen Dokuments zusammen.',
      fr: 'Veuillez résumer les points clés et les informations essentielles du document actuel.',
      ru: 'Пожалуйста, обобщите ключевые моменты и основную информацию текущего документа.',
      ar: 'يرجى تلخيص النقاط الرئيسية والمعلومات الأساسية للمستند الحالي.',
    },
  },
  {
    id: 'polish',
    icon: Sparkles,
    labelKey: 'agentUi.promptPolish' as const,
    defaultText: {
      'zh-CN': '请对当前文档内容进行语言润色，提高表达的流畅度与专业度。',
      en: 'Please polish the text in the current document to improve clarity, flow, and professionalism.',
      ja: '現在のドキュメントの文章を推敲し、読みやすさと表現力を向上させてください。',
      es: 'Por favor, pule el texto del documento actual para mejorar la claridad y el estilo profesional.',
      pt: 'Por favor, revise e aprimore o texto do documento atual para melhorar a fluidez e o profissionalismo.',
      de: 'Bitte überarbeiten Sie den Text des aktuellen Dokuments, um Klarheit und Stil zu verbessern.',
      fr: 'Veuillez peaufiner le texte du document actuel pour améliorer sa clarté et sa fluidité.',
      ru: 'Пожалуйста, отшлифуйте текст текущего документа, улучшив плавность и стиль.',
      ar: 'يرجى تحسين وتنقيح لغة المستند الحالي لزيادة سلاسة التعبير والاحترافية.',
    },
  },
  {
    id: 'fix',
    icon: CheckCheck,
    labelKey: 'agentUi.promptFixErrors' as const,
    defaultText: {
      'zh-CN': '请检查当前文档中的错别字、语法错误以及排版格式问题。',
      en: 'Please check the current document for spelling, grammar, and formatting errors.',
      ja: '現在のドキュメント内の誤字脱字、文法、書式の問題をチェックしてください。',
      es: 'Por favor, revisa el documento actual en busca de errores ortográficos, gramaticales y de formato.',
      pt: 'Por favor, verifique o documento atual quanto a erros de ortografia, gramática e formatação.',
      de: 'Bitte überprüfen Sie das aktuelle Dokument auf Rechtschreib-, Grammatik- und Formatierungsfehler.',
      fr: 'Veuillez vérifier les fautes d’orthographe, de grammaire et les problèmes de mise en page dans le document actuel.',
      ru: 'Пожалуйста, проверьте текущий документ на наличие орфографических, грамматических и форматирующих ошибок.',
      ar: 'يرجى فحص المستند الحالي للتحقق من الأخطاء الإملائية والنحوية وتنسيق الفقرات.',
    },
  },
  {
    id: 'outline',
    icon: ListTree,
    labelKey: 'agentUi.promptOutline' as const,
    defaultText: {
      'zh-CN': '请为当前文档梳理生成清晰的结构大纲与行动建议。',
      en: 'Please generate a structured outline and actionable next steps for this document.',
      ja: '現在のドキュメントの構成アウトラインと次のアクション項目を作成してください。',
      es: 'Por favor, genera un esquema estructurado y recomendaciones de acción para este documento.',
      pt: 'Por favor, elabore uma estrutura organizada e sugestões de ação para este documento.',
      de: 'Bitte erstellen Sie eine strukturierte Gliederung und Handlungsempfehlungen für dieses Dokument.',
      fr: 'Veuillez générer un plan structuré et des recommandations d’action pour ce document.',
      ru: 'Пожалуйста, создайте структурированный план и рекомендации по действиям для этого документа.',
      ar: 'يرجى إعداد مخطط تفصيلي منظم واقتراحات للخطوات التالية لهذا المستند.',
    },
  },
]

export function AgentChat({
  agentId,
  agentName,
  providerId,
  model,
  reasoning,
  messages,
  conversations,
  activeConversationId,
  isImportingCodex,
  codexImportResult,
  isRunning,
  onStop,
  onSend,
  onSelectModel,
  onSelectReasoning,
  onConfigureProviders,
  onEditAgent,
  onClearHistory,
  onNewConversation,
  onImportCodex,
  onLoadConversation,
  beforeComposer,
}: AgentChatProps) {
  const { language, t } = useTranslation()
  const agents = useAgentStore((state) => state.agents)
  const currentAgent = agents.find((a) => a.id === agentId)

  const input = useAgentStore((state) => agentId ? state.drafts[agentId] ?? '' : '')
  const attachments = useAgentStore(
    (state) => agentId ? state.attachmentDrafts[agentId] ?? EMPTY_AGENT_ATTACHMENTS : EMPTY_AGENT_ATTACHMENTS,
  )
  const setDraft = useAgentStore((state) => state.setDraft)
  const addDraftAttachments = useAgentStore((state) => state.addDraftAttachments)
  const removeDraftAttachment = useAgentStore((state) => state.removeDraftAttachment)
  const clearDraftAttachments = useAgentStore((state) => state.clearDraftAttachments)

  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dragDepthRef = useRef(0)
  const [isDropActive, setIsDropActive] = useState(false)
  const [isPickingFiles, setIsPickingFiles] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isRunning])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '0px'
    textarea.style.height = `${Math.max(40, Math.min(textarea.scrollHeight, 160))}px`
  }, [input])

  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || !agentId || isRunning) return
    onSend(input.trim(), attachments)
    setDraft(agentId, '')
    clearDraftAttachments(agentId)
  }

  const handleStarterPrompt = (promptItem: typeof STARTER_PROMPTS[number]) => {
    if (!agentId || isRunning) return
    const text = (promptItem.defaultText as Record<string, string>)[language] ?? promptItem.defaultText.en
    setDraft(agentId, text)
    textareaRef.current?.focus()
  }

  const handlePickFiles = async () => {
    if (!agentId || isPickingFiles) return
    setIsPickingFiles(true)
    setAttachmentError(null)
    try {
      const selections = await selectAgentAttachmentPaths(desktopApi.files)
      addDraftAttachments(
        agentId,
        selections.map((selection) => createAgentAttachment(
          selection.path,
          'picker',
          selection.grantId,
        )),
      )
    } catch (error) {
      console.error('[AgentChat] Failed to open attachment picker:', error)
      setAttachmentError(t('agentUi.attachmentPickerFailed'))
    } finally {
      setIsPickingFiles(false)
    }
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasAgentAttachmentDragData(event.dataTransfer)) return
    event.preventDefault()
    dragDepthRef.current += 1
    setIsDropActive(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasAgentAttachmentDragData(event.dataTransfer)) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDropActive(false)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!agentId || !hasAgentAttachmentDragData(event.dataTransfer)) return
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDropActive(false)
    setAttachmentError(null)
    addDraftAttachments(agentId, readAgentAttachmentDragData(event.dataTransfer))
  }

  if (!agentId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-xs text-muted-foreground">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-border/60 bg-muted/40 text-muted-foreground shadow-xs">
          <Bot className="h-6 w-6" />
        </div>
        <p className="font-medium text-foreground">{t('agentUi.selectAgent')}</p>
        {beforeComposer}
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={350}>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        {/* History Panel Overlay */}
        {showHistory && (
          <AgentChatHistory
            conversations={conversations}
            activeConversationId={activeConversationId}
            currentMessageCount={messages.length}
            isImportingCodex={isImportingCodex}
            importResult={codexImportResult}
            onClose={() => setShowHistory(false)}
            onClear={onClearHistory}
            onNew={onNewConversation}
            onImportCodex={onImportCodex}
            onSelect={onLoadConversation}
          />
        )}

        {/* Main Chat Conversation Area */}
        <ScrollArea className="min-h-0 flex-1 px-3 py-2">
          <div className="space-y-4 py-2">
            {/* Empty State Welcome Card with Starter Prompts */}
            {messages.length === 0 && (
              <div className="my-auto flex flex-col items-center justify-center px-1 py-4 text-center">
                <div
                  className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-border/50 shadow-sm transition-transform hover:scale-105"
                  style={{
                    backgroundColor: (currentAgent?.color || '#3b82f6') + '18',
                    borderColor: (currentAgent?.color || '#3b82f6') + '40',
                  }}
                >
                  <Bot className="h-6 w-6" style={{ color: currentAgent?.color || '#3b82f6' }} />
                </div>
                <h3 className="text-sm font-semibold tracking-tight text-foreground">
                  {agentName || t('agents.agent')}
                </h3>
                <p className="mt-1 max-w-[240px] text-xs text-muted-foreground">
                  {currentAgent?.role || t('agentUi.emptyStateHint')}
                </p>

                {/* Quick Starter Prompt Chips */}
                <div className="mt-5 w-full space-y-1.5 text-left">
                  <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {t('agentUi.quickPrompts')}
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {STARTER_PROMPTS.map((item) => {
                      const Icon = item.icon
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleStarterPrompt(item)}
                          disabled={isRunning}
                          className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/80 p-2 text-left text-xs transition-all hover:border-primary/40 hover:bg-accent/60 hover:shadow-xs active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
                            <Icon className="h-3 w-3" />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                            {t(item.labelKey)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Chat Message List */}
            {messages.map((msg, i) => {
              const isUser = msg.role === 'user'
              return (
                <div
                  key={i}
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
                            backgroundColor: (currentAgent?.color || '#3b82f6') + '22',
                            color: currentAgent?.color || '#3b82f6',
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

                    {/* Document operation badge */}
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

            {/* Live Thinking Status */}
            {isRunning && (
              <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-card/60 px-3 py-2 text-xs text-muted-foreground shadow-xs">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                </span>
                <span className="font-medium text-foreground">
                  {t('agentUi.thinking', { agent: agentName || t('agents.agent') })}
                </span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Space for collaboration & task status */}
        {beforeComposer}

        {/* Composer / Input Area */}
        <div
          className={cn(
            'relative shrink-0 border-t border-border/40 bg-sidebar/40 p-2.5 transition-colors',
            isDropActive && 'bg-primary/5',
          )}
          data-testid="agent-composer"
          data-drop-active={isDropActive ? 'true' : 'false'}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={(event) => {
            if (!hasAgentAttachmentDragData(event.dataTransfer)) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={handleDrop}
        >
          <div
            className={cn(
              'rounded-2xl border border-border/80 bg-card transition-all shadow-xs focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20',
              isDropActive && 'border-primary ring-2 ring-primary/40',
            )}
          >
            {/* Draft Attachments List */}
            {attachments.length > 0 && (
              <div
                className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto px-2.5 pt-2.5"
                data-testid="agent-attachment-list"
              >
                {attachments.map((attachment) => (
                  <span
                    key={attachment.path}
                    className="flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-border/60 bg-muted/60 py-0.5 pl-2 pr-1 text-xs"
                    title={attachment.path}
                    data-agent-attachment-chip={attachment.path}
                  >
                    <FileIcon filePath={attachment.path} className="h-3.5 w-3.5 shrink-0" />
                    <span className="max-w-36 truncate text-[11px]">{attachment.name}</span>
                    <button
                      type="button"
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      aria-label={t('agentUi.removeAttachment', { name: attachment.name })}
                      title={t('agentUi.removeAttachment', { name: attachment.name })}
                      onClick={() => agentId && removeDraftAttachment(agentId, attachment.path)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Input Textarea */}
            <textarea
              ref={textareaRef}
              rows={2}
              placeholder={t('agentUi.sendMessage')}
              aria-label={t('agentUi.sendMessage')}
              value={input}
              onChange={(event) => agentId && setDraft(agentId, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  handleSend()
                }
              }}
              disabled={isRunning}
              className="w-full resize-none bg-transparent px-3 py-2 text-xs leading-relaxed outline-none placeholder:text-muted-foreground"
              data-testid="agent-message-input"
            />

            {/* Composer Bottom Toolbar - Row 1: Model + Reasoning */}
            <div className="flex min-w-0 items-center gap-1 border-t border-border/40 px-2 py-1">
              <AgentModelPicker
                providerId={providerId}
                model={model}
                disabled={isRunning}
                onSelect={onSelectModel}
                onConfigureProviders={onConfigureProviders}
                onEditAgent={onEditAgent}
              />

              <AgentReasoningPicker
                providerId={providerId}
                model={model}
                value={reasoning}
                disabled={isRunning}
                onSelect={onSelectReasoning}
              />
            </div>

            {/* Composer Bottom Toolbar - Row 2: Attach + History + Send */}
            <div className="flex min-w-0 items-center justify-between gap-1 border-t border-border/30 px-2 py-1">
              <div className="flex items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => void handlePickFiles()}
                      disabled={isPickingFiles}
                      aria-label={t('agentUi.addAttachment')}
                      data-testid="agent-add-attachment"
                    >
                      {isPickingFiles ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="whitespace-nowrap rounded-xl border bg-popover px-3 py-1 text-center text-[11px] font-medium text-popover-foreground shadow-md">
                    {t('agentUi.addAttachment')}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={cn(
                        'h-6 w-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
                        showHistory && 'bg-accent text-foreground',
                      )}
                      onClick={() => setShowHistory((prev) => !prev)}
                      aria-label={t('agentUi.chatHistory')}
                      data-testid="agent-history-toggle"
                    >
                      <Clock className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="whitespace-nowrap rounded-xl border bg-popover px-3 py-1 text-center text-[11px] font-medium text-popover-foreground shadow-md">
                    {t('agentUi.chatHistory')}
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Action Button (Send / Stop) */}
              <div className="flex shrink-0 items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant={isRunning ? 'destructive' : 'default'}
                      className={cn(
                        'h-7 w-7 shrink-0 rounded-xl transition-transform active:scale-95 shadow-xs',
                        !isRunning && (!input.trim() && attachments.length === 0)
                          ? 'opacity-40'
                          : 'opacity-100',
                      )}
                      onClick={isRunning ? onStop : handleSend}
                      disabled={!isRunning && !input.trim() && attachments.length === 0}
                      aria-label={isRunning ? t('codeEditor.stopDebug') : t('agentUi.send')}
                      data-testid={isRunning ? 'agent-stop' : 'agent-send'}
                    >
                      {isRunning ? (
                        <Square className="h-3 w-3 fill-current" />
                      ) : (
                        <ArrowUp className="h-3.5 w-3.5 stroke-[2.5]" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="whitespace-nowrap rounded-xl border bg-popover px-3 py-1 text-center text-[11px] font-medium text-popover-foreground shadow-md">
                    {isRunning ? t('codeEditor.stopDebug') : t('agentUi.send')}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          {attachmentError && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-destructive" role="alert">
              <AlertCircle className="h-3 w-3 shrink-0" />
              <span className="truncate">{attachmentError}</span>
            </p>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
