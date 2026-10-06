import { desktopApi } from '@/platform'
import { useEffect, useState, useCallback } from 'react'
import { Key, PanelRightClose, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAgentStore } from '@/stores/agent.store'
import { localizeAgentDefaults } from '@/lib/i18n/agent-defaults'
import { useTranslation } from '@/lib/i18n/runtime'
import { AGENT_COLLABORATION_ENABLED } from '@/lib/agent-collaboration'
import {
  APP_MENU_NEW_AGENT_EVENT,
  APP_MENU_RUN_MULTI_AGENT_EVENT,
} from '@/lib/app-menu-events'
import { AgentList } from './AgentList'
import { AgentChat } from './AgentChat'
import { AgentConfigDialog } from './AgentConfigDialog'
import { TaskStatus } from './TaskStatus'
import { ProviderSettings } from './ProviderSettings'
import { CollaborationChat } from './CollaborationChat'
import { CollaborationConfigDialog } from './CollaborationConfigDialog'
import type { AgentAttachment, AgentCollaborationEvent, AgentConfig, AgentReasoningSelection, ChatMessage, CollaborationMode } from '@/types/agent'
import type { ProviderDefinition } from '@/types/provider'
import type { ConversationMessage } from '@/types/generated'

let codexAutoImportStarted = false

function persistedMessages(messages: ChatMessage[]): ConversationMessage[] {
  return messages
    .filter((message) => !message.streamingRunId && message.content.trim())
    .map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
    }))
}

interface AgentSidebarProps {
  /** 折叠右侧 Agent 助手侧栏 */
  onCollapse?: () => void
}

