/** Structural coverage for frame-aligned Fortune scrollbar updates. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const util = fs.readFileSync(
  path.join(root, 'src/lightweight-office/utils/excel-frame-scroll.ts'),
  'utf8',
)
const editor = fs.readFileSync(
  path.join(root, 'src/lightweight-office/editors/ExcelEditor.tsx'),
  'utf8',
)

assert.match(util, /addEventListener\('scroll', onScrollCapture, true\)/)
assert.match(util, /event\.stopPropagation\(\)/)
assert.match(util, /requestAnimationFrame\(flush\)/)
assert.match(util, /pendingTargets = new Set/)
assert.match(util, /flushSync\(\(\) =>/)
assert.match(util, /target\.dispatchEvent\(new Event\('scroll'\)\)/)
assert.match(editor, /attachExcelFrameScroll\(shell\)/)
console.log('PASS  Excel scrollbar updates are coalesced and flushed once per display frame')
