import assert from 'node:assert/strict'
import { BUNDLED_PROVIDER_CATALOG } from '../electron/services/provider-catalog.seed'
import {
  isTextChatModel,
  mergeProviderCatalog,
  withBundledCatalog,
  type ModelsDevModel,
  type ProviderDefinition,
} from '../electron/services/provider-registry.service'
import {
  normalizeProviderBaseURL,
  normalizeProviderEndpoint,
} from '../electron/services/provider-base-url.util'

assert.equal(BUNDLED_PROVIDER_CATALOG.length, 185, 'the bundled provider directory must contain 185 providers')
assert.equal(new Set(BUNDLED_PROVIDER_CATALOG.map((provider) => provider.id)).size, 185, 'provider IDs must be unique')
assert.equal(
  BUNDLED_PROVIDER_CATALOG.reduce((count, provider) => count + provider.models.length, 0),
  5_556,
  'the bundled provider directory must retain the complete model snapshot',
)
assert.deepEqual(
  BUNDLED_PROVIDER_CATALOG.filter((provider) => !provider.doc).map((provider) => provider.id),
  [],
  'every bundled provider must retain its documentation link',
)
assert.ok(
  BUNDLED_PROVIDER_CATALOG.every((provider) => provider.doc?.startsWith('https://')),
  'bundled provider documentation links must be browser-safe HTTPS URLs',
)
for (const expected of [
  {
    id: 'iflytek-astron-coding-plan',
    api: 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2',
    firstModel: 'astron-code-latest',
    modelCount: 20,
  },
  {
    id: 'jdcloud-joybuilder-coding-plan',
    api: 'https://modelservice.jdcloud.com/coding/openai/v1',
    firstModel: 'DeepSeek-V3.2',
    modelCount: 7,
  },
  {
    id: 'streamlake-kwaikat-coding-plan',
    api: 'https://wanqing.streamlakeapi.com/api/gateway/coding/v1',
    firstModel: 'kat-coder-pro-v2.5',
    modelCount: 3,
  },
  {
    id: 'compshare-coding-plan',
    api: 'https://cp.compshare.cn/v1',
    firstModel: 'deepseek-v4-flash',
    modelCount: 6,
  },
] as const) {
  const provider = BUNDLED_PROVIDER_CATALOG.find(({ id }) => id === expected.id)
  assert.ok(provider, `${expected.id} must remain in the bundled provider directory`)
  assert.equal(provider.api, expected.api, `${expected.id} must retain its subscription endpoint`)
  assert.equal(provider.protocol, 'openai-compatible', `${expected.id} must use the OpenAI-compatible client`)
  assert.equal(provider.models[0]?.id, expected.firstModel, `${expected.id} must retain its recommended model`)
  assert.equal(provider.models.length, expected.modelCount, `${expected.id} must retain its documented model list`)
}
assert.equal(
  BUNDLED_PROVIDER_CATALOG.find((provider) => provider.id === 'opencode-go')?.doc,
  'https://opencode.ai/docs/go',
  'OpenCode Go must use its dedicated documentation page',
)

const firstProvider = BUNDLED_PROVIDER_CATALOG[0]
const incompleteRefresh: ProviderDefinition = {
  ...firstProvider,
  api: '',
  env: [],
  doc: undefined,
  models: firstProvider.models.slice(0, 1),
}
const mergedCatalog = mergeProviderCatalog(BUNDLED_PROVIDER_CATALOG, [incompleteRefresh])
const mergedFirstProvider = mergedCatalog.find((provider) => provider.id === firstProvider.id)
assert.equal(mergedCatalog.length, 185, 'a partial refresh must not remove bundled providers')
assert.equal(mergedFirstProvider?.api, firstProvider.api, 'a blank refresh address must not clear the bundled address')
assert.deepEqual(mergedFirstProvider?.env, firstProvider.env, 'a blank refresh must not clear environment metadata')
assert.equal(mergedFirstProvider?.doc, firstProvider.doc, 'a blank refresh must not clear documentation')
assert.equal(
  mergedFirstProvider?.models.length,
  firstProvider.models.length,
  'a partial refresh must not remove bundled models',
)

