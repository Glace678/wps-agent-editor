import { useEffect, useState, useCallback } from 'react'
import { Key, PanelRightClose, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAgentStore } from '@/stores/agent.store'
import { useTranslation } from '@/lib/i18n/runtime'
import {
  APP_MENU_NEW_AGENT_EVENT,
  APP_MENU_RUN_MULTI_AGENT_EVENT,
} from '@/lib/app-menu-events'
import { AgentList } from './AgentList'
import { AgentChat } from './AgentChat'
import { AgentConfigDialog } from './AgentConfigDialog'
import { TaskStatus } from './TaskStatus'
import { ProviderSettings } from './ProviderSettings'
import type { AgentConfig } from '@/types/agent'

interface AgentSidebarProps {
  /** 折叠右侧 Agent 助手侧栏 */
  onCollapse?: () => void
}

export function AgentSidebar({ onCollapse }: AgentSidebarProps) {
  const { language, t } = useTranslation()
  const {
    agents, activeAgentId, messages, isRunning, taskStatus,
    setAgents, setActiveAgentId, addMessage, setIsRunning, setTaskStatus,
  } = useAgentStore()
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [showProviderSettings, setShowProviderSettings] = useState(false)

  useEffect(() => {
    window.api.agent.list().then(setAgents)
  }, [language, setAgents])

  const activeAgent = agents.find((a) => a.id === activeAgentId)

  const handleSend = useCallback(async (content: string) => {
    if (!activeAgentId) return
    addMessage(activeAgentId, { role: 'user', content })
    setIsRunning(true)
    setTaskStatus(t('agentUi.processing'))

    try {
      const history = [...(messages[activeAgentId] || []), { role: 'user' as const, content }]
      const result = await window.api.agent.chat(activeAgentId, history)

      if ('error' in result) {
        addMessage(activeAgentId, { role: 'assistant', content: t('agentUi.error', { error: result.error }) })
      } else {
        addMessage(activeAgentId, { role: 'assistant', content: result.response })
        if (result.toolCalls.length > 0) {
          setTaskStatus(t('agentUi.documentOperationsCompleted', { count: result.toolCalls.length }))
        } else {
          setTaskStatus(t('agentUi.completed'))
        }
      }
    } catch (err) {
      console.error('[AgentSidebar] chat request failed:', err)
      addMessage(activeAgentId, { role: 'assistant', content: t('agentUi.requestFailedGeneric') })
      setTaskStatus(t('agentUi.failed'))
    } finally {
      setIsRunning(false)
    }
  }, [activeAgentId, addMessage, messages, setIsRunning, setTaskStatus, t])

  const handleMultiAgent = useCallback(async () => {
    const enabledAgents = agents.filter((a) => a.enabled)
    if (enabledAgents.length < 2) {
      setTaskStatus(t('agentUi.enableAtLeastTwo'))
      return
    }

    setIsRunning(true)
    setTaskStatus(t('agentUi.collaborating'))

    try {
      const results = await window.api.agent.runTask(
        enabledAgents.map((a) => a.id),
        t('agentUi.collaborationTask'),
      )
      if (!Array.isArray(results)) {
        setTaskStatus(t('agentUi.collaborationFailed', { error: results.error }))
        return
      }
      for (const result of results) {
        addMessage(result.agentId, { role: 'assistant', content: result.response })
      }
      setTaskStatus(t('agentUi.collaborationCompleted', { count: results.length }))
    } catch (err) {
      console.error('[AgentSidebar] collaboration request failed:', err)
      setTaskStatus(t('agentUi.collaborationFailed', {
        error: t('agentUi.requestFailedGeneric'),
      }))
    } finally {
      setIsRunning(false)
    }
  }, [agents, addMessage, setIsRunning, setTaskStatus, t])

  const handleNewAgent = useCallback(() => {
    const newAgent: AgentConfig = {
      id: crypto.randomUUID(),
      name: t('agents.newAgent'),
      role: t('agents.customAssistant'),
      systemPrompt: t('agents.customAssistantPrompt'),
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      temperature: 0.7,
      tools: ['read_document', 'insert_text'],
      color: '#6366f1',
      enabled: true,
    }
    setEditingAgent(newAgent)
    setShowConfig(true)
  }, [t])

  useEffect(() => {
    const openNewAgent = () => handleNewAgent()
    const runMultiAgent = () => { void handleMultiAgent() }
    window.addEventListener(APP_MENU_NEW_AGENT_EVENT, openNewAgent)
    window.addEventListener(APP_MENU_RUN_MULTI_AGENT_EVENT, runMultiAgent)
    return () => {
      window.removeEventListener(APP_MENU_NEW_AGENT_EVENT, openNewAgent)
      window.removeEventListener(APP_MENU_RUN_MULTI_AGENT_EVENT, runMultiAgent)
    }
  }, [handleMultiAgent, handleNewAgent])

  const handleSaveAgent = async (agent: AgentConfig) => {
    const updated = await window.api.agent.save(agent)
    setAgents(updated)
    if (!activeAgentId) setActiveAgentId(agent.id)
  }

  return (
    <TooltipProvider delayDuration={450}>
      <aside className="flex h-full min-h-0 w-full flex-col">
        <div className="flex items-center justify-between gap-1 px-2 py-2">
          <div className="flex min-w-0 items-center gap-0.5">
            {onCollapse && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={onCollapse}
                    aria-label={t('appShell.collapseAgentAssistant')}
                  >
                    <PanelRightClose className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="whitespace-nowrap rounded-[2px] border-0 bg-[#666] px-1.5 py-1.5 text-center text-[12px] leading-normal text-white shadow-none">
                  {t('appShell.collapseAgentAssistant')}
                </TooltipContent>
              </Tooltip>
            )}
            <span className="min-w-0 truncate px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('agentUi.assistantTitle')}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setShowProviderSettings(true)}
                  aria-label={t('providerSettings.title')}
                >
                  <Key className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="whitespace-nowrap rounded-[2px] border-0 bg-[#666] px-1.5 py-1.5 text-center text-[12px] leading-normal text-white shadow-none">
                {t('providerSettings.title')}
              </TooltipContent>
            </Tooltip>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={handleMultiAgent}
              disabled={isRunning}
            >
              <Users className="h-3 w-3" />
              {t('agentUi.collaborate')}
            </Button>
          </div>
        </div>

      <AgentList
        agents={agents}
        activeId={activeAgentId}
        onSelect={setActiveAgentId}
        onNew={handleNewAgent}
        onEdit={(agent) => { setEditingAgent(agent); setShowConfig(true) }}
      />

      <Separator />

      <AgentChat
        agentId={activeAgentId}
        agentName={activeAgent?.name ?? ''}
        agentColor={activeAgent?.color ?? '#6366f1'}
        messages={messages[activeAgentId ?? ''] || []}
        isRunning={isRunning}
        onSend={handleSend}
      />

      <TaskStatus status={taskStatus} isRunning={isRunning} />

      {showConfig && editingAgent && (
        <AgentConfigDialog
          agent={editingAgent}
          onSave={handleSaveAgent}
          onClose={() => { setShowConfig(false); setEditingAgent(null) }}
        />
      )}

      {showProviderSettings && (
        <ProviderSettings onClose={() => setShowProviderSettings(false)} />
      )}
    </aside>
    </TooltipProvider>
  )
}
