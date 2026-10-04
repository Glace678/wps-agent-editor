import assert from 'node:assert/strict'
import catalog from '../src-tauri/resources/provider-catalog.json'
import {
  createProviderSearchIndex,
  normalizeProviderSearchQuery,
  searchProviderIndex,
  searchProviders,
} from '../src/lib/provider-search'
import { PROVIDER_SEARCH_LOCALES, type ProviderSearchLocale } from '../src/lib/provider-search-aliases'
import type { ProviderDefinition } from '../src/types/provider'

const BUNDLED_PROVIDER_CATALOG = catalog as ProviderDefinition[]

const ALIBABA_PROVIDER_IDS = [
  'alibaba',
  'alibaba-cn',
  'alibaba-coding-plan-cn',
  'alibaba-coding-plan',
  'alibaba-token-plan',
  'alibaba-token-plan-cn',
]

const XIAOMI_PROVIDER_IDS = [
  'xiaomi',
  'xiaomi-token-plan-cn',
  'xiaomi-token-plan-ams',
  'xiaomi-token-plan-sgp',
]

const CATALOG_INDEX = createProviderSearchIndex(BUNDLED_PROVIDER_CATALOG)

function resultIds(
  query: string,
  providers = BUNDLED_PROVIDER_CATALOG,
  language: ProviderSearchLocale = 'zh-CN',
): string[] {
  return searchProviders(providers, query, language).map(({ provider }) => provider.id)
}

assert.equal(BUNDLED_PROVIDER_CATALOG.length, 179, 'all bundled providers must be indexed')
const bundledModelCount = BUNDLED_PROVIDER_CATALOG.reduce((count, provider) => count + provider.models.length, 0)
assert.equal(
  bundledModelCount,
  5_485,
  'all bundled model metadata must remain searchable',
)

// Every bundled provider must be reachable through its stable ID and display
// name, and every model ID/name must be discoverable inside its provider.
// Model lookups intentionally use the model-inclusive scope: provider-name
// search (the default) must never surface a provider just because it hosts a
// matching model.
for (const provider of BUNDLED_PROVIDER_CATALOG) {
  for (const term of [provider.id, provider.name]) {
    assert.ok(
      searchProviderIndex(CATALOG_INDEX, term).some(({ provider: match }) => match.id === provider.id),
      `${provider.id} must be searchable by ${term}`,
    )
  }
  const providerIndex = createProviderSearchIndex([provider])
  for (const model of provider.models) {
    for (const term of [model.id, model.name]) {
      assert.ok(
        searchProviderIndex(providerIndex, term, { scope: 'provider-names-and-models' }).some(({ provider: match }) => match.id === provider.id),
        `${provider.id}/${model.id} must be searchable by ${term}`,
      )
    }
  }
}

const qwenResults = searchProviders(BUNDLED_PROVIDER_CATALOG, 'qwen')
assert.ok(qwenResults.length >= ALIBABA_PROVIDER_IDS.length, 'qwen must return associated providers')
assert.deepEqual(
  qwenResults.slice(0, ALIBABA_PROVIDER_IDS.length).map(({ provider }) => provider.id),
  ALIBABA_PROVIDER_IDS,
  'Alibaba/Qwen services must be ranked before third-party Qwen hosts',
)
for (const providerId of ALIBABA_PROVIDER_IDS) {
  assert.ok(qwenResults.some(({ provider }) => provider.id === providerId), `${providerId} must be suggested for qwen`)
}
// Provider-name search matches identity only: gateways that merely host Qwen
// models (ModelScope, OpenRouter) are no longer suggested by the model name.
assert.equal(qwenResults.some(({ provider }) => provider.id === 'modelscope'), false, 'model hosts without a Qwen name must not be suggested')
assert.equal(qwenResults.some(({ provider }) => provider.id === 'openrouter'), false, 'model hosts without a Qwen name must not be suggested')
assert.equal(qwenResults.some(({ provider }) => provider.id === 'zhipuai'), false, 'providers without Qwen models must not be suggested')

assert.equal(normalizeProviderSearchQuery('通义千问模型服务'), 'qwen', 'Chinese Qwen aliases should canonicalize')
assert.equal(normalizeProviderSearchQuery('模型'), '模型', 'a one-word Chinese context term should remain searchable')
assert.equal(normalizeProviderSearchQuery('小米模型服务商'), 'xiaomi', 'Chinese context words should be removable')
assert.equal(normalizeProviderSearchQuery('model provider ModelScope'), 'modelscope', 'Latin context words must not corrupt ModelScope')
assert.deepEqual(
  resultIds('通义千问').slice(0, ALIBABA_PROVIDER_IDS.length),
  ALIBABA_PROVIDER_IDS,
  '通义千问 must find the same Alibaba services as qwen',
)
assert.deepEqual(
  resultIds('千問').slice(0, ALIBABA_PROVIDER_IDS.length),
  ALIBABA_PROVIDER_IDS,
  'traditional Chinese Qwen aliases should work',
)

for (const query of ['百炼', 'Bailian', 'DashScope', '灵积', 'Model Studio']) {
  const ids = resultIds(query)
  for (const providerId of ALIBABA_PROVIDER_IDS) {
    assert.ok(ids.includes(providerId), `${query} must suggest ${providerId}`)
  }
}

