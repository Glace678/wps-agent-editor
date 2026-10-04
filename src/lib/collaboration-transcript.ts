import type {
  AgentCacheUsage,
  AgentCollaborationEvent,
  AgentConfig,
  CollaborationMode,
} from '@/types/agent'
import { resolveAgentIdentity, type AgentIdentity } from './agent-model'

/** A right-aligned bubble: the user task that started the collaboration. */
export interface TaskTranscriptItem {
  kind: 'task'
  key: string
  text: string
}

/** A model speech bubble (WeChat group-chat style, left aligned with logo). */
export interface SpeechTranscriptItem {
  kind: 'speech'
  key: string
  agent: AgentIdentity
  text: string
  streaming: boolean
  /** False when the previous visible row is another bubble from the same agent. */
  clusterHead: boolean
}

/** Transient "agent is thinking" row with animated dots. */
export interface TypingTranscriptItem {
  kind: 'typing'
  key: string
  agent: AgentIdentity
  clusterHead: boolean
}

/** Rich card describing a delegation: from which model to which model. */
export interface DelegationTranscriptItem {
  kind: 'delegation'
  key: string
  from: AgentIdentity
  to: AgentIdentity
  text: string
}

export type SystemLineKey =
  | 'directorReady'
  | 'synthesizerReady'
  | 'taskAssigned'
  | 'handoff'
  | 'toolInvoked'
  | 'documentApplied'
  | 'documentRejected'
  | 'runComplete'
  | 'runCancelled'
  | 'conflict'
  | 'error'

export interface SystemTranscriptItem {
  kind: 'system'
  key: string
  tone: 'info' | 'success' | 'warning' | 'error'
  messageKey: SystemLineKey
  params: Record<string, string>
}

const SYSTEM_LINE_KEYS: readonly SystemLineKey[] = [
  'directorReady',
  'synthesizerReady',
  'taskAssigned',
  'handoff',
  'toolInvoked',
  'documentApplied',
  'documentRejected',
  'runComplete',
  'runCancelled',
  'conflict',
  'error',
]

/** Narrows an unknown value to SystemLineKey without an unchecked cast. */
export function isSystemLineKey(value: unknown): value is SystemLineKey {
  return typeof value === 'string'
    && (SYSTEM_LINE_KEYS as readonly string[]).includes(value)
}

export type TranscriptItem =
  | TaskTranscriptItem
  | SpeechTranscriptItem
  | TypingTranscriptItem
  | DelegationTranscriptItem
  | SystemTranscriptItem

type InternalItem =
  | (TaskTranscriptItem & { hidden?: boolean })
  | (SpeechTranscriptItem & { hidden?: boolean })
  | (TypingTranscriptItem & { hidden?: boolean })
  | (DelegationTranscriptItem & { hidden?: boolean })
  | (SystemTranscriptItem & { hidden?: boolean })

const TOOL_BLOCK = /```tool[\s\S]*?```/gi

/**
 * Model outputs contain raw ```tool fences (delegation/document calls). Strip
 * them from bubble text: the delegation card and system lines already show the
 * action. Returns '' when the message was only a tool call.
 */
export function stripToolFences(text: string): string {
  return text
    .replace(TOOL_BLOCK, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * True when a fence info string identifies a (possibly half-emitted) tool
 * fence: "tool", or a partial prefix typed mid-stream such as "t"/"to"/"too".
 */
function isToolLikeFenceTag(tag: string): boolean {
  return tag.length > 0 && ('tool'.startsWith(tag) || tag.startsWith('tool'))
}

/**
 * After complete ```tool blocks are removed, drop only an *unclosed* tool fence
 * that is still streaming. A normal, still-open Markdown code fence (e.g. an
 * unclosed ```python) must stay visible — it is not a tool call.
 */
function stripUnclosedToolFenceLive(text: string): string {
  const lines = text.split('\n')
  let openTag: string | null = null
  let openIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*```/.test(lines[i])) continue
    if (openTag === null) {
      openTag = lines[i].replace(/^\s*```/, '').trim()
      openIndex = i
    } else {
      // A closing fence balances the currently open one.
      openTag = null
      openIndex = -1
    }
  }
  if (openTag === null) return text
  // Unterminated fence at EOF: hide only when it is a (partial) tool fence.
  return isToolLikeFenceTag(openTag) ? lines.slice(0, openIndex).join('\n') : text
}

/**
 * Streaming variant: frames are accumulated and a ```tool block may be only
 * half-emitted (open fence, partial "tool" prefix). Hides the unfinished tool
 * tail so raw fence syntax never flashes in the live bubble, while leaving
 * ordinary Markdown code fences visible.
 */
export function stripToolFencesLive(text: string): string {
  const closed = stripToolFences(text)
  return stripUnclosedToolFenceLive(closed).trim()
}

