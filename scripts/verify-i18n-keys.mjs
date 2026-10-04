// Verifies every locale defines the same key set as the source locale (zh-CN),
// and that every baseline leaf is a non-empty string. Locales are discovered
// from the locales/ directory rather than hardcoded, so a newly added locale that
// is forgotten here fails loudly. Run: node scripts/verify-i18n-keys.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const localesDir = join(root, 'src/lib/i18n/locales')

// Locale codes (file basenames) for which an empty/whitespace leaf is acceptable.
// Anything not listed here must be a non-empty translated string.
const ALLOW_EMPTY = new Set([
  // e.g. 'en:some.section.optionalKey',
])

// Discover locales from the directory itself. The export const name does not
// always match the file basename (zh-CN.ts exports zhCN), so read it from source.
const discovered = new Map()
for (const file of readdirSync(localesDir)) {
  if (!file.endsWith('.ts')) continue
  const code = file.slice(0, -3)
  const src = readFileSync(join(localesDir, file), 'utf8')
  const m = src.match(/export\s+const\s+([A-Za-z0-9_$]+)\s*=/)
  if (!m) throw new Error(`Could not find an exported locale const in ${file}`)
  discovered.set(code, m[1])
}
if (discovered.size === 0) throw new Error(`No locale files found in ${localesDir}`)

const dir = mkdtempSync(join(tmpdir(), 'i18n-keys-'))
const entry = join(dir, 'entry.ts')
writeFileSync(entry, [...discovered.entries()]
  .map(([code, name]) => `export { ${name} as l_${name} } from ${JSON.stringify(join(localesDir, `${code}.ts`))}`)
  .join('\n'))

const esbuildBin = join(root, 'node_modules/esbuild/bin/esbuild')
execFileSync('node', [esbuildBin, entry, '--bundle', '--format=esm', '--platform=node',
  `--outfile=${join(dir, 'out.mjs')}`], { cwd: root, stdio: 'inherit' })
const mod = await import(pathToFileURL(join(dir, 'out.mjs')).href)

const locales = {}
for (const [code, name] of discovered) locales[code] = mod[`l_${name}`]

function flat(obj, prefix = '') {
  const out = []
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) out.push(...flat(value, path))
    else out.push([path, value])
  }
  return out
}

const BASELINE = 'zh-CN'
if (!locales[BASELINE]) throw new Error(`Baseline locale ${BASELINE} not discovered`)
const baselineLeaves = flat(locales[BASELINE])
const baselineKeys = new Set(baselineLeaves.map(([key]) => key))

let failures = 0

// 1. Every discovered locale must have exactly the baseline key set.
for (const [code, dict] of Object.entries(locales)) {
  if (code === BASELINE) continue
  const keys = new Set(flat(dict).map(([key]) => key))
  const missing = [...baselineKeys].filter((key) => !keys.has(key))
  const extra = [...keys].filter((key) => !baselineKeys.has(key))
  if (missing.length) { failures++; console.error(`FAIL ${code}: missing ${missing.length} keys:\n  ${missing.join('\n  ')}`) }
  if (extra.length) { failures++; console.error(`FAIL ${code}: extra keys not in ${BASELINE}:\n  ${extra.join('\n  ')}`) }
  if (!missing.length && !extra.length) console.log(`PASS ${code}: ${keys.size} keys, full parity`)
}

// 2. Every baseline leaf must be a non-empty string in EVERY locale (including the
// baseline). Only entries in ALLOW_EMPTY may be blank.
for (const [code, dict] of Object.entries(locales)) {
  for (const [key, value] of flat(dict)) {
    if (typeof value === 'string' && value.trim()) continue
    if (ALLOW_EMPTY.has(`${code}:${key}`)) continue
    failures++
    console.error(`FAIL ${code}: ${key} is ${typeof value === 'string' ? 'blank' : `a ${typeof value}`} (${JSON.stringify(value)})`)
  }
}

console.log(`\nDiscovered ${discovered.size} locales: ${[...discovered.keys()].sort().join(', ')}`)
if (!failures) console.log(`PASS: all ${baselineKeys.size} baseline leaves are non-empty strings across ${discovered.size} locales`)
process.exit(failures ? 1 : 0)
