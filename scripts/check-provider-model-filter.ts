import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import catalog from '../src-tauri/resources/provider-catalog.json'

assert.equal(catalog.length, 179, 'the bundled provider directory must contain 179 providers')
assert.equal(new Set(catalog.map((provider) => provider.id)).size, 179, 'provider IDs must be unique')
assert.equal(
  catalog.reduce((count, provider) => count + provider.models.length, 0),
  5_485,
  'the bundled provider directory must retain the complete model snapshot',
)

// Canonical member-set snapshot. The totals above only guard counts: a provider or
// model could be swapped out (or a model moved between providers) while the totals
// and local doc/HTTPS/truthiness assertions still pass. Pin the exact set of
// (provider id -> sorted model ids) pairs as a stable sha256 so any addition,
// deletion, rename, or cross-provider move fails this check. Recompute the hash
// below when the catalog intentionally changes (same discipline as the 179/5_485
// constants).
const canonicalMembers = catalog
  .map((provider) => ({
    id: provider.id,
    models: provider.models.map((model) => model.id).slice().sort(),
  }))
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
const canonicalHash = createHash('sha256')
  .update(JSON.stringify(canonicalMembers))
  .digest('hex')
assert.equal(
  canonicalHash,
  '3f0ace1550a0b1971d708c32ebaa7cdf0cbd5d6b3e942b1c7c29437c36b459e7',
  'the canonical provider/model member set changed. If this is intentional, recompute the snapshot hash.',
)

const CONTROL_CHAR = /[\u0000-\u001F\u007F]/

function assertHttpsDocUrl(value: unknown, providerId: string): asserts value is string {
  assert.equal(typeof value, 'string', `${providerId}: doc must be a string`)
  const url = value as string
  if (CONTROL_CHAR.test(url)) {
    assert.fail(`${providerId}: doc URL contains a control character`)
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    assert.fail(`${providerId}: doc must be an absolute URL (got ${JSON.stringify(url)})`)
  }
  assert.equal(parsed.protocol, 'https:', `${providerId}: doc must use https (got ${JSON.stringify(url)})`)
  assert.ok(parsed.hostname, `${providerId}: doc must have a non-empty host`)
}

assert.deepEqual(
  catalog.filter((provider) => !provider.doc).map((provider) => provider.id),
  [],
  'every bundled provider must retain its documentation link',
)
for (const provider of catalog) {
  assertHttpsDocUrl(provider.doc, provider.id)
  for (const model of provider.models) {
    assert.equal(typeof model.id, 'string', `${provider.id}: model id must be a string`)
    assert.ok((model.id as string).trim().length > 0, `${provider.id}: model id must be non-empty`)
    assert.equal(typeof model.name, 'string', `${provider.id}/${String(model.id)}: model name must be a string`)
    assert.ok(
      (model.name as string).trim().length > 0,
      `${provider.id}/${String(model.id)}: model name must be non-empty`,
    )
  }
}
assert.equal(
  catalog.find((provider) => provider.id === 'opencode-go')?.doc,
  'https://opencode.ai/docs/go',
  'OpenCode Go must use its dedicated documentation page',
)

console.log('PASS canonical Rust provider catalog is complete and structurally valid')