/**
 * Aggregates provider-reported prompt-cache usage across a collaboration run.
 *
 * Only frames whose provider actually measured caching contribute, so a run
 * against a provider that never reports cache numbers stays `measured: false`
 * instead of showing a fabricated 0% hit rate.
 */
export function summarizeCollaborationCacheUsage(
  events: AgentCollaborationEvent[],
): AgentCacheUsage {
  const summary: AgentCacheUsage = {
    measured: false,
    requests: 0,
    promptTokens: 0,
    cacheReadTokens: 0,
    cacheMissTokens: 0,
    cacheWriteTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    hitRate: 0,
  }
  for (const event of events) {
    const usage = event.cacheUsage
    if (!usage?.measured) continue
    summary.measured = true
    summary.requests += usage.requests
    summary.promptTokens += usage.promptTokens
    summary.cacheReadTokens += usage.cacheReadTokens
    summary.cacheMissTokens += usage.cacheMissTokens
    summary.cacheWriteTokens += usage.cacheWriteTokens
    summary.completionTokens += usage.completionTokens
    summary.totalTokens += usage.totalTokens
  }
  const denominator = summary.cacheReadTokens + summary.cacheMissTokens
  summary.hitRate = denominator > 0 ? summary.cacheReadTokens / denominator : 0
  return summary
}

/**
 * Converts the raw collaboration event stream into a WeChat-style transcript.
 * Pure and synchronous: the store already dedupes/merges `agent-stream` frames
 * by operationId, this function only orders and groups them per speaker.
 */
