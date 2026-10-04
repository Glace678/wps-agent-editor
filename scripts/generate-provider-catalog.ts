import { mkdir, writeFile, rename } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import catalog from '../src-tauri/resources/provider-catalog.json'

const KNOWN_PROTOCOLS = new Set(['openai-compatible', 'openai', 'google', 'anthropic', 'bedrock'])
const CONTROL_CHARS = /[\x00-\x1F\x7F]/

function isHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return 'must be a non-empty string'
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'must be a valid URL'
  }
  if (url.protocol !== 'https:') return `must use https: (got ${url.protocol})`
  if (!url.hostname) return 'must have a host'
  if (CONTROL_CHARS.test(value)) return 'contains control characters'
  return null
}

// Provider api base URLs are more permissive than doc URLs: local providers use
// http://localhost / http://127.0.0.1, and SDK/gateway providers may leave the
// base as an env-var template such as "${BASE_URL}/v1".
function validateApi(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null // optional
  if (value.includes('${')) return null // runtime template, not a literal URL
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'must be a valid URL or env template'
  }
  if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return null
  if (url.protocol !== 'https:') return `must use https: (got ${url.protocol})`
  if (!url.hostname) return 'must have a host'
  if (CONTROL_CHARS.test(value)) return 'contains control characters'
  return null
}

async function main() {
  // Default (no flags): validate only, do not touch the catalog on disk.
  // --write performs an atomic regeneration (temp file + rename). A positional
  // argument overrides the output path.
  const args = process.argv.slice(2)
  let write = false
  let outputArg: string | undefined
  for (const arg of args) {
    if (arg === '--write') write = true
    else if (!arg.startsWith('-')) outputArg = arg
    else throw new Error(`Unknown argument: ${arg}`)
  }
  const output = resolve(outputArg ?? 'src-tauri/resources/provider-catalog.json')
  const errors: string[] = []
  const providerIds = new Set<string>()
  let modelCount = 0

  catalog.forEach((provider, i) => {
    const where = `provider[${i}]`
    if (typeof provider.id !== 'string' || !provider.id.trim()) {
      errors.push(`${where}: id must be a non-empty string`)
    } else {
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(provider.id)) errors.push(`${where}: id has unexpected format: ${provider.id}`)
      if (providerIds.has(provider.id)) errors.push(`${where}: duplicate provider id "${provider.id}"`)
      providerIds.add(provider.id)
    }
    if (typeof provider.name !== 'string' || !provider.name.trim()) errors.push(`${where}: name must be a non-empty string`)
    // api is optional (SDK providers use an empty base URL); when present and
    // non-empty it must be a valid https URL.
    if (typeof provider.api === 'string' && provider.api.trim()) {
      const apiErr = validateApi(provider.api)
      if (apiErr) errors.push(`${where}.api ${apiErr}: ${JSON.stringify(provider.api)}`)
    }
    const docErr = isHttpsUrl(provider.doc)
    if (docErr) errors.push(`${where}.doc ${docErr}: ${JSON.stringify(provider.doc)}`)
    if (typeof provider.npm !== 'string' || !provider.npm.trim()) errors.push(`${where}.npm must be a non-empty string`)
    if (!KNOWN_PROTOCOLS.has(provider.protocol as string)) errors.push(`${where}: unknown protocol "${provider.protocol}"`)
    if (!Array.isArray(provider.env) || !provider.env.every((e) => typeof e === 'string' && e)) {
      errors.push(`${where}.env must be an array of non-empty strings`)
    }
    // These flags are optional (absent == false); when present they must be booleans.
    for (const flag of ['isCustom', 'isLocal', 'isApiOverridden'] as const) {
      if (provider[flag] !== undefined && typeof provider[flag] !== 'boolean') {
        errors.push(`${where}.${flag} must be a boolean when present`)
      }
    }
    if (!Array.isArray(provider.models)) {
      errors.push(`${where}.models must be an array`)
      return
    }
    const modelIds = new Set<string>()
    provider.models.forEach((model, j) => {
      modelCount += 1
      const mwhere = `${where}.models[${j}]`
      if (typeof model.id !== 'string' || !model.id.trim()) {
        errors.push(`${mwhere}: id must be a non-empty string`)
      } else {
        if (modelIds.has(model.id)) errors.push(`${mwhere}: duplicate model id "${model.id}" within ${provider.id}`)
        modelIds.add(model.id)
      }
      if (typeof model.name !== 'string' || !model.name.trim()) errors.push(`${mwhere}: name must be a non-empty string`)
    })
  })

  if (errors.length) {
    throw new Error(`Provider catalog validation failed:\n  ${errors.slice(0, 60).join('\n  ')}${errors.length > 60 ? `\n  ...and ${errors.length - 60} more` : ''}`)
  }

  // Regression tripwire: the catalog must remain complete. (Verified counts as of
  // the catalog source of truth; update together with the source data.)
  if (catalog.length !== 179 || providerIds.size !== 179 || modelCount !== 5485) {
    throw new Error(`Refusing to write an incomplete provider catalog: providers=${catalog.length}, unique=${providerIds.size}, models=${modelCount}`)
  }

  if (write) {
    await mkdir(dirname(output), { recursive: true })
    // Atomic write: same-directory temp file then rename, so a failure mid-write
    // leaves the previous catalog intact.
    const tmp = `${output}.tmp-${process.pid}`
    await writeFile(tmp, `${JSON.stringify(catalog, null, 2)}\n`)
    await rename(tmp, output)
    console.log(`Wrote ${output}: ${providerIds.size} providers and ${modelCount} models`)
  } else {
    console.log(`Validated ${output}: ${providerIds.size} providers and ${modelCount} models`)
  }
}

void main()
