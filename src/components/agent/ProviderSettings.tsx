import { desktopApi } from '@/platform'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Key, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { AuthStatus, ProviderDefinition, CustomProviderConfig, ProviderModel } from '@/types/provider'
import { orderProvidersForSettings } from '@/lib/provider-order'
import { createProviderSearchIndex, searchProviderIndex } from '@/lib/provider-search'
import { ProviderLogo } from '@/components/agent/ProviderLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useTranslation } from '@/lib/i18n/runtime'

const MIN_LIST_WIDTH = 168
const MAX_LIST_WIDTH = 336
const DEFAULT_LIST_WIDTH = 224
const ENABLED_PROVIDER_STORAGE_KEY = 'provider-settings-enabled-provider'

function readEnabledProviderId(): string | null {
  try {
    return window.localStorage.getItem(ENABLED_PROVIDER_STORAGE_KEY)
  } catch {
    return null
  }
}

function persistEnabledProviderId(providerId: string | null) {
  try {
    if (providerId) window.localStorage.setItem(ENABLED_PROVIDER_STORAGE_KEY, providerId)
    else window.localStorage.removeItem(ENABLED_PROVIDER_STORAGE_KEY)
  } catch {
    // The switch still works for this session when storage is unavailable.
  }
}

function ProviderEnableSwitch({
  checked,
  label,
  onChange,
  providerId,
}: {
  checked: boolean
  label: string
  onChange: () => void
  providerId: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-state={checked ? 'checked' : 'unchecked'}
      data-testid={`provider-enable-${providerId}`}
      className={`inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/45 focus-visible:ring-offset-1 ${
        checked ? 'bg-[#22c55e]' : 'bg-[#c7c7c7] dark:bg-[#525252]'
      }`}
      onClick={(event) => {
        event.stopPropagation()
        onChange()
      }}
    >
      <span
        data-provider-switch-thumb=""
        className={`block h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
          checked ? 'translate-x-3' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

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
  const [authStatus, setAuthStatus] = useState<Record<string, AuthStatus>>({})
  const [enabledProviderId, setEnabledProviderId] = useState<string | null>(readEnabledProviderId)
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
  const listPanelRef = useRef<HTMLDivElement>(null)
  const listContentRef = useRef<HTMLDivElement>(null)
  const listWidthRef = useRef(DEFAULT_LIST_WIDTH)
  const customConnectionTestRef = useRef(0)
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH)

  const startListResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = listWidthRef.current
    const pointerId = event.pointerId
    const resizeHandle = event.currentTarget
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    let latestWidth = startWidth
    let animationFrame: number | null = null
    let finished = false

    const flushWidth = () => {
      animationFrame = null
      const width = `${latestWidth}px`
      if (listPanelRef.current) listPanelRef.current.style.width = width
      if (listContentRef.current) {
        listContentRef.current.style.width = width
        listContentRef.current.style.maxWidth = width
      }
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      latestWidth = Math.max(
        MIN_LIST_WIDTH,
        Math.min(MAX_LIST_WIDTH, startWidth + moveEvent.clientX - startX),
      )
      listWidthRef.current = latestWidth

      // Keep the large provider list out of React's pointer-move render path.
      if (animationFrame === null) animationFrame = requestAnimationFrame(flushWidth)
    }

    const finishResize = () => {
      if (finished) return
      finished = true
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerup', onPointerEnd, true)
      document.removeEventListener('pointercancel', onPointerEnd, true)
      window.removeEventListener('blur', finishResize)

      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
      flushWidth()
      setListWidth(latestWidth)
      resizeHandle.removeAttribute('data-resizing')
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }

    const onPointerEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return
      finishResize()
    }

    resizeHandle.setAttribute('data-resizing', 'true')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerup', onPointerEnd, true)
    document.addEventListener('pointercancel', onPointerEnd, true)
    window.addEventListener('blur', finishResize)
  }, [])

  const load = useCallback(async (forceRefresh = false): Promise<ProviderDefinition[]> => {
    const [list, statuses] = await Promise.all([
      desktopApi.providers.list(forceRefresh),
      desktopApi.providers.auth.getAll().catch(() => ({} as Record<string, AuthStatus>)),
    ])
    setProviders(list)
    setAuthStatus(statuses)
    setEnabledProviderId((current) => {
      if (!current) return null
      const status = statuses[current]
      if (status?.configured && status.type === 'api') return current
      persistEnabledProviderId(null)
      return null
    })
    return list
  }, [])

  useEffect(() => {
    let cancelled = false
    void load()
      .then(() => desktopApi.providers.list(true))
      .then((list) => {
        if (!cancelled) setProviders(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [language, load])

  const orderedProviders = useMemo(
    () => orderProvidersForSettings(providers, authStatus),
    [authStatus, providers],
  )

  const providerSearchIndex = useMemo(
    () => createProviderSearchIndex(orderedProviders, language),
    [language, orderedProviders],
  )
  const filtered = useMemo(
    () => searchProviderIndex(providerSearchIndex, search),
    [providerSearchIndex, search],
  )
  const hasSearchQuery = search.trim().length > 0
  const matchedModelCount = useMemo(
    () => filtered.reduce((total, result) => total + result.matchedModels.length, 0),
    [filtered],
  )

  const selected = providers.find((p) => p.id === selectedId)
  const providerLink = selected
    ? selected.doc?.trim() || selected.api.trim() || 'https://models.dev'
    : ''
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
      await desktopApi.providers.setBaseURL(selectedId, value)
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

    await desktopApi.providers.setBaseURL(providerId, '')
    setProviders((current) => current.map((provider) => (
      provider.id === providerId
        ? { ...provider, api: restoredBaseURL, isApiOverridden: false }
        : provider
    )))
  }

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return
    await desktopApi.providers.auth.set(selectedId, apiKey.trim())
    setApiKey('')
    await load()
  }

  const handleToggleProvider = (providerId: string) => {
    setSelectedId(providerId)
    setApiKey('')
    setEnabledProviderId((current) => {
      const next = current === providerId ? null : providerId
      persistEnabledProviderId(next)
      return next
    })
  }

  const resetCustomConnectionTest = () => {
    customConnectionTestRef.current += 1
    setDetectedModels([])
    setCustomTestError('')
    setIsTestingCustomConnection(false)
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
    const requestId = customConnectionTestRef.current + 1
    customConnectionTestRef.current = requestId

    setIsTestingCustomConnection(true)
    setCustomTestError('')
    setDetectedModels([])
    setIsCustomModelMenuOpen(false)

    try {
      const result = await desktopApi.providers.custom.testConnection(testBaseURL, testApiKey)
      // Ignore a late response after the user has edited the URL or API key.
      if (requestId !== customConnectionTestRef.current) return
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
      if (requestId !== customConnectionTestRef.current) return
      setCustomTestError(t('providerSettings.testConnectionFailed'))
    } finally {
      if (requestId === customConnectionTestRef.current) setIsTestingCustomConnection(false)
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
    await desktopApi.providers.custom.save(provider)
    if (customApiKey.trim()) {
      await desktopApi.providers.auth.set(provider.id, customApiKey.trim())
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
        className="flex h-[82vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('providerSettings.title')}
      >
        <div className="flex items-center justify-between border-b p-3.5">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            <h2 className="font-semibold text-sm">{t('providerSettings.title')}</h2>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>{t('providerSettings.close')}</Button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div
            ref={listPanelRef}
            data-testid="provider-list"
            className="flex min-w-0 shrink-0 flex-col overflow-hidden"
            style={{ width: listWidth }}
          >
            <div className="p-2">
              <Input
                data-testid="provider-search"
                placeholder={t('providerSettings.search')}
                aria-label={t('providerSettings.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-xs"
              />
              {hasSearchQuery && filtered.length > 0 && (
                <p
                  aria-live="polite"
                  data-testid="provider-search-summary"
                  className="mt-1 px-1 text-[10px] leading-4 text-muted-foreground"
                >
                  {t('providerSettings.searchSummary', {
                    providers: filtered.length,
                    models: matchedModelCount,
                  })}
                </p>
              )}
            </div>
            <ScrollArea className="min-w-0 flex-1">
              <div
                ref={listContentRef}
                className="min-w-0 overflow-hidden"
                style={{ width: listWidth, maxWidth: listWidth }}
              >
                {hasSearchQuery && filtered.length === 0 && (
                  <p
                    aria-live="polite"
                    data-testid="provider-search-empty"
                    className="px-3 py-6 text-center text-xs leading-5 text-muted-foreground"
                  >
                    {t('providerSettings.noSearchResults')}
                  </p>
                )}
                {filtered.map(({ provider: p, matchedModels }) => {
                  const hasConfiguredApiKey = authStatus[p.id]?.configured
                    && authStatus[p.id]?.type === 'api'
                  const firstMatchedModel = matchedModels[0]
                  const additionalMatchedModelCount = Math.max(0, matchedModels.length - 1)
                  return (
                    <div
                      key={p.id}
                      data-testid={`provider-option-${p.id}`}
                      className={`flex w-full max-w-full items-center overflow-hidden rounded-lg text-xs transition-colors hover:bg-accent ${
                        selectedId === p.id ? 'bg-accent' : ''
                      }`}
                      onClick={() => { setSelectedId(p.id); setApiKey('') }}
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
                          {firstMatchedModel && (
                            <span
                              data-testid={`provider-match-${p.id}`}
                              className="block truncate text-[10px] font-normal text-muted-foreground"
                              title={matchedModels.slice(0, 8).map((model) => model.name).join(', ')}
                            >
                              {firstMatchedModel.name}
                              {additionalMatchedModelCount > 0 ? ` +${additionalMatchedModelCount}` : ''}
                            </span>
                          )}
                        </span>
                      </button>
                      {hasConfiguredApiKey && (
                        <div className="ml-auto shrink-0 pr-3">
                          <ProviderEnableSwitch
                            checked={enabledProviderId === p.id}
                            label={p.name}
                            onChange={() => handleToggleProvider(p.id)}
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
            <div className="w-0.5 bg-border transition-colors group-hover:bg-primary/40 group-active:bg-primary/60 group-data-[resizing=true]:bg-primary/60" />
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
                {!isCustomModelMenuOpen && (
                  <div className="flex gap-2">
                    <Button data-testid="custom-provider-create" onClick={() => void handleSaveCustom()} disabled={!customForm.baseURL?.trim() || !customForm.defaultModel?.trim()}>{t('providerSettings.create')}</Button>
                    <Button variant="outline" onClick={closeCustomForm}>{t('providerSettings.cancel')}</Button>
                  </div>
                )}
              </div>
            ) : selected ? (
              <div className="space-y-5">
                <div>
                  <div className="flex items-center gap-2.5">
                    <ProviderLogo
                      providerId={selected.id}
                      providerName={selected.name}
                      className="h-9 w-9 rounded-md"
                    />
                    <div className="min-w-0">
                      <h3 className="truncate font-medium">{selected.name}</h3>
                      <p className="truncate text-xs text-muted-foreground">ID: {selected.id} | {selected.protocol}</p>
                    </div>
                  </div>
                  {providerLink && (
                    <a
                      data-testid="provider-documentation"
                      href={providerLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex max-w-full items-start gap-1.5 text-xs text-primary hover:underline"
                      title={t('providerSettings.apiDocumentation')}
                    >
                      <svg
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                        style={{ backgroundColor: 'transparent' }}
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        {/* 粗体外链图标：完全复刻用户提供的黑色粗线条样式，透明背景，暗黑模式自适应 text-primary */}
                        <path d="M3 4H13V7.8H6.8V17.2H17.2V11.2H21V21H3V4Z" fill="currentColor" />
                        <path d="M12.8 4H21V12.2L18.6 9.8L11.1 17.3L8.7 14.9L16.2 7.4L12.8 4Z" fill="currentColor" />
                      </svg>
                      <span className="break-all">{providerLink}</span>
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
                      <svg
                        data-testid="provider-save-base-url-icon"
                        className="mr-1 h-[18px] w-[18px] shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M3 2H15.5L21 7.5V22H3V2ZM7 3.75V9.5H16V3.75H7ZM7 14.5V20.25H17V14.5H7Z"
                          fill="currentColor"
                          fillRule="evenodd"
                          clipRule="evenodd"
                        />
                        <path d="M10 3.75V9.5M13 3.75V9.5" stroke="currentColor" strokeWidth="1.35" />
                      </svg>
                      {t('providerSettings.saveBaseUrl')}
                    </Button>
                    <Button
                      size="sm"
                      data-testid="provider-reset-base-url"
                      variant="outline"
                      onClick={() => void handleResetBaseURL()}
                      disabled={!hasCustomBaseURL}
                    >
                      <svg
                        data-testid="provider-reset-base-url-icon"
                        className="mr-1 h-[18px] w-[18px] shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M7.75 19.36A8.5 8.5 0 1 0 3.5 12"
                          fill="none"
                          style={{ fill: 'none' }}
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                        />
                        <path
                          d="M0.8 9L3.5 12L6.7 9.1"
                          fill="none"
                          style={{ fill: 'none' }}
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
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
                      <Button
                        size="sm"
                        data-testid="provider-save-key"
                        onClick={handleSaveKey}
                      >
                        {t('providerSettings.saveKey')}
                      </Button>
                      {authStatus[selectedId]?.configured && (
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="provider-delete-key"
                          onClick={async () => {
                            await desktopApi.providers.auth.remove(selectedId)
                            await load()
                          }}
                        >
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
