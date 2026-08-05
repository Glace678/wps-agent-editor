import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'src/components/file-manager/RecentFiles.tsx'), 'utf8')
let passed = 0

function test(name, check) {
  try {
    check()
    passed += 1
    console.log(`PASS  ${name}`)
  } catch (error) {
    console.error(`FAIL  ${name}`)
    throw error
  }
}

test('selection square is visible only while its row is hovered (or selected)', () => {
  assert.match(source, /opacity-0/)
  assert.match(source, /group-hover:opacity-100/)
  assert.match(source, /selectedPaths\.has\(file\.path\)\s*\n?\s*\? 'border-primary bg-primary text-primary-foreground'/)
  assert.match(source, /data-recent-file-select/)
})

test('selection square has explicit light and dark theme colors', () => {
  assert.match(source, /border-black\/55[^']*bg-white/)
  assert.match(source, /dark:border-white\/65[^']*dark:bg-\[#242424\]/)
  assert.match(source, /border-primary bg-primary text-primary-foreground/)
})

test('checkbox clicks toggle paths without bubbling into row open behavior', () => {
  assert.match(source, /data-recent-file-select/)
  assert.match(source, /className="flex h-6 w-6 shrink-0 items-center justify-center/)
  assert.doesNotMatch(source, /pointer-events-none/)
  assert.match(source, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/)
  assert.match(source, /onMouseDown=\{\(event\) => event\.stopPropagation\(\)\}/)
  assert.match(source, /event\.stopPropagation\(\)[\s\S]*if \(next\.has\(file\.path\)\) next\.delete\(file\.path\)[\s\S]*else next\.add\(file\.path\)/)
})

test('row click stays single-select and double-click opens', () => {
  assert.match(source, /onClick=\{\(\) => setSelectedPaths\(new Set\(\[file\.path\]\)\)\}/)
  assert.match(source, /onDoubleClick=\{\(\) => onOpen\(file\.path\)\}/)
})

test('drag-selection listeners were removed', () => {
  assert.doesNotMatch(source, /dragRef|handlePointerMove|addEventListener\('pointermove'/)
})

test('right-click opens the menu only for an already selected file', () => {
  assert.match(source, /event\.preventDefault\(\)[\s\S]*if \(!selectedPaths\.has\(file\.path\)\) return[\s\S]*setMenu/)
  assert.doesNotMatch(source, /if \(!selectedPaths\.has\(file\.path\)\) setSelectedPaths/)
  assert.match(source, /<RecentFileContextMenu/)
})

console.log(`\n${passed} tests passed`)
