import assert from 'node:assert/strict'
import {
  fromCustomProviderWire,
  fromProviderDefinitionWire,
  toCustomProviderSaveArgs,
  type CustomProviderWire,
  type ProviderDefinitionWire,
} from '../src/platform/provider-contract'
import type { CustomProviderConfig } from '../src/types/provider'

const uiProvider: CustomProviderConfig = {
  id: '',
  name: 'Example',
  baseURL: 'https://api.example.com/v1',
  defaultModel: 'example-chat',
  protocol: 'openai-compatible',
  createdAt: 1_788_000_000_000,
}

const saveArgs = toCustomProviderSaveArgs(uiProvider)
assert.equal(saveArgs.provider.baseUrl, uiProvider.baseURL)
assert.equal('baseURL' in saveArgs.provider, false)
assert.equal(typeof saveArgs.provider.createdAt, 'number')
assert.doesNotThrow(() => JSON.stringify(saveArgs))

const response: CustomProviderWire = {
  ...saveArgs.provider,
  id: 'custom-example',
}
const mappedResponse = fromCustomProviderWire(response)
assert.equal(mappedResponse.baseURL, uiProvider.baseURL)
assert.equal('baseUrl' in mappedResponse, false)
assert.equal(mappedResponse.createdAt, uiProvider.createdAt)

const definitionResponse = {
  id: 'openai',
  name: 'OpenAI',
  api: 'https://gateway.example.com/v1',
  npm: '@ai-sdk/openai',
  env: ['OPENAI_API_KEY'],
  protocol: 'openai',
  models: [],
  defaultApi: 'https://api.openai.com/v1',
  isApiOverridden: true,
  isCustom: false,
  isLocal: false,
} satisfies ProviderDefinitionWire
const mappedDefinition = fromProviderDefinitionWire(definitionResponse)
assert.equal(mappedDefinition.defaultApi, 'https://api.openai.com/v1')
assert.equal(mappedDefinition.isApiOverridden, true)

console.log('Provider desktop contract checks passed')
