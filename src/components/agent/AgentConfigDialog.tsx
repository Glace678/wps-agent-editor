import { useEffect, useState, useMemo } from 'react'
import type { AgentConfig } from '@/types/agent'
import type { ProviderDefinition } from '@/types/provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { useTranslation } from '@/lib/i18n/runtime'

interface AgentConfigDialogProps {
  agent: AgentConfig | null
  onSave: (agent: AgentConfig) => void
  onClose: () => void
}

const AVAILABLE_TOOLS = [
  { id: 'insert_text', key: 'agentConfig.insertText' },
  { id: 'append_paragraph', key: 'agentConfig.appendParagraph' },
  { id: 'replace_text', key: 'agentConfig.findReplace' },
  { id: 'read_document', key: 'agentConfig.readDocument' },
] as const

export function AgentConfigDialog({ agent, onSave, onClose }: AgentConfigDialogProps) {
  const { language, t } = useTranslation()
  const [form, setForm] = useState<AgentConfig | null>(null)
  const [providers, setProviders] = useState<ProviderDefinition[]>([])
  const [providerSearch, setProviderSearch] = useState('')
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [loadingProviders, setLoadingProviders] = useState(true)

  useEffect(() => {
    if (!agent) return
    setForm({ ...agent })
  }, [agent])

  useEffect(() => {
    if (!agent) return
    setLoadingProviders(true)
    window.api.provider.list().then((list) => {
      setProviders(list)
      setLoadingProviders(false)
    })
  }, [agent, language])

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === form?.providerId),
    [providers, form?.providerId],
  )

  const filteredProviders = useMemo(() => {
    const q = providerSearch.toLowerCase()
    if (!q) return providers
    return providers.filter(
      (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
    )
  }, [providers, providerSearch])

  const handleProviderChange = async (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId)
    if (!provider || !form) return

    let model = provider.models[0]?.id || ''
    let baseURL = provider.api

    if (providerId === 'ollama') {
      const detected = await window.api.provider.detectOllama()
      if (detected.available) {
        setOllamaModels(detected.models)
        model = detected.models[0] || model
        baseURL = detected.baseURL
      }
    }

    setForm({
      ...form,
      providerId,
      model: model || form.model,
      baseURL: provider.isLocal ? baseURL : undefined,
    })
  }

  if (!agent || !form) return null

  const toggleTool = (toolId: string) => {
    setForm((f) => f ? {
      ...f,
      tools: f.tools.includes(toolId)
        ? f.tools.filter((t) => t !== toolId)
        : [...f.tools, toolId],
    } : f)
  }

  const modelOptions = form.providerId === 'ollama' && ollamaModels.length > 0
    ? ollamaModels.map((m) => ({ id: m, name: m }))
    : selectedProvider?.models || []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-card shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('agentConfig.configAgent')}
      >
        <div className="p-6 pb-0">
          <h2 className="text-lg font-semibold">{t('agentConfig.configAgent')}</h2>
          <Separator className="my-4" />
        </div>

        {/* 原生滚动：容器仅有 max-h（高度不确定）时，Radix ScrollArea 视口的
            h-full 百分比无法解析，滚动会失效 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6" data-testid="agent-config-dialog-body">
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
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                value={form.systemPrompt}
                onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">
                LLM Provider {loadingProviders && `(${t('agentConfig.loading')})`}
              </label>
              <Input
                className="mb-1"
                placeholder={t('agentConfig.searchProvider')}
                value={providerSearch}
                onChange={(e) => setProviderSearch(e.target.value)}
              />
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.providerId}
                onChange={(e) => handleProviderChange(e.target.value)}
              >
                <optgroup label={t('agentConfig.presetProvider')}>
                  {filteredProviders.filter((p) => !p.isCustom).map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                  ))}
                </optgroup>
                {filteredProviders.some((p) => p.isCustom) && (
                  <optgroup label={t('agentConfig.customProvider')}>
                    {filteredProviders.filter((p) => p.isCustom).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {selectedProvider && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedProvider.protocol} · {selectedProvider.api || t('agentConfig.local')}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('agentConfig.model')}</label>
                {modelOptions.length > 0 ? (
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                  >
                    {modelOptions.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                ) : (
                  <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('agentConfig.temperature')}</label>
                <Input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={form.temperature}
                  onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) || 0.7 })}
                />
              </div>
            </div>

            {(form.providerId === 'ollama' || selectedProvider?.isCustom) && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t('agentConfig.baseUrl')}</label>
                <Input
                  value={form.baseURL ?? selectedProvider?.api ?? ''}
                  onChange={(e) => setForm({ ...form, baseURL: e.target.value })}
                />
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('agentConfig.availableTools')}</label>
              <div className="mt-1 flex flex-wrap gap-2">
                {AVAILABLE_TOOLS.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      form.tools.includes(tool.id)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input hover:bg-accent'
                    }`}
                    onClick={() => toggleTool(tool.id)}
                  >
                    {t(tool.key)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t p-6">
          <Button variant="outline" onClick={onClose}>{t('agentConfig.cancel')}</Button>
          <Button onClick={() => { onSave(form); onClose() }}>{t('agentConfig.save')}</Button>
        </div>
      </div>
    </div>
  )
}
