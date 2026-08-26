const TRUSTED_RENDERER_ARGUMENT = '--wps-trusted-renderer-url='

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

export function createRendererContentSecurityPolicy(development: boolean): string {
  const scriptSources = ["'self'", ...(development ? ["'unsafe-inline'"] : [])]
  const connectSources = [
    "'self'",
    ...(development
      ? [
          'http://127.0.0.1:*',
          'http://localhost:*',
          'ws://127.0.0.1:*',
          'ws://localhost:*',
        ]
      : []),
  ]
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src ${scriptSources.join(' ')}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: http: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(' ')}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "media-src 'self' data: blob:",
    "form-action 'none'",
  ].join('; ')
}

export function loopbackHttpUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if (!LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())) return null
    return url.toString()
  } catch {
    return null
  }
}

export function canonicalRendererDocument(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.username || url.password) return null
    if (url.protocol === 'file:') {
      if (url.hostname) return null
    } else if (!loopbackHttpUrl(url.toString())) {
      return null
    }
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function isTrustedRendererDocument(currentUrl: string, expectedUrl: string): boolean {
  const current = canonicalRendererDocument(currentUrl)
  const expected = canonicalRendererDocument(expectedUrl)
  return current !== null && expected !== null && current === expected
}

export function createTrustedRendererArgument(rendererUrl: string): string {
  const canonical = canonicalRendererDocument(rendererUrl)
  if (!canonical) throw new Error('INVALID_TRUSTED_RENDERER_URL')
  return `${TRUSTED_RENDERER_ARGUMENT}${encodeURIComponent(canonical)}`
}

export function readTrustedRendererArgument(argv: readonly string[]): string | null {
  const argument = argv.find((value) => value.startsWith(TRUSTED_RENDERER_ARGUMENT))
  if (!argument) return null
  try {
    const decoded = decodeURIComponent(argument.slice(TRUSTED_RENDERER_ARGUMENT.length))
    return canonicalRendererDocument(decoded)
  } catch {
    return null
  }
}

export function externalHttpUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}
