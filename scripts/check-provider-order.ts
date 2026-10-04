import assert from 'node:assert/strict'
import { orderProvidersForSettings } from '../src/lib/provider-order'
import type { AuthStatus, ProviderDefinition } from '../src/types/provider'

function provider(
  id: string,
  name: string,
  options: Pick<ProviderDefinition, 'isCustom' | 'isLocal' | 'sortName'> = {},
): ProviderDefinition {
  return {
    id,
    name,
    api: '',
    env: [],
    npm: '',
    protocol: 'openai-compatible',
    models: [],
    ...options,
  }
}

const providers = [
  provider('zhipuai', '智谱 AI', { sortName: 'Zhipu AI' }),
  provider('lucidquery', 'LucidQuery'),
  provider('custom-blue', 'Blue Custom', { isCustom: true }),
  provider('ollama', 'Ollama (本地)', { isLocal: true, sortName: 'Ollama' }),
  provider('configured-zulu', 'Zulu Configured'),
  provider('anyapi', 'AnyAPI'),
  // configured:false with a *different* AuthStatus.type: must NOT lead even though
  // a status object exists (only `configured === true` promotes a provider).
  provider('explicit-false', 'Explicitly Not Configured'),
  // No authStatus entry at all (unknown / unrequested credential state): must NOT lead.
  provider('missing-status', 'Missing Status Entry'),
  provider('tencent', 'Tencent'),
  provider('alibaba', '通义千问', { sortName: 'Alibaba' }),
  provider('together', 'Together AI'),
  provider('trusted-router', 'TrustedRouter'),
  provider('unrouter', 'Unrouter'),
  // A configured provider that sits at the END of the input array must still be
  // promoted to the configured-first group.
  provider('configured-alpha', 'Alpha Configured'),
]

const authStatus: Record<string, AuthStatus> = {
  'configured-zulu': { configured: true, type: 'api' },
  'configured-alpha': { configured: true, type: 'oauth' },
  'explicit-false': { configured: false, type: 'oauth' },
}

// Deep snapshot before the call: ordering must neither reorder the input array nor
// mutate any field (name, sortName, models, flags) on the registry objects.
const registryBefore = structuredClone(providers)
const ordered = orderProvidersForSettings(providers, authStatus)

assert.deepEqual(
  ordered.map(({ id }) => id),
  [
    'configured-alpha',
    'configured-zulu',
    'anyapi',
    'custom-blue',
    'explicit-false',
    'lucidquery',
    'missing-status',
    'ollama',
    'tencent',
    'together',
    'trusted-router',
    'alibaba',
    'unrouter',
    'zhipuai',
  ],
  'configured providers must lead, with each group ordered by canonical English name',
)

// Only the two providers with `configured === true` may occupy the leading group;
// configured:false, missing-status, and other auth types must not enter it.
const configuredLeading = ordered
  .filter((entry) => authStatus[entry.id]?.configured === true)
  .map(({ id }) => id)
assert.deepEqual(configuredLeading, ['configured-alpha', 'configured-zulu'])
for (const nonLeading of ['explicit-false', 'missing-status']) {
  assert.ok(
    !ordered.slice(0, configuredLeading.length).some((entry) => entry.id === nonLeading),
    `${nonLeading} must not enter the configured-first group`,
  )
}

// The returned list must be the exact same object references (no clone/replace) and
// the input registry must be byte-for-byte unchanged after the call.
for (const entry of ordered) {
  assert.ok(
    providers.includes(entry),
    'ordering must return the same provider object references, not copies',
  )
}
assert.deepEqual(
  providers,
  registryBefore,
  'provider ordering must not mutate the registry (order, fields, or object identity content)',
)

console.log('PASS provider settings ordering keeps configured providers first and sorts names A-Z')
