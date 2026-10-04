import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = path.join(root, 'src-tauri', 'resources', 'provider-catalog.json')
const assetDir = path.join(root, 'src', 'assets', 'provider-logos')
const providerLogoComponentPath = path.join(root, 'src', 'components', 'agent', 'ProviderLogo.tsx')
const sourceManifestPath = path.join(assetDir, 'sources.json')
const providerIds = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).map((provider) => provider.id)
// Detect non-empty-string and duplicate provider ids BEFORE collapsing them into a
// Set: a Set silently folds duplicates, which would under-report the success count
// and let a duplicated catalog id pass missing/extra/source validation.
const idIssues = []
const seenProviderIds = new Set()
for (const id of providerIds) {
  if (typeof id !== 'string' || id.trim() === '') {
    idIssues.push(`provider catalog contains a non-empty-string provider id (got ${JSON.stringify(id)})`)
  } else if (seenProviderIds.has(id)) {
    idIssues.push(`duplicate provider id in catalog: ${id}`)
  } else {
    seenProviderIds.add(id)
  }
}
if (idIssues.length) {
  for (const issue of idIssues) console.error(issue)
  process.exit(1)
}
const expectedIds = new Set(['ollama', ...providerIds])
const assetFiles = fs.readdirSync(assetDir).filter((file) => /\.(?:svg|png|ico|webp|avif)$/i.test(file))
const assetsById = new Map()

for (const file of assetFiles) {
  const id = file.replace(/\.[^.]+$/, '')
  const files = assetsById.get(id) ?? []
  files.push(file)
  assetsById.set(id, files)
}

// Logo assets registered for name-alias resolution only (see PROVIDER_NAME_ALIASES in
// src/lib/provider-logos.ts): they have no provider id in the catalog, so the manifest
// is the source of truth for which extra asset files are allowed.
const manifestExists = fs.existsSync(sourceManifestPath)
const manifest = manifestExists ? JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8')) : {}
const aliasAssets = manifest?.aliasAssets ?? {}
const aliasIds = new Set(Object.keys(aliasAssets))
// Everything the checker considers a legitimately registered logo id.
const knownIds = new Set([...expectedIds, ...aliasIds])

// Provenance URLs must be absolute, https, with a host, and must not carry
// credentials or control characters. A bare truthy check accepted relative paths,
// whitespace, or ftp:/file:/javascript: and similar unapproved schemes.
function isHttpsUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false
  if (/[\u0000-\u001F\u007F]/.test(value)) return false
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (parsed.username || parsed.password) return false
  if (!parsed.hostname) return false
  return true
}

const missing = [...knownIds].filter((id) => !assetsById.has(id)).sort()
const extra = [...assetsById.keys()].filter((id) => !knownIds.has(id)).sort()
const duplicates = [...assetsById.entries()].filter(([, files]) => files.length > 1)
const unsafe = []
const sourceIssues = []

const providerLogoComponent = fs.readFileSync(providerLogoComponentPath, 'utf8')
if (/dangerouslySetInnerHTML/.test(providerLogoComponent)) {
  unsafe.push('ProviderLogo.tsx: SVG markup must render as an isolated image')
}

if (!manifestExists) {
  sourceIssues.push('sources.json is missing')
} else {
  const providers = manifest?.providers ?? {}
  const sourceIds = new Set(Object.keys(providers))
  for (const id of aliasIds) {
    if (providers[id]) sourceIssues.push(`${id}: alias asset id must not also be a provider id`)
  }
  for (const id of knownIds) {
    const source = providers[id] ?? aliasAssets[id]
    if (!source) {
      sourceIssues.push(`${id}: missing source metadata`)
      continue
    }
    if (typeof source.officialColor !== 'boolean') sourceIssues.push(`${id}: officialColor must be boolean`)
    if (!/^official-/.test(source.sourceType ?? '')) sourceIssues.push(`${id}: invalid sourceType ${source.sourceType ?? '(missing)'}`)
    for (const field of ['sourceUrl', 'pageUrl']) {
      const value = source[field]
      if (!isHttpsUrl(value)) {
        sourceIssues.push(`${id}: ${field} must be a non-empty absolute https:// URL with a host and no credentials/control characters (got ${JSON.stringify(value)})`)
      }
    }
    if (/lobe-icons|simple-icons|models\.dev|seeklogo/i.test(`${source.sourceUrl} ${source.pageUrl}`)) {
      sourceIssues.push(`${id}: community or logo-aggregator source is forbidden`)
    }
    if (!assetsById.get(id)?.includes(source.assetFile)) sourceIssues.push(`${id}: assetFile does not match ${source.assetFile}`)
    if (source.parentProviderId && !expectedIds.has(source.parentProviderId)) {
      sourceIssues.push(`${id}: unknown parentProviderId ${source.parentProviderId}`)
    }
    if (source.presentationColor && !/^#[0-9a-f]{6}$/i.test(source.presentationColor)) {
      sourceIssues.push(`${id}: invalid presentationColor ${source.presentationColor}`)
    }
    if (source.presentationColor && !source.presentationColorSource) {
      sourceIssues.push(`${id}: presentationColorSource is required`)
    }
  }
  for (const id of sourceIds) {
    if (!knownIds.has(id)) sourceIssues.push(`${id}: unexpected source metadata`)
  }
}

// The asset glob above is case-insensitive, so uppercase ".SVG" files are accepted
// as assets; every accepted SVG must run through the same content scan regardless
// of extension casing (previously `endsWith('.svg')` silently skipped them).
for (const file of assetFiles.filter((name) => /\.svg$/i.test(name))) {
  const svg = fs.readFileSync(path.join(assetDir, file), 'utf8')
  if (!/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i.test(svg)) {
    unsafe.push(`${file}: invalid SVG root`)
  }
  if (/<\s*(?:script|foreignObject|iframe|object|embed|image)\b/i.test(svg)) {
    unsafe.push(`${file}: forbidden embedded element`)
  }
  if (/\bon[a-z]+\s*=/i.test(svg)) unsafe.push(`${file}: inline event handler`)
  if (/currentColor/i.test(svg)) unsafe.push(`${file}: theme-dependent currentColor`)
  if (/(?:href|xlink:href)\s*=\s*["']\s*(?!#)(?:https?:|\/\/|data:|javascript:)/i.test(svg)) {
    unsafe.push(`${file}: external reference`)
  }
  if (/url\(\s*["']?(?:https?:|\/\/|data:|javascript:)/i.test(svg)) {
    unsafe.push(`${file}: external CSS reference`)
  }
}

if (missing.length || extra.length || duplicates.length || unsafe.length || sourceIssues.length) {
  if (missing.length) console.error('Missing provider logos:', missing.join(', '))
  if (extra.length) console.error('Unexpected provider logos:', extra.join(', '))
  for (const [id, files] of duplicates) console.error(`Duplicate provider logo ${id}: ${files.join(', ')}`)
  for (const issue of unsafe) console.error(`Unsafe provider logo: ${issue}`)
  for (const issue of sourceIssues) console.error(`Invalid provider logo source: ${issue}`)
  process.exit(1)
}

console.log(
  `Provider logo check passed: ${expectedIds.size} providers, ${aliasIds.size} alias assets, ${assetFiles.length} asset files`,
)
