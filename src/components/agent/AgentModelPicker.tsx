import { desktopApi } from '@/platform'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { ProviderLogo } from '@/components/agent/ProviderLogo'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { searchProviders } from '@/lib/provider-search'
import { useTranslation } from '@/lib/i18n/runtime'
import type { AuthStatus, ProviderDefinition } from '@/types/provider'

interface AgentModelPickerProps {
  providerId: string
  model: string
  disabled: boolean
  onSelect: (providerId: string, model: string) => Promise<void>
  onConfigureProviders: () => void
  onEditAgent: () => void
}

export function AgentModelPicker({
  providerId,
  model,
  disabled,
  onSelect,
  onConfigureProviders,
  onEditAgent,
}: AgentModelPickerProps) {
  const { language, t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [providers, setProviders] = useState<ProviderDefinition[]>([])
  const [loading, setLoading] = useState(false)
  const [savingModel, setSavingModel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)

    void Promise.all([
      desktopApi.providers.list(),
      desktopApi.providers.auth.getAll().catch(() => ({} as Record<string, AuthStatus>)),
    ]).then(async ([list, authStatus]) => {
      let configured = list.filter(
        (provider) => provider.isLocal === true
          || (authStatus[provider.id]?.configured === true
            && authStatus[provider.id]?.type === 'api'),
      )

      const ollama = providerId === 'ollama'
        ? configured.find((provider) => provider.id === 'ollama' && provider.models.length === 0)
        : undefined
      if (ollama) {
        try {
          const detected = await desktopApi.providers.detectOllama(ollama.api)
          if (detected.available) {
            configured = configured.map((provider) => provider.id === 'ollama'
              ? { ...provider, models: detected.models.map((id) => ({ id, name: id })) }
              : provider)
          }
        } catch {
          // Keep the configured provider visible even if local discovery is unavailable.
        }
      }

      if (!cancelled) setProviders(configured)
    }).catch(() => {
      if (!cancelled) setProviders([])
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [open, providerId])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    requestAnimationFrame(() => searchRef.current?.focus())
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const searchableProviders = useMemo(() => providers.map((provider) => {
    if (provider.id !== providerId || !model || provider.models.some((item) => item.id === model)) {
      return provider
    }
    return { ...provider, models: [{ id: model, name: model }, ...provider.models] }
  }), [model, providerId, providers])

  const groups = useMemo(() => searchProviders(searchableProviders, query, language, { scope: 'provider-names-and-models' })
    .map((result) => ({
      provider: result.provider,
      models: result.matchedModels.length > 0
        ? result.matchedModels
        : result.provider.models,
    }))
    .filter((group) => group.models.length > 0), [language, query, searchableProviders])

  const selectedProvider = searchableProviders.find((provider) => provider.id === providerId)
  const selectedModel = selectedProvider?.models.find((item) => item.id === model)
  const modelLabel = selectedModel?.name || model || t('providerSettings.defaultModel')

  const handleSelect = async (nextProviderId: string, nextModel: string) => {
    if (savingModel || disabled) return
    if (nextProviderId === providerId && nextModel === model) {
      setOpen(false)
      return
    }
    const selectionKey = `${nextProviderId}/${nextModel}`
    setSavingModel(selectionKey)
    setError(null)
    try {
      await onSelect(nextProviderId, nextModel)
      setOpen(false)
      setQuery('')
    } catch (selectionError) {
      console.error('[AgentModelPicker] Failed to switch model:', selectionError)
      setError(t('agentUi.modelSwitchFailed'))
    } finally {
      setSavingModel(null)
    }
  }

  return (
    <div ref={rootRef} className="min-w-0 flex-1">
      <button
        type="button"
        className="flex h-6 w-full max-w-full items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        onClick={() => {
          setOpen((current) => !current)
          setQuery('')
          setError(null)
        }}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('agentUi.switchModel')}
        title={`${selectedProvider?.name || providerId} / ${modelLabel}`}
        data-testid="agent-model-picker-trigger"
      >
        <ProviderLogo
          providerId={providerId}
          providerName={selectedProvider?.name || providerId}
          className="h-4 w-4 rounded-[3px]"
          decorative
        />
        <span className="min-w-0 truncate">{modelLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>

      {open && (
        <div
          className="absolute bottom-[calc(100%+0.5rem)] left-2 right-2 z-50 flex max-h-[min(25rem,70vh)] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
          role="dialog"
          aria-label={t('agentUi.switchModel')}
          data-testid="agent-model-picker"
          dir={language === 'ar' ? 'rtl' : 'ltr'}
        >
          <div className="flex items-center gap-1.5 border-b p-2">
            <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-muted/60 px-2.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                placeholder={t('agentUi.searchModels')}
                aria-label={t('agentUi.searchModels')}
                data-testid="agent-model-search"
              />
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => { setOpen(false); onConfigureProviders() }}
                  aria-label={t('providerSettings.title')}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="whitespace-nowrap rounded-xl border bg-popover px-3.5 py-1.5 text-center text-[12px] font-medium text-popover-foreground shadow-md">{t('providerSettings.title')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => { setOpen(false); onEditAgent() }}
                  aria-label={t('agentConfig.configAgent')}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="whitespace-nowrap rounded-xl border bg-popover px-3.5 py-1.5 text-center text-[12px] font-medium text-popover-foreground shadow-md">{t('agentConfig.configAgent')}</TooltipContent>
            </Tooltip>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox">
            {loading ? (
              <div className="flex h-20 items-center justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : groups.length === 0 ? (
              <div className="flex h-20 items-center justify-center px-4 text-center text-xs text-muted-foreground">
                {t('agentUi.noModelsAvailable')}
              </div>
            ) : groups.map((group) => (
              <div key={group.provider.id} className="pb-1.5 last:pb-0">
                <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <ProviderLogo
                    providerId={group.provider.id}
                    providerName={group.provider.name}
                    className="h-4 w-4 rounded-[3px]"
                    decorative
                  />
                  <span className="min-w-0 truncate">{group.provider.name}</span>
                </div>
                {group.models.map((item) => {
                  const selected = group.provider.id === providerId && item.id === model
                  const selectionKey = `${group.provider.id}/${item.id}`
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className="flex min-h-7 w-full items-center gap-2 rounded-[3px] px-2 py-1 text-left text-xs outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
                      onClick={() => void handleSelect(group.provider.id, item.id)}
                      disabled={Boolean(savingModel)}
                      title={item.id}
                      data-testid={`agent-model-option-${group.provider.id}-${item.id}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.name || item.id}</span>
                      {savingModel === selectionKey
                        ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                        : selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
          {error && <p className="border-t px-2.5 py-1.5 text-xs text-destructive" role="alert">{error}</p>}
        </div>
      )}
    </div>
  )
}
