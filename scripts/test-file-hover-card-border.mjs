/**
 * Theme-aware outline on FileHoverCard (right-side popup for 最近/浏览).
 * Drives the shipped fileHoverCardBoxShadow() helper.
 *
 * Run: npx tsx scripts/test-file-hover-card-border.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FILE_HOVER_CARD_OUTLINE_PX,
  fileHoverCardBoxShadow,
  parseHoverCardOutlineWidthPx,
} from '../src/components/file-manager/file-hover-card-styles.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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

test('light mode: black outline via box-shadow', () => {
  const shadow = fileHoverCardBoxShadow(false)
  assert.match(shadow, new RegExp(`0 0 0 ${FILE_HOVER_CARD_OUTLINE_PX}px #000000`, 'i'))
  assert.doesNotMatch(shadow, /#ffffff/i)
})

test('dark mode: white outline via box-shadow', () => {
  const shadow = fileHoverCardBoxShadow(true)
  assert.match(shadow, new RegExp(`0 0 0 ${FILE_HOVER_CARD_OUTLINE_PX}px #ffffff`, 'i'))
  assert.doesNotMatch(shadow, /#000000/i)
})

test('light black and dark white outlines use the exact same pixel width', () => {
  const lightW = parseHoverCardOutlineWidthPx(fileHoverCardBoxShadow(false))
  const darkW = parseHoverCardOutlineWidthPx(fileHoverCardBoxShadow(true))
  assert.equal(lightW, darkW)
  assert.equal(lightW, FILE_HOVER_CARD_OUTLINE_PX)
  assert.equal(darkW, FILE_HOVER_CARD_OUTLINE_PX)
  // Dark white ring is the visual reference thickness.
  assert.equal(FILE_HOVER_CARD_OUTLINE_PX, 1)
})

test('FileHoverCard applies fileHoverCardBoxShadow(isDark) — not hardcoded white', () => {
  const src = read('src/components/file-manager/FileHoverCard.tsx')
  assert.match(src, /from ['"]\.\/file-hover-card-styles['"]/)
  assert.match(src, /fileHoverCardBoxShadow\(isDark\)/)
  assert.doesNotMatch(
    src,
    /boxShadow:\s*['"]0 0 0 1px #ffffff/,
    'must not hardcode white outline on the card style',
  )
  assert.match(src, /APP_THEME_EVENT|MutationObserver/)
})

test('FileTree and RecentFiles still use FileHoverCard for the popup', () => {
  assert.match(read('src/components/file-manager/FileTree.tsx'), /FileHoverCard/)
  assert.match(read('src/components/file-manager/RecentFiles.tsx'), /FileHoverCard/)
})

console.log(`\nlight: ${fileHoverCardBoxShadow(false)}`)
console.log(`dark:  ${fileHoverCardBoxShadow(true)}`)
console.log(`outline width (both): ${FILE_HOVER_CARD_OUTLINE_PX}px`)
console.log(`${passed} tests passed`)
if (process.exitCode) process.exit(1)
