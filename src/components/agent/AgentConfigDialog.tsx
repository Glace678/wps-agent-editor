import { useEffect, useState } from 'react'
import type { AgentConfig } from '@/types/agent'
import type { AuthStatus, ProviderDefinition } from '@/types/provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { AgentProviderPicker } from './AgentProviderPicker'
import { localizeAgentDefaults } from '@/lib/i18n/agent-defaults'
import { useTranslation } from '@/lib/i18n/runtime'
import { DEFAULT_DOCUMENT_OPERATION_PROMPT } from '@/lib/document-operation-prompt'
import { RotateCcw } from 'lucide-react'

interface AgentConfigDialogProps {
  agent: AgentConfig | null
  onSave: (agent: AgentConfig) => void
  onClose: () => void
  onConfigureProviders: () => void
}

const THEMED_SELECT_CLASS =
  'flex h-8 w-full rounded-[4px] border border-input bg-card px-2.5 text-xs text-card-foreground outline-none transition-colors focus:ring-1 focus:ring-ring'

const THEMED_OPTION_CLASS = 'bg-card text-card-foreground'

export function AgentConfigDialog({
  agent,
  onSave,
  onClose,
  onConfigureProviders,
}: AgentConfigDialogProps) {
  const { language, t } = useTranslation()
  const [form, setForm] = useState<AgentConfig | null>(null)
  const [providers, setProviders] = useState<ProviderDefinition[]>([])
  const [loadingProviders, setLoadingProviders] = useState(true)

  useEffect(() => {
    if (!agent) return
    setForm({ ...localizeAgentDefaults(agent, language), model: agent.model ?? '' })
  }, [agent])

  useEffect(() => {
    setForm((current) => current ? localizeAgentDefaults(current, language) : current)
  }, [language])

  useEffect(() => {
    if (!agent) return
    let cancelled = false
    setLoadingProviders(true)

    void Promise.all([
      window.api.provider.list(),
      window.api.auth.getAll().catch(() => ({} as Record<string, AuthStatus>)),
    ]).then(([list, authStatus]) => {
      if (cancelled) return
      const configuredProviders = list.filter(
        (provider) => provider.isLocal === true
          || (authStatus[provider.id]?.configured === true
            && authStatus[provider.id]?.type === 'api'),
      )
      setProviders(configuredProviders)
      setForm((current) => {
        if (!current) return current
        const isCurrentConfigured = configuredProviders.some((provider) => provider.id === current.providerId)
        if (isCurrentConfigured) {
          const selected = configuredProviders.find((provider) => provider.id === current.providerId)
          return {
            ...current,
            model: current.model || selected?.defaultModel || selected?.models[0]?.id || 'default',
          }
        }
        const fallback = configuredProviders[0]
        if (fallback) {
          return {
            ...current,
            providerId: fallback.id,
            model: fallback.defaultModel || fallback.models[0]?.id || 'default',
          }
        }
        return current
      })
    }).catch(() => {
      if (!cancelled) setProviders([])
    }).finally(() => {
      if (!cancelled) setLoadingProviders(false)
    })

    return () => {
      cancelled = true
    }
  }, [agent, language])

  useEffect(() => {
    if (form?.providerId !== 'ollama') return
    const ollama = providers.find((provider) => provider.id === 'ollama')
    if (!ollama || ollama.models.length > 0) return
    let cancelled = false
    void window.api.provider.detectOllama(ollama.api).then((detected) => {
      if (cancelled || !detected.available) return
      const models = detected.models.map((id) => ({ id, name: id }))
      setProviders((current) => current.map((provider) => (
        provider.id === 'ollama' ? { ...provider, models } : provider
      )))
      setForm((current) => current && !current.model
        ? { ...current, model: models[0]?.id || '' }
        : current)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [form?.providerId, form?.model, providers])

  if (!agent || !form) return null

  const hasConfiguredProvider = providers.some((provider) => provider.id === form.providerId)
  const selectedProvider = providers.find((provider) => provider.id === form.providerId)
  const modelOptions = selectedProvider?.models ?? []
  const hasModelOptions = modelOptions.length > 0 || Boolean(form.model)

  const handleProviderChange = (providerId: string) => {
    const provider = providers.find((item) => item.id === providerId)
    setForm({
      ...form,
      providerId,
      model: provider?.defaultModel || provider?.models[0]?.id || 'default',
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('agentConfig.configAgent')}
      >
        <div className="p-5 pb-0">
          <h2 className="text-base font-semibold">{t('agentConfig.configAgent')}</h2>
          <Separator className="my-3" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5" data-testid="agent-config-dialog-body">
          <div className="space-y-3 pb-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('agentConfig.name')}</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('agentConfig.role')}</label>
              <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('agentConfig.systemPrompt')}</label>
              <textarea
                className="flex min-h-[80px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
                value={form.systemPrompt}
                onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-muted-foreground">
                  {t('agentConfig.documentOperationPrompt')}
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  title={t('agentConfig.restoreDocumentOperationPrompt')}
                  onClick={() => setForm({ ...form, documentOperationPrompt: DEFAULT_DOCUMENT_OPERATION_PROMPT })}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('agentConfig.restoreDefault')}
                </Button>
              </div>
              <textarea
                className="flex min-h-[132px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-xs leading-5 outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="agent-document-operation-prompt"
                value={form.documentOperationPrompt}
                onChange={(event) => setForm({ ...form, documentOperationPrompt: event.target.value })}
              />
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                {t('agentConfig.documentOperationPromptHint')}
              </p>
            </div>

            <div>
              <label
                className="text-xs font-medium text-muted-foreground"
                data-testid="agent-provider-label"
              >
                LLM Provider
              </label>
              <AgentProviderPicker
                providers={providers}
                value={hasConfiguredProvider ? form.providerId : ''}
                loading={loadingProviders}
                disabled={loadingProviders || providers.length === 0}
                onChange={handleProviderChange}
              />
              {!loadingProviders && providers.length === 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={onConfigureProviders}
                >
                  {t('providerSettings.title')}
                </Button>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground" data-testid="agent-model-label">
                {t('providerSettings.defaultModel')}
              </label>
              {hasModelOptions ? (
                <select
                  className={THEMED_SELECT_CLASS}
                  data-testid="agent-model-select"
                  value={form.model}
                  disabled={!hasConfiguredProvider}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                >
                  {!form.model && <option className={THEMED_OPTION_CLASS} value="">{t('providerSettings.defaultModel')}</option>}
                  {form.model && !modelOptions.some((model) => model.id === form.model) && (
                    <option className={THEMED_OPTION_CLASS} value={form.model}>{form.model}</option>
                  )}
                  {modelOptions.map((model) => (
                    <option className={THEMED_OPTION_CLASS} key={model.id} value={model.id}>
                      {model.name || model.id}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  data-testid="agent-model-input"
                  placeholder={t('providerSettings.defaultModel')}
                  value={form.model}
                  disabled={!hasConfiguredProvider}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedProvider?.name || t('providerSettings.defaultModel')}
                {form.model ? ` / ${form.model}` : ''}
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t p-6">
          <Button variant="outline" onClick={onClose}>{t('agentConfig.cancel')}</Button>
          <Button
            disabled={!hasConfiguredProvider}
            onClick={() => {
              const finalModel = form.model.trim() || selectedProvider?.defaultModel || selectedProvider?.models[0]?.id || 'default'
              onSave({ ...form, model: finalModel })
              onClose()
            }}
          >
            {t('agentConfig.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
