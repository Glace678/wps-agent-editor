import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, ExternalLink, Key, LoaderCircle, Plus, RefreshCw, RotateCcw, Save, Trash2 } from 'lucide-react'
import type { ProviderDefinition, CustomProviderConfig, ProviderModel } from '@/types/provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslation } from '@/lib/i18n/runtime'

const MIN_LIST_WIDTH = 168
const MAX_LIST_WIDTH = 336
const DEFAULT_LIST_WIDTH = 224

function createCustomProviderForm(): Partial<CustomProviderConfig> {
  return {
    name: '',
    baseURL: 'https://api.example.com/v1',
    defaultModel: 'gpt-4o-mini',
    protocol: 'openai-compatible',
  }
}

interface ProviderSettingsProps {
  onClose: () => void
}

export function ProviderSettings({ onClose }: ProviderSettingsProps) {
  const { language, t } = useTranslation()
  const [providers, setProviders] = useState<ProviderDefinition[]>([])
  const [authStatus, setAuthStatus] = useState<Record<string, { configured: boolean }>>({})
  const [selectedId, setSelectedId] = useState<string>('deepseek')
  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [baseURLError, setBaseURLError] = useState('')
  const [baseURLSaved, setBaseURLSaved] = useState(false)
  const [search, setSearch] = useState('')
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [customForm, setCustomForm] = useState<Partial<CustomProviderConfig>>(createCustomProviderForm)
  const [customApiKey, setCustomApiKey] = useState('')
  const [detectedModels, setDetectedModels] = useState<ProviderModel[]>([])
  const [customTestError, setCustomTestError] = useState('')
  const [isTestingCustomConnection, setIsTestingCustomConnection] = useState(false)
  const [isCustomModelMenuOpen, setIsCustomModelMenuOpen] = useState(false)
  const listWidthRef = useRef(DEFAULT_LIST_WIDTH)
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH)

  const startListResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = listWidthRef.current
    const previousUserSelect = document.body.style.userSelect

    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.max(
        MIN_LIST_WIDTH,
        Math.min(MAX_LIST_WIDTH, startWidth + moveEvent.clientX - startX),
      )
      listWidthRef.current = nextWidth
      setListWidth(nextWidth)
    }
    const onPointerEnd = () => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerEnd)
      document.removeEventListener('pointercancel', onPointerEnd)
      document.body.style.userSelect = previousUserSelect
    }
    document.body.style.userSelect = 'none'
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerEnd)
    document.addEventListener('pointercancel', onPointerEnd)
  }, [])

  const load = async (): Promise<ProviderDefinition[]> => {
    const [list, auth] = await Promise.all([
      window.api.provider.list(),
      window.api.auth.getAll(),
    ])
    setProviders(list)
    setAuthStatus(auth)
    return list
  }

  useEffect(() => { void load() }, [language])

  const filtered = providers.filter(
    (p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.id.includes(search),
  )

  const selected = providers.find((p) => p.id === selectedId)
  const defaultBaseURL = selected?.defaultApi ?? selected?.api ?? ''
  const hasCustomBaseURL = Boolean(
    selected && baseURL.trim() !== defaultBaseURL.trim(),
  )

  useEffect(() => {
    setBaseURL(selected?.api || '')
    setBaseURLError('')
    setBaseURLSaved(false)
  }, [selectedId, providers.length])

  const handleSaveBaseURL = async () => {
    const value = baseURL.trim()
    try {
      const parsed = new URL(value)
      if (!value || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        throw new Error('INVALID_PROVIDER_BASE_URL')
      }
      await window.api.provider.setBaseURL(selectedId, value)
      const list = await load()
      setBaseURL(list.find((provider) => provider.id === selectedId)?.api || value)
      setBaseURLError('')
      setBaseURLSaved(true)
    } catch {
      setBaseURLError(t('providerSettings.invalidBaseUrl'))
      setBaseURLSaved(false)
    }
  }

  const handleResetBaseURL = async () => {
    const providerId = selectedId
    const restoredBaseURL = defaultBaseURL

    setBaseURL(restoredBaseURL)
    setBaseURLError('')
    setBaseURLSaved(false)

    await window.api.provider.setBaseURL(providerId, '')
    setProviders((current) => current.map((provider) => (
      provider.id === providerId
        ? { ...provider, api: restoredBaseURL, isApiOverridden: false }
        : provider
    )))
  }

  const handleRefresh = async () => {
    const list = await window.api.provider.list(true)
    setProviders(list)
    setBaseURL(list.find((provider) => provider.id === selectedId)?.api || '')
    setBaseURLError('')
    setBaseURLSaved(false)
  }

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return
    await window.api.auth.set(selectedId, apiKey.trim())
    setApiKey('')
    await load()
  }

  const resetCustomConnectionTest = () => {
    setDetectedModels([])
    setCustomTestError('')
    setIsCustomModelMenuOpen(false)
  }

  const closeCustomForm = () => {
    setShowCustomForm(false)
    setCustomForm(createCustomProviderForm())
    setCustomApiKey('')
    resetCustomConnectionTest()
  }

  const handleTestCustomConnection = async () => {
    const testBaseURL = customForm.baseURL?.trim() || ''
    const testApiKey = customApiKey.trim()

    setIsTestingCustomConnection(true)
    setCustomTestError('')
    setDetectedModels([])
    setIsCustomModelMenuOpen(false)

    try {
      const result = await window.api.customProvider.testConnection(testBaseURL, testApiKey)
      if (!result.success) {
        const errorKey = result.error === 'invalid-base-url'
          ? 'invalidBaseUrl'
          : result.error === 'missing-api-key'
            ? 'customApiKeyRequired'
            : result.error === 'unauthorized'
              ? 'testConnectionUnauthorized'
              : result.error === 'no-models'
                ? 'testConnectionNoModels'
                : 'testConnectionFailed'
        setCustomTestError(t(`providerSettings.${errorKey}`))
        return
      }

      setDetectedModels(result.models)
      setCustomForm((current) => ({
        ...current,
        defaultModel: result.models.some((model) => model.id === current.defaultModel)
          ? current.defaultModel
          : result.models[0].id,
      }))
      // Once /models succeeds, open the picker immediately so users can select from every detected model.
      setIsCustomModelMenuOpen(true)
    } catch {
      setCustomTestError(t('providerSettings.testConnectionFailed'))
    } finally {
      setIsTestingCustomConnection(false)
    }
  }

  const handleSaveCustom = async () => {
    const provider: CustomProviderConfig = {
      id: `custom-${crypto.randomUUID()}`,
      name: customForm.name || t('providerSettings.customProvider'),
      baseURL: customForm.baseURL || '',
      defaultModel: customForm.defaultModel || 'gpt-4o-mini',
      models: detectedModels.length > 0 ? detectedModels : undefined,
      protocol: customForm.protocol || 'openai-compatible',
      createdAt: Date.now(),
    }
    await window.api.customProvider.save(provider)
    if (customApiKey.trim()) {
      await window.api.auth.set(provider.id, customApiKey.trim())
    }
    closeCustomForm()
    await load()
    setSelectedId(provider.id)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="flex h-[82vh] w-full max-w-3xl flex-col rounded-lg bg-card shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('providerSettings.title')}
      >
        <div className="flex items-center justify-between border-b p-4">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            <h2 className="font-semibold">{t('providerSettings.title')}</h2>
          </div>
           <div className="flex gap-2">
             <TooltipProvider delayDuration={450}>
               <Tooltip>
                 <TooltipTrigger asChild>
                   <Button
                     variant="ghost"
                     size="icon"
                     onClick={() => void handleRefresh()}
                     aria-label={t('providerSettings.refresh')}
                   >
                     <RefreshCw className="h-4 w-4" />
                   </Button>
                 </TooltipTrigger>
                 <TooltipContent side="bottom" className="whitespace-nowrap rounded-lg border-0 bg-[#666] px-1.5 py-1.5 text-center text-[12px] leading-normal text-white shadow-none">
                   {t('providerSettings.refresh')}
                 </TooltipContent>
               </Tooltip>
             </TooltipProvider>
             <Button variant="outline" size="sm" onClick={onClose}>{t('providerSettings.close')}</Button>
           </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex shrink-0 flex-col" style={{ width: listWidth }}>
            <div className="p-2">
              <Input
                placeholder={t('providerSettings.search')}
                aria-label={t('providerSettings.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <ScrollArea className="flex-1">
               {filtered.map((p) => (
                  <button
                    key={p.id}
                    data-testid={`provider-option-${p.id}`}
                   className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-accent ${
                     selectedId === p.id ? 'bg-accent' : ''
                   }`}
                   onClick={() => { setSelectedId(p.id); setApiKey('') }}
                 >
                   <span className="truncate">{p.name}</span>
                   {authStatus[p.id]?.configured && (
                     <TooltipProvider delayDuration={450}>
                       <Tooltip>
                         <TooltipTrigger asChild>
                           <span
                             className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500"
                             aria-label={t('providerSettings.configured')}
                           />
                         </TooltipTrigger>
                         <TooltipContent side="right" className="whitespace-nowrap rounded-lg border-0 bg-[#666] px-1.5 py-1.5 text-center text-[12px] leading-normal text-white shadow-none">
                           {t('providerSettings.configured')}
                         </TooltipContent>
                       </Tooltip>
                     </TooltipProvider>
                   )}
                 </button>
               ))}
            </ScrollArea>
            <div className="border-t p-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1 text-xs"
                onClick={() => {
                  closeCustomForm()
                  setShowCustomForm(true)
                }}
              >
                <Plus className="h-3 w-3" /> {t('providerSettings.addCustom')}
              </Button>
            </div>
          </div>

          <div
            role="separator"
            aria-orientation="vertical"
            data-testid="provider-list-resizer"
            onPointerDown={startListResize}
            className="group flex w-1.5 shrink-0 cursor-col-resize touch-none items-stretch justify-center outline-none"
          >
            <div className="w-px bg-border transition-colors group-hover:bg-[#d24726] group-active:bg-[#d24726]" />
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto p-5">
            {showCustomForm ? (
              <div className="space-y-3">
                <h3 className="text-sm font-medium">{t('providerSettings.newCompatibleProvider')}</h3>
                <Input placeholder={t('providerSettings.name')} value={customForm.name} onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })} />
                <Input
                  data-testid="custom-provider-base-url"
                  placeholder={t('agentConfig.baseUrl')}
                  value={customForm.baseURL}
                  onChange={(e) => {
                    setCustomForm({ ...customForm, baseURL: e.target.value })
                    resetCustomConnectionTest()
                  }}
                />
                <Input
                  data-testid="custom-provider-api-key"
                  type="password"
                  autoComplete="off"
                  placeholder={t('providerSettings.customApiKey')}
                  value={customApiKey}
                  onChange={(e) => {
                    setCustomApiKey(e.target.value)
                    resetCustomConnectionTest()
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    data-testid="custom-provider-test-connection"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleTestCustomConnection()}
                    disabled={!customForm.baseURL?.trim() || !customApiKey.trim() || isTestingCustomConnection}
                  >
                    {isTestingCustomConnection
                      ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      : <RefreshCw className="h-3.5 w-3.5" />}
                    {isTestingCustomConnection ? t('providerSettings.testingConnection') : t('providerSettings.testConnection')}
                  </Button>
                  {detectedModels.length > 0 && (
                    <span data-testid="custom-provider-models-detected" className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                      <Check className="h-3.5 w-3.5" />
                      {t('providerSettings.modelsDetected', { count: detectedModels.length })}
                    </span>
                  )}
                </div>
                {customTestError && <p data-testid="custom-provider-test-error" className="text-xs text-destructive">{customTestError}</p>}
                {detectedModels.length > 0 ? (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">{t('providerSettings.defaultModel')}</label>
                    {/* 测试成功后自动展开下拉栏，展示该服务 /models 接口返回的全部可选模型。 */}
                    <DropdownMenu.Root open={isCustomModelMenuOpen} onOpenChange={setIsCustomModelMenuOpen}>
                      <DropdownMenu.Trigger asChild>
                        <Button
                          data-testid="custom-provider-model-picker"
                          type="button"
                          variant="outline"
                          className="w-full justify-between font-normal"
                        >
                          <span className="truncate">{customForm.defaultModel}</span>
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        </Button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          data-testid="custom-provider-model-menu"
                          align="start"
                          sideOffset={4}
                          className="z-[60] max-h-60 min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                        >
                          {detectedModels.map((model) => (
                            <DropdownMenu.Item
                              key={model.id}
                              data-testid="custom-provider-model-option"
                              className="flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent focus:bg-accent"
                              onSelect={() => setCustomForm((current) => ({ ...current, defaultModel: model.id }))}
                            >
                              <span className="min-w-0 truncate" title={model.name}>{model.name}</span>
                              {customForm.defaultModel === model.id && <Check className="h-3.5 w-3.5 shrink-0" />}
                            </DropdownMenu.Item>
                          ))}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </div>
                ) : (
                  <Input
                    data-testid="custom-provider-default-model"
                    placeholder={t('providerSettings.defaultModel')}
                    value={customForm.defaultModel}
                    onChange={(e) => setCustomForm({ ...customForm, defaultModel: e.target.value })}
                  />
                )}
                <div className="flex gap-2">
                  <Button onClick={() => void handleSaveCustom()} disabled={!customForm.baseURL?.trim() || !customForm.defaultModel?.trim()}>{t('providerSettings.create')}</Button>
                  <Button variant="outline" onClick={closeCustomForm}>{t('providerSettings.cancel')}</Button>
                </div>
              </div>
            ) : selected ? (
              <div className="space-y-5">
                <div>
                  <h3 className="font-medium">{selected.name}</h3>
                  <p className="text-xs text-muted-foreground">ID: {selected.id} | {selected.protocol}</p>
                  {selected.doc && (
                    <a
                      data-testid="provider-documentation"
                      href={selected.doc}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex max-w-full items-start gap-1.5 text-xs text-primary hover:underline"
                      title={t('providerSettings.apiDocumentation')}
                    >
                      <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="break-all">{selected.doc}</span>
                    </a>
                  )}
                </div>
                <Separator />
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="provider-base-url">
                    {t('providerSettings.apiBaseUrl')}
                  </label>
                  <Input
                    id="provider-base-url"
                    data-testid="provider-base-url"
                    type="url"
                    className="h-11 w-full text-sm"
                    placeholder={t('providerSettings.apiBaseUrlPlaceholder')}
                    value={baseURL}
                    aria-invalid={Boolean(baseURLError)}
                    onChange={(event) => {
                      setBaseURL(event.target.value)
                      setBaseURLError('')
                      setBaseURLSaved(false)
                    }}
                  />
                  {baseURLError && <p className="text-xs text-destructive">{baseURLError}</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button data-testid="provider-save-base-url" size="sm" onClick={() => void handleSaveBaseURL()} disabled={!baseURL.trim()}>
                      <Save className="mr-1.5 h-3.5 w-3.5" />
                      {t('providerSettings.saveBaseUrl')}
                    </Button>
                    <Button
                      size="sm"
                      data-testid="provider-reset-base-url"
                      variant="outline"
                      onClick={() => void handleResetBaseURL()}
                      disabled={!hasCustomBaseURL}
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      {t('providerSettings.resetBaseUrl')}
                    </Button>
                    {baseURLSaved && (
                      <span data-testid="provider-base-url-saved" className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                        <Check className="h-3.5 w-3.5" />
                        {t('providerSettings.baseUrlSaved')}
                      </span>
                    )}
                  </div>
                </div>
                <Separator />
                {!selected.isLocal && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium">{t('providerSettings.apiKeyStorage')}</label>
                    <Input
                      data-testid="provider-api-key"
                      type="password"
                      placeholder={authStatus[selectedId]?.configured
                        ? t('providerSettings.configuredKeyPlaceholder')
                        : t('providerSettings.enterApiKey')}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveKey}>{t('providerSettings.saveKey')}</Button>
                      {authStatus[selectedId]?.configured && (
                        <Button size="sm" variant="outline" onClick={async () => {
                          await window.api.auth.remove(selectedId)
                          await load()
                        }}>
                          <Trash2 className="mr-1 h-3 w-3" /> {t('providerSettings.delete')}
                        </Button>
                      )}
                    </div>
                    {selected.env.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t('providerSettings.environmentVariables', {
                          variables: selected.env.join(', '),
                        })}
                      </p>
                    )}
                  </div>
                )}
                {selected.isLocal && (
                  <p className="text-sm text-muted-foreground">{t('providerSettings.localNoApiKey')}</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
