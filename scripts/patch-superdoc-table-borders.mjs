// SuperDoc 1.44.0 trusts the document settings' default table style when a new
// table is inserted. Many Word documents name TableNormal there, but
// TableNormal is intentionally borderless. Treat it like the existing
// type-default TableNormal case so the resolver can choose TableGrid, or fall
// back to SuperDoc's explicit TABLE_FALLBACK_BORDERS when TableGrid is absent.
// Always add those explicit black fallback borders to the inserted table as
// direct formatting as well. Some documents define TableGrid without usable
// border properties; direct formatting keeps rendering and save/export black.
//
// The renderer replacement removes an older local workaround that painted a
// border on every borderless table. Existing intentionally borderless tables
// must retain their source-document appearance.
// Idempotent: safe to run on every install.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
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

// SuperDoc emits content-hashed chunk names (src-<hash>.es.js / .cjs and
// SuperConverter-<hash>.es.js / .cjs) that change every release; resolve them by
// pattern and assert the expected counts instead of hardcoding the hashes.
const chunksDir = path.join(distDir, 'chunks')
const layoutChunks = readdirSync(chunksDir)
  .filter((name) => /^src-.*\.(?:es\.js|cjs)$/.test(name))
  .sort()
if (layoutChunks.length !== 2) {
  throw new Error(`Expected one ESM and one CJS layout chunk, found ${layoutChunks.length}`)
}
const layoutEsm = layoutChunks.find((name) => name.endsWith('.es.js'))
const layoutCjs = layoutChunks.find((name) => name.endsWith('.cjs'))
const converterChunks = readdirSync(chunksDir)
  .filter((name) => /^SuperConverter-.*\.(?:es\.js|cjs)$/.test(name))
  .sort()
if (converterChunks.length !== 2) {
  throw new Error(`Expected one ESM and one CJS SuperConverter chunk, found ${converterChunks.length}`)
}

const layoutReplacements = [
  {
    label: 'preserve intentionally borderless existing tables',
    from: `borders: paintBorders,
			borderBandOverridesPx,
			useDefaultBorder: !effectiveTableBorders || Object.keys(effectiveTableBorders).length === 0,`,
    to: `borders: paintBorders,
			borderBandOverridesPx,
			useDefaultBorder: false,`,
  },
]

for (const chunk of layoutChunks) apply(`chunks/${chunk}`, layoutReplacements)

const insertedTableBorderEsmReplacements = [
  {
    label: 'prepare explicit black borders for every newly inserted table',
    from: `function normalizeNewTableAttrs(editor) {
	const resolved = resolvePreferredNewTableStyleIdFromEditor(editor);
	if (resolved.source === "none") {
		const fallbackPixelBorders = cloneBorders(TABLE_FALLBACK_BORDERS, TABLE_BORDER_SIDES);
		mapBorderSizes(fallbackPixelBorders, eighthPointsToPixels);`,
    to: `function normalizeNewTableAttrs(editor) {
	const resolved = resolvePreferredNewTableStyleIdFromEditor(editor);
	const fallbackPixelBorders = cloneBorders(TABLE_FALLBACK_BORDERS, TABLE_BORDER_SIDES);
	mapBorderSizes(fallbackPixelBorders, eighthPointsToPixels);
	if (resolved.source === "none") {`,
  },
  {
    label: 'store explicit black borders alongside the preferred table style',
    from: `	return {
		tableStyleId: resolved.styleId,
		tableProperties: {
			tableStyleId: resolved.styleId,
			tblLook: { ...DEFAULT_TBL_LOOK }
		}
	};`,
    to: `	return {
		tableStyleId: resolved.styleId,
		borders: fallbackPixelBorders,
		tableProperties: {
			tableStyleId: resolved.styleId,
			tblLook: { ...DEFAULT_TBL_LOOK },
			borders: { ...TABLE_FALLBACK_BORDERS }
		}
	};`,
  },
]

const insertedTableBorderCjsReplacements = [
  {
    label: 'prepare explicit black borders for every newly inserted table',
    from: `function normalizeNewTableAttrs(editor) {
	const resolved = resolvePreferredNewTableStyleIdFromEditor(editor);
	if (resolved.source === "none") {
		const fallbackPixelBorders = cloneBorders(require_SuperConverter.TABLE_FALLBACK_BORDERS, TABLE_BORDER_SIDES);
		mapBorderSizes(fallbackPixelBorders, require_constants.eighthPointsToPixels);`,
    to: `function normalizeNewTableAttrs(editor) {
	const resolved = resolvePreferredNewTableStyleIdFromEditor(editor);
	const fallbackPixelBorders = cloneBorders(require_SuperConverter.TABLE_FALLBACK_BORDERS, TABLE_BORDER_SIDES);
	mapBorderSizes(fallbackPixelBorders, require_constants.eighthPointsToPixels);
	if (resolved.source === "none") {`,
  },
  {
    label: 'store explicit black borders alongside the preferred table style',
    from: `	return {
		tableStyleId: resolved.styleId,
		tableProperties: {
			tableStyleId: resolved.styleId,
			tblLook: { ...require_SuperConverter.DEFAULT_TBL_LOOK }
		}
	};`,
    to: `	return {
		tableStyleId: resolved.styleId,
		borders: fallbackPixelBorders,
		tableProperties: {
			tableStyleId: resolved.styleId,
			tblLook: { ...require_SuperConverter.DEFAULT_TBL_LOOK },
			borders: { ...require_SuperConverter.TABLE_FALLBACK_BORDERS }
		}
	};`,
  },
]

apply(`chunks/${layoutEsm}`, insertedTableBorderEsmReplacements)
apply(`chunks/${layoutCjs}`, insertedTableBorderCjsReplacements)

const preferredStyleReplacements = [
  {
    label: 'skip borderless TableNormal for newly inserted tables',
    from: `if (settingsDefaultTableStyleId && isKnownTableStyleId(settingsDefaultTableStyleId, translatedLinkedStyles)) return {`,
    to: `if (settingsDefaultTableStyleId && settingsDefaultTableStyleId !== "TableNormal" && isKnownTableStyleId(settingsDefaultTableStyleId, translatedLinkedStyles)) return {`,
  },
]

for (const chunk of converterChunks) apply(`chunks/${chunk}`, preferredStyleReplacements)

console.log('superdoc table border patch applied (idempotent)')
