import { Plus } from 'lucide-react'
import type { LegacyRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { AuthStatus } from '@/types/provider'
import type { ProviderSearchResult } from '@/lib/provider-search'
import { ProviderLogo } from '../ProviderLogo'
import { ProviderEnableSwitch } from './ProviderEnableSwitch'

export function ProviderListPanel({
  listRef,
  contentRef,
  width,
  searchSummaryText,
  labels,
  search,
  filtered,
  hasSearchQuery,
  selectedId,
  authStatus,
  enabledProviderId,
  onSearchChange,
  onSelect,
  onToggleProvider,
  onAddCustom,
}: {
  listRef: LegacyRef<HTMLDivElement>
  contentRef: LegacyRef<HTMLDivElement>
  width: number
  searchSummaryText: string
  labels: {
    search: string
    searchSummary: string
    noSearchResults: string
    addCustom: string
  }
  search: string
  filtered: ProviderSearchResult[]
  hasSearchQuery: boolean
  selectedId: string
  authStatus: Record<string, AuthStatus>
  enabledProviderId: string | null
  onSearchChange: (value: string) => void
  onSelect: (id: string) => void
  onToggleProvider: (id: string) => void
  onAddCustom: () => void
}) {
  return (
    <div
      ref={listRef}
      data-testid="provider-list"
      className="flex min-w-0 shrink-0 flex-col overflow-hidden"
      style={{ width }}
    >
      <div className="p-2">
        <Input
          data-testid="provider-search"
          placeholder={labels.search}
          aria-label={labels.search}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="h-8 text-xs"
        />
        {hasSearchQuery && filtered.length > 0 && (
          <p
            aria-live="polite"
            data-testid="provider-search-summary"
            className="mt-1 px-1 text-[10px] leading-4 text-muted-foreground"
          >
            {searchSummaryText}
          </p>
        )}
      </div>
      <ScrollArea className="min-w-0 flex-1">
        <div
          ref={contentRef}
          className="min-w-0 overflow-hidden"
          style={{ width, maxWidth: width }}
        >
          {hasSearchQuery && filtered.length === 0 && (
            <p
              aria-live="polite"
              data-testid="provider-search-empty"
              className="px-3 py-6 text-center text-xs leading-5 text-muted-foreground"
            >
              {labels.noSearchResults}
            </p>
          )}
          {filtered.map(({ provider: p }) => {
            const hasConfiguredApiKey = authStatus[p.id]?.configured
              && authStatus[p.id]?.type === 'api'
            return (
              <div
                key={p.id}
                data-testid={`provider-option-${p.id}`}
                className={`flex w-full max-w-full items-center overflow-hidden rounded-lg text-xs transition-colors hover:bg-accent ${
                  selectedId === p.id ? 'bg-accent' : ''
                }`}
                onClick={() => onSelect(p.id)}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-3 py-2 text-left"
                  aria-pressed={selectedId === p.id}
                >
                  <ProviderLogo
                    providerId={p.id}
                    providerName={p.name}
                    className="h-6 w-6 rounded-[4px]"
                    decorative
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.name}</span>
                  </span>
                </button>
                {hasConfiguredApiKey && (
                  <div className="ml-auto shrink-0 pr-3">
                    <ProviderEnableSwitch
                      checked={enabledProviderId === p.id}
                      label={p.name}
                      onChange={() => onToggleProvider(p.id)}
                      providerId={p.id}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>
      <div className="border-t p-2">
        <Button
          data-testid="add-custom-provider"
          variant="outline"
          size="sm"
          className="w-full gap-1 text-xs"
          onClick={onAddCustom}
        >
          <Plus className="h-3 w-3" /> {labels.addCustom}
        </Button>
      </div>
    </div>
  )
}
