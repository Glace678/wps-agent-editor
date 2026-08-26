import type { ProviderDefinition, ProviderProtocol } from '../../src/types/provider'

const GOOGLE_API_VERSION = /^v\d+(?:(?:alpha|beta)\d*)?$/i
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function parseHTTPURL(input: string): URL {
  const url = new URL(input.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('INVALID_PROVIDER_BASE_URL')
  }
  if (url.username || url.password) {
    throw new Error('INVALID_PROVIDER_BASE_URL')
  }
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname.toLocaleLowerCase())) {
    throw new Error('INSECURE_PROVIDER_BASE_URL')
  }

  // Documentation examples can include ?key=...; API keys belong in safeStorage.
  url.search = ''
  url.hash = ''
  return url
}

export function isLoopbackProviderURL(input: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(input).hostname.toLocaleLowerCase())
  } catch {
    return false
  }
}

function serializeURL(url: URL): string {
  return url.toString().replace(/\/+$/, '')
}

export function normalizeProviderBaseURL(
  protocol: ProviderProtocol,
  input: string,
): string {
  if (!input.trim()) return ''

  const url = parseHTTPURL(input)
  let pathname = url.pathname.replace(/\/+$/, '')

  if (protocol === 'openai' || protocol === 'openai-compatible') {
    pathname = pathname.replace(/\/(?:chat\/completions|completions|responses)$/i, '')
  } else if (protocol === 'anthropic') {
    pathname = pathname.replace(/\/v1\/messages$/i, '').replace(/\/v1$/i, '')
  } else if (protocol === 'google') {
    const segments = pathname.split('/').filter(Boolean)
    const versionIndex = segments.findIndex((segment) => GOOGLE_API_VERSION.test(segment))
    if (versionIndex >= 0) pathname = `/${segments.slice(0, versionIndex + 1).join('/')}`
  }

  url.pathname = pathname || '/'
  return serializeURL(url)
}

/**
 * Built-in provider keys may only be sent to the bundled provider origin.
 * Custom providers are an explicit trust decision, but still require HTTPS
 * unless they point at an exact loopback host.
 */
export function normalizeProviderEndpoint(
  provider: Pick<ProviderDefinition, 'api' | 'defaultApi' | 'isCustom' | 'isLocal' | 'protocol'>,
  input: string,
): string {
  const normalized = normalizeProviderBaseURL(provider.protocol, input)
  if (!normalized) return ''

  if (provider.isLocal) {
    if (!isLoopbackProviderURL(normalized)) throw new Error('LOCAL_PROVIDER_MUST_USE_LOOPBACK')
    return normalized
  }
  if (provider.isCustom) return normalized

  const canonicalInput = provider.defaultApi ?? provider.api
  // Some official SDK-backed providers have no fixed endpoint, while
  // account-scoped services publish a ${...} template. In those cases a URL
  // entered in Settings is the trust decision; require HTTPS and keep remote
  // catalog data from ever supplying it automatically.
  if (!canonicalInput.trim() || canonicalInput.includes('${')) {
    if (new URL(normalized).protocol !== 'https:') {
      throw new Error('UNPINNED_PROVIDER_MUST_USE_HTTPS')
    }
    return normalized
  }

  const canonical = normalizeProviderBaseURL(provider.protocol, canonicalInput)
  if (!canonical || new URL(normalized).origin !== new URL(canonical).origin) {
    throw new Error('PROVIDER_BASE_URL_ORIGIN_MISMATCH')
  }
  return normalized
}

export function splitGoogleBaseURL(baseURL?: string): {
  baseUrl?: string
  apiVersion?: string
} {
  if (!baseURL?.trim()) return {}

  const normalizedURL = normalizeProviderBaseURL('google', baseURL)
  const url = new URL(normalizedURL)
  const segments = url.pathname.split('/').filter(Boolean)
  const versionIndex = segments.findIndex((segment) => GOOGLE_API_VERSION.test(segment))
  if (versionIndex < 0) return { baseUrl: normalizedURL }

  const apiVersion = segments[versionIndex]
  url.pathname = `/${segments.slice(0, versionIndex).join('/')}`
  return { baseUrl: serializeURL(url), apiVersion }
}
