import { useEffect, useMemo, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  normalizeAgentReasoningSelection,
  normalizeReasoningForProfile,
  parseReasoningSelectionKey,
  reasoningSelectionKey,
  reasoningSelectionsEqual,
  resolveAgentReasoningProfile,
  type AgentReasoningProfile,
} from '@/lib/agent-reasoning'
import { useTranslation } from '@/lib/i18n/runtime'
import type { AgentReasoningSelection } from '@/types/agent'

interface AgentReasoningPickerProps {
  providerId: string
  model: string
  value: AgentReasoningSelection | undefined
  disabled: boolean
  onSelect: (selection: AgentReasoningSelection) => Promise<void>
}

function formatBudget(tokens: number): string {
  if (tokens < 1_024) return String(tokens)
  const value = tokens / 1_024
  return `${Number.isInteger(value) ? value : value.toFixed(1)}K`
}

export function AgentReasoningPicker({
  providerId,
  model,
  value,
  disabled,
  onSelect,
}: AgentReasoningPickerProps) {
  const { language, t } = useTranslation()
  const [profile, setProfile] = useState<AgentReasoningProfile | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const configuredSelection = normalizeAgentReasoningSelection(value)
  const selection = profile
    ? normalizeReasoningForProfile(profile, configuredSelection)
    : configuredSelection

  useEffect(() => {
    let cancelled = false
    setProfile(null)
    setError(null)
    void window.api.provider.get(providerId).then((provider) => {
      if (!cancelled) setProfile(resolveAgentReasoningProfile(provider, model))
    }).catch(() => {
      if (!cancelled) setProfile({
        mode: 'unsupported',
        transport: 'none',
        selections: [{ kind: 'auto' }],
      })
    })
    return () => { cancelled = true }
  }, [model, providerId])

  useEffect(() => {
    if (!profile || profile.mode === 'unsupported') return
    const normalized = normalizeReasoningForProfile(profile, configuredSelection)
    if (reasoningSelectionsEqual(normalized, configuredSelection)) return
    void onSelect(normalized).catch((selectionError) => {
      console.error('[AgentReasoningPicker] Failed to normalize reasoning selection:', selectionError)
    })
  }, [configuredSelection, onSelect, profile])

  const labelForSelection = useMemo(() => (item: AgentReasoningSelection): string => {
    if (item.kind === 'auto') return t('agentUi.reasoningAuto')
    if (item.kind === 'enabled') return t('agentUi.reasoningOn')
    if (item.kind === 'disabled') return t('agentUi.reasoningOff')
    if (item.kind === 'budget') return formatBudget(item.tokens)
    const labels = {
      none: t('agentUi.reasoningNone'),
      minimal: t('agentUi.reasoningMinimal'),
      low: t('agentUi.reasoningLow'),
      medium: t('agentUi.reasoningMedium'),
      high: t('agentUi.reasoningHigh'),
      xhigh: t('agentUi.reasoningExtraHigh'),
      max: t('agentUi.reasoningMaximum'),
    }
    return labels[item.value]
  }, [t])

  const fixed = profile?.mode === 'fixed'
  const unsupported = profile?.mode === 'unsupported'
  const selectedLabel = fixed
    ? t('agentUi.reasoningFixed')
    : labelForSelection(selection)
  const configurable = Boolean(profile && profile.selections.length > 1)
  const tooltip = error
    || (fixed
      ? t('agentUi.reasoningFixed')
      : unsupported
        ? t('agentUi.reasoningUnsupported')
        : t('agentUi.reasoningEffort'))

  const handleSelect = async (nextSelection: AgentReasoningSelection) => {
    if (saving || reasoningSelectionsEqual(nextSelection, selection)) return
    setSaving(true)
    setError(null)
    try {
      await onSelect(nextSelection)
    } catch (selectionError) {
      console.error('[AgentReasoningPicker] Failed to switch reasoning effort:', selectionError)
      setError(t('agentUi.reasoningSwitchFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <DropdownMenu.Root modal={false} dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex shrink-0">
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="flex h-6 items-center gap-0.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
                disabled={disabled || saving || !configurable}
                aria-label={t('agentUi.reasoningEffort')}
                data-testid="agent-reasoning-trigger"
              >
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                <span>{selectedLabel}</span>
                {configurable && <ChevronDown className="h-3 w-3" />}
              </button>
            </DropdownMenu.Trigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="whitespace-nowrap rounded-xl border bg-popover px-3.5 py-1.5 text-center text-[12px] font-medium text-popover-foreground shadow-md">{tooltip}</TooltipContent>
      </Tooltip>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="end"
          sideOffset={6}
          className="z-[10000] min-w-[9rem] rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
          aria-label={t('agentUi.reasoningEffort')}
          data-testid="agent-reasoning-menu"
        >
          <DropdownMenu.RadioGroup
            value={reasoningSelectionKey(selection)}
            onValueChange={(nextValue) => void handleSelect(parseReasoningSelectionKey(nextValue))}
          >
            {(profile?.selections ?? []).map((option) => {
              const key = reasoningSelectionKey(option)
              return (
                <DropdownMenu.RadioItem
                  key={key}
                  value={key}
                  className="relative flex h-7 cursor-default select-none items-center rounded-md px-2 pr-7 text-xs outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  data-testid={`agent-reasoning-${key.replace(':', '-')}`}
                >
                  <span>{labelForSelection(option)}</span>
                  <DropdownMenu.ItemIndicator className="absolute right-2">
                    <Check className="h-3.5 w-3.5 text-primary" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              )
            })}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
