import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { ProviderLogo } from '@/components/agent/ProviderLogo'
import { searchProviders } from '@/lib/provider-search'
import { useTranslation } from '@/lib/i18n/runtime'
import { WaitingText } from '@/components/ui/animated-ellipsis'
import { usePopover } from '@/hooks/use-popover'
import type { ProviderDefinition } from '@/types/provider'

interface AgentProviderPickerProps {
  providers: ProviderDefinition[]
  value: string
  loading: boolean
  disabled: boolean
  onChange: (providerId: string) => void
}

export function AgentProviderPicker({
  providers,
  value,
  loading,
  disabled,
  onChange,
}: AgentProviderPickerProps) {
  const { language, t } = useTranslation()
  const [query, setQuery] = useState('')

  const filteredProviders = useMemo(
    () => searchProviders(providers, query, language).map(({ provider }) => provider),
    [language, providers, query],
  )
  const selectedProvider = providers.find((provider) => provider.id === value)
  const selectedLabel = selectedProvider
    ? `${selectedProvider.name}${selectedProvider.isCustom ? '' : ` (${selectedProvider.id})`}`
    : loading
      ? t('agentConfig.loading')
      : t('providerSettings.enterApiKey')

  const {
    open,
    position,
    triggerRef,
    popoverRef,
    initialFocusRef,
    optionsRef,
    keyboard,
    show,
    close,
  } = usePopover({
    minWidth: 256,
    blocked: () => disabled,
    contentKey: filteredProviders.length,
  })

  const popup = open && createPortal(
    <div
      ref={(node) => { popoverRef.current = node }}
      role="dialog"
      aria-label="LLM Provider"
      className="fixed z-[10000] flex max-h-[min(18rem,50vh)] flex-col overflow-hidden rounded-md border bg-card text-card-foreground shadow-xl"
      style={{
        left: position?.left ?? -9999,
        top: position?.top ?? -9999,
        width: position?.width ?? Math.max(triggerRef.current?.getBoundingClientRect().width ?? 0, 256),
        visibility: position ? 'visible' : 'hidden',
      }}
      data-testid="agent-provider-menu"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      <div className="shrink-0 border-b bg-card p-2">
        <div className="flex h-9 items-center gap-2 rounded-[4px] bg-muted px-3 focus-within:ring-1 focus-within:ring-ring">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={(node) => { initialFocusRef.current = node }}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                keyboard.focusOption(0)
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={t('providerSettings.search')}
            aria-label={t('providerSettings.search')}
            data-testid="agent-provider-search"
          />
        </div>
      </div>

      <div
        ref={(node) => { optionsRef.current = node }}
        role="listbox"
        aria-label="LLM Provider"
        className="min-h-0 flex-1 overflow-y-auto p-1.5"
        onKeyDown={keyboard.onKeyDown}
      >
        {filteredProviders.length === 0 ? (
          <div className="flex h-20 items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {t('providerSettings.noSearchResults')}
          </div>
        ) : filteredProviders.map((provider) => {
          const selected = provider.id === value
          return (
            <button
              key={provider.id}
              type="button"
              role="option"
              aria-selected={selected}
              className="relative flex min-h-9 w-full items-center rounded-[4px] px-2 py-2 pr-8 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
              title={provider.id}
              onClick={() => {
                onChange(provider.id)
                close(true)
              }}
              data-testid={`agent-provider-option-${provider.id}`}
            >
              <ProviderLogo
                providerId={provider.id}
                providerName={provider.name}
                className="h-5 w-5 rounded-[4px]"
                decorative
              />
              <span className="min-w-0 flex-1 truncate">
                {provider.name}{provider.isCustom ? '' : ` (${provider.id})`}
              </span>
              {selected && <Check className="absolute right-2 h-4 w-4 text-primary" />}
            </button>
          )
        })}
      </div>
    </div>,
    document.body,
  )

  return (
    <>
      <button
        ref={(node) => { triggerRef.current = node }}
        type="button"
        className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-sm text-card-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="LLM Provider"
        onClick={() => open ? close() : show()}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            show()
          }
        }}
        data-testid="agent-provider-select"
      >
        {selectedProvider && (
          <ProviderLogo
            providerId={selectedProvider.id}
            providerName={selectedProvider.name}
            className="h-5 w-5 rounded-[4px]"
            decorative
          />
        )}
        <span className="min-w-0 flex-1 truncate">
          {loading && !selectedProvider ? <WaitingText text={t('agentConfig.loading')} /> : selectedLabel}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {popup}
    </>
  )
}
