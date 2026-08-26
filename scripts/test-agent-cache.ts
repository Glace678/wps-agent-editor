import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AIMessage } from '@langchain/core/messages'
import { getEncoding } from '@langchain/core/utils/tiktoken'
import { addStableAttachmentContextToMessages } from '../electron/services/agent-attachment.service'
import {
  AGENT_CACHE_PROTOCOL,
  aggregateAgentCacheUsage,
  createPromptCacheKey,
  extractAgentCacheUsage,
  normalizeOpenAICompatibleUsage,
} from '../electron/services/agent-cache.service'
import type { AgentAttachment } from '../src/types/agent'

function responseWithUsage(usage: Record<string, unknown>): AIMessage {
  return new AIMessage({
    content: 'ok',
    additional_kwargs: { __raw_response: { usage } },
  })
}

async function main(): Promise<void> {
  const nativeUsage = extractAgentCacheUsage(responseWithUsage({
    prompt_tokens: 10_000,
    completion_tokens: 20,
    total_tokens: 10_020,
    prompt_cache_hit_tokens: 9_600,
    prompt_cache_miss_tokens: 400,
  }))
  assert.equal(nativeUsage.measured, true)
  assert.equal(nativeUsage.cacheReadTokens, 9_600)
  assert.equal(nativeUsage.cacheMissTokens, 400)
  assert.equal(nativeUsage.hitRate, 0.96)

  const standardUsage = extractAgentCacheUsage(responseWithUsage({
    prompt_tokens: 8_000,
    completion_tokens: 10,
    prompt_tokens_details: { cached_tokens: 7_680 },
  }))
  assert.equal(standardUsage.measured, true)
  assert.equal(standardUsage.cacheMissTokens, 320)
  assert.equal(standardUsage.hitRate, 0.96)

  const unmeasuredUsage = extractAgentCacheUsage(responseWithUsage({
    prompt_tokens: 500,
    completion_tokens: 10,
  }))
  assert.equal(unmeasuredUsage.measured, false)
  assert.equal(unmeasuredUsage.cacheReadTokens, 0)
  assert.equal(unmeasuredUsage.cacheMissTokens, 0)

  const bridged = normalizeOpenAICompatibleUsage({
    prompt_tokens: 4_096,
    prompt_cache_hit_tokens: 3_840,
    prompt_cache_miss_tokens: 256,
  })
  assert.equal(bridged.prompt_tokens_details.cached_tokens, 3_840)

  const aggregate = aggregateAgentCacheUsage([nativeUsage, standardUsage])
  assert.equal(aggregate.requests, 2)
  assert.equal(aggregate.cacheReadTokens, 17_280)
  assert.equal(aggregate.cacheMissTokens, 720)
  assert.equal(aggregate.hitRate, 0.96)

  const firstKey = createPromptCacheKey('conversation-a')
  assert.equal(firstKey, createPromptCacheKey('conversation-a'))
  assert.notEqual(firstKey, createPromptCacheKey('conversation-b'))
  assert.match(firstKey, /^[a-f0-9]{64}$/)

  const tokenizer = await getEncoding('cl100k_base')
  assert.ok(
    tokenizer.encode(AGENT_CACHE_PROTOCOL).length >= 6_000,
    'The reusable prefix must preserve the 95% short-turn cache floor',
  )
  assert.doesNotMatch(AGENT_CACHE_PROTOCOL, /\b20\d{2}-\d{2}-\d{2}\b/)

  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'wps-agent-cache-'))
  try {
    const attachmentPath = path.join(fixtureDirectory, 'reference.txt')
    const attachment: AgentAttachment = {
      path: attachmentPath,
      name: 'reference.txt',
      source: 'picker',
    }
    const firstRawMessage = {
      role: 'user' as const,
      content: 'Use the attached reference.',
      attachments: [attachment],
    }

    await fs.writeFile(attachmentPath, 'original attachment text', 'utf8')
    const firstTurn = await addStableAttachmentContextToMessages(
      'cache-test-conversation',
      [firstRawMessage],
    )
    assert.match(firstTurn[0].content, /original attachment text/)

    await fs.writeFile(attachmentPath, 'changed attachment text', 'utf8')
    const secondTurn = await addStableAttachmentContextToMessages(
      'cache-test-conversation',
      [
        firstRawMessage,
        { role: 'assistant' as const, content: 'I read it.' },
        { role: 'user' as const, content: 'Continue.' },
      ],
    )
    assert.equal(secondTurn[0].content, firstTurn[0].content)
    assert.doesNotMatch(secondTurn[0].content, /changed attachment text/)

    const newConversation = await addStableAttachmentContextToMessages(
      'cache-test-new-conversation',
      [firstRawMessage],
    )
    assert.match(newConversation[0].content, /changed attachment text/)
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true })
  }

  console.log('PASS DeepSeek-native, OpenAI-compatible, and absent cache usage parsing')
  console.log('PASS stable prompt cache keys and reusable protocol prefix')
  console.log('PASS attachment snapshots preserve an exact multi-turn prefix')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