export function AgentSidebar({ onCollapse }: AgentSidebarProps) {
  const { language, t } = useTranslation()
  const {
    agents, activeAgentId, messages, conversationIds, conversationSummaries,
    codexImportResult, isImportingCodex, isRunning, taskStatus, activeRunId, isStopping,
    setAgents, setActiveAgentId, addMessage, appendAssistantStream, completeAssistantStream, settleStreamingMessages,
    setIsRunning, setActiveRunId, setIsStopping, setTaskStatus,
    ensureConversationId, clearMessages, loadConversation,
    setConversationSummaries, upsertConversationSummary,
    setCodexImportResult, setIsImportingCodex,
    collaborationEvents, addCollaborationEvent, clearCollaborationEvents,
  } = useAgentStore()
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [showProviderSettings, setShowProviderSettings] = useState(false)
  const [resumeAgentConfig, setResumeAgentConfig] = useState(false)
  const [showCollaborationConfig, setShowCollaborationConfig] = useState(false)
  const [providers, setProviders] = useState<ProviderDefinition[]>([])
  const [collaborationMode, setCollaborationMode] = useState<CollaborationMode | null>(null)

  const refreshConversations = useCallback(async () => {
    const summaries = await desktopApi.agents.conversations.list()
    setConversationSummaries(summaries)
    return summaries
  }, [setConversationSummaries])

  const handleImportCodex = useCallback(async () => {
    if (useAgentStore.getState().isImportingCodex) return
    setIsImportingCodex(true)
    try {
      const result = await desktopApi.agents.conversations.importCodex()
      setCodexImportResult(result)
      await refreshConversations()
    } finally {
      setIsImportingCodex(false)
    }
  }, [refreshConversations, setCodexImportResult, setIsImportingCodex])

  const persistConversation = useCallback(async (
    conversationId: string,
    history: ChatMessage[],
  ) => {
    const record = await desktopApi.agents.conversations.save({
      id: conversationId,
      messages: persistedMessages(history),
    })
    upsertConversationSummary(record.summary)
    return record
  }, [upsertConversationSummary])

  useEffect(() => {
    let cancelled = false
    void desktopApi.agents.list().then((list) => {
      if (!cancelled) setAgents(list.map((agent) => localizeAgentDefaults(agent, language)))
    })
    return () => { cancelled = true }
  }, [language, setAgents])

  useEffect(() => {
    let cancelled = false
    void refreshConversations().catch((error) => {
      if (!cancelled) console.error('[AgentSidebar] Failed to load conversations:', error)
    })
    if (!codexAutoImportStarted) {
      codexAutoImportStarted = true
      void handleImportCodex().catch((error) => {
        if (!cancelled) console.error('[AgentSidebar] Automatic Codex import failed:', error)
      })
    }
    return () => { cancelled = true }
  }, [handleImportCodex, refreshConversations])

  useEffect(() => {
    let cancelled = false
    void desktopApi.providers.list().then((list) => {
      if (!cancelled) setProviders(list)
    }).catch(() => {
      if (!cancelled) setProviders([])
    })
    return () => { cancelled = true }
  }, [])

  const handleAgentEvent = useCallback((event: AgentCollaborationEvent) => {
    addCollaborationEvent(event)
    if (event.type === 'agent-stream' && event.agentId && event.content) {
      // wps_06 E1: key per invocation so concurrent delegations to the same
      // peer do not interleave into one bubble. operationId form:
      // `stream:{agent}:{token}:{round}`.
      const parts = event.operationId?.split(':')
      const streamKey = parts && parts.length >= 3 && parts[2]
        ? `inv:${parts[1]}:${parts[2]}`
        : event.runId
      appendAssistantStream(event.agentId, streamKey, event.runId, event.content)
    }
  }, [addCollaborationEvent, appendAssistantStream])

  const activeAgent = agents.find((a) => a.id === activeAgentId)

  const handleSend = useCallback(async (content: string, attachments: AgentAttachment[]) => {
    if (!activeAgentId) return
    const runId = crypto.randomUUID()
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      attachments,
      timestamp: Date.now(),
    }
    // Review §01-9: snapshot the conversation history synchronously from the
    // store instead of the subscribed `messages` closure, which can be stale if
    // a stream event landed between render and send. Snapshot BEFORE addMessage
    // so the just-created userMessage is appended to history exactly once.
    const history = [...(useAgentStore.getState().messages[activeAgentId] || []), userMessage]
    addMessage(activeAgentId, userMessage)
    clearCollaborationEvents()
    setIsRunning(true)
    setActiveRunId(runId)
    setIsStopping(false)
    setTaskStatus(t('agentUi.processing'))

    const conversationId = ensureConversationId(activeAgentId)

    interface ResolvedTurn {
      message: ChatMessage
      toolCalls: number
      failed: boolean
    }

    // Resolves the final assistant turn, or null when the user stopped the run
    // (stopping takes precedence over error/success text).
    const resolveTurn = async (): Promise<ResolvedTurn | null> => {
      try {
        const { result } = await desktopApi.agents.chat({
          agentId: activeAgentId,
          messages: history,
          conversationId,
          runId,
          onEvent: handleAgentEvent,
        })
        if ('error' in result) {
          return useAgentStore.getState().isStopping
            ? null
            : {
                failed: true,
                toolCalls: 0,
                message: { role: 'assistant', content: t('agentUi.error', { error: result.error }), timestamp: Date.now() },
              }
        }
        return {
          failed: false,
          toolCalls: result.toolCalls.length,
          message: {
            role: 'assistant',
            content: result.response,
            cacheUsage: result.cacheUsage,
            timestamp: Date.now(),
          },
        }
      } catch (err) {
        console.error('[AgentSidebar] chat request failed:', err)
        if (useAgentStore.getState().isStopping) return null
        return {
          failed: true,
          toolCalls: 0,
          message: { role: 'assistant', content: t('agentUi.requestFailedGeneric'), timestamp: Date.now() },
        }
      }
    }

    try {
      await persistConversation(conversationId, history)
      const turn = await resolveTurn()
      if (useAgentStore.getState().isStopping) {
        setTaskStatus(t('codeEditor.stopDebug'))
      } else if (turn) {
        completeAssistantStream(activeAgentId, runId, turn.message)
        await persistConversation(conversationId, [...history, turn.message])
        if (turn.failed) {
          setTaskStatus(t('agentUi.failed'))
        } else if (turn.toolCalls > 0) {
          setTaskStatus(t('agentUi.documentOperationsCompleted', { count: turn.toolCalls }))
        } else {
          setTaskStatus(t('agentUi.completed'))
        }
      }
    } catch (err) {
      console.error('[AgentSidebar] chat send failed:', err)
      if (useAgentStore.getState().isStopping) {
        setTaskStatus(t('codeEditor.stopDebug'))
      } else {
        setTaskStatus(t('agentUi.failed'))
      }
    } finally {
      // wps_06 A4: settle any streaming placeholder the result paths did
      // not — user stop and the outer catch used to leave it spinning.
      const wasStopping = useAgentStore.getState().isStopping
      settleStreamingMessages(runId, wasStopping ? 'cancelled' : 'error')
      setIsRunning(false)
      setActiveRunId(null)
      setIsStopping(false)
    }
  }, [activeAgentId, addMessage, clearCollaborationEvents, completeAssistantStream, ensureConversationId, handleAgentEvent, persistConversation, settleStreamingMessages, setActiveRunId, setIsRunning, setIsStopping, setTaskStatus, t])

  const handleLoadConversation = useCallback(async (conversationId: string) => {
    if (!activeAgentId || isRunning) return
    const conversation = await desktopApi.agents.conversations.get(conversationId)
    loadConversation(activeAgentId, conversation)
    clearCollaborationEvents()
    setTaskStatus(t('agentUi.conversationLoaded', { title: conversation.summary.title }))
  }, [activeAgentId, clearCollaborationEvents, isRunning, loadConversation, setTaskStatus, t])

  const handleNewConversation = useCallback(() => {
    if (!activeAgentId || isRunning) return
    clearMessages(activeAgentId)
    clearCollaborationEvents()
    setTaskStatus('')
  }, [activeAgentId, clearCollaborationEvents, clearMessages, isRunning, setTaskStatus])

  const handleMultiAgent = useCallback(async (
    task: string,
    agentIds: string[],
    rootAgentId: string,
    mode: CollaborationMode,
  ) => {
    if (!AGENT_COLLABORATION_ENABLED) return
    if (agentIds.length < 2) {
      setTaskStatus(t('agentUi.enableAtLeastTwo'))
      return
    }

    setIsRunning(true)
    const runId = crypto.randomUUID()
    setActiveRunId(runId)
    setIsStopping(false)
    clearCollaborationEvents()
    setCollaborationMode(mode)
    setTaskStatus(t('agentUi.collaborating'))

    try {
      const { result: results } = await desktopApi.agents.runTask({
        agentIds,
        task,
        runId,
        rootAgentId,
        mode,
        onEvent: handleAgentEvent,
      })
      if (!Array.isArray(results)) {
        setTaskStatus(useAgentStore.getState().isStopping
          ? t('codeEditor.stopDebug')
          : t('agentUi.collaborationFailed', { error: results.error }))
        return
      }
      for (const result of results) {
        completeAssistantStream(
          result.agentId,
          `inv:${result.agentId}:${result.invocationToken}`,
          {
            role: 'assistant',
            content: result.response,
            cacheUsage: result.cacheUsage,
          },
        )
      }
      // wps_06 B2: a stopped run may return partial results; missing peers
      // are settled as cancelled by the finally block.
      if (useAgentStore.getState().isStopping) {
        setTaskStatus(t('codeEditor.stopDebug'))
      } else {
        setTaskStatus(t('agentUi.collaborationCompleted', { count: results.length }))
      }
    } catch (err) {
      console.error('[AgentSidebar] collaboration request failed:', err)
      setTaskStatus(useAgentStore.getState().isStopping
        ? t('codeEditor.stopDebug')
        : t('agentUi.collaborationFailed', { error: t('agentUi.requestFailedGeneric') }))
    } finally {
      // wps_06 A4: agents missing from the results (cancelled, failed, or
      // never reached) keep their streaming bubble until this safety net.
      const wasStopping = useAgentStore.getState().isStopping
      settleStreamingMessages(runId, wasStopping ? 'cancelled' : 'error')
      setIsRunning(false)
      setActiveRunId(null)
      setIsStopping(false)
    }
  }, [clearCollaborationEvents, completeAssistantStream, handleAgentEvent, settleStreamingMessages, setActiveRunId, setCollaborationMode, setIsRunning, setIsStopping, setTaskStatus, t])

  const handleCloseCollaboration = useCallback(() => {
    setCollaborationMode(null)
    clearCollaborationEvents()
    setTaskStatus('')
  }, [clearCollaborationEvents, setTaskStatus])

  const handleStop = useCallback(() => {
    if (!activeRunId || isStopping) return
    setIsStopping(true)
    setTaskStatus(t('agentUi.processing'))
    void desktopApi.agents.cancel(activeRunId).catch((error) => {
      console.error('[AgentSidebar] cancel request failed:', error)
      setIsStopping(false)
    })
  }, [activeRunId, isStopping, setIsStopping, setTaskStatus, t])

  const handleNewAgent = useCallback(() => {
    const newAgent: AgentConfig = {
      id: crypto.randomUUID(),
      name: t('agents.newAgent'),
      role: t('agents.customAssistant'),
      systemPrompt: t('agents.customAssistantPrompt'),
      providerId: 'deepseek',
      model: 'deepseek-chat',
      reasoning: { kind: 'auto' },
      color: '#6366f1',
      enabled: true,
    }
    setEditingAgent(newAgent)
    setShowConfig(true)
  }, [t])

  useEffect(() => {
    const openNewAgent = () => handleNewAgent()
    const runMultiAgent = () => setShowCollaborationConfig(true)
    window.addEventListener(APP_MENU_NEW_AGENT_EVENT, openNewAgent)
    if (AGENT_COLLABORATION_ENABLED) {
      window.addEventListener(APP_MENU_RUN_MULTI_AGENT_EVENT, runMultiAgent)
    }
    return () => {
      window.removeEventListener(APP_MENU_NEW_AGENT_EVENT, openNewAgent)
      if (AGENT_COLLABORATION_ENABLED) {
        window.removeEventListener(APP_MENU_RUN_MULTI_AGENT_EVENT, runMultiAgent)
      }
    }
  }, [handleNewAgent])

  const handleSaveAgent = useCallback(async (agent: AgentConfig) => {
    const updated = await desktopApi.agents.save(agent)
    setAgents(updated.map((item) => localizeAgentDefaults(item, language)))
    if (!activeAgentId) setActiveAgentId(agent.id)
  }, [activeAgentId, language, setActiveAgentId, setAgents])

  const handleSelectModel = useCallback(async (providerId: string, model: string) => {
    if (!activeAgent) return
    await handleSaveAgent({ ...activeAgent, providerId, model })
  }, [activeAgent, handleSaveAgent])

  const handleSelectReasoning = useCallback(async (reasoning: AgentReasoningSelection) => {
    if (!activeAgent) return
    await handleSaveAgent({ ...activeAgent, reasoning })
  }, [activeAgent, handleSaveAgent])

  return (
    <TooltipProvider delayDuration={350}>
      <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-sidebar">
        {collaborationMode ? (
          <CollaborationChat
            events={collaborationEvents}
            agents={agents}
            providers={providers}
            mode={collaborationMode}
            isRunning={isRunning}
            isStopping={isStopping}
            onStop={handleStop}
            onClose={handleCloseCollaboration}
          />
        ) : (
        <>
        {/* Top Header Bar */}
        <div className="flex h-9 shrink-0 items-center justify-between gap-1 border-b border-border/50 bg-background/40 px-2.5 backdrop-blur-xs">
          <div className="flex min-w-0 items-center gap-1.5">
            {onCollapse && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={onCollapse}
                    aria-label={t('appShell.collapseAgentAssistant')}
                  >
                    <PanelRightClose className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="whitespace-nowrap rounded-xl border bg-popover px-3 py-1 text-center text-[11px] font-medium text-popover-foreground shadow-md">
                  {t('appShell.collapseAgentAssistant')}
                </TooltipContent>
              </Tooltip>
            )}
            <span className="truncate text-xs font-semibold tracking-wide text-foreground">
              {t('agentUi.assistantTitle')}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setShowProviderSettings(true)}
                  aria-label={t('providerSettings.title')}
                >
                  <Key className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="whitespace-nowrap rounded-xl border bg-popover px-3 py-1 text-center text-[11px] font-medium text-popover-foreground shadow-md">
                {t('providerSettings.title')}
              </TooltipContent>
            </Tooltip>

            {AGENT_COLLABORATION_ENABLED && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1 rounded-md px-2 text-[11px] font-medium"
                onClick={() => setShowCollaborationConfig(true)}
                disabled={isRunning}
                data-testid="collaboration-open"
              >
                <Users className="h-3 w-3" />
                {t('agentUi.collaborate')}
              </Button>
            )}
          </div>
        </div>

        {/* Compact Agent Switcher Bar */}
        <AgentList
          agents={agents}
          activeId={activeAgentId}
          onSelect={setActiveAgentId}
          onNew={handleNewAgent}
          onEdit={(agent) => { setEditingAgent(agent); setShowConfig(true) }}
          providers={providers}
        />

        {/* Chat Area (Dominant Workspace) */}
        <AgentChat
          agentId={activeAgentId}
          agentName={activeAgent?.name ?? ''}
          providerId={activeAgent?.providerId ?? ''}
          model={activeAgent?.model ?? ''}
          reasoning={activeAgent?.reasoning}
          messages={messages[activeAgentId ?? ''] || []}
          conversations={conversationSummaries}
          activeConversationId={activeAgentId ? conversationIds[activeAgentId] : undefined}
          isImportingCodex={isImportingCodex}
          codexImportResult={codexImportResult}
          isRunning={isRunning}
          onStop={handleStop}
          onSend={handleSend}
          onSelectModel={handleSelectModel}
          onSelectReasoning={handleSelectReasoning}
          onConfigureProviders={() => {
            setResumeAgentConfig(false)
            setShowProviderSettings(true)
          }}
          onEditAgent={() => {
            if (!activeAgent) return
            setEditingAgent(activeAgent)
            setShowConfig(true)
          }}
          onClearHistory={handleNewConversation}
          onNewConversation={handleNewConversation}
          onImportCodex={handleImportCodex}
          onLoadConversation={handleLoadConversation}
          beforeComposer={(
            <TaskStatus status={taskStatus} isRunning={isRunning} />
          )}
        />
        </>
        )}

        {showConfig && editingAgent && (
          <AgentConfigDialog
            agent={editingAgent}
            onSave={handleSaveAgent}
            onClose={() => { setShowConfig(false); setEditingAgent(null) }}
            onConfigureProviders={() => {
              setShowConfig(false)
              setResumeAgentConfig(true)
              setShowProviderSettings(true)
            }}
          />
        )}

        {showProviderSettings && (
          <ProviderSettings onClose={() => {
            setShowProviderSettings(false)
            if (resumeAgentConfig) {
              setResumeAgentConfig(false)
              setShowConfig(true)
            }
          }} />
        )}

        {AGENT_COLLABORATION_ENABLED && showCollaborationConfig && (
          <CollaborationConfigDialog
            agents={agents}
            isRunning={isRunning}
            providers={providers}
            onClose={() => setShowCollaborationConfig(false)}
            onStart={(task, agentIds, rootAgentId, mode) => {
              setShowCollaborationConfig(false)
              void handleMultiAgent(task, agentIds, rootAgentId, mode)
            }}
          />
        )}
      </aside>
    </TooltipProvider>
  )
}
