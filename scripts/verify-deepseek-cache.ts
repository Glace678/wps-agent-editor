import assert from 'node:assert/strict'
import { stdin } from 'node:process'
import { AGENT_CACHE_PROTOCOL } from '../electron/services/agent-cache.service'

interface DeepSeekUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
}

interface DeepSeekCompletion {
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: DeepSeekUsage
}

interface CacheSample {
  round: number
  hit: number
  miss: number
  hitRate: number
}

const endpoint = 'https://api.deepseek.com'
const rounds = Number(process.env.DEEPSEEK_CACHE_ROUNDS ?? 12)
const threshold = 0.95

assert.ok(Number.isInteger(rounds) && rounds >= 4 && rounds <= 50, 'DEEPSEEK_CACHE_ROUNDS must be 4-50')

async function readApiKey(): Promise<string> {
  const fromEnvironment = process.env.DEEPSEEK_API_KEY?.trim()
  if (fromEnvironment) return fromEnvironment
  if (stdin.isTTY) {
    throw new Error('Provide DEEPSEEK_API_KEY or pipe the key through standard input')
  }
  const chunks: Buffer[] = []
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function requestJson<T>(apiKey: string, pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${endpoint}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 2_000)
    throw new Error(`DeepSeek ${pathname} returned HTTP ${response.status}: ${detail}`)
  }
  return response.json() as Promise<T>
}

function summarize(samples: CacheSample[]) {
  const hit = samples.reduce((sum, sample) => sum + sample.hit, 0)
  const miss = samples.reduce((sum, sample) => sum + sample.miss, 0)
  return {
    requests: samples.length,
    cacheReadTokens: hit,
    cacheMissTokens: miss,
    hitRate: hit / (hit + miss),
    minRequestHitRate: Math.min(...samples.map((sample) => sample.hitRate)),
    maxRequestHitRate: Math.max(...samples.map((sample) => sample.hitRate)),
  }
}

async function main(): Promise<void> {
  const apiKey = await readApiKey()
  assert.ok(apiKey, 'A DeepSeek API key is required')

  const models = await requestJson<{ data?: Array<{ id?: string }> }>(apiKey, '/models')
  const availableModels = (models.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => Boolean(id))
  const requestedModel = process.env.DEEPSEEK_MODEL?.trim()
  const model = requestedModel
    || availableModels.find((id) => id === 'deepseek-v4-flash')
    || availableModels.find((id) => id === 'deepseek-v4-pro')
    || availableModels.find((id) => id === 'deepseek-chat')
    || availableModels.find((id) => id === 'deepseek-reasoner')
    || availableModels[0]
  assert.ok(model, 'The DeepSeek account returned no available chat model')
  if (requestedModel) {
    assert.ok(availableModels.includes(requestedModel), `Requested model ${requestedModel} is unavailable`)
  }

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: AGENT_CACHE_PROTOCOL },
    {
      role: 'system',
      content: 'Reply with exactly the marker requested by the user. Do not call document tools.',
    },
  ]
  const samples: CacheSample[] = []
  for (let round = 1; round <= rounds; round += 1) {
    const marker = `OFFICIAL_DEEPSEEK_ACK_${round}`
    messages.push({
      role: 'user',
      content: `Official cache verification turn ${round}. Reply exactly ${marker}.`,
    })
    const completion = await requestJson<DeepSeekCompletion>(apiKey, '/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages,
        thinking: { type: 'disabled' },
        max_tokens: 64,
        temperature: 0,
        stream: false,
      }),
    })
    const content = completion.choices?.[0]?.message?.content ?? ''
    assert.ok(content.includes(marker), `Round ${round} returned the wrong marker`)
    const usage = completion.usage ?? {}
    const hit = usage.prompt_cache_hit_tokens
    const miss = usage.prompt_cache_miss_tokens
    assert.ok(Number.isFinite(hit) && Number.isFinite(miss), `Round ${round} omitted cache hit/miss usage`)
    const hitRate = hit! / (hit! + miss!)
    samples.push({ round, hit: hit!, miss: miss!, hitRate })
    messages.push({ role: 'assistant', content })
    console.log([
      `${String(round).padStart(2)}/${rounds}`,
      `hit=${(hitRate * 100).toFixed(2)}%`,
      `read=${hit}`,
      `miss=${miss}`,
    ].join(' '))
  }

  const steadyState = summarize(samples.slice(1))
  console.log(JSON.stringify({
    endpoint,
    model,
    rounds,
    coldStartExcluded: true,
    acceptanceThreshold: threshold,
    coldStart: samples[0],
    steadyState,
  }, null, 2))
  assert.ok(steadyState.hitRate >= threshold, 'Official DeepSeek aggregate warm cache rate fell below 95%')
  assert.ok(steadyState.minRequestHitRate >= threshold, 'An official DeepSeek warm request fell below 95%')
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
