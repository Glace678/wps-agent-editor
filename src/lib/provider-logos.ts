import sourceManifest from '../assets/provider-logos/sources.json'

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

const providerLogoAssets: Readonly<Record<string, ProviderLogoAsset>> = Object.freeze({
  ...Object.fromEntries(Object.entries(svgModules).map(([path, url]) => [
    providerIdFromPath(path),
    { kind: 'image' as const, url },
  ])),
  ...Object.fromEntries(Object.entries(imageModules).map(([path, url]) => [
    providerIdFromPath(path),
    { kind: 'image' as const, url },
  ])),
})

export const BUILTIN_PROVIDER_LOGO_IDS = Object.freeze(Object.keys(providerLogoAssets).sort())

interface ProviderLogoSourceMetadata {
  officialColor: boolean
  presentationColor?: string
}

const providerLogoSourceMetadata = sourceManifest.providers as Record<string, ProviderLogoSourceMetadata>

/**
 * Name-based fallbacks for custom providers whose id is `custom-<uuid>` but
 * whose display name identifies a known brand (e.g. a self-configured 豆包/
 * Volcengine Ark endpoint).
 */
const PROVIDER_NAME_ALIASES: ReadonlyArray<{ pattern: RegExp; assetId: string }> = [
  { pattern: /doubao|豆包|volc|火山|方舟|bytedance|字节跳动|字节|(^|[^a-z])ark([^a-z]|$)/i, assetId: 'volcengine' },
]

export function getProviderLogoAsset(providerId: string): ProviderLogoAsset | undefined {
  return providerLogoAssets[providerId]
}

/** Direct id lookup first, then brand-name alias matching for custom providers. */
export function resolveProviderLogoAsset(
  providerId: string,
  providerName?: string,
): ProviderLogoAsset | undefined {
  const direct = providerLogoAssets[providerId]
  if (direct) return direct
  if (!providerName) return undefined
  const haystack = `${providerId} ${providerName}`
  const alias = PROVIDER_NAME_ALIASES.find((entry) => entry.pattern.test(haystack))
  return alias ? providerLogoAssets[alias.assetId] : undefined
}

export function hasProviderLogo(providerId: string): boolean {
  return providerId in providerLogoAssets
}

export function getProviderLogoPresentationColor(providerId: string): string | undefined {
  return providerLogoSourceMetadata[providerId]?.presentationColor
}