assert.deepEqual(
  resultIds('Qwen Code').slice(0, 4),
  ['alibaba-coding-plan-cn', 'alibaba-coding-plan', 'alibaba-token-plan', 'alibaba-token-plan-cn'],
  'Qwen Code should suggest both official subscription services in plan order',
)
assert.deepEqual(
  resultIds('通义灵码').slice(0, 4),
  ['alibaba-coding-plan-cn', 'alibaba-coding-plan', 'alibaba-token-plan', 'alibaba-token-plan-cn'],
  'the Tongyi Lingma product name should prioritize coding subscriptions',
)

assert.deepEqual(
  resultIds('qwen coding').slice(0, 2),
  ['alibaba-coding-plan-cn', 'alibaba-coding-plan'],
  'Coding Plan should lead a combined Qwen/coding search',
)
assert.ok(resultIds('qwen coding').includes('alibaba-token-plan'), 'token coding terminology should include Token Plan')
assert.deepEqual(
  resultIds('qwen token').slice(0, 2),
  ['alibaba-token-plan', 'alibaba-token-plan-cn'],
  'Token Plan should lead a Qwen/token search',
)

const localeXiaomiQueries: Readonly<Record<ProviderSearchLocale, string>> = {
  'zh-CN': '小米',
  en: 'Xiaomi MiMo',
  ja: 'シャオミ',
  es: 'IA de Xiaomi',
  pt: 'IA da Xiaomi',
  de: 'Xiaomi-KI',
  fr: 'modèle Xiaomi',
  ru: 'Сяоми',
  ar: 'شاومي',
}
assert.deepEqual(
  [...PROVIDER_SEARCH_LOCALES].sort(),
  Object.keys(localeXiaomiQueries).sort(),
  'all nine renderer languages must have a search probe',
)
for (const language of PROVIDER_SEARCH_LOCALES) {
  const results = searchProviders(BUNDLED_PROVIDER_CATALOG, localeXiaomiQueries[language], language)
  const ids = results.map(({ provider }) => provider.id)
  assert.deepEqual(
    ids,
    XIAOMI_PROVIDER_IDS,
    `${language} Xiaomi aliases must return exactly the official endpoints under provider-name search`,
  )
}

// Family aliases.
// - mode 'exact': the query must return EXACTLY these providers, in this order.
// - mode 'leading': the canonical brand must rank first and be present; hosted
//   gateways may follow, but cross-brand noise listed in `deny` must not leak in.
// A bare "contains the expected ids" check previously let unrelated providers slip
// into results (or be ranked above the expected ones) undetected.
const familyChecks: ReadonlyArray<
  | { query: string; mode: 'exact'; expected: readonly string[] }
  | { query: string; mode: 'leading'; expected: readonly string[]; deny: readonly string[] }
> = [
  { query: '腾讯', mode: 'exact', expected: ['tencent-tokenhub', 'tencent-coding-plan', 'tencent-token-plan'] },
  { query: '腾讯元宝', mode: 'exact', expected: ['tencent-tokenhub', 'tencent-coding-plan', 'tencent-token-plan'] },
  { query: '深度求索', mode: 'exact', expected: ['deepseek'] },
  { query: '月之暗面', mode: 'exact', expected: ['moonshotai-cn', 'moonshotai', 'kimi-for-coding'] },
  { query: '智谱', mode: 'exact', expected: ['zhipuai', 'zai', 'zhipuai-coding-plan', 'zai-coding-plan'] },
  { query: '阶跃星辰', mode: 'exact', expected: ['stepfun', 'stepfun-ai', 'stepfun-step-plan', 'stepfun-ai-step-plan'] },
  { query: '跃问', mode: 'exact', expected: ['stepfun', 'stepfun-ai', 'stepfun-step-plan', 'stepfun-ai-step-plan'] },
  { query: '硅基流动', mode: 'exact', expected: ['siliconflow', 'siliconflow-cn'] },
  { query: 'SiliconCloud', mode: 'exact', expected: ['siliconflow', 'siliconflow-cn'] },
  { query: '魔搭', mode: 'exact', expected: ['modelscope'] },
  { query: '小爱同学', mode: 'exact', expected: XIAOMI_PROVIDER_IDS },
  { query: 'OpenAI', mode: 'leading', expected: ['openai'], deny: ['anthropic', 'google', 'deepseek', 'zhipuai'] },
  { query: 'Claude', mode: 'leading', expected: ['anthropic'], deny: ['openai', 'google', 'deepseek'] },
  { query: 'Gemini', mode: 'leading', expected: ['google'], deny: ['openai', 'anthropic', 'deepseek'] },
]
for (const check of familyChecks) {
  const ids = resultIds(check.query)
  if (check.mode === 'exact') {
    assert.deepEqual(
      ids,
      check.expected,
      `family query ${check.query} must return exactly the expected providers in order`,
    )
  } else {
    assert.equal(ids[0], check.expected[0], `family query ${check.query} must rank ${check.expected[0]} first`)
    for (const providerId of check.expected) {
      assert.ok(ids.includes(providerId), `${check.query} must suggest ${providerId}`)
    }
    for (const providerId of check.deny) {
      assert.ok(!ids.includes(providerId), `${check.query} must not leak unrelated provider ${providerId}`)
    }
  }
}
// Dedicated brand entries (e.g. Volcengine Doubao) now surface under their
// own brand name; brands that only exist as hosted models are still reachable
// through the model-inclusive scope.
for (const [query, modelPattern] of [
  ['百度', /(?:ernie|qianfan|wenxin)/i],
] as const) {
  assert.deepEqual(
    resultIds(query),
    [],
    `${query} must not surface unrelated providers under provider-name search`,
  )
  const results = searchProviders(BUNDLED_PROVIDER_CATALOG, query, 'zh-CN', { scope: 'provider-names-and-models' })
  assert.ok(results.length > 0, `${query} must return model-host providers in the model-inclusive scope`)
  assert.ok(
    results.some(({ matchedModels }) => matchedModels.some((model) => modelPattern.test(`${model.id} ${model.name}`))),
    `${query} must expose matching model hints`,
  )
}
// 豆包 / 火山方舟 now have a dedicated Volcengine entry and must surface it.
for (const query of ['豆包', '火山方舟', '糖包']) {
  assert.ok(resultIds(query).includes('volcengine'), `${query} must surface the volcengine provider`)
}
assert.equal(resultIds('MiMo').some((id) => id === 'gmicloud'), false, 'MiMo must not match across unrelated word boundaries')

