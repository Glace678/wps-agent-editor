export type ProviderLogoAsset = { kind: 'image'; url: string }

const svgModules = import.meta.glob('../assets/provider-logos/*.svg', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

const imageModules = import.meta.glob('../assets/provider-logos/*.{png,ico,webp,avif}', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

function providerIdFromPath(path: string): string {
  return path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? path
}

// Build the lookup table on a null-prototype object so lookups by ids like
// "constructor" / "toString" never resolve to inherited Object.prototype props.
const providerLogoAssets: Readonly<Record<string, ProviderLogoAsset>> = (() => {
  const map: Record<string, ProviderLogoAsset> = Object.create(null)
  for (const [path, url] of Object.entries(svgModules)) {
    map[providerIdFromPath(path)] = { kind: 'image', url }
  }
  for (const [path, url] of Object.entries(imageModules)) {
    map[providerIdFromPath(path)] = { kind: 'image', url }
  }
  return Object.freeze(map)
})()

function isLogoAsset(value: unknown): value is ProviderLogoAsset {
  return typeof value === 'object'
    && value !== null
    && (value as ProviderLogoAsset).kind === 'image'
    && typeof (value as ProviderLogoAsset).url === 'string'
}

function lookupLogoAsset(providerId: string): ProviderLogoAsset | undefined {
  if (typeof providerId !== 'string' || providerId.length === 0) return undefined
  if (!Object.prototype.hasOwnProperty.call(providerLogoAssets, providerId)) return undefined
  const asset = providerLogoAssets[providerId]
  return isLogoAsset(asset) ? asset : undefined
}

export const BUILTIN_PROVIDER_LOGO_IDS = Object.freeze(Object.keys(providerLogoAssets).sort())

/**
 * Name-based fallbacks for custom providers whose id is `custom-<uuid>` but
 * whose display name identifies a known brand (e.g. a self-configured 豆包/
 * Volcengine Ark endpoint).
 */
const PROVIDER_NAME_ALIASES: ReadonlyArray<{ pattern: RegExp; assetId: string }> = [
  { pattern: /doubao|豆包|volc|火山|方舟|bytedance|字节跳动|字节|(^|[^a-z])ark([^a-z]|$)/i, assetId: 'volcengine' },
  { pattern: /(^|[^a-z])amd([^a-z]|$)/i, assetId: 'amd' },
]

export function getProviderLogoAsset(providerId: string): ProviderLogoAsset | undefined {
  return lookupLogoAsset(providerId)
}

/** Direct id lookup first, then brand-name alias matching for custom providers. */
export function resolveProviderLogoAsset(
  providerId: string,
  providerName?: string,
): ProviderLogoAsset | undefined {
  const direct = lookupLogoAsset(providerId)
  if (direct) return direct
  if (!providerName) return undefined
  const haystack = `${providerId} ${providerName}`
  const alias = PROVIDER_NAME_ALIASES.find((entry) => entry.pattern.test(haystack))
  return alias ? lookupLogoAsset(alias.assetId) : undefined
}

export function hasProviderLogo(providerId: string): boolean {
  return lookupLogoAsset(providerId) !== undefined
}
