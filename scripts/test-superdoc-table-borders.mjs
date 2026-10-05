import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const chunks = path.join(root, 'node_modules', 'superdoc', 'dist', 'chunks')

// SuperDoc emits content-hashed chunk names (SuperConverter-<hash>.es.js,
// src-<hash>.es.js / .cjs) that change every release; resolve by pattern and
// assert the expected counts instead of hardcoding the hashes.
function resolveOne(pattern) {
  const matches = readdirSync(chunks).filter((name) => pattern.test(name)).sort()
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one chunks/${pattern} chunk, found ${matches.length}`)
  }
  return matches[0]
}
const converterEsm = path.join(chunks, resolveOne(/^SuperConverter-.*\.es\.js$/))

const converter = await import(pathToFileURL(converterEsm).href)
const resolvePreferredNewTableStyleId = converter.Is
const tableFallbackBorders = converter.Ns

assert.equal(typeof resolvePreferredNewTableStyleId, 'function')
assert.equal(Object.keys(tableFallbackBorders).length, 6)
for (const border of Object.values(tableFallbackBorders)) {
  assert.deepEqual(border, { val: 'single', size: 4, color: '#000000' })
}

const tableStyles = {
  styles: {
    TableNormal: { type: 'table', default: true },
    TableGrid: { type: 'table' },
    CustomTable: { type: 'table' },
  },
}

assert.deepEqual(resolvePreferredNewTableStyleId('TableNormal', tableStyles), {
  styleId: 'TableGrid',
  source: 'builtin-fallback',
})
assert.deepEqual(resolvePreferredNewTableStyleId('CustomTable', tableStyles), {
  styleId: 'CustomTable',
  source: 'settings-default',
})
assert.deepEqual(
  resolvePreferredNewTableStyleId('TableNormal', {
    styles: { TableNormal: { type: 'table', default: true } },
  }),
  { styleId: null, source: 'none' },
)

for (const file of [
  resolveOne(/^src-.*\.es\.js$/),
  resolveOne(/^src-.*\.cjs$/),
]) {
  const source = readFileSync(path.join(chunks, file), 'utf8')
  assert.match(source, /useDefaultBorder: false,/)
  assert.doesNotMatch(
    source,
    /useDefaultBorder: !effectiveTableBorders \|\| Object\.keys\(effectiveTableBorders\)\.length === 0,/,
  )
  assert.match(
    source,
    /tableProperties: \{\s*borders: \{\s*\.\.\.(?:require_SuperConverter\.)?TABLE_FALLBACK_BORDERS\s*\},/,
  )
  assert.match(
    source,
    /tableStyleId: resolved\.styleId,\s*borders: fallbackPixelBorders,\s*tableProperties: \{\s*tableStyleId: resolved\.styleId,\s*tblLook: \{ \.\.\.(?:require_SuperConverter\.)?DEFAULT_TBL_LOOK \},\s*borders: \{ \.\.\.(?:require_SuperConverter\.)?TABLE_FALLBACK_BORDERS \}/,
  )
}

const wordEditorCss = readFileSync(
  path.join(root, 'src', 'lightweight-office', 'word-editor.css'),
  'utf8',
)
assert.match(
  wordEditorCss,
  /\.superdoc-table-fragment\s*>\s*div:not\(\[style\*='border-'\]\):not\(\[class\*='border'\]\)::after/,
)
assert.match(wordEditorCss, /border:\s*1px solid #000;/)
assert.doesNotMatch(wordEditorCss, /border:\s*1px dotted rgb\(100 116 139 \/ 35%\);/)

console.log('SuperDoc inserted-table border regression checks passed')
