/**
 * Unit coverage for the code-language badges shown in DocumentTabBar.
 * Run: npx tsx scripts/test-code-file-tab-visuals.ts
 */
import assert from 'node:assert/strict'
import { getCodeFileTabVisual } from '../src/lib/file-tab-visuals'

const cpp = getCodeFileTabVisual('src/main.cpp')
const python = getCodeFileTabVisual('tools/build.py')
const java = getCodeFileTabVisual('src/Main.java')
const javascript = getCodeFileTabVisual('src/app.js')
const typescript = getCodeFileTabVisual('src/App.tsx')

assert.equal(cpp?.badge, 'C++')
assert.equal(python?.badge, 'Py')
assert.equal(java?.badge, 'J')
assert.equal(javascript?.badge, 'JS')
assert.equal(typescript?.badge, 'TS')
assert.equal(
  new Set([cpp?.id, python?.id, java?.id, javascript?.id, typescript?.id]).size,
  5,
)

assert.equal(getCodeFileTabVisual('Dockerfile')?.id, 'docker')
assert.equal(getCodeFileTabVisual('CMakeLists.txt')?.id, 'cmake')
assert.equal(getCodeFileTabVisual('.env.local')?.badge, 'ENV')
assert.equal(getCodeFileTabVisual('include/widget.hpp')?.badge, 'H++')
assert.equal(getCodeFileTabVisual('README.unknown'), null)

console.log('PASS  code file tab visuals are distinct and cover special filenames')
