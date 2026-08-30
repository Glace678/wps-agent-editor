import assert from 'node:assert/strict'
import {
  getAgentReasoningRequestOptions,
  normalizeAgentReasoningSelection,
  reasoningSelectionKey,
  resolveAgentReasoningProfile,
} from '../src/lib/agent-reasoning'
import type { ProviderDefinition, ProviderModel, ProviderProtocol } from '../src/types/provider'

function provider(
  id: string,
  protocol: ProviderProtocol,
  models: ProviderModel[],
): ProviderDefinition {
  return {
    id,
    name: id,
    api: 'https://example.test/v1',
    env: [],
    npm: protocol === 'anthropic' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible',
    protocol,
    models,
  }
}

function optionKeys(profile: ReturnType<typeof resolveAgentReasoningProfile>): string[] {
  return profile.selections.map(reasoningSelectionKey)
}

assert.deepEqual(normalizeAgentReasoningSelection(undefined), { kind: 'auto' })
assert.deepEqual(normalizeAgentReasoningSelection('high'), { kind: 'effort', value: 'high' })
assert.deepEqual(normalizeAgentReasoningSelection({ kind: 'budget', tokens: 4095.6 }), {
  kind: 'budget',
  tokens: 4_096,
})

const openCodeGo = provider('opencode-go', 'openai-compatible', [
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
])
const gpt56 = resolveAgentReasoningProfile(openCodeGo, 'gpt-5.6-luna')
assert.equal(gpt56.mode, 'effort')
assert.deepEqual(optionKeys(gpt56), [
  'auto',
  'effort:none',
  'effort:low',
  'effort:medium',
  'effort:high',
  'effort:xhigh',
  'effort:max',
])

const deepSeek = provider('deepseek', 'openai-compatible', [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
])
const deepSeekFlash = resolveAgentReasoningProfile(deepSeek, 'deepseek-v4-flash')
assert.deepEqual(optionKeys(deepSeekFlash), [
  'auto', 'disabled', 'effort:low', 'effort:high', 'effort:max',
])
const deepSeekPro = resolveAgentReasoningProfile(deepSeek, 'deepseek-v4-pro')
assert.deepEqual(optionKeys(deepSeekPro), [
  'auto', 'disabled', 'effort:low', 'effort:high', 'effort:max',
])
assert.deepEqual(getAgentReasoningRequestOptions(deepSeekFlash, { kind: 'disabled' }), {
  modelKwargs: { thinking: { type: 'disabled' } },
})
assert.deepEqual(getAgentReasoningRequestOptions(deepSeekFlash, { kind: 'effort', value: 'max' }), {
  openAIReasoningEffort: 'max',
  modelKwargs: { thinking: { type: 'enabled' } },
})

const hy3Provider = provider('opencode-go', 'openai-compatible', [
  { id: 'hy3', name: 'Hy3', reasoning: true },
  { id: 'tencent/hy3-preview', name: 'Hy3 preview', reasoning: true },
])
for (const modelId of ['hy3', 'tencent/hy3-preview']) {
  const hy3 = resolveAgentReasoningProfile(hy3Provider, modelId)
  assert.equal(hy3.mode, 'effort')
  assert.deepEqual(optionKeys(hy3), [
    'auto', 'effort:none', 'effort:low', 'effort:high',
  ])
  assert.deepEqual(getAgentReasoningRequestOptions(hy3, { kind: 'effort', value: 'high' }), {
    openAIReasoningEffort: 'high',
  })
}

