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
import { Check, ChevronDown, Search } from 'lucide-react'
import { ProviderLogo } from '@/components/agent/ProviderLogo'
import { searchProviders } from '@/lib/provider-search'
import { useTranslation } from '@/lib/i18n/runtime'
import type { ProviderDefinition } from '@/types/provider'

interface AgentProviderPickerProps {
  providers: ProviderDefinition[]
  value: string
  loading: boolean
  disabled: boolean
  onChange: (providerId: string) => void
}

interface PopupPosition {
  left: number
  top: number
  width: number
}

const POPUP_GAP = 4
const VIEWPORT_PADDING = 12

export function AgentProviderPicker({
  providers,
  value,
  loading,
  disabled,
  onChange,
}: AgentProviderPickerProps) {
  const { language, t } = useTranslation()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const optionsRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<PopupPosition | null>(null)

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

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    const popup = popupRef.current
    if (!trigger || !popup) return
    const triggerRect = trigger.getBoundingClientRect()
    const popupHeight = popup.getBoundingClientRect().height
    const width = Math.min(
      Math.max(triggerRect.width, 256),
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

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    setPosition(null)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const show = useCallback(() => {
    if (disabled) return
    setQuery('')
    setPosition(null)
    setOpen(true)
  }, [disabled])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    const frame = requestAnimationFrame(() => {
      updatePosition()
      searchRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [filteredProviders.length, open, updatePosition])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node
        && (popupRef.current?.contains(event.target) || triggerRef.current?.contains(event.target))) {
        return
      }
      close()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(true)
      }
    }
    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node
        && (popupRef.current?.contains(event.target) || triggerRef.current?.contains(event.target))) {
        return
      }
      close()
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
  }, [close, open, updatePosition])

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

  const popup = open && createPortal(
    <div
      ref={popupRef}
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
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                focusOption(0)
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
        ref={optionsRef}
        role="listbox"
        aria-label="LLM Provider"
        className="min-h-0 flex-1 overflow-y-auto p-1.5"
        onKeyDown={handleOptionsKeyDown}
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
        ref={triggerRef}
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
        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {popup}
    </>
  )
}
