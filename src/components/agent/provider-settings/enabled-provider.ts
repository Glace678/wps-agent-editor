const ENABLED_PROVIDER_STORAGE_KEY = 'provider-settings-enabled-provider'

export function readEnabledProviderId(): string | null {
  try {
    return window.localStorage.getItem(ENABLED_PROVIDER_STORAGE_KEY)
  } catch {
    return null
  }
}

export function persistEnabledProviderId(providerId: string | null) {
  try {
    if (providerId) window.localStorage.setItem(ENABLED_PROVIDER_STORAGE_KEY, providerId)
    else window.localStorage.removeItem(ENABLED_PROVIDER_STORAGE_KEY)
  } catch {
    // The switch still works for this session when storage is unavailable.
  }
}
