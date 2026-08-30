import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = path.join(root, 'src-tauri', 'resources', 'provider-catalog.json')
const assetDir = path.join(root, 'src', 'assets', 'provider-logos')
const providerLogoComponentPath = path.join(root, 'src', 'components', 'agent', 'ProviderLogo.tsx')
const sourceManifestPath = path.join(assetDir, 'sources.json')
const providerIds = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).map((provider) => provider.id)
const expectedIds = new Set(['ollama', ...providerIds])
const assetFiles = fs.readdirSync(assetDir).filter((file) => /\.(?:svg|png|ico|webp|avif)$/i.test(file))
const assetsById = new Map()

for (const file of assetFiles) {
  const id = file.replace(/\.[^.]+$/, '')
  const files = assetsById.get(id) ?? []
  files.push(file)
  assetsById.set(id, files)
}

const missing = [...expectedIds].filter((id) => !assetsById.has(id)).sort()
const extra = [...assetsById.keys()].filter((id) => !expectedIds.has(id)).sort()
const duplicates = [...assetsById.entries()].filter(([, files]) => files.length > 1)
const unsafe = []
const sourceIssues = []

const providerLogoComponent = fs.readFileSync(providerLogoComponentPath, 'utf8')
if (/dangerouslySetInnerHTML/.test(providerLogoComponent)) {
  unsafe.push('ProviderLogo.tsx: SVG markup must render as an isolated image')
}

if (!fs.existsSync(sourceManifestPath)) {
  sourceIssues.push('sources.json is missing')
} else {
  const manifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'))
  const providers = manifest?.providers ?? {}
  const sourceIds = new Set(Object.keys(providers))
  for (const id of expectedIds) {
    const source = providers[id]
    if (!source) {
      sourceIssues.push(`${id}: missing source metadata`)
      continue
    }
    if (typeof source.officialColor !== 'boolean') sourceIssues.push(`${id}: officialColor must be boolean`)
    if (!/^official-/.test(source.sourceType ?? '')) sourceIssues.push(`${id}: invalid sourceType ${source.sourceType ?? '(missing)'}`)
    if (!source.sourceUrl || !source.pageUrl) sourceIssues.push(`${id}: sourceUrl and pageUrl are required`)
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
    if (!expectedIds.has(id)) sourceIssues.push(`${id}: unexpected source metadata`)
  }
}

for (const file of assetFiles.filter((name) => name.endsWith('.svg'))) {
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

console.log(`Provider logo check passed: ${expectedIds.size} providers, ${assetFiles.length} assets`)
