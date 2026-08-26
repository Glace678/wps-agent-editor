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

export function getProviderLogoAsset(providerId: string): ProviderLogoAsset | undefined {
  return providerLogoAssets[providerId]
}

export function hasProviderLogo(providerId: string): boolean {
  return providerId in providerLogoAssets
}

export function getProviderLogoPresentationColor(providerId: string): string | undefined {
  return providerLogoSourceMetadata[providerId]?.presentationColor
}
