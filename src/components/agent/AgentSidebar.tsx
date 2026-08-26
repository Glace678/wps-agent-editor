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
import { CollaborationTimeline } from './CollaborationTimeline'
import { CollaborationConfigDialog } from './CollaborationConfigDialog'
import { AgentApprovalBanner } from './AgentApprovalBanner'
import { ArtifactReviewPanel } from './ArtifactReviewPanel'
import { ArtifactHistoryPanel } from './ArtifactHistoryPanel'
import type { AgentAttachment, AgentConfig, AgentReasoningSelection, ChatMessage } from '@/types/agent'
import { DEFAULT_DOCUMENT_OPERATION_PROMPT } from '@/lib/document-operation-prompt'
import type { AgentApprovalRequest } from '@/types/document'
import type { ProviderDefinition } from '@/types/provider'

interface AgentSidebarProps {
  /** 折叠右侧 Agent 助手侧栏 */
  onCollapse?: () => void
}

export function AgentSidebar({ onCollapse }: AgentSidebarProps) {
  const { language, t } = useTranslation()
  const {
    agents, activeAgentId, messages, isRunning, taskStatus, activeRunId, isStopping,
    setAgents, setActiveAgentId, addMessage, setIsRunning, setActiveRunId, setIsStopping, setTaskStatus,
    ensureConversationId,
    collaborationEvents, addCollaborationEvent, clearCollaborationEvents,
    pendingApproval, approvalStatus, setPendingApproval, setApprovalStatus, setWordPlayback,
  } = useAgentStore()
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [showProviderSettings, setShowProviderSettings] = useState(false)
  const [resumeAgentConfig, setResumeAgentConfig] = useState(false)
  const [showCollaborationConfig, setShowCollaborationConfig] = useState(false)
  const [providers, setProviders] = useState<ProviderDefinition[]>([])
  const [isCollaborationCollapsed, setIsCollaborationCollapsed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.agent.list().then((list) => {
      if (!cancelled) setAgents(list.map((agent) => localizeAgentDefaults(agent, language)))
    })
    return () => { cancelled = true }
  }, [language, setAgents])

  useEffect(() => {
    let cancelled = false
    void window.api.provider.list().then((list) => {
      if (!cancelled) setProviders(list)
    }).catch(() => {
      if (!cancelled) setProviders([])
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!AGENT_COLLABORATION_ENABLED) return
    const unsubscribe = window.api.agent.onEvent?.((event) => {
      addCollaborationEvent(event)
      if (event.playback) setWordPlayback(event.playback)
      if (event.type === 'approval-required' && event.approval) {
        setPendingApproval(event.approval)
        setApprovalStatus('idle')
      } else if (event.type === 'approval-invalidated') {
        const current = useAgentStore.getState().pendingApproval
        if (!current || !event.approval || current.approvalId === event.approval.approvalId) {
          setPendingApproval(null)
          setApprovalStatus('expired')
        }
      } else if (event.type === 'approval-resolved') {
        setPendingApproval(null)
        setApprovalStatus('idle')
      }
    })
    return () => unsubscribe?.()
  }, [addCollaborationEvent, setApprovalStatus, setPendingApproval, setWordPlayback])

  const activeAgent = agents.find((a) => a.id === activeAgentId)

  const handleSend = useCallback(async (content: string, attachments: AgentAttachment[]) => {
    if (!activeAgentId) return
    const userMessage: ChatMessage = { role: 'user', content, attachments }
    addMessage(activeAgentId, userMessage)
    clearCollaborationEvents()
    setIsRunning(true)
    const runId = crypto.randomUUID()
    setActiveRunId(runId)
    setIsStopping(false)
    setTaskStatus(t('agentUi.processing'))

    try {
      const history = [...(messages[activeAgentId] || []), userMessage]
      const conversationId = ensureConversationId(activeAgentId)
      const result = await window.api.agent.chat(activeAgentId, history, conversationId, runId)

      if ('error' in result) {
        if (useAgentStore.getState().isStopping) {
          setTaskStatus(t('codeEditor.stopDebug'))
        } else {
          addMessage(activeAgentId, { role: 'assistant', content: t('agentUi.error', { error: result.error }) })
        }
      } else {
        addMessage(activeAgentId, {
          role: 'assistant',
          content: result.response,
          cacheUsage: result.cacheUsage,
        })
        if (result.toolCalls.length > 0) {
          setTaskStatus(t('agentUi.documentOperationsCompleted', { count: result.toolCalls.length }))
        } else {
          setTaskStatus(t('agentUi.completed'))
        }
      }
    } catch (err) {
      console.error('[AgentSidebar] chat request failed:', err)
      if (useAgentStore.getState().isStopping) {
        setTaskStatus(t('codeEditor.stopDebug'))
      } else {
        addMessage(activeAgentId, { role: 'assistant', content: t('agentUi.requestFailedGeneric') })
        setTaskStatus(t('agentUi.failed'))
      }
    } finally {
      setIsRunning(false)
      setActiveRunId(null)
      setIsStopping(false)
    }
  }, [activeAgentId, addMessage, clearCollaborationEvents, ensureConversationId, messages, setActiveRunId, setIsRunning, setIsStopping, setTaskStatus, t])

  const handleMultiAgent = useCallback(async (task: string, agentIds: string[], rootAgentId: string) => {
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
    setTaskStatus(t('agentUi.collaborating'))

    try {
      const results = await window.api.agent.runTask(
        agentIds,
        task,
        runId,
        rootAgentId,
      )
      if (!Array.isArray(results)) {
        setTaskStatus(useAgentStore.getState().isStopping
          ? t('codeEditor.stopDebug')
          : t('agentUi.collaborationFailed', { error: results.error }))
        return
      }
      for (const result of results) {
        addMessage(result.agentId, {
          role: 'assistant',
          content: result.response,
          cacheUsage: result.cacheUsage,
        })
      }
      setTaskStatus(t('agentUi.collaborationCompleted', { count: results.length }))
    } catch (err) {
      console.error('[AgentSidebar] collaboration request failed:', err)
      setTaskStatus(useAgentStore.getState().isStopping
        ? t('codeEditor.stopDebug')
        : t('agentUi.collaborationFailed', { error: t('agentUi.requestFailedGeneric') }))
    } finally {
      setIsRunning(false)
      setActiveRunId(null)
      setIsStopping(false)
    }
  }, [addMessage, clearCollaborationEvents, setActiveRunId, setIsRunning, setIsStopping, setTaskStatus, t])

  const handleStop = useCallback(() => {
    if (!activeRunId || isStopping) return
    setIsStopping(true)
    setTaskStatus(t('agentUi.processing'))
    void window.api.agent.cancel(activeRunId).catch((error) => {
      console.error('[AgentSidebar] cancel request failed:', error)
      setIsStopping(false)
    })
  }, [activeRunId, isStopping, setIsStopping, setTaskStatus, t])

  const respondToApproval = useCallback(async (
    approval: AgentApprovalRequest,
    decision: 'continue' | 'end',
  ) => {
    setApprovalStatus('submitting')
    try {
      const result = await window.api.agent.respondApproval({
        approvalId: approval.approvalId,
        runId: approval.runId,
        planId: approval.planId,
        planVersion: approval.planVersion,
        documentRevision: approval.documentRevision,
        documentApiRevision: approval.documentApiRevision,
        decision,
      })
      if (!result.success) {
        setPendingApproval(null)
        setApprovalStatus('expired')
      }
    } catch (error) {
      console.error('[AgentSidebar] approval response failed:', error)
      setApprovalStatus('idle')
    }
  }, [setApprovalStatus, setPendingApproval])

  const handleNewAgent = useCallback(() => {
    const newAgent: AgentConfig = {
      id: crypto.randomUUID(),
      name: t('agents.newAgent'),
      role: t('agents.customAssistant'),
      systemPrompt: t('agents.customAssistantPrompt'),
      documentOperationPrompt: DEFAULT_DOCUMENT_OPERATION_PROMPT,
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
  }, [handleMultiAgent, handleNewAgent])

  const handleSaveAgent = useCallback(async (agent: AgentConfig) => {
    const updated = await window.api.agent.save(agent)
    setAgents(updated.map((item) => localizeAgentDefaults(item, language)))
    if (!activeAgentId) setActiveAgentId(agent.id)
  }, [activeAgentId, language, setActiveAgentId, setAgents])

  const handleDeleteAgent = useCallback(async (agentId: string) => {
    const updated = await window.api.agent.delete(agentId)
    const localizedAgents = updated.map((item) => localizeAgentDefaults(item, language))
    setAgents(localizedAgents)
    if (activeAgentId === agentId) {
      setActiveAgentId(localizedAgents[0]?.id ?? null)
    }
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
          onClearHistory={() => {
            if (activeAgentId) {
              useAgentStore.getState().clearMessages(activeAgentId)
            }
          }}
           beforeComposer={(
             <>
              <ArtifactReviewPanel />
              <ArtifactHistoryPanel />
              <AgentApprovalBanner
                approval={pendingApproval}
                status={approvalStatus}
                onContinue={(approval) => { void respondToApproval(approval, 'continue') }}
                onEnd={(approval) => { void respondToApproval(approval, 'end') }}
              />
               {AGENT_COLLABORATION_ENABLED && (
                <CollaborationTimeline
                  events={collaborationEvents}
                  collapsed={isCollaborationCollapsed}
                  onToggle={() => setIsCollaborationCollapsed((collapsed) => !collapsed)}
                />
              )}
              <TaskStatus status={taskStatus} isRunning={isRunning} />
            </>
          )}
        />

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
            onDeleteAgent={handleDeleteAgent}
            onStart={(task, agentIds, rootAgentId) => {
              setShowCollaborationConfig(false)
              void handleMultiAgent(task, agentIds, rootAgentId)
            }}
          />
        )}
      </aside>
    </TooltipProvider>
  )
}
