import { Bot } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/runtime'
import { STARTER_PROMPTS } from './starter-prompts'

export function AgentWelcomeCard({
  agentName,
  agentColor,
  agentRole,
  disabled,
  onSelectPrompt,
}: {
  agentName: string
  agentColor: string
  agentRole: string | undefined
  disabled: boolean
  onSelectPrompt: (id: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="my-auto flex flex-col items-center justify-center px-1 py-4 text-center">
      <div
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border shadow-sm transition-transform hover:scale-105"
        style={{
          backgroundColor: `${agentColor}18`,
          borderColor: `${agentColor}40`,
        }}
      >
        <Bot className="h-6 w-6" style={{ color: agentColor }} />
      </div>
      <h3 className="text-sm font-semibold tracking-tight text-foreground">
        {agentName || t('agents.agent')}
      </h3>
      <p className="mt-1 max-w-[240px] text-xs text-muted-foreground">
        {agentRole || t('agentUi.emptyStateHint')}
      </p>

      {/* Quick Starter Prompt Chips */}
      <div className="mt-5 w-full space-y-1.5 text-left">
        <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          {t('agentUi.quickPrompts')}
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          {STARTER_PROMPTS.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectPrompt(item.id)}
                disabled={disabled}
                className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/80 p-2 text-left text-xs transition-all hover:border-primary/40 hover:bg-accent/60 hover:shadow-xs active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
                  <Icon className="h-3 w-3" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                  {t(item.labelKey)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
