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
  provider('tencent', 'Tencent'),
  provider('alibaba', '通义千问', { sortName: 'Alibaba' }),
  provider('together', 'Together AI'),
  provider('trusted-router', 'TrustedRouter'),
  provider('unrouter', 'Unrouter'),
  provider('configured-alpha', 'Alpha Configured'),
]

const authStatus: Record<string, AuthStatus> = {
  'configured-zulu': { configured: true, type: 'api' },
  'configured-alpha': { configured: true, type: 'oauth' },
}

const ordered = orderProvidersForSettings(providers, authStatus)

assert.deepEqual(
  ordered.map(({ id }) => id),
  [
    'configured-alpha',
    'configured-zulu',
    'anyapi',
    'custom-blue',
    'lucidquery',
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
assert.deepEqual(
  providers.map(({ id }) => id),
  [
    'zhipuai',
    'lucidquery',
    'custom-blue',
    'ollama',
    'configured-zulu',
    'anyapi',
    'tencent',
    'alibaba',
    'together',
    'trusted-router',
    'unrouter',
    'configured-alpha',
  ],
  'provider ordering must not mutate the registry result',
)

console.log('PASS provider settings ordering keeps configured providers first and sorts names A-Z')
