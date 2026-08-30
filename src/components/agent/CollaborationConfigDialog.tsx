import { desktopApi } from '@/platform'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Bot, Check, ChevronDown, Play, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useTranslation } from '@/lib/i18n/runtime'
import { cn } from '@/lib/utils'
import type { AgentConfig } from '@/types/agent'
import type { ProviderDefinition } from '@/types/provider'

interface CollaborationConfigDialogProps {
  agents: AgentConfig[]
  isRunning: boolean
  onStart: (task: string, agentIds: string[], rootAgentId: string) => void
  onClose: () => void
  providers?: ProviderDefinition[]
}

interface PopupPosition {
  left: number
  top: number
  width: number
}

const POPUP_GAP = 4
const VIEWPORT_PADDING = 12

export function CollaborationConfigDialog({
  agents,
  isRunning,
  onStart,
  onClose,
  providers: initialProviders,
}: CollaborationConfigDialogProps) {
  const { language, t } = useTranslation()
  const isZh = language.startsWith('zh')
  const [providers, setProviders] = useState<ProviderDefinition[]>(initialProviders ?? [])
  const enabledAgents = useMemo(() => agents.filter((agent) => agent.enabled), [agents])
  const [task, setTask] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [rootAgentId, setRootAgentId] = useState('')

  useEffect(() => {
    if (initialProviders && initialProviders.length > 0) {
      setProviders(initialProviders)
      return
    }
    let cancelled = false
    void desktopApi.providers.list().then((list) => {
      if (!cancelled && Array.isArray(list)) setProviders(list)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [initialProviders])

  const getCleanModelName = useCallback((agent: AgentConfig): string => {
    const raw = agent.model?.trim()
    if (!raw) return 'default'
    const withoutCustomPrefix = raw.replace(/^custom-[a-f0-9-]+\//i, '')
    const provider = providers.find((p) => p.id === agent.providerId)
    const found = provider?.models?.find((m) => m.id === withoutCustomPrefix || m.id === raw)
    return found?.name || withoutCustomPrefix
  }, [providers])

  const getProviderLabel = useCallback((providerId: string | undefined): string => {
    if (!providerId) return ''
    const p = providers.find((item) => item.id === providerId)
    if (p?.name && !p.name.toLowerCase().startsWith('custom-')) return p.name
    if (providerId.toLowerCase().startsWith('custom-')) {
      return t('providerSettings.customProvider')
    }
    return providerId
  }, [providers, t])

  // Searchable Root Agent Dropdown State
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [position, setPosition] = useState<PopupPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const optionsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelectedIds(enabledAgents.map((agent) => agent.id))
    setRootAgentId((current) => current && enabledAgents.some((agent) => agent.id === current)
      ? current
      : enabledAgents[0]?.id ?? '')
  }, [enabledAgents])

  useEffect(() => {
    if (selectedIds.length === 0) {
      if (rootAgentId) setRootAgentId('')
      return
    }
    if (!selectedIds.includes(rootAgentId)) setRootAgentId(selectedIds[0])
  }, [rootAgentId, selectedIds])

  const toggleAgent = (agentId: string) => {
    setSelectedIds((current) => current.includes(agentId)
      ? current.filter((id) => id !== agentId)
      : [...current, agentId])
  }

  const selectedAgents = enabledAgents.filter((agent) => selectedIds.includes(agent.id))
  const selectedAgent = selectedAgents.find((agent) => agent.id === rootAgentId)
  const hasAgentWithoutModel = selectedAgents.some((agent) => !agent.model.trim())
  const canStart = task.trim().length > 0
    && selectedIds.length >= 2
    && Boolean(rootAgentId && selectedIds.includes(rootAgentId))
    && !hasAgentWithoutModel
    && !isRunning

  // Search filter for root agents
  const filteredRootAgents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return selectedAgents
    return selectedAgents.filter((agent) => {
      const cleanModel = getCleanModelName(agent).toLowerCase()
      const providerName = getProviderLabel(agent.providerId).toLowerCase()
      return (
        agent.name.toLowerCase().includes(q)
        || (agent.role && agent.role.toLowerCase().includes(q))
        || cleanModel.includes(q)
        || (agent.model && agent.model.toLowerCase().includes(q))
        || providerName.includes(q)
      )
    })
  }, [getCleanModelName, getProviderLabel, searchQuery, selectedAgents])

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    const popup = popupRef.current
    if (!trigger || !popup) return
    const triggerRect = trigger.getBoundingClientRect()
    const popupHeight = popup.getBoundingClientRect().height
    const width = Math.min(
      Math.max(triggerRect.width, 280),
      window.innerWidth - VIEWPORT_PADDING * 2,
    )
    const left = Math.min(
      Math.max(VIEWPORT_PADDING, triggerRect.left),
      window.innerWidth - width - VIEWPORT_PADDING,
    )
    const below = triggerRect.bottom + POPUP_GAP
    const above = triggerRect.top - POPUP_GAP - popupHeight
    const top = below + popupHeight <= window.innerHeight - VIEWPORT_PADDING
      ? below
      : Math.max(VIEWPORT_PADDING, above)
    setPosition({ left, top, width })
  }, [])

  const closeDropdown = useCallback((restoreFocus = false) => {
    setDropdownOpen(false)
    setPosition(null)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const openDropdown = useCallback(() => {
    if (selectedAgents.length === 0) return
    setSearchQuery('')
    setPosition(null)
    setDropdownOpen(true)
  }, [selectedAgents.length])

  useLayoutEffect(() => {
    if (!dropdownOpen) return
    updatePosition()
    const frame = requestAnimationFrame(() => {
      updatePosition()
      searchRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [dropdownOpen, updatePosition])

  useEffect(() => {
    if (!dropdownOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node
        && (popupRef.current?.contains(event.target) || triggerRef.current?.contains(event.target))) {
        return
      }
      closeDropdown()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDropdown(true)
      }
    }
    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node
        && (popupRef.current?.contains(event.target) || triggerRef.current?.contains(event.target))) {
        return
      }
      closeDropdown()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('focusin', handleFocusIn, true)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('focusin', handleFocusIn, true)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [closeDropdown, dropdownOpen, updatePosition])

  const focusOption = (index: number) => {
    const options = [...(optionsRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    if (options.length === 0) return
    options[(index + options.length) % options.length].focus()
  }

  const handleOptionsKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const options = [...(optionsRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    const currentIndex = options.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusOption(currentIndex + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (currentIndex <= 0) searchRef.current?.focus()
      else focusOption(currentIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusOption(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusOption(options.length - 1)
    }
  }

  const rootAgentPopup = dropdownOpen && createPortal(
    <div
      ref={popupRef}
      role="dialog"
      aria-label={t('agentUi.rootAgent')}
      className="fixed z-[10000] flex max-h-[min(18rem,45vh)] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl dark:border-border dark:bg-[#1f1f23]"
      style={{
        left: position?.left ?? -9999,
        top: position?.top ?? -9999,
        width: position?.width ?? Math.max(triggerRef.current?.getBoundingClientRect().width ?? 0, 280),
        visibility: position ? 'visible' : 'hidden',
      }}
      data-testid="collaboration-root-agent-menu"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      <div className="shrink-0 border-b border-border/60 bg-popover p-2 dark:bg-[#1f1f23]">
        <div className="flex h-8 items-center gap-2 rounded-lg bg-muted/60 px-2.5 focus-within:ring-1 focus-within:ring-ring">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                focusOption(0)
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-xs text-popover-foreground outline-none placeholder:text-muted-foreground"
            placeholder={isZh ? '搜索 Agent...' : 'Search agents...'}
            aria-label={t('agentUi.rootAgent')}
            data-testid="collaboration-root-agent-search"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div
        ref={optionsRef}
        role="listbox"
        aria-label={t('agentUi.rootAgent')}
        className="min-h-0 flex-1 overflow-y-auto p-1.5 space-y-0.5"
        onKeyDown={handleOptionsKeyDown}
      >
        {filteredRootAgents.length === 0 ? (
          <div className="flex h-16 items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {isZh ? '未找到匹配的 Agent' : 'No matching agents'}
          </div>
        ) : filteredRootAgents.map((agent) => {
          const selected = agent.id === rootAgentId
          return (
            <button
              key={agent.id}
              type="button"
              role="option"
              aria-selected={selected}
              className={cn(
                'relative flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs outline-none transition-colors',
                'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent',
                selected ? 'bg-accent/70 font-medium text-foreground' : 'text-foreground/90',
              )}
              onClick={() => {
                setRootAgentId(agent.id)
                closeDropdown(true)
              }}
              data-testid={`collaboration-root-agent-option-${agent.id}`}
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/40"
                style={{ backgroundColor: `${agent.color}22` }}
              >
                <Bot className="h-3.5 w-3.5" style={{ color: agent.color }} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-semibold text-foreground">{agent.name}</span>
                  <span className="text-[10px] text-muted-foreground/40">/</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {agent.role || t('agents.customAssistant')}
                  </span>
                </div>
                {agent.model && (
                  <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">
                    {getCleanModelName(agent)}
                    {getProviderLabel(agent.providerId) ? ` · ${getProviderLabel(agent.providerId)}` : ''}
                  </div>
                )}
              </div>
              {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
          )
        })}
      </div>
    </div>,
    document.body,
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('agentUi.collaborate')}
        onSubmit={(event) => {
          event.preventDefault()
          if (canStart && rootAgentId) onStart(task.trim(), selectedIds, rootAgentId)
        }}
      >
        <div className="p-5 pb-0">
          <h2 className="text-base font-semibold">{t('agentUi.collaborate')}</h2>
          <Separator className="my-3" />
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="collaboration-task">
              {t('agentUi.collaborationTask')}
            </label>
            <textarea
              id="collaboration-task"
              data-testid="collaboration-task-input"
              className="flex min-h-24 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder={t('agentUi.collaborationTask')}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="collaboration-root-agent">
              {t('agentUi.rootAgent')}
            </label>
            <button
              ref={triggerRef}
              id="collaboration-root-agent"
              data-testid="collaboration-root-agent"
              type="button"
              disabled={selectedAgents.length === 0}
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
              onClick={() => (dropdownOpen ? closeDropdown() : openDropdown())}
              onKeyDown={(event) => {
                if (!dropdownOpen && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  openDropdown()
                }
              }}
              className={cn(
                'flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-background/50 px-2.5 text-left text-xs outline-none transition-colors',
                'hover:border-border hover:bg-accent/40 focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                dropdownOpen && 'border-ring ring-1 ring-ring',
              )}
            >
              {selectedAgent ? (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border/40"
                    style={{ backgroundColor: `${selectedAgent.color}22` }}
                  >
                    <Bot className="h-3.5 w-3.5" style={{ color: selectedAgent.color }} />
                  </span>
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {selectedAgent.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/50">/</span>
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                    {selectedAgent.role || t('agents.customAssistant')}
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground">
                  {selectedAgents.length === 0 ? t('agentUi.enableAtLeastTwo') : t('agentUi.rootAgent')}
                </span>
              )}
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
                  dropdownOpen && 'rotate-180 text-foreground',
                )}
              />
            </button>
            {rootAgentPopup}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{t('agentUi.agents')}</span>
              <span className="text-xs text-muted-foreground">{selectedIds.length}/{enabledAgents.length}</span>
            </div>
            <div className="space-y-1.5">
              {enabledAgents.map((agent) => {
                const checked = selectedIds.includes(agent.id)
                return (
                  <label
                    key={agent.id}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-border/70 bg-card/40 p-2.5 transition-colors hover:border-border hover:bg-accent/40"
                  >
                    <input
                      data-testid={`collaboration-agent-${agent.id}`}
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAgent(agent.id)}
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/40"
                      style={{ backgroundColor: `${agent.color}22` }}
                    >
                      <Bot className="h-4 w-4" style={{ color: agent.color }} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-foreground">{agent.name}</span>
                        <span
                          className="shrink-0 max-w-[220px] truncate rounded bg-muted/80 px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted-foreground"
                          title={getCleanModelName(agent)}
                        >
                          {getCleanModelName(agent)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="truncate">{agent.role || t('agents.customAssistant')}</span>
                        {getProviderLabel(agent.providerId) && (
                          <>
                            <span className="text-muted-foreground/40">·</span>
                            <span className="truncate text-[10px] text-muted-foreground/70">
                              {getProviderLabel(agent.providerId)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>
            {selectedIds.length < 2 && (
              <p className="text-xs text-destructive">{t('agentUi.enableAtLeastTwo')}</p>
            )}
            {hasAgentWithoutModel && (
              <p className="text-xs text-destructive">{t('agentUi.modelRequired')}</p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t p-6">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('agentConfig.cancel')}
          </Button>
          <Button type="submit" disabled={!canStart} data-testid="collaboration-start">
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {t('agentUi.collaborate')}
          </Button>
        </div>
      </form>
    </div>
  )
}
