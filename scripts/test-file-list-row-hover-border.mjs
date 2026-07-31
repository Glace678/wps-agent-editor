/**
 * Tests for theme-aware hover border on 最近 / 浏览 file-list rows.
 * Drives the shipped FILE_LIST_ROW_HOVER_BORDER constant and checks both
 * consumers (FileTree, RecentFiles) wire it into row buttons.
 *
 * Run: node scripts/test-file-list-row-hover-border.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

// tsx/esbuild not required: the styles module is plain TS-exportable JS string.
// Load via dynamic import after compiling with a tiny eval of the source export.
function loadShippedHoverBorderClass() {
  const stylesPath = path.join(root, 'src/components/file-manager/file-list-row-styles.ts')
  const src = fs.readFileSync(stylesPath, 'utf8')
  // Extract the exported string constant from the real source file.
  const m = src.match(
    /export\s+const\s+FILE_LIST_ROW_HOVER_BORDER\s*=\s*\n?\s*['`]([^'`]+)['`]/,
  )
  assert.ok(m, 'FILE_LIST_ROW_HOVER_BORDER export must exist in file-list-row-styles.ts')
  return m[1]
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

let passed = 0
function test(name, fn) {
  try {
    fn()
    console.log(`PASS  ${name}`)
    passed += 1
  } catch (err) {
    console.error(`FAIL  ${name}`)
    console.error(err)
    process.exitCode = 1
  }
}

test('shipped hover border class draws full rectangle with transparent default', () => {
  const cls = loadShippedHoverBorderClass()
  assert.match(cls, /\bborder\b/, 'must set border width for full rectangular outline')
  assert.match(cls, /\bborder-transparent\b/, 'default state must not show a colored box')
  assert.doesNotMatch(cls, /hover:bg-/, 'border token must not own background fill')
})

test('light mode hover uses black border; dark mode hover uses white border', () => {
  const cls = loadShippedHoverBorderClass()
  assert.match(cls, /\bhover:border-black\b/, 'light/day mode: black hover box')
  assert.match(cls, /\bdark:hover:border-white\b/, 'dark/night mode: white hover box')
})

test('FileTree (浏览) imports and applies FILE_LIST_ROW_HOVER_BORDER on dir and file rows', () => {
  const src = read('src/components/file-manager/FileTree.tsx')
  assert.match(src, /FILE_LIST_ROW_HOVER_BORDER/)
  assert.match(src, /from ['"]\.\/file-list-row-styles['"]/)
  // Both directory and file buttons use cn(..., FILE_LIST_ROW_HOVER_BORDER)
  const uses = [...src.matchAll(/FILE_LIST_ROW_HOVER_BORDER/g)]
  // import + two button classNames
  assert.ok(uses.length >= 3, `expected ≥3 references (import + dir + file), got ${uses.length}`)
  assert.match(src, /onOpenDir/)
  assert.match(src, /onOpenFile/)
})

test('RecentFiles (最近) imports and applies FILE_LIST_ROW_HOVER_BORDER on file rows', () => {
  const src = read('src/components/file-manager/RecentFiles.tsx')
  assert.match(src, /FILE_LIST_ROW_HOVER_BORDER/)
  assert.match(src, /from ['"]\.\/file-list-row-styles['"]/)
  assert.match(src, /onOpen\(file\.path\)/)
})

test('FileManager still mounts FileTree and RecentFiles for both tabs', () => {
  const src = read('src/components/file-manager/FileManager.tsx')
  assert.match(src, /<FileTree/)
  assert.match(src, /<RecentFiles/)
})

// Also re-export assertion via Node path existence
test('shared styles module file exists at shipped path', () => {
  assert.ok(
    fs.existsSync(path.join(root, 'src/components/file-manager/file-list-row-styles.ts')),
  )
  // unused require keep for createRequire pattern stability
  void require
})

console.log(`\nShipped hover border class: "${loadShippedHoverBorderClass()}"`)
console.log(`${passed} tests passed`)
if (process.exitCode) process.exit(1)
