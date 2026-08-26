import { AgentSidebar } from '@/components/agent/AgentSidebar'

interface AgentAssistantModuleProps {
  onCollapse?: () => void
}

/** 模块 3：Agent 助手 */
export function AgentAssistantModule({ onCollapse }: AgentAssistantModuleProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-sidebar">
      <AgentSidebar onCollapse={onCollapse} />
    </div>
  )
}