import { desktopApi } from '@/platform'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Key } from 'lucide-react'
import type {
  AuthStatus,
  CustomProviderConfig,
  ProviderDefinition,
  ProviderModel,
} from '@/types/provider'
import { orderProvidersForSettings } from '@/lib/provider-order'
import { createProviderSearchIndex, searchProviderIndex } from '@/lib/provider-search'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n/runtime'
import {
  DEFAULT_LIST_WIDTH,
  MAX_LIST_WIDTH,
  MIN_LIST_WIDTH,
} from './provider-settings/resize-constants'
import {
  readEnabledProviderId,
  persistEnabledProviderId,
} from './provider-settings/enabled-provider'
import { createCustomProviderForm } from './provider-settings/custom-provider-form'
import { ProviderListPanel } from './provider-settings/ProviderListPanel'
import { CustomProviderWizard } from './provider-settings/CustomProviderWizard'
import { ProviderDetailPanel } from './provider-settings/ProviderDetailPanel'

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
  const [isSavingKey, setIsSavingKey] = useState(false)
  const [apiKeyError, setApiKeyError] = useState('')
  const [isResettingBaseURL, setIsResettingBaseURL] = useState(false)
  const [isCreatingCustom, setIsCreatingCustom] = useState(false)
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

  const handleSaveBaseURL = useCallback(async () => {
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
  }, [baseURL, load, selectedId, t])

  const handleResetBaseURL = useCallback(async () => {
    if (isResettingBaseURL) return
    const providerId = selectedId
    const restoredBaseURL = defaultBaseURL
    const previousValue = baseURL

    setIsResettingBaseURL(true)
    setBaseURLError('')
    try {
      // 先持久化成功，再更新本地 UI；失败时恢复旧值。
      await desktopApi.providers.setBaseURL(providerId, '')
      setBaseURL(restoredBaseURL)
      setBaseURLSaved(false)
      setProviders((current) => current.map((provider) => (
        provider.id === providerId
          ? { ...provider, api: restoredBaseURL, isApiOverridden: false }
          : provider
      )))
    } catch {
      setBaseURL(previousValue)
      setBaseURLError(t('recentFiles.errorOperationFailed'))
    } finally {
      setIsResettingBaseURL(false)
    }
  }, [baseURL, defaultBaseURL, isResettingBaseURL, selectedId, t])

  const handleSaveKey = useCallback(async () => {
    if (!apiKey.trim() || isSavingKey) return
    setIsSavingKey(true)
    setApiKeyError('')
    try {
      await desktopApi.providers.auth.set(selectedId, apiKey.trim())
      await load()
      setApiKey('')
    } catch {
      setApiKeyError(t('providerSettings.testConnectionFailed'))
    } finally {
      setIsSavingKey(false)
    }
  }, [apiKey, isSavingKey, load, selectedId, t])

  const handleToggleProvider = useCallback((providerId: string) => {
    setSelectedId(providerId)
    setApiKey('')
    setEnabledProviderId((current) => {
      const next = current === providerId ? null : providerId
      persistEnabledProviderId(next)
      return next
    })
  }, [])

  const resetCustomConnectionTest = useCallback(() => {
    customConnectionTestRef.current += 1
    setDetectedModels([])
    setCustomTestError('')
    setIsTestingCustomConnection(false)
    setIsCustomModelMenuOpen(false)
  }, [])

  const closeCustomForm = useCallback(() => {
    setShowCustomForm(false)
    setCustomForm(createCustomProviderForm())
    setCustomApiKey('')
    resetCustomConnectionTest()
  }, [resetCustomConnectionTest])

  const handleTestCustomConnection = useCallback(async () => {
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
  }, [customForm.baseURL, customApiKey, t])

  const handleSaveCustom = useCallback(async () => {
    if (isCreatingCustom) return
    const provider: CustomProviderConfig = {
      id: `custom-${crypto.randomUUID()}`,
      name: customForm.name || t('providerSettings.customProvider'),
      baseURL: customForm.baseURL || '',
      defaultModel: customForm.defaultModel || 'gpt-4o-mini',
      models: detectedModels.length > 0 ? detectedModels : undefined,
      protocol: customForm.protocol || 'openai-compatible',
      createdAt: Date.now(),
    }
    setIsCreatingCustom(true)
    setCustomTestError('')
    try {
      await desktopApi.providers.custom.save(provider)
      if (customApiKey.trim()) {
        await desktopApi.providers.auth.set(provider.id, customApiKey.trim())
      }
      await load()
      // 全部成功后才关闭弹窗并切到新 provider。
      closeCustomForm()
      setSelectedId(provider.id)
    } catch {
      // 失败时保留弹窗与已填内容，仅展示错误。
      setCustomTestError(t('providerSettings.testConnectionFailed'))
    } finally {
      setIsCreatingCustom(false)
    }
  }, [closeCustomForm, customApiKey, customForm.baseURL, customForm.defaultModel, customForm.name, customForm.protocol, detectedModels, isCreatingCustom, load, t])

  const patchCustomForm = useCallback(
    (next: Partial<CustomProviderConfig>) =>
      setCustomForm((current) => ({ ...current, ...next })),
    [],
  )

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
          <ProviderListPanel
            listRef={listPanelRef}
            contentRef={listContentRef}
            width={listWidth}
            searchSummaryText={t('providerSettings.searchSummary', {
              providers: filtered.length,
              models: matchedModelCount,
            })}
            labels={{
              search: t('providerSettings.search'),
              searchSummary: t('providerSettings.searchSummary'),
              noSearchResults: t('providerSettings.noSearchResults'),
              addCustom: t('providerSettings.addCustom'),
            }}
            search={search}
            filtered={filtered}
            hasSearchQuery={hasSearchQuery}
            selectedId={selectedId}
            authStatus={authStatus}
            enabledProviderId={enabledProviderId}
            onSearchChange={setSearch}
            onSelect={(id) => {
              setSelectedId(id)
              setApiKey('')
            }}
            onToggleProvider={handleToggleProvider}
            onAddCustom={() => {
              closeCustomForm()
              setShowCustomForm(true)
            }}
          />

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
              <CustomProviderWizard
                title={t('providerSettings.newCompatibleProvider')}
                labels={{
                  name: t('providerSettings.name'),
                  baseUrl: t('agentConfig.baseUrl'),
                  apiKey: t('providerSettings.customApiKey'),
                  testConnection: t('providerSettings.testConnection'),
                  testingConnection: t('providerSettings.testingConnection'),
                  modelsDetected: t('providerSettings.modelsDetected', { count: detectedModels.length }),
                  defaultModel: t('providerSettings.defaultModel'),
                  create: t('providerSettings.create'),
                  cancel: t('providerSettings.cancel'),
                }}
                form={customForm}
                apiKey={customApiKey}
                detectedModels={detectedModels}
                testError={customTestError}
                isTesting={isTestingCustomConnection}
                isModelMenuOpen={isCustomModelMenuOpen}
                isCreating={isCreatingCustom}
                onFormChange={(next) => patchCustomForm(next)}
                onApiKeyChange={(value) => {
                  setCustomApiKey(value)
                  resetCustomConnectionTest()
                }}
                onTest={() => void handleTestCustomConnection()}
                onModelMenuOpenChange={setIsCustomModelMenuOpen}
                onDefaultModelChange={(id) => patchCustomForm({ defaultModel: id })}
                onCreate={() => void handleSaveCustom()}
                onCancel={closeCustomForm}
              />
            ) : selected ? (
              <ProviderDetailPanel
                selected={selected}
                authStatus={authStatus}
                selectedId={selectedId}
                providerLink={providerLink}
                baseURL={baseURL}
                baseURLError={baseURLError}
                baseURLSaved={baseURLSaved}
                apiKey={apiKey}
                apiKeyError={apiKeyError}
                isSavingKey={isSavingKey}
                hasCustomBaseURL={hasCustomBaseURL}
                isResettingBaseURL={isResettingBaseURL}
                labels={{
                  apiBaseUrl: t('providerSettings.apiBaseUrl'),
                  apiBaseUrlPlaceholder: t('providerSettings.apiBaseUrlPlaceholder'),
                  saveBaseUrl: t('providerSettings.saveBaseUrl'),
                  resetBaseUrl: t('providerSettings.resetBaseUrl'),
                  baseUrlSaved: t('providerSettings.baseUrlSaved'),
                  apiKeyStorage: t('providerSettings.apiKeyStorage'),
                  configuredKeyPlaceholder: t('providerSettings.configuredKeyPlaceholder'),
                  enterApiKey: t('providerSettings.enterApiKey'),
                  saveKey: t('providerSettings.saveKey'),
                  delete: t('providerSettings.delete'),
                  environmentVariables: t('providerSettings.environmentVariables', {
                    variables: selected.env.join(', '),
                  }),
                  localNoApiKey: t('providerSettings.localNoApiKey'),
                  apiDocumentation: t('providerSettings.apiDocumentation'),
                }}
                onBaseURLChange={(value) => {
                  setBaseURL(value)
                  setBaseURLError('')
                  setBaseURLSaved(false)
                }}
                onSaveBaseURL={() => void handleSaveBaseURL()}
                onResetBaseURL={() => void handleResetBaseURL()}
                onApiKeyChange={setApiKey}
                onSaveKey={() => void handleSaveKey()}
                onDeleteKey={async () => {
                  await desktopApi.providers.auth.remove(selectedId)
                  await load()
                }}
                onOpenLink={(url) => void desktopApi.app.openUrl(url)}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
