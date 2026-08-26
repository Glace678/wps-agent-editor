import { useMemo, useState, useRef, useEffect } from 'react'
import { Bot, ChevronDown, Plus, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/runtime'
import type { AgentConfig } from '@/types/agent'
import type { ProviderDefinition } from '@/types/provider'

interface AgentListProps {
  agents: AgentConfig[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onEdit: (agent: AgentConfig) => void
  providers?: ProviderDefinition[]
}

const MODEL_TOKEN_NAMES: Record<string, string> = {
  api: 'API',
  coder: 'Coder',
  code: 'Code',
  gemini: 'Gemini',
  glm: 'GLM',
  gpt: 'GPT',
  kimi: 'Kimi',
  llama: 'Llama',
  minimax: 'MiniMax',
  mimo: 'MiMo',
  qwen: 'Qwen',
}

function humanizeModelToken(token: string): string {
  const knownName = MODEL_TOKEN_NAMES[token.toLowerCase()]
  if (knownName) return knownName
  if (/^\d+o$/i.test(token)) return token.toLowerCase()
  if (/\d/.test(token)) return token.replace(/[a-z]/gi, (letter) => letter.toUpperCase())
  return token.charAt(0).toUpperCase() + token.slice(1)
}

function humanizeModelId(modelId: string): string {
  const leaf = modelId.trim().split('/').filter(Boolean).at(-1) || modelId.trim()
  if (!leaf) return 'Default'

  return leaf
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .map(humanizeModelToken)
    .join(' ')
}

export function AgentList({
  agents,
  activeId,
  onSelect,
  onNew,
  onEdit,
  providers = [],
}: AgentListProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const modelLabels = useMemo(() => {
    const exact = new Map<string, string>()
    const byModelId = new Map<string, string>()

    for (const provider of providers) {
      for (const model of provider.models) {
        const id = model.id.trim()
        if (!id) continue
        const name = model.name.trim()
        const readableName = name && name.toLowerCase() !== id.toLowerCase() ? name : ''
        exact.set(`${provider.id}\u0000${id}`, readableName || humanizeModelId(id))
        if (readableName && !byModelId.has(id.toLowerCase())) {
          byModelId.set(id.toLowerCase(), readableName)
        }
      }
    }

    return { exact, byModelId }
  }, [providers])

  const modelLabel = (agent: AgentConfig) => {
    const modelId = agent.model.trim()
    if (!modelId) return 'Default'
    return modelLabels.exact.get(`${agent.providerId}\u0000${modelId}`)
      ?? modelLabels.byModelId.get(modelId.toLowerCase())
      ?? humanizeModelId(modelId)
  }

  const providerLabel = (agent: AgentConfig) => {
    const p = providers.find((item) => item.id === agent.providerId)
    return p?.name || agent.providerId
  }

  const activeAgent = agents.find((a) => a.id === activeId)

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <TooltipProvider delayDuration={350}>
      <div ref={rootRef} className="relative border-b border-border/50 bg-background/60 backdrop-blur-xs">
        {/* Compact Trigger Row */}
        <div className="flex items-center gap-1 px-2 py-1.5">
          {/* Agent Selector Button */}
          <button
            type="button"
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2 py-1 text-left transition-all outline-none',
              isOpen
                ? 'border-primary/40 bg-accent/60 shadow-xs'
                : 'border-border/60 bg-card/80 hover:border-border hover:bg-accent/40',
            )}
            onClick={() => setIsOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-label={t('agentUi.agents')}
            data-testid="agent-selector-trigger"
          >
            {activeAgent ? (
              <>
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: `${activeAgent.color}22`, color: activeAgent.color }}
                >
                  <Bot className="h-3 w-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-foreground">{activeAgent.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {activeAgent.role || t('agents.customAssistant')}
                  </div>
                </div>
              </>
            ) : (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {t('agentUi.selectAgent')}
              </span>
            )}
            <ChevronDown className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
          </button>

          {/* Action Buttons */}
          <div className="flex shrink-0 items-center gap-0.5">
            {activeAgent && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit(activeAgent)
                    }}
                    aria-label={t('agentUi.editAgent', { agent: activeAgent.name })}
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="whitespace-nowrap rounded-xl border bg-popover px-3 py-1 text-center text-[11px] font-medium text-popover-foreground shadow-md">
                  {t('agentUi.editAgent', { agent: activeAgent.name })}
                </TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={onNew}
                  aria-label={t('agents.newAgent')}
                  data-testid="agent-new"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="whitespace-nowrap rounded-xl border bg-popover px-3 py-1 text-center text-[11px] font-medium text-popover-foreground shadow-md">
                {t('agents.newAgent')}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Dropdown Agent List Panel */}
        {isOpen && (
          <div
            className="absolute left-1.5 right-1.5 top-full z-50 mt-0.5 flex max-h-[min(20rem,60vh)] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
            role="listbox"
            aria-label={t('agentUi.agents')}
            data-testid="agent-selector-list"
          >
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {agents.map((agent) => {
                const isActive = activeId === agent.id
                const readableModel = modelLabel(agent)
                const readableProvider = providerLabel(agent)

                return (
                  <button
                    key={agent.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={cn(
                      'group flex w-full items-start gap-2 rounded-lg p-2 text-left transition-all outline-none',
                      isActive
                        ? 'bg-accent/80 text-foreground'
                        : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
                      !agent.enabled && 'opacity-50',
                    )}
                    onClick={() => {
                      onSelect(agent.id)
                      setIsOpen(false)
                    }}
                    title={`${agent.name} · ${readableModel} · ${readableProvider}`}
                    data-testid={`agent-option-${agent.id}`}
                  >
                    <span
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-border/40 shadow-2xs"
                      style={{ backgroundColor: `${agent.color}22` }}
                    >
                      <Bot className="h-3.5 w-3.5" style={{ color: agent.color }} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-semibold tracking-tight">
                          {agent.name}
                        </span>
                        {isActive && (
                          <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {agent.role || t('agents.customAssistant')}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-muted-foreground/60">
                        {readableModel} · {readableProvider}
                      </div>
                    </div>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          role="button"
                          tabIndex={0}
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation()
                            onEdit(agent)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation()
                              onEdit(agent)
                            }
                          }}
                          aria-label={t('agentUi.editAgent', { agent: agent.name })}
                        >
                          <Settings className="h-3 w-3" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-[11px]">
                        {t('agentUi.editAgent', { agent: agent.name })}
                      </TooltipContent>
                    </Tooltip>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