// Any fragment of a provider display name must surface that provider —
// including mid-name fragments ("seek" inside "DeepSeek") and fragments
// spanning separator characters ("irouter" inside "AI-ROUTER").
const nameFragmentChecks: ReadonlyArray<{ query: string; providerId: string }> = [
  { query: 'deep', providerId: 'deepseek' },
  { query: 'seek', providerId: 'deepseek' },
  { query: 'DeepSeek', providerId: 'deepseek' },
  { query: 'epsee', providerId: 'deepseek' },
  { query: 'irouter', providerId: 'ai-router' },
  { query: 'airouter', providerId: 'ai-router' },
]
for (const { query, providerId } of nameFragmentChecks) {
  const ids = resultIds(query)
  assert.ok(ids.includes(providerId), `${query} must surface ${providerId} through its display name`)
}
assert.equal(resultIds('deep')[0], 'deepseek', 'a name prefix must rank the matching provider first')
assert.equal(resultIds('seek')[0], 'deepseek', 'a mid-name fragment must rank the matching provider first')
assert.deepEqual(resultIds('xyzq'), [], 'queries that hit no provider name or model must stay empty')

const coderNext = searchProviders(BUNDLED_PROVIDER_CATALOG, 'Qwen3-Coder-Next', 'zh-CN', { scope: 'provider-names-and-models' })
const codingPlanMatch = coderNext.find(({ provider }) => provider.id === 'alibaba-coding-plan')
assert.deepEqual(
  codingPlanMatch?.matchedModels.map((model) => model.id),
  ['qwen3-coder-next'],
  'model ID punctuation and exact model hints should be preserved',
)

const customProvider: ProviderDefinition = {
  id: 'custom-qwen-gateway',
  name: 'Example Gateway',
  api: 'https://example.com/v1',
  env: [],
  npm: '@ai-sdk/openai-compatible',
  protocol: 'openai-compatible',
  models: [{ id: 'QWEN-LOCAL-7B', name: 'Qwen Local 7B' }],
}
assert.ok(
  resultIds('ample gate', [...BUNDLED_PROVIDER_CATALOG, customProvider]).includes('custom-qwen-gateway'),
  'custom providers should be searchable through their display name fragments',
)
assert.equal(
  resultIds('qwen local', [...BUNDLED_PROVIDER_CATALOG, customProvider]).includes('custom-qwen-gateway'),
  false,
  'a matching model must not surface a custom provider under provider-name search',
)
assert.ok(
  searchProviders([...BUNDLED_PROVIDER_CATALOG, customProvider], 'qwen local', 'zh-CN', { scope: 'provider-names-and-models' })
    .some(({ provider }) => provider.id === 'custom-qwen-gateway'),
  'model pickers should still discover custom providers through detected model metadata',
)
assert.deepEqual(resultIds('provider-that-does-not-exist'), [], 'unknown searches should not leak unrelated providers')

const emptyResults = searchProviderIndex(CATALOG_INDEX, '')
assert.equal(emptyResults.length, BUNDLED_PROVIDER_CATALOG.length, 'empty search should retain the complete provider list')
assert.deepEqual(
  emptyResults.slice(0, 3).map(({ provider }) => provider.id),
  BUNDLED_PROVIDER_CATALOG.slice(0, 3).map((provider) => provider.id),
  'empty search should preserve catalog order',
)

console.log(
  `PASS provider search covers ${BUNDLED_PROVIDER_CATALOG.length} providers, ${bundledModelCount} models, `
    + `${PROVIDER_SEARCH_LOCALES.length} locales, and ${qwenResults.length} Qwen hosts`,
)
