import assert from 'node:assert/strict'
import { isTextChatModel, type ModelsDevModel } from '../electron/services/provider-registry.service'

const textOutput = { input: ['text'], output: ['text'] }
const rejected: ModelsDevModel[] = [
  { id: 'bge-multilingual-gemma2', modalities: textOutput },
  { id: 'melotts', modalities: textOutput },
  { id: 'studiovoice', modalities: textOutput },
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
