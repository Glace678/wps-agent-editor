// Raises SuperDoc's font-size range (pinned to ^1.44.0 in package.json) from
// 8–96 pt to Word's real 1–1638 pt. Three hard-coded clamp sites all have to
// move together, otherwise the value applied to the document, the toolbar
// field display, and the "type size before typing" stored-mark path disagree:
//
// 1. FontSize extension option defaults (drives the setFontSize command clamp).
// 2. Toolbar fontSize onActivate (clamps the value shown in the field).
// 3. The toolbar stored-marks fast path for empty selections (Math.min/max).
//
// Idempotent: safe to run on every install. Throws when an expected pattern
// is missing so a future superdoc upgrade cannot silently lose the patch.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'node_modules', 'superdoc', 'dist')

const WORD_MIN_SIZE = 1
const WORD_MAX_SIZE = 1638

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

// ---------------------------------------------------------------------------
// chunks/src-CcBJnYZd.es.js and chunks/src-VzGe-_l_.cjs (same source, ESM/CJS)
// ---------------------------------------------------------------------------
const chunkReplacements = [
  {
    label: 'FontSize extension defaults 8–96 → 1–1638',
    from: `defaults: {\n\t\t\t\tvalue: 12,\n\t\t\t\tunit: "pt",\n\t\t\t\tmin: 8,\n\t\t\t\tmax: 96\n\t\t\t}`,
    to: `defaults: {\n\t\t\t\tvalue: 12,\n\t\t\t\tunit: "pt",\n\t\t\t\tmin: ${WORD_MIN_SIZE},\n\t\t\t\tmax: ${WORD_MAX_SIZE}\n\t\t\t}`,
  },
  {
    label: 'toolbar fontSize display clamp 8–96 → 1–1638',
    from: `if (sanitizedValue < 8) sanitizedValue = 8;\n\t\t\tif (sanitizedValue > 96) sanitizedValue = 96;`,
    to: `if (sanitizedValue < ${WORD_MIN_SIZE}) sanitizedValue = ${WORD_MIN_SIZE};\n\t\t\tif (sanitizedValue > ${WORD_MAX_SIZE}) sanitizedValue = ${WORD_MAX_SIZE};`,
  },
  {
    label: 'stored-marks clamp 8–96 → 1–1638',
    from: `const clamped = Math.min(96, Math.max(8, Number(value)));`,
    to: `const clamped = Math.min(${WORD_MAX_SIZE}, Math.max(${WORD_MIN_SIZE}, Number(value)));`,
  },
]
apply('chunks/src-CcBJnYZd.es.js', chunkReplacements)
apply('chunks/src-VzGe-_l_.cjs', chunkReplacements)

// ---------------------------------------------------------------------------
// superdoc.min.js (minified bundle; variable names are 1.44.0-specific)
// ---------------------------------------------------------------------------
apply('superdoc.min.js', [
  {
    label: 'FontSize extension defaults 8–96 → 1–1638',
    from: `defaults:{value:12,unit:"pt",min:8,max:96}`,
    to: `defaults:{value:12,unit:"pt",min:${WORD_MIN_SIZE},max:${WORD_MAX_SIZE}}`,
  },
  {
    label: 'toolbar fontSize display clamp 8–96 → 1–1638',
    from: `Je<8&&(Je=8),Je>96&&(Je=96)`,
    to: `Je<${WORD_MIN_SIZE}&&(Je=${WORD_MIN_SIZE}),Je>${WORD_MAX_SIZE}&&(Je=${WORD_MAX_SIZE})`,
  },
  {
    label: 'stored-marks clamp 8–96 → 1–1638',
    from: `Math.min(96,Math.max(8,Number(s)))`,
    to: `Math.min(${WORD_MAX_SIZE},Math.max(${WORD_MIN_SIZE},Number(s)))`,
  },
])

console.log('superdoc font-size patch applied (idempotent)')