const opencodeGoMatrix = provider('opencode-go', 'openai-compatible', [
  { id: 'mimo-v2-pro', name: 'MiMo V2 Pro', reasoning: true },
  { id: 'mimo-v2-omni', name: 'MiMo V2 Omni', reasoning: true },
  { id: 'mimo-v2.5', name: 'MiMo V2.5', reasoning: true },
  { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', reasoning: true },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: true },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', reasoning: true },
  { id: 'glm-5', name: 'GLM-5', reasoning: true },
  { id: 'glm-5.1', name: 'GLM-5.1', reasoning: true },
  { id: 'glm-5.2', name: 'GLM-5.2', reasoning: true },
  { id: 'qwen3.8-max', name: 'Qwen3.8 Max', reasoning: true },
  { id: 'qwen3.7-max', name: 'Qwen3.7 Max', reasoning: true },
  { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', reasoning: true },
  { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus', reasoning: true },
  { id: 'qwen3.5-plus', name: 'Qwen3.5 Plus', reasoning: true },
  { id: 'minimax-m3', name: 'MiniMax-M3', reasoning: true },
  { id: 'minimax-m2.7', name: 'MiniMax-M2.7', reasoning: true },
  { id: 'minimax-m2.5', name: 'MiniMax-M2.5', reasoning: true },
  { id: 'kimi-k3', name: 'Kimi K3', reasoning: true },
])

for (const modelId of ['mimo-v2-pro', 'mimo-v2-omni', 'mimo-v2.5', 'mimo-v2.5-pro']) {
  const profile = resolveAgentReasoningProfile(opencodeGoMatrix, modelId)
  assert.deepEqual(optionKeys(profile), ['auto', 'enabled', 'disabled'])
  assert.deepEqual(getAgentReasoningRequestOptions(profile, { kind: 'disabled' }), {
    modelKwargs: { thinking: { type: 'disabled' } },
  })
}

for (const modelId of ['glm-5', 'glm-5.1']) {
  const profile = resolveAgentReasoningProfile(opencodeGoMatrix, modelId)
  assert.deepEqual(optionKeys(profile), ['auto', 'enabled', 'disabled'])
  assert.deepEqual(getAgentReasoningRequestOptions(profile, { kind: 'disabled' }), {
    modelKwargs: { thinking: { type: 'disabled' } },
  })
}
const openCodeGlm52 = resolveAgentReasoningProfile(opencodeGoMatrix, 'glm-5.2')
assert.deepEqual(optionKeys(openCodeGlm52), [
  'auto', 'effort:high', 'effort:max',
])
assert.deepEqual(getAgentReasoningRequestOptions(openCodeGlm52, { kind: 'effort', value: 'max' }), {
  openAIReasoningEffort: 'max',
})

const qwen38 = resolveAgentReasoningProfile(opencodeGoMatrix, 'qwen3.8-max')
assert.deepEqual(optionKeys(qwen38), [
  'auto', 'disabled', 'effort:low', 'effort:medium', 'effort:xhigh',
])
assert.deepEqual(getAgentReasoningRequestOptions(qwen38, { kind: 'effort', value: 'xhigh' }), {
  openAIReasoningEffort: 'xhigh',
  modelKwargs: { enable_thinking: true },
})
for (const modelId of ['qwen3.7-max', 'qwen3.7-plus']) {
  const profile = resolveAgentReasoningProfile(opencodeGoMatrix, modelId)
  assert.equal(profile.mode, 'budget')
  assert.equal(profile.budget?.max, 262_144)
  assert.equal(optionKeys(profile).includes('disabled'), true)
  assert.deepEqual(getAgentReasoningRequestOptions(profile, { kind: 'budget', tokens: 16_384 }), {
    modelKwargs: { enable_thinking: true, thinking_budget: 16_384 },
  })
}
for (const modelId of ['qwen3.6-plus', 'qwen3.5-plus']) {
  const profile = resolveAgentReasoningProfile(opencodeGoMatrix, modelId)
  assert.equal(profile.mode, 'budget')
  assert.equal(profile.budget?.max, 81_920)
}

for (const modelId of ['minimax-m3', 'minimax-m2.7', 'minimax-m2.5']) {
  const profile = resolveAgentReasoningProfile(opencodeGoMatrix, modelId)
  if (modelId === 'minimax-m3') {
    assert.deepEqual(optionKeys(profile), ['auto', 'enabled', 'disabled'])
    assert.deepEqual(getAgentReasoningRequestOptions(profile, { kind: 'enabled' }), {
      modelKwargs: { thinking: { type: 'adaptive' } },
    })
    assert.deepEqual(getAgentReasoningRequestOptions(profile, { kind: 'disabled' }), {
      modelKwargs: { thinking: { type: 'disabled' } },
    })
  } else {
    assert.equal(profile.mode, 'fixed')
    assert.deepEqual(profile.selections, [])
  }
}

assert.deepEqual(optionKeys(resolveAgentReasoningProfile(opencodeGoMatrix, 'deepseek-v4-flash')), [
  'auto', 'disabled', 'effort:low', 'effort:high', 'effort:max',
])
assert.deepEqual(optionKeys(resolveAgentReasoningProfile(opencodeGoMatrix, 'deepseek-v4-pro')), [
  'auto', 'disabled', 'effort:high', 'effort:max',
])
assert.equal(resolveAgentReasoningProfile(opencodeGoMatrix, 'kimi-k3').mode, 'fixed')

const anthropic = provider('anthropic', 'anthropic', [
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
])
const sonnet = resolveAgentReasoningProfile(anthropic, 'claude-sonnet-4-6')
assert.deepEqual(optionKeys(sonnet), [
  'auto', 'effort:low', 'effort:medium', 'effort:high', 'effort:max',
])
assert.deepEqual(getAgentReasoningRequestOptions(sonnet, { kind: 'effort', value: 'high' }), {
  anthropic: { thinking: { type: 'adaptive' }, effort: 'high' },
})
const haiku = resolveAgentReasoningProfile(anthropic, 'claude-haiku-4-5')
assert.equal(haiku.mode, 'budget')
assert.deepEqual(getAgentReasoningRequestOptions(haiku, { kind: 'budget', tokens: 8_192 }), {
  anthropic: {
    thinking: { type: 'enabled', budget_tokens: 8_192 },
    maxTokens: 9_216,
  },
})

const google = provider('google', 'google', [
  { id: 'gemini-3-flash', name: 'Gemini 3 Flash' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
])
assert.deepEqual(optionKeys(resolveAgentReasoningProfile(google, 'gemini-3-flash')), [
  'auto', 'effort:minimal', 'effort:low', 'effort:medium', 'effort:high',
])
const geminiPro = resolveAgentReasoningProfile(google, 'gemini-2.5-pro')
assert.equal(geminiPro.mode, 'budget')
assert.equal(optionKeys(geminiPro).includes('disabled'), false)
const geminiFlash = resolveAgentReasoningProfile(google, 'gemini-2.5-flash')
assert.equal(optionKeys(geminiFlash).includes('disabled'), true)
assert.deepEqual(getAgentReasoningRequestOptions(geminiFlash, { kind: 'budget', tokens: 8_192 }), {
  googleThinkingConfig: { thinkingBudget: 8_192 },
})

const xai = provider('xai', 'openai-compatible', [
  { id: 'grok-4.5', name: 'Grok 4.5' },
  { id: 'grok-4.20-multi-agent', name: 'Grok 4.20 Multi-Agent' },
])
assert.deepEqual(optionKeys(resolveAgentReasoningProfile(xai, 'grok-4.5')), [
  'auto', 'effort:low', 'effort:medium', 'effort:high',
])
assert.deepEqual(optionKeys(resolveAgentReasoningProfile(xai, 'grok-4.20-multi-agent')), [
  'auto', 'effort:low', 'effort:medium', 'effort:high', 'effort:xhigh',
])

const kimi = provider('moonshotai', 'openai-compatible', [
  { id: 'kimi-k3', name: 'Kimi K3' },
  { id: 'kimi-k2.5', name: 'Kimi K2.5' },
  { id: 'kimi-k2.6', name: 'Kimi K2.6' },
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code' },
])
assert.deepEqual(optionKeys(resolveAgentReasoningProfile(kimi, 'kimi-k3')), [
  'auto', 'effort:low', 'effort:high', 'effort:max',
])
const kimiK3 = resolveAgentReasoningProfile(kimi, 'kimi-k3')
assert.deepEqual(getAgentReasoningRequestOptions(kimiK3, { kind: 'effort', value: 'high' }), {
  openAIReasoningEffort: 'high',
})
const kimiK26 = resolveAgentReasoningProfile(kimi, 'kimi-k2.6')
assert.deepEqual(optionKeys(kimiK26), [
  'auto', 'enabled', 'disabled',
])
assert.deepEqual(getAgentReasoningRequestOptions(kimiK26, { kind: 'disabled' }), {
  modelKwargs: { thinking: { type: 'disabled' } },
})
assert.deepEqual(optionKeys(resolveAgentReasoningProfile(kimi, 'kimi-k2.5')), [
  'auto', 'enabled', 'disabled',
])
assert.equal(resolveAgentReasoningProfile(kimi, 'kimi-k2.7-code').mode, 'fixed')

const alibaba = provider('alibaba', 'openai-compatible', [
  { id: 'glm-5.1', name: 'GLM-5.1' },
  { id: 'glm-5.2', name: 'GLM-5.2' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { id: 'kimi-k2.6', name: 'Kimi K2.6' },
  { id: 'kimi-k3', name: 'Kimi K3' },
  { id: 'minimax-m3', name: 'MiniMax-M3' },
])
for (const modelId of ['glm-5.1', 'glm-5.2', 'deepseek-v4-pro']) {
  const profile = resolveAgentReasoningProfile(alibaba, modelId)
  assert.deepEqual(optionKeys(profile), ['auto', 'disabled', 'effort:high', 'effort:max'])
  assert.deepEqual(getAgentReasoningRequestOptions(profile, { kind: 'effort', value: 'high' }), {
    openAIReasoningEffort: 'high',
    modelKwargs: { enable_thinking: true },
  })
}
const alibabaKimi = resolveAgentReasoningProfile(alibaba, 'kimi-k2.6')
assert.deepEqual(getAgentReasoningRequestOptions(alibabaKimi, { kind: 'disabled' }), {
  modelKwargs: { enable_thinking: false },
})
assert.equal(resolveAgentReasoningProfile(alibaba, 'kimi-k3').mode, 'fixed')
const alibabaMiniMax = resolveAgentReasoningProfile(alibaba, 'minimax-m3')
assert.deepEqual(getAgentReasoningRequestOptions(alibabaMiniMax, { kind: 'enabled' }), {
  modelKwargs: { thinking: { type: 'adaptive' } },
})

const metadataModel = provider('future-provider', 'openai-compatible', [{
  id: 'future-model',
  name: 'Future Model',
  reasoning: true,
  reasoningOptions: [{ type: 'effort', values: ['minimal', 'max'] }],
}])
assert.deepEqual(optionKeys(resolveAgentReasoningProfile(metadataModel, 'future-model')), [
  'auto', 'effort:minimal', 'effort:max',
])

const openAIRequest = getAgentReasoningRequestOptions(gpt56, { kind: 'effort', value: 'max' })
assert.deepEqual(openAIRequest, { openAIReasoningEffort: 'max' })

console.log('Agent reasoning capability tests passed.')
