import type {
  AgentCacheUsage,
  AgentCollaborationEvent,
  AgentCollaborationEventType,
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
  // Renderer-only: shown when older trace events were trimmed from memory.
  | 'eventsTruncated'
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
  'eventsTruncated',
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
 * Only `agent-complete` events are counted (wps_06 F1): the backend emits the
 * same usage on the per-round `agent-message` events and again as the grand
 * total on `agent-complete`, so accumulating both doubled every number. One
 * completion event per invocation carries exactly that invocation's totals.
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
    reasoningTokens: 0,
    totalTokens: 0,
    hitRate: 0,
  }
  for (const event of events) {
    if (event.type !== 'agent-complete') continue
    const usage = event.cacheUsage
    if (!usage?.measured) continue
    summary.measured = true
    summary.requests += usage.requests
    summary.promptTokens += usage.promptTokens
    summary.cacheReadTokens += usage.cacheReadTokens
    summary.cacheMissTokens += usage.cacheMissTokens
    summary.cacheWriteTokens += usage.cacheWriteTokens
    summary.completionTokens += usage.completionTokens
    summary.reasoningTokens += usage.reasoningTokens
    summary.totalTokens += usage.totalTokens
  }
  const denominator = summary.cacheReadTokens + summary.cacheMissTokens
  summary.hitRate = denominator > 0 ? summary.cacheReadTokens / denominator : 0
  return summary
}

type HiddenSpeech = SpeechTranscriptItem & { hidden?: boolean }

/**
 * Mutable reducer state shared by the per-event handler functions. Handlers
 * interact with the in-progress transcript only through this context, never
 * with the raw maps directly.
 */
interface TranscriptContext {
  readonly mode: CollaborationMode
  readonly items: readonly InternalItem[]
  nextKey(): string
  commitItem(item: InternalItem): void
  pushSystem(
    messageKey: SystemLineKey,
    tone: SystemTranscriptItem['tone'],
    params?: Record<string, string>,
  ): void
  settleTyping(agentId?: string): void
  settleAllTyping(): void
  /**
   * Finalizes every still-streaming speech bubble. Called when the run ends
   * via cancellation or an error so partial answers do not spin forever
   * (wps_06 A4).
   */
  settleAllSpeech(): void
  pushTyping(event: AgentCollaborationEvent): void
  /** Creates a bubble or merges the text into the bubble keyed by operationId. */
  upsertSpeech(event: AgentCollaborationEvent, text: string, streaming: boolean): void
  findSpeechForAgent(agentId: string): HiddenSpeech | undefined
  speechKeyForOperation(operationId: string): string | undefined
  markSpeechSettled(key: string): void
  isSpeechSettled(key: string): boolean
  identityOfRef(ref: {
    agentId?: string
    agentName?: string
    providerId?: string
    model?: string
  }): AgentIdentity
}