export function buildCollaborationTranscript(
  events: AgentCollaborationEvent[],
  agents: AgentConfig[],
  mode: CollaborationMode,
): TranscriptItem[] {
  const items: InternalItem[] = []
  let uid = 0
  const nextKey = () => `item-${uid++}`

  const speechByOperation = new Map<string, string>()
  const lastSpeechByAgent = new Map<string, string>()
  // Item keys whose text was finalized by an agent-message. A second
  // agent-message without intervening stream frames starts a new bubble
  // instead of overwriting the previous turn (e.g. director turns around
  // delegation rounds).
  const settledSpeech = new Set<string>()
  const typingByAgent = new Map<string, string>()

  const identityOf = (event: AgentCollaborationEvent): AgentIdentity =>
    resolveAgentIdentity({
      agentId: event.agentId,
      agentName: event.agentName,
      providerId: event.providerId,
      model: event.model,
    }, agents)

  const settleTyping = (agentId?: string) => {
    if (!agentId) return
    const key = typingByAgent.get(agentId)
    if (!key) return
    const item = items.find((entry) => entry.key === key)
    if (item) item.hidden = true
    typingByAgent.delete(agentId)
  }

  const settleAllTyping = () => {
    for (const item of items) {
      if (item.kind === 'typing') item.hidden = true
    }
    typingByAgent.clear()
  }

  const pushSystem = (
    messageKey: SystemLineKey,
    tone: SystemTranscriptItem['tone'],
    params: Record<string, string> = {},
  ) => {
    items.push({ kind: 'system', key: nextKey(), tone, messageKey, params })
  }

  const upsertSpeech = (
    event: AgentCollaborationEvent,
    text: string,
    streaming: boolean,
  ): void => {
    const agent = identityOf(event)
    if (!agent.agentId) return
    settleTyping(agent.agentId)
    const operationKey = event.operationId ? speechByOperation.get(event.operationId) : undefined
    if (operationKey) {
      const item = items.find((entry) => entry.key === operationKey)
      if (item && item.kind === 'speech') {
        item.text = text
        item.streaming = streaming
        return
      }
    }
    const key = nextKey()
    items.push({
      kind: 'speech',
      key,
      agent,
      text,
      streaming,
      clusterHead: true,
    })
    if (event.operationId) speechByOperation.set(event.operationId, key)
    lastSpeechByAgent.set(agent.agentId, key)
  }

  for (const event of events) {
    switch (event.type) {
      case 'run-start':
        if (event.content?.trim()) {
          items.push({ kind: 'task', key: nextKey(), text: event.content })
        }
        break

      case 'task-created': {
        const name = event.agentName || ''
        pushSystem(
          mode === 'directed' ? 'directorReady' : 'synthesizerReady',
          'info',
          { agent: name },
        )
        break
      }

      case 'task-assigned':
        settleTyping(event.agentId)
        pushSystem('taskAssigned', 'info', { agent: event.agentName || '' })
        break

      case 'agent-start':
        if (event.agentId) {
          settleTyping(event.agentId)
          const key = nextKey()
          items.push({
            kind: 'typing',
            key,
            agent: identityOf(event),
            clusterHead: true,
          })
          typingByAgent.set(event.agentId, key)
        }
        break

      case 'agent-stream': {
        // Store frames are accumulated per operationId; hide half-emitted
        // tool fences and keep the typing row until real prose arrives.
        const visible = event.content ? stripToolFencesLive(event.content) : ''
        if (visible) upsertSpeech(event, visible, true)
        break
      }

      case 'agent-message':
      case 'agent-question':
      case 'agent-answer': {
        if (!event.content) break
        const visible = stripToolFences(event.content)
        const agentId = event.agentId
        const lastKey = agentId ? lastSpeechByAgent.get(agentId) : undefined
        const lastEntry = lastKey === undefined
          ? undefined
          : items.find((entry) => entry.key === lastKey)
        // lastSpeechByAgent only ever stores speech-item keys; narrow once so
        // the mutation below needs no non-null assertion.
        const activeSpeech = lastEntry?.kind === 'speech' ? lastEntry : undefined
        // Finalize the still-streaming bubble of the current turn only. When
        // no previous speech item exists (e.g. a tool-only message arriving
        // before any prose) lastKey/activeSpeech are undefined and this branch
        // only settles the typing row.
        if (lastKey !== undefined && activeSpeech !== undefined && (!visible || !settledSpeech.has(lastKey))) {
          if (visible) {
            activeSpeech.text = visible
            activeSpeech.streaming = false
            settledSpeech.add(lastKey)
          } else {
            // Tool-only turn: the delegation card / system line replaces it.
            // Only hide the prior bubble when we can tie it to THIS turn — via
            // a shared operation id or a still-streaming bubble. If the last
            // bubble belongs to an earlier, already-answered turn, leave it
            // visible and just clear the typing row instead.
            const belongsToCurrentTurn =
              (event.operationId !== undefined && speechByOperation.get(event.operationId) === lastKey)
              || activeSpeech.streaming === true
            if (belongsToCurrentTurn) {
              activeSpeech.hidden = true
              settledSpeech.add(lastKey)
            }
          }
          settleTyping(agentId)
          break
        }
        // A later finalized turn (or a message without preceding stream
        // frames) becomes its own bubble.
        if (visible && agentId) {
          upsertSpeech(event, visible, false)
          const freshKey = lastSpeechByAgent.get(agentId)
          if (freshKey !== undefined) settledSpeech.add(freshKey)
        }
        settleTyping(agentId)
        break
      }

      case 'agent-delegated': {
        settleTyping(event.fromAgentId)
        items.push({
          kind: 'delegation',
          key: nextKey(),
          from: resolveAgentIdentity(
            { agentId: event.fromAgentId, agentName: event.fromAgentName },
            agents,
          ),
          to: resolveAgentIdentity(
            { agentId: event.toAgentId, agentName: event.toAgentName },
            agents,
          ),
          text: event.content || '',
        })
        break
      }

      case 'agent-tool':
        settleTyping(event.agentId)
        if (event.tool === 'delegate_task') break
        pushSystem('toolInvoked', 'info', {
          agent: event.agentName || '',
          tool: event.tool || 'tool',
        })
        break

      case 'document-operation-applied':
        settleTyping(event.agentId)
        pushSystem('documentApplied', 'info', {
          agent: event.agentName || '',
          action: event.action || '',
        })
        break

      case 'document-operation-rejected':
        settleTyping(event.agentId)
        pushSystem('documentRejected', 'warning', {
          agent: event.agentName || '',
          action: event.action || '',
        })
        break

      case 'handoff':
        pushSystem('handoff', 'info', {
          from: event.fromAgentName || '',
          to: event.toAgentName || '',
        })
        break

      case 'conflict':
        pushSystem('conflict', 'warning', { detail: event.content || event.message || '' })
        break

      case 'run-complete':
        settleAllTyping()
        pushSystem('runComplete', 'success')
        break

      case 'run-cancelled':
        settleAllTyping()
        pushSystem('runCancelled', 'warning')
        break

      case 'error':
        settleAllTyping()
        pushSystem('error', 'error', { error: event.error || '' })
        break

      default:
        // document-operation-prepared / cursor / selection / revision and
        // other lifecycle noise are intentionally not rendered in the chat.
        break
    }
  }

  const visible = items.filter((item) => !item.hidden)

  // Cluster consecutive bubbles/typing rows of the same agent (WeChat style).
  let previousSpeaker: string | undefined
  for (const item of visible) {
    if (item.kind === 'speech' || item.kind === 'typing') {
      const speaker = item.agent.agentId
      item.clusterHead = speaker !== previousSpeaker
      previousSpeaker = speaker
    } else {
      previousSpeaker = undefined
    }
  }
  return visible as TranscriptItem[]
}
