import { IPC } from './channels'
import { handleTrustedIpc } from './trusted-ipc'
import * as authStorage from '../services/auth-storage.service'
import * as providerRegistry from '../services/provider-registry.service'
import * as customProvider from '../services/custom-provider.service'
import * as providerBaseURL from '../services/provider-base-url.service'
import {
  normalizeProviderBaseURL,
  normalizeProviderEndpoint,
} from '../services/provider-base-url.util'

export function registerProviderHandlers(): void {
  handleTrustedIpc(IPC.PROVIDER_LIST, async (_e, forceRefresh?: boolean) => {
    const builtin = await providerRegistry.getProviderCatalog(forceRefresh)
    const customs = await customProvider.getCustomProviders()
    const customDefs = customs.map(customProvider.toProviderDefinition)
    return providerBaseURL.applyProviderBaseURLs([...builtin, ...customDefs])
  })

  handleTrustedIpc(IPC.PROVIDER_GET, async (_e, providerId: string) => {
    if (providerId.startsWith('custom-')) {
      const customs = await customProvider.getCustomProviders()
      const found = customs.find((p) => p.id === providerId)
      if (!found) return null
      const [configured] = await providerBaseURL.applyProviderBaseURLs([
        customProvider.toProviderDefinition(found),
      ])
      return configured
    }
    const found = await providerRegistry.getProviderById(providerId)
    if (!found) return null
    const [configured] = await providerBaseURL.applyProviderBaseURLs([found])
    return configured
  })

  handleTrustedIpc(IPC.PROVIDER_DETECT_OLLAMA, async (_e, baseURL?: string) => {
    return providerRegistry.detectOllama(baseURL)
  })

  handleTrustedIpc(IPC.PROVIDER_SET_BASE_URL, async (
    _e,
    payload: { providerId: string; baseURL: string },
  ) => {
    if (!payload || typeof payload.providerId !== 'string' || typeof payload.baseURL !== 'string') {
      throw new Error('INVALID_PROVIDER_BASE_URL')
    }
    const customs = payload.providerId.startsWith('custom-')
      ? await customProvider.getCustomProviders()
      : []
    const provider = payload.providerId.startsWith('custom-')
      ? customs.find((item) => item.id === payload.providerId)
      : await providerRegistry.getProviderById(payload.providerId)
    if (!provider) throw new Error('UNKNOWN_PROVIDER')

    const providerDefaultApi = 'baseURL' in provider
      ? provider.baseURL
      : provider.defaultApi ?? provider.api
    const providerDefinition = 'baseURL' in provider
      ? customProvider.toProviderDefinition(provider)
      : provider
    const baseURL = normalizeProviderEndpoint(providerDefinition, payload.baseURL)
    let defaultBaseURL = providerDefaultApi.trim()
    try {
      defaultBaseURL = normalizeProviderBaseURL(provider.protocol, providerDefaultApi)
    } catch {
      // Account-scoped catalog values can be ${...} templates rather than a
      // usable URL. A validated user URL is necessarily an override for them.
    }
    const override = baseURL === defaultBaseURL ? '' : baseURL
    await providerBaseURL.setProviderBaseURL(payload.providerId, override)
    return { success: true, baseURL: override || defaultBaseURL }
  })

  handleTrustedIpc(IPC.AUTH_GET_ALL, async () => authStorage.getAllAuth())

  handleTrustedIpc(IPC.AUTH_SET, async (_e, payload: { providerId: string; apiKey: string }) => {
    if (!payload || typeof payload.providerId !== 'string' || typeof payload.apiKey !== 'string'
      || !payload.providerId.trim() || !payload.apiKey.trim()) {
      throw new Error('INVALID_PROVIDER_AUTH')
    }
    await authStorage.setAuth(payload.providerId.trim(), { type: 'api', key: payload.apiKey.trim() })
    return { success: true, storage: authStorage.getAuthStorageMode() }
  })

  handleTrustedIpc(IPC.AUTH_REMOVE, async (_e, providerId: string) => {
    await authStorage.removeAuth(providerId)
    return { success: true }
  })

  handleTrustedIpc(IPC.CUSTOM_PROVIDER_LIST, async () => customProvider.getCustomProviders())

  handleTrustedIpc(IPC.CUSTOM_PROVIDER_SAVE, async (_e, provider) => {
    return customProvider.saveCustomProvider({
      ...provider,
      baseURL: normalizeProviderBaseURL(provider.protocol, provider.baseURL),
    })
  })

  handleTrustedIpc(IPC.CUSTOM_PROVIDER_TEST_CONNECTION, async (_e, payload) => {
    if (!payload || typeof payload.baseURL !== 'string' || typeof payload.apiKey !== 'string') {
      return { success: false, models: [], error: 'invalid-base-url' }
    }
    return customProvider.testCustomProviderConnection(payload.baseURL, payload.apiKey)
  })

  handleTrustedIpc(IPC.CUSTOM_PROVIDER_DELETE, async (_e, id: string) => {
    await providerBaseURL.setProviderBaseURL(id, '')
    await authStorage.removeAuth(id)
    return customProvider.deleteCustomProvider(id)
  })

  handleTrustedIpc(IPC.PROVIDER_DELETE, async (_e, providerId: string) => {
    if (typeof providerId !== 'string' || !providerId.trim()) {
      return { success: false }
    }
    await providerBaseURL.setProviderBaseURL(providerId, '')
    await authStorage.removeAuth(providerId)
    if (providerId.startsWith('custom-')) {
      await customProvider.deleteCustomProvider(providerId)
    } else {
      await providerRegistry.addDeletedProviderId(providerId)
    }
    return { success: true }
  })
}
