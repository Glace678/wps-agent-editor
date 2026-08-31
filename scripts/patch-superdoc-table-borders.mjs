// SuperDoc 1.44.0 renders table cells without explicit borders as completely
// borderless. In Word this matches "no border" semantics, but many documents
// rely on the default table grid being visible. This patch applies a fallback
// border in the paginated/presentation renderer when the table itself carries
// no effective borders, matching the default grid used for newly inserted
// tables (TABLE_FALLBACK_BORDERS).
//
// The editing view is handled by CSS in src/lightweight-office/word-editor.css,
// which does not mutate the document model. This script only touches rendering.
// Idempotent: safe to run on every install.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'node_modules', 'superdoc', 'dist')

function apply(file, replacements) {
  const target = path.join(distDir, file)
  const source = readFileSync(target, 'utf8')
  let output = source
  for (const { from, to, label, optional = false } of replacements) {
    if (output.includes(to)) {
      console.log(`[SKIP] ${file}: ${label} (already applied)`)
      continue
    }
    const count = output.split(from).length - 1
    if (count === 0 && optional) {
      console.log(`[SKIP] ${file}: ${label} (source not present)`)
      continue
    }
    if (count !== 1) {
      throw new Error(`${file}: ${label}: expected exactly 1 source occurrence, found ${count}`)
    }
    output = output.replace(from, to)
    console.log(`[OK]   ${file}: ${label}`)
  }
  if (output !== source) writeFileSync(target, output, 'utf8')
}

const layoutReplacements = [
  {
    label: 'use default border when table has no effective borders',
    from: `borders: paintBorders,
			borderBandOverridesPx,
			useDefaultBorder: false,`,
    to: `borders: paintBorders,
			borderBandOverridesPx,
			useDefaultBorder: !effectiveTableBorders || Object.keys(effectiveTableBorders).length === 0,`,
  },
]

apply('chunks/src-CcBJnYZd.es.js', layoutReplacements)
apply('chunks/src-VzGe-_l_.cjs', layoutReplacements)

console.log('superdoc table border patch applied (idempotent)')
