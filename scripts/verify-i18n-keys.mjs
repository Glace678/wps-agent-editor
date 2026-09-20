// Verifies every locale defines the same key set as the source locale (zh-CN).
// Missing locale keys previously caused blank screens. Run: node scripts/verify-i18n-keys.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd().replace(/\\/g, '\\\\')
const dir = mkdtempSync(join(tmpdir(), 'i18n-keys-'))
const entry = join(dir, 'entry.ts')
writeFileSync(entry, `export * from '${root}/src/lib/i18n/locales/ar'
export * from '${root}/src/lib/i18n/locales/de'
export * from '${root}/src/lib/i18n/locales/en'
export * from '${root}/src/lib/i18n/locales/es'
export * from '${root}/src/lib/i18n/locales/fr'
export * from '${root}/src/lib/i18n/locales/ja'
export * from '${root}/src/lib/i18n/locales/pt'
export * from '${root}/src/lib/i18n/locales/ru'
export * from '${root}/src/lib/i18n/locales/zh-CN'
`)
execFileSync('node', ['node_modules/esbuild/bin/esbuild', entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${join(dir, 'out.mjs')}`], { stdio: 'inherit' })
const mod = await import(pathToFileURL(join(dir, 'out.mjs')).href)

const locales = {
  ar: mod.ar, de: mod.de, en: mod.en, es: mod.es, fr: mod.fr,
  ja: mod.ja, pt: mod.pt, ru: mod.ru, 'zh-CN': mod.zhCN,
}

function flatKeys(obj, prefix = '') {
  const out = []
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) out.push(...flatKeys(value, path))
    else out.push(path)
  }
  return out
}

const baseline = new Set(flatKeys(locales['zh-CN']))
let failures = 0

// 1. Every locale matches the zh-CN key set across ALL sections.
for (const [code, dict] of Object.entries(locales)) {
  if (code === 'zh-CN') continue
  const keys = new Set(flatKeys(dict))
  const missing = [...baseline].filter((key) => !keys.has(key))
  const extra = [...keys].filter((key) => !baseline.has(key))
  if (missing.length) { failures++; console.error(`FAIL ${code}: missing ${missing.length} keys:\n  ${missing.join('\n  ')}`) }
  if (extra.length) { failures++; console.error(`FAIL ${code}: extra keys not in zh-CN:\n  ${extra.join('\n  ')}`) }
  if (!missing.length && !extra.length) console.log(`PASS ${code}: ${keys.size} keys, full parity`)
}

// 2. The specific keys introduced by the collaboration UI must be non-empty
//    in every locale.
const required = [
  'agentUi.collaborationChat', 'agentUi.collaborationMode',
  'agentUi.modeDirected', 'agentUi.modeDirectedHint',
  'agentUi.modeParallel', 'agentUi.modeParallelHint',
  'agentUi.directorAgent', 'agentUi.stopCollaboration', 'agentUi.backToChat',
  'agentUi.delegationTag',
  'agentUi.lineDirectorReady', 'agentUi.lineSynthesizerReady',
  'agentUi.lineTaskAssigned', 'agentUi.lineHandoff', 'agentUi.lineToolInvoked',
  'agentUi.lineDocumentApplied', 'agentUi.lineDocumentRejected',
  'agentUi.lineRunComplete', 'agentUi.lineRunCancelled',
  'agentUi.lineConflict', 'agentUi.lineError',
]
for (const [code, dict] of Object.entries(locales)) {
  for (const key of required) {
    const value = key.split('.').reduce((acc, part) => acc?.[part], dict)
    if (typeof value !== 'string' || !value.trim()) {
      failures++
      console.error(`FAIL ${code}: ${key} is empty or missing`)
    }
  }
}
if (!failures) console.log(`PASS: all ${required.length} collaboration keys present in ${Object.keys(locales).length} locales`)
process.exit(failures ? 1 : 0)
