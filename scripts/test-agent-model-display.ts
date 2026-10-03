import assert from 'node:assert/strict'
import { humanizeModelId, modelDisplayName, stripCustomPrefix } from '../src/lib/agent-model'

type P = { id: string; models: Array<{ id: string; name: string }> }
const providers = [
  { id: 'deepseek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] },
  { id: 'openai', models: [{ id: 'gpt-4o', name: 'gpt-4o' }] },
  { id: 'a', models: [{ id: 'shared', name: 'Name A' }] },
  { id: 'b', models: [{ id: 'shared', name: 'Name B' }] },
  { id: 'c', models: [{ id: 'unique-x', name: 'Unique X' }] },
] as P[] as never

const uuid = 'custom-01234567-89ab-cdef-0123-456789abcdef'
const cases: Array<[string | undefined, string | undefined, string]> = [
  ['deepseek', 'deepseek-chat', 'DeepSeek Chat'],
  [uuid, `${uuid}/doubao-pro`, 'Doubao Pro'],
  ['qwen', 'qwen-max', 'Qwen Max'],
  ['openai', 'gpt-4o', 'GPT 4o'],
  ['missing', 'foo/bar_model_2', 'Bar Model 2'],
  ['a', 'shared', 'Name A'],
  ['b', 'shared', 'Name B'],
  ['unknown', 'shared', 'Shared'],
  ['unknown', 'unique-x', 'Unique X'],
  ['x', 'claude-3.5-sonnet', 'Claude 3.5 Sonnet'],
  ['x', 'glm-4', 'GLM 4'],
  ['x', '', ''],
  ['x', undefined, ''],
]
for (const [providerId, model, expected] of cases) {
  assert.equal(modelDisplayName(providerId, model, providers), expected, `${providerId}/${model}`)
  assert.equal(modelDisplayName(providerId, model, []), model ? humanizeModelId(stripCustomPrefix(model)) : '')
}
assert.equal(stripCustomPrefix('custom-example/foo'), 'custom-example/foo')
console.log(`PASS agent model display (${cases.length} cases)`)
