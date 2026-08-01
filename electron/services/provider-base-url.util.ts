import type { ProviderProtocol } from './provider-registry.service'

const GOOGLE_API_VERSION = /^v\d+(?:(?:alpha|beta)\d*)?$/i

function parseHTTPURL(input: string): URL {
  const url = new URL(input.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('INVALID_PROVIDER_BASE_URL')
  }
  if (url.username || url.password) {
    throw new Error('INVALID_PROVIDER_BASE_URL')
  }

  // Documentation examples can include ?key=...; API keys belong in safeStorage.
  url.search = ''
  url.hash = ''
  return url
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
