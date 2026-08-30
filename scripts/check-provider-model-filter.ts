import assert from 'node:assert/strict'
import catalog from '../src-tauri/resources/provider-catalog.json'

assert.equal(catalog.length, 178, 'the bundled provider directory must contain 178 providers')
assert.equal(new Set(catalog.map((provider) => provider.id)).size, 178, 'provider IDs must be unique')
assert.equal(
  catalog.reduce((count, provider) => count + provider.models.length, 0),
  5_482,
  'the bundled provider directory must retain the complete model snapshot',
)
assert.deepEqual(
  catalog.filter((provider) => !provider.doc).map((provider) => provider.id),
  [],
  'every bundled provider must retain its documentation link',
)
assert.ok(
  catalog.every((provider) => provider.doc?.startsWith('https://')),
  'bundled provider documentation links must use HTTPS',
)
assert.ok(
  catalog.every((provider) => provider.models.every((model) => model.id && model.name)),
  'every bundled model must retain a stable id and display name',
)
assert.equal(
  catalog.find((provider) => provider.id === 'opencode-go')?.doc,
  'https://opencode.ai/docs/go',
  'OpenCode Go must use its dedicated documentation page',
)

console.log('PASS canonical Rust provider catalog is complete and structurally valid')