function createTranscriptContext(
  agents: AgentConfig[],
  mode: CollaborationMode,
): TranscriptContext {
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

  const identityOfRef: TranscriptContext['identityOfRef'] = (ref) =>
    resolveAgentIdentity(ref, agents)

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

  // wps_06 A4: cancellation/error must end the run for speech bubbles too.
  const settleAllSpeech = () => {
    for (const item of items) {
      if (item.kind === 'speech' && item.streaming) {
        item.streaming = false
        settledSpeech.add(item.key)
      }
    }
  }

  const pushSystem: TranscriptContext['pushSystem'] = (
    messageKey,
    tone,
    params = {},
  ) => {
    items.push({ kind: 'system', key: nextKey(), tone, messageKey, params })
  }

  const pushTyping: TranscriptContext['pushTyping'] = (event) => {
    if (!event.agentId) return
    settleTyping(event.agentId)
    const key = nextKey()
    items.push({
      kind: 'typing',
      key,
      agent: identityOfRef(event),
      clusterHead: true,
    })
    typingByAgent.set(event.agentId, key)
  }

  const upsertSpeech: TranscriptContext['upsertSpeech'] = (
    event,
    text,
    streaming,
  ) => {
    const agent = identityOfRef(event)
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

  const findSpeechForAgent = (agentId: string): HiddenSpeech | undefined => {
    const key = lastSpeechByAgent.get(agentId)
    if (key === undefined) return undefined
    const item = items.find((entry) => entry.key === key)
    return item?.kind === 'speech' ? item : undefined
  }

  return {
    mode,
    items,
    nextKey,
    commitItem: (item) => {
      items.push(item)
    },
    pushSystem,
    settleTyping,
    settleAllTyping,
    settleAllSpeech,
    pushTyping,
    upsertSpeech,
    findSpeechForAgent,
    speechKeyForOperation: (operationId) => speechByOperation.get(operationId),
    markSpeechSettled: (key) => {
      settledSpeech.add(key)
    },
    isSpeechSettled: (key) => settledSpeech.has(key),
    identityOfRef,
  }
}

type TranscriptEventHandler = (
  event: AgentCollaborationEvent,
  ctx: TranscriptContext,
) => void

const onRunStart: TranscriptEventHandler = (event, ctx) => {
  if (event.content?.trim()) {
    ctx.commitItem({ kind: 'task', key: ctx.nextKey(), text: event.content })
  }
}

const onTaskCreated: TranscriptEventHandler = (event, ctx) => {
  ctx.pushSystem(
    ctx.mode === 'directed' ? 'directorReady' : 'synthesizerReady',
    'info',
    { agent: event.agentName || '' },
  )
}

const onTaskAssigned: TranscriptEventHandler = (event, ctx) => {
  ctx.settleTyping(event.agentId)
  ctx.pushSystem('taskAssigned', 'info', { agent: event.agentName || '' })
}

const onAgentStart: TranscriptEventHandler = (event, ctx) => {
  ctx.pushTyping(event)
}

const onAgentStream: TranscriptEventHandler = (event, ctx) => {
  // Store frames are accumulated per operationId; hide half-emitted
  // tool fences and keep the typing row until real prose arrives.
  const visible = event.content ? stripToolFencesLive(event.content) : ''
  if (visible) ctx.upsertSpeech(event, visible, true)
}

const onAgentMessage: TranscriptEventHandler = (event, ctx) => {
  if (!event.content) return
  const visible = stripToolFences(event.content)
  const agentId = event.agentId
  const activeSpeech = agentId ? ctx.findSpeechForAgent(agentId) : undefined
  const lastKey = activeSpeech?.key
  // Finalize the still-streaming bubble of the current turn only. When
  // no previous speech item exists (e.g. a tool-only message arriving
  // before any prose) activeSpeech is undefined and this handler only
  // settles the typing row.
  if (agentId && activeSpeech && lastKey !== undefined
      && (!visible || !ctx.isSpeechSettled(lastKey))) {
    if (visible) {
      activeSpeech.text = visible
      activeSpeech.streaming = false
      ctx.markSpeechSettled(lastKey)
    } else {
      // Tool-only turn: the delegation card / system line replaces it.
      // Only hide the prior bubble when we can tie it to THIS turn — via
      // a shared operation id or a still-streaming bubble. If the last
      // bubble belongs to an earlier, already-answered turn, leave it
      // visible and just clear the typing row instead.
      const belongsToCurrentTurn =
        (event.operationId !== undefined
          && ctx.speechKeyForOperation(event.operationId) === lastKey)
        || activeSpeech.streaming === true
      if (belongsToCurrentTurn) {
        activeSpeech.hidden = true
        ctx.markSpeechSettled(lastKey)
      }
    }
    ctx.settleTyping(agentId)
    return
  }
  // A later finalized turn (or a message without preceding stream
  // frames) becomes its own bubble.
  if (visible && agentId) {
    ctx.upsertSpeech(event, visible, false)
    const fresh = ctx.findSpeechForAgent(agentId)
    if (fresh) ctx.markSpeechSettled(fresh.key)
  }
  ctx.settleTyping(agentId)
}

const onAgentDelegated: TranscriptEventHandler = (event, ctx) => {
  ctx.settleTyping(event.fromAgentId)
  ctx.commitItem({
    kind: 'delegation',
    key: ctx.nextKey(),
    from: ctx.identityOfRef({
      agentId: event.fromAgentId,
      agentName: event.fromAgentName,
    }),
    to: ctx.identityOfRef({
      agentId: event.toAgentId,
      agentName: event.toAgentName,
    }),
    text: event.content || '',
  })
}

const onAgentTool: TranscriptEventHandler = (event, ctx) => {
  ctx.settleTyping(event.agentId)
  if (event.tool === 'delegate_task') return
  ctx.pushSystem('toolInvoked', 'info', {
    agent: event.agentName || '',
    tool: event.tool || 'tool',
  })
}

const onDocumentOperationApplied: TranscriptEventHandler = (event, ctx) => {
  ctx.settleTyping(event.agentId)
  ctx.pushSystem('documentApplied', 'info', {
    agent: event.agentName || '',
    action: event.action || '',
  })
}

const onDocumentOperationRejected: TranscriptEventHandler = (event, ctx) => {
  ctx.settleTyping(event.agentId)
  ctx.pushSystem('documentRejected', 'warning', {
    agent: event.agentName || '',
    action: event.action || '',
  })
}

const onHandoff: TranscriptEventHandler = (event, ctx) => {
  ctx.pushSystem('handoff', 'info', {
    from: event.fromAgentName || '',
    to: event.toAgentName || '',
  })
}

const onConflict: TranscriptEventHandler = (event, ctx) => {
  ctx.pushSystem('conflict', 'warning', {
    detail: event.content || event.message || '',
  })
}

const onEventsTruncated: TranscriptEventHandler = (event, ctx) => {
  ctx.pushSystem('eventsTruncated', 'warning', { count: event.content || '' })
}

const onRunComplete: TranscriptEventHandler = (_event, ctx) => {
  ctx.settleAllTyping()
  ctx.pushSystem('runComplete', 'success')
}

const onRunCancelled: TranscriptEventHandler = (_event, ctx) => {
  ctx.settleAllTyping()
  // wps_06 A4: keep whatever partial answer arrived, but end the spinner.
  ctx.settleAllSpeech()
  ctx.pushSystem('runCancelled', 'warning')
}

const onError: TranscriptEventHandler = (event, ctx) => {
  ctx.settleAllTyping()
  ctx.settleAllSpeech()
  ctx.pushSystem('error', 'error', { error: event.error || '' })
}

const TRANSCRIPT_HANDLERS: Partial<
  Record<AgentCollaborationEventType, TranscriptEventHandler>
> = {
  'run-start': onRunStart,
  'task-created': onTaskCreated,
  'task-assigned': onTaskAssigned,
  'agent-start': onAgentStart,
  'agent-stream': onAgentStream,
  'agent-message': onAgentMessage,
  'agent-question': onAgentMessage,
  'agent-answer': onAgentMessage,
  'agent-delegated': onAgentDelegated,
  'agent-tool': onAgentTool,
  'document-operation-applied': onDocumentOperationApplied,
  'document-operation-rejected': onDocumentOperationRejected,
  handoff: onHandoff,
  conflict: onConflict,
  'run-complete': onRunComplete,
  'run-cancelled': onRunCancelled,
  'events-truncated': onEventsTruncated,
  error: onError,
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
  const ctx = createTranscriptContext(agents, mode)
  for (const event of events) {
    TRANSCRIPT_HANDLERS[event.type]?.(event, ctx)
  }

  const visible = ctx.items.filter((item) => !item.hidden)

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