const maliciousRefresh: ProviderDefinition = {
  ...firstProvider,
  name: 'Untrusted replacement',
  api: 'https://attacker.invalid/v1',
  env: ['STOLEN_KEY'],
  npm: '@ai-sdk/openai-compatible',
  protocol: 'openai-compatible',
  doc: 'https://attacker.invalid/docs',
  models: [{ id: 'safe-model-metadata-update', name: 'Safe model metadata update' }],
}
const protectedCatalog = mergeProviderCatalog(BUNDLED_PROVIDER_CATALOG, [maliciousRefresh])
const protectedProvider = protectedCatalog.find((provider) => provider.id === firstProvider.id)
assert.equal(protectedProvider?.name, firstProvider.name, 'remote metadata must not replace a bundled provider name')
assert.equal(protectedProvider?.api, firstProvider.api, 'remote metadata must not replace a bundled API endpoint')
assert.deepEqual(protectedProvider?.env, firstProvider.env, 'remote metadata must not replace credential metadata')
assert.equal(protectedProvider?.npm, firstProvider.npm, 'remote metadata must not replace the client implementation')
assert.equal(protectedProvider?.protocol, firstProvider.protocol, 'remote metadata must not replace the wire protocol')
assert.equal(protectedProvider?.doc, firstProvider.doc, 'remote metadata must not replace the documentation URL')
assert.ok(protectedProvider?.models.some(({ id }) => id === 'safe-model-metadata-update'))
assert.equal(
  withBundledCatalog([{ ...maliciousRefresh, id: 'remote-only-provider' }])
    .some(({ id }) => id === 'remote-only-provider'),
  false,
  'an untrusted remote catalog must not introduce a credential endpoint',
)

assert.equal(
  normalizeProviderBaseURL('openai-compatible', 'http://127.0.0.1:11434/v1'),
  'http://127.0.0.1:11434/v1',
)
assert.throws(
  () => normalizeProviderBaseURL('openai-compatible', 'http://api.example.com/v1'),
  /INSECURE_PROVIDER_BASE_URL/,
)
assert.equal(
  normalizeProviderEndpoint(firstProvider, `${new URL(firstProvider.api).origin}/alternate/v1`),
  `${new URL(firstProvider.api).origin}/alternate/v1`,
)
assert.throws(
  () => normalizeProviderEndpoint(firstProvider, 'https://attacker.invalid/v1'),
  /PROVIDER_BASE_URL_ORIGIN_MISMATCH/,
)
const endpointConfiguredProvider: ProviderDefinition = {
  ...firstProvider,
  id: 'account-scoped-provider',
  api: '',
}
assert.equal(
  normalizeProviderEndpoint(endpointConfiguredProvider, 'https://tenant.example.com/v1'),
  'https://tenant.example.com/v1',
  'providers without a fixed endpoint must accept an explicit HTTPS endpoint',
)
assert.throws(
  () => normalizeProviderEndpoint(endpointConfiguredProvider, 'http://127.0.0.1:9000/v1'),
  /UNPINNED_PROVIDER_MUST_USE_HTTPS/,
)
assert.equal(
  normalizeProviderEndpoint(
    { ...endpointConfiguredProvider, api: 'https://${TENANT_HOST}/v1' },
    'https://tenant.example.com/v1',
  ),
  'https://tenant.example.com/v1',
  'account-scoped endpoint templates must remain configurable',
)

const textOutput = { input: ['text'], output: ['text'] }
const rejected: ModelsDevModel[] = [
  { id: 'bge-multilingual-gemma2', modalities: textOutput },
  { id: 'melotts', modalities: textOutput },
  { id: 'studiovoice', modalities: textOutput },
  { id: 'nemotron-voicechat', modalities: textOutput },
  { id: 'PaddlePaddle/PaddleOCR-VL-1.5', modalities: textOutput },
  { id: 'meta/esm2-650m', modalities: textOutput },
  { id: 'meta/esmfold', modalities: textOutput },
  { id: 'fastino/gliner2-large', modalities: textOutput },
  { id: 'fastino/gliguard', modalities: textOutput },
  { id: 'qwen3guard-gen-8b', modalities: textOutput },
  { id: 'usdvalidate', modalities: textOutput },
  { id: 'gpt-image-2', modalities: { input: ['text'], output: ['image'] } },
]

for (const model of rejected) {
  assert.equal(isTextChatModel(model), false, `${model.id} must not be listed as a chat model`)
}

assert.equal(
  isTextChatModel({
    id: 'gpt-4o',
    description: 'A multimodal chat model',
    modalities: { input: ['text', 'image'], output: ['text'] },
  }),
  true,
  'multimodal input with text-only chat output should remain available',
)

console.log('PASS provider model catalog keeps chat models only')
