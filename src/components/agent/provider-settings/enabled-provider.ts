import { safeStorage } from '@/lib/safe-storage'

const ENABLED_PROVIDER_STORAGE_KEY = 'provider-settings-enabled-provider'

export function readEnabledProviderId(): string | null {
  return safeStorage.get(ENABLED_PROVIDER_STORAGE_KEY)
}

export function persistEnabledProviderId(providerId: string | null) {
  if (providerId) safeStorage.set(ENABLED_PROVIDER_STORAGE_KEY, providerId)
  else safeStorage.remove(ENABLED_PROVIDER_STORAGE_KEY)
}
