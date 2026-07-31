import { ipcMain } from 'electron'
import { IPC } from './channels'
import * as authStorage from '../services/auth-storage.service'
import * as providerRegistry from '../services/provider-registry.service'
import * as customProvider from '../services/custom-provider.service'

export function registerProviderHandlers(): void {
  ipcMain.handle(IPC.PROVIDER_LIST, async (_e, forceRefresh?: boolean) => {
    const builtin = await providerRegistry.getProviderCatalog(forceRefresh)
    const customs = await customProvider.getCustomProviders()
    const customDefs = customs.map(customProvider.toProviderDefinition)
    return [...builtin, ...customDefs]
  })

  ipcMain.handle(IPC.PROVIDER_GET, async (_e, providerId: string) => {
    if (providerId.startsWith('custom-')) {
      const customs = await customProvider.getCustomProviders()
      const found = customs.find((p) => p.id === providerId)
      return found ? customProvider.toProviderDefinition(found) : null
    }
    return providerRegistry.getProviderById(providerId)
  })

  ipcMain.handle(IPC.PROVIDER_DETECT_OLLAMA, async (_e, baseURL?: string) => {
    return providerRegistry.detectOllama(baseURL)
  })

  ipcMain.handle(IPC.AUTH_GET_ALL, async () => authStorage.getAllAuth())

  ipcMain.handle(IPC.AUTH_SET, async (_e, payload: { providerId: string; apiKey: string }) => {
    await authStorage.setAuth(payload.providerId, { type: 'api', key: payload.apiKey })
    return { success: true }
  })

  ipcMain.handle(IPC.AUTH_REMOVE, async (_e, providerId: string) => {
    await authStorage.removeAuth(providerId)
    return { success: true }
  })

  ipcMain.handle(IPC.CUSTOM_PROVIDER_LIST, async () => customProvider.getCustomProviders())

  ipcMain.handle(IPC.CUSTOM_PROVIDER_SAVE, async (_e, provider) => {
    return customProvider.saveCustomProvider(provider)
  })

  ipcMain.handle(IPC.CUSTOM_PROVIDER_DELETE, async (_e, id: string) => {
    return customProvider.deleteCustomProvider(id)
  })
}