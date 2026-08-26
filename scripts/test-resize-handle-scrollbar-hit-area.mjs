import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(
  new URL('../src/components/layout/resize/ResizeHandle.tsx', import.meta.url),
  'utf8',
)

test('resize handle hit area never extends left over a panel scrollbar', () => {
  assert.match(source, /before:left-0/)
  assert.match(source, /before:-right-1/)
  assert.doesNotMatch(source, /before:-left-/)
})
