import { Bot, Plus, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/runtime'
import type { AgentConfig } from '@/types/agent'

interface AgentListProps {
  agents: AgentConfig[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onEdit: (agent: AgentConfig) => void
}

export function AgentList({ agents, activeId, onSelect, onNew, onEdit }: AgentListProps) {
  const { t } = useTranslation()

  return (
    <TooltipProvider delayDuration={450}>
      <div className="space-y-1 p-2">
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('agentUi.agents')}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={onNew}
                aria-label={t('agents.newAgent')}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="whitespace-nowrap rounded-[2px] border-0 bg-[#666] px-1.5 py-1.5 text-center text-[12px] leading-normal text-white shadow-none">
              {t('agents.newAgent')}
            </TooltipContent>
          </Tooltip>
        </div>

        {agents.map((agent) => (
          <button
            key={agent.id}
            className={cn(
              'group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
              activeId === agent.id ? 'bg-accent' : 'hover:bg-accent/50',
              !agent.enabled && 'opacity-50',
            )}
            onClick={() => onSelect(agent.id)}
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: agent.color + '22' }}
            >
              <Bot className="h-4 w-4" style={{ color: agent.color }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{agent.name}</p>
              <p className="truncate text-xs text-muted-foreground">{agent.role}</p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100"
                  onClick={(e) => { e.stopPropagation(); onEdit(agent) }}
                  aria-label={t('agentUi.editAgent', { agent: agent.name })}
                >
                  <Settings className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="whitespace-nowrap rounded-[2px] border-0 bg-[#666] px-1.5 py-1.5 text-center text-[12px] leading-normal text-white shadow-none">
                {t('agentUi.editAgent', { agent: agent.name })}
              </TooltipContent>
            </Tooltip>
          </button>
        ))}
      </div>
    </TooltipProvider>
  )
}
