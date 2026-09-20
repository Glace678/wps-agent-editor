// Golden-case verifier for buildCollaborationTranscript (pure reducer).
// Run: npm run test:collaboration-transcript
//
// Each case feeds a raw collaboration event stream through the reducer and pins
// the resulting transcript: item KINDS, their ORDER, TEXT content, streaming /
// clusterHead flags, and which rows the reducer HID. Hidden rows are filtered
// out of the return value, so hiding is pinned by asserting the item key was
// consumed (a gap in the `item-<n>` sequence) while later items still exist --
// that distinguishes "created then hidden" from "never created".
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'collab-transcript-'))
const entry = join(dir, 'entry.ts')
writeFileSync(entry, `
export { buildCollaborationTranscript, stripToolFences, stripToolFencesLive, isSystemLineKey } from '${process.cwd().replace(/\\/g, '\\\\')}/src/lib/collaboration-transcript'
`)
execFileSync('node', ['node_modules/esbuild/bin/esbuild',
  entry,
  '--bundle',
  '--format=esm',
  '--platform=node',
  `--outfile=${join(dir, 'out.mjs')}`,
], { stdio: 'inherit' })
const mod = await import(pathToFileURL(join(dir, 'out.mjs')).href)
const { buildCollaborationTranscript, stripToolFences, stripToolFencesLive, isSystemLineKey } = mod

const AGENTS = [
  { id: 'doubao', name: '豆包', providerId: 'custom-uuid', model: 'custom-uuid/doubao-pro', color: '#1f6bff', enabled: true },
  { id: 'gpt', name: 'GPT助手', providerId: 'openai', model: 'gpt-4o', color: '#22c55e', enabled: true },
]

const AGENTS3 = [
  { id: 'root', name: '主管', providerId: 'p1', model: 'm1', color: '#000', enabled: true },
  { id: 'a', name: '阿A', providerId: 'p2', model: 'm2', color: '#111', enabled: true },
  { id: 'b', name: '阿B', providerId: 'p3', model: 'm3', color: '#222', enabled: true },
]

/** Numeric suffixes of the generated item keys, in output order. */
const seq = (items) => items.map((i) => Number(i.key.slice('item-'.length)))
const kinds = (items) => items.map((i) => i.kind)
const speechOf = (items, agentId) => items.filter((i) => i.kind === 'speech' && i.agent.agentId === agentId)

/**
 * @typedef {{ name: string, events: object[], agents?: object[], mode?: string,
 *             expect: (items: object[]) => [boolean, string][] }} GoldenCase
 */

/** @type {GoldenCase[]} */
const CASES = [
  {
    name: 'empty event stream yields an empty transcript',
    events: [],
    expect: (items) => [
      [items.length === 0, 'zero items for zero events'],
    ],
  },

  {
    name: 'run-start emits the task row first with verbatim text',
    events: [{ type: 'run-start', runId: 'r', content: '写一首关于秋天的诗' }],
    expect: (items) => [
      [items.length === 1, 'exactly one item'],
      [kinds(items)[0] === 'task', 'first item kind is task'],
      [items[0].text === '写一首关于秋天的诗', 'task text preserved verbatim'],
      [items[0].key === 'item-0', 'task row takes the first generated key'],
    ],
  },

  {
    name: 'blank run-start content emits no task row',
    events: [{ type: 'run-start', runId: 'r', content: '   ' }],
    expect: (items) => [
      [items.length === 0, 'whitespace-only content produces no task row'],
    ],
  },

  {
    name: 'typing row collapses when the agent sends prose',
    events: [
      { type: 'run-start', runId: 'r', content: 't' },
      { type: 'task-created', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-start', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-message', runId: 'r', agentId: 'gpt', agentName: 'GPT助手', content: '你好' },
    ],
    expect: (items) => [
      [kinds(items).join() === 'task,system,speech', 'task, director line, then speech'],
      [seq(items).join() === '0,1,3', 'item-2 (typing) was created then hidden, not skipped'],
      [items[1].messageKey === 'directorReady' && items[1].params.agent === 'GPT助手', 'directorReady system line with agent param'],
      [items[2].text === '你好', 'settled bubble carries the message text'],
      [items[2].streaming === false, 'bubble is no longer streaming'],
      [items[2].clusterHead === true, 'bubble is a cluster head'],
    ],
  },

  {
    name: 'agent-stream frames sharing an operationId merge into one bubble',
    events: [
      { type: 'run-start', runId: 'r', content: 't' },
      { type: 'task-created', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-start', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-stream', runId: 'r', operationId: 'op-1', agentId: 'gpt', agentName: 'GPT助手', content: '秋' },
      { type: 'agent-stream', runId: 'r', operationId: 'op-1', agentId: 'gpt', agentName: 'GPT助手', content: '秋风起' },
      { type: 'agent-message', runId: 'r', operationId: 'op-1', agentId: 'gpt', agentName: 'GPT助手', content: '秋风起兮白云飞' },
    ],
    expect: (items) => [
      [speechOf(items, 'gpt').length === 1, 'three frames with one operationId render one bubble'],
      [speechOf(items, 'gpt')[0].text === '秋风起兮白云飞', 'bubble shows the final accumulated text'],
      [speechOf(items, 'gpt')[0].streaming === false, 'agent-message marks the bubble as settled'],
      [seq(items).join() === '0,1,3', 'only one speech key was allocated'],
    ],
  },

  {
    name: 'a second finalized turn from the same agent starts a new bubble',
    events: [
      { type: 'run-start', runId: 'r', content: '改一下' },
      { type: 'task-created', runId: 'r', agentId: 'doubao', agentName: '豆包' },
      { type: 'agent-start', runId: 'r', agentId: 'doubao', agentName: '豆包' },
      { type: 'agent-message', runId: 'r', agentId: 'doubao', agentName: '豆包', content: '第一版答复' },
      { type: 'agent-message', runId: 'r', agentId: 'doubao', agentName: '豆包', content: '第二版答复' },
    ],
    expect: (items) => [
      [speechOf(items, 'doubao').length === 2, 'two turns render two bubbles (no overwrite)'],
      [speechOf(items, 'doubao').map((i) => i.text).join('|') === '第一版答复|第二版答复', 'both turn texts survive in order'],
      [seq(items).join() === '0,1,3,4', 'each turn allocates its own key'],
      [!items.some((i) => i.kind === 'typing'), 'no typing row leaks into the output'],
    ],
  },

  {
    name: 'agent-message with no previous speech item does not crash',
    events: [
      { type: 'run-start', runId: 'r', content: 't' },
      { type: 'task-created', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-message', runId: 'r', agentId: 'gpt', agentName: 'GPT助手', content: '直接回复' },
    ],
    expect: (items) => [
      [kinds(items).join() === 'task,system,speech', 'task, director line, then speech'],
      [items[2].text === '直接回复', 'message without prior bubble becomes its own bubble'],
      [items[2].streaming === false, 'bubble is settled'],
    ],
  },

  {
    name: 'a bare agent-message finalizes the still-streaming bubble in place',
    events: [
      { type: 'run-start', runId: 'r', content: 't' },
      { type: 'task-created', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-start', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-stream', runId: 'r', operationId: 'op-5', agentId: 'gpt', agentName: 'GPT助手', content: '秋风' },
      { type: 'agent-message', runId: 'r', agentId: 'gpt', agentName: 'GPT助手', content: '秋风起兮白云飞' },
    ],
    expect: (items) => [
      [speechOf(items, 'gpt').length === 1, 'message without operationId reuses the streaming bubble'],
      [speechOf(items, 'gpt')[0].text === '秋风起兮白云飞', 'streaming bubble takes the finalized text'],
      [speechOf(items, 'gpt')[0].streaming === false, 'bubble stops streaming'],
      [seq(items).join() === '0,1,3', 'no second speech key was allocated'],
    ],
  },

  {
    name: 'tool-only message after streamed prose hides the prose bubble',
    events: [
      { type: 'run-start', runId: 'r', content: 't' },
      { type: 'task-created', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-start', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-stream', runId: 'r', operationId: 'op-6', agentId: 'gpt', agentName: 'GPT助手', content: '我先查一下\n```tool {"tool":"web_search","args":{"q":"秋"}}\n```' },
      { type: 'agent-message', runId: 'r', operationId: 'op-6', agentId: 'gpt', agentName: 'GPT助手', content: '```tool {"tool":"web_search","args":{"q":"秋"}}\n```' },
      { type: 'run-complete', runId: 'r' },
    ],
    expect: (items) => [
      [items.some((i) => i.kind === 'speech') === false, 'streamed prose bubble is hidden by the tool-only message'],
      [items.some((i) => i.kind === 'typing') === false, 'typing row is cleared'],
      [seq(items).join() === '0,1,4', 'item-2 typing and item-3 prose bubble were created then hidden'],
      [kinds(items).join() === 'task,system,system', 'task + directorReady + runComplete only'],
    ],
  },

  {
    name: 'tool-only message hides the bubble and keeps the tool system line',
    events: [
      { type: 'run-start', runId: 'r', content: '查资料' },
      { type: 'task-created', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-start', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-stream', runId: 'r', operationId: 'op-2', agentId: 'gpt', agentName: 'GPT助手', content: '```tool {"tool' },
      { type: 'agent-message', runId: 'r', operationId: 'op-2', agentId: 'gpt', agentName: 'GPT助手', content: '```tool {"tool":"web_search","args":{"q":"秋天"}}\n```' },
      { type: 'agent-tool', runId: 'r', agentId: 'gpt', agentName: 'GPT助手', tool: 'web_search' },
      { type: 'run-complete', runId: 'r' },
    ],
    expect: (items) => [
      [items.some((i) => i.kind === 'speech') === false, 'tool-only turn renders no speech bubble'],
      [items.some((i) => i.kind === 'typing') === false, 'typing row is cleared'],
      [kinds(items).join() === 'task,system,system,system', 'task + directorReady + toolInvoked + runComplete'],
      [seq(items).join() === '0,1,3,4', 'item-2 typing row was created then hidden; no speech key was ever allocated'],
      [items.some((i) => i.messageKey === 'toolInvoked' && i.params.tool === 'web_search' && i.params.agent === 'GPT助手'), 'tool system line names the tool and agent'],
      [items.at(-1).messageKey === 'runComplete', 'run-complete line is last'],
    ],
  },

  {
    name: 'half-emitted tool fence is hidden while streaming',
    events: [
      { type: 'run-start', runId: 'r', content: 't' },
      { type: 'task-created', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-start', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-stream', runId: 'r', operationId: 'op-3', agentId: 'gpt', agentName: 'GPT助手', content: '正在想\n```tool {"tool":"de' },
    ],
    expect: (items) => [
      [speechOf(items, 'gpt').length === 1, 'live frame renders one bubble'],
      [speechOf(items, 'gpt')[0].text === '正在想', 'only prose before the unclosed fence survives'],
      [speechOf(items, 'gpt')[0].streaming === true, 'bubble stays streaming until agent-message'],
      [!speechOf(items, 'gpt')[0].text.includes('```'), 'no raw fence syntax leaks into the bubble'],
    ],
  },

  {
    name: 'closed tool fence mid-stream is stripped from the live bubble',
    events: [
      { type: 'run-start', runId: 'r', content: 't' },
      { type: 'task-created', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-start', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-stream', runId: 'r', operationId: 'op-7', agentId: 'gpt', agentName: 'GPT助手', content: '前半\n```tool {"tool":"web_search","args":{}}\n```\n后半' },
    ],
    expect: (items) => {
      const bubbles = speechOf(items, 'gpt')
      return [
        [bubbles.length === 1, 'one live bubble'],
        [bubbles[0].text === '前半\n\n后半', 'prose on both sides of a closed fence survives'],
        [!bubbles[0].text.includes('```'), 'closed fence never flashes in the live bubble'],
        [bubbles[0].streaming === true, 'bubble stays streaming until agent-message'],
      ]
    },
  },

  {
    name: 'delegation card carries from/to identities and hides delegate_task',
    events: [
      { type: 'run-start', runId: 'r', content: '分工' },
      { type: 'task-created', runId: 'r', agentId: 'doubao', agentName: '豆包' },
      { type: 'agent-delegated', runId: 'r', fromAgentId: 'doubao', fromAgentName: '豆包', toAgentId: 'gpt', toAgentName: 'GPT助手', content: '你写草稿' },
      { type: 'agent-tool', runId: 'r', agentId: 'doubao', agentName: '豆包', tool: 'delegate_task' },
      { type: 'agent-tool', runId: 'r', agentId: 'gpt', agentName: 'GPT助手', tool: 'web_search' },
      { type: 'run-complete', runId: 'r' },
    ],
    expect: (items) => [
      [kinds(items).join() === 'task,system,delegation,system,system', 'task, directorReady, card, toolInvoked, runComplete'],
      [items[2].from.agentId === 'doubao' && items[2].to.agentId === 'gpt', 'card from/to agent ids'],
      [items[2].from.agentName === '豆包' && items[2].to.agentName === 'GPT助手', 'card from/to names backfilled from config'],
      [items[2].text === '你写草稿', 'card carries the delegated task text'],
      [!items.some((i) => i.messageKey === 'toolInvoked' && i.params.tool === 'delegate_task'), 'delegate_task emits no tool system line'],
      [items.some((i) => i.messageKey === 'toolInvoked' && i.params.tool === 'web_search'), 'other tools still emit a system line'],
    ],
  },

  {
    name: 'run-cancelled clears typing and keeps the partial bubble streaming',
    events: [
      { type: 'run-start', runId: 'r', content: 't' },
      { type: 'task-created', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-start', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-stream', runId: 'r', operationId: 'op-4', agentId: 'gpt', agentName: 'GPT助手', content: '半句话' },
      { type: 'run-cancelled', runId: 'r' },
    ],
    expect: (items) => [
      [kinds(items).join() === 'task,system,speech,system', 'task, directorReady, partial bubble, runCancelled'],
      [seq(items).join() === '0,1,3,4', 'item-2 typing row created then hidden'],
      [items[2].text === '半句话' && items[2].streaming === true, 'partial bubble stays visible and streaming'],
      [items.at(-1).messageKey === 'runCancelled' && items.at(-1).tone === 'warning', 'runCancelled warning line is last'],
    ],
  },

  {
    name: 'error clears typing and surfaces the message',
    events: [
      { type: 'run-start', runId: 'r', content: 'x' },
      { type: 'task-created', runId: 'r', agentId: 'root', agentName: '主管' },
      { type: 'agent-start', runId: 'r', agentId: 'root', agentName: '主管' },
      { type: 'error', runId: 'r', error: 'boom' },
    ],
    agents: AGENTS3,
    expect: (items) => [
      [kinds(items).join() === 'task,system,system', 'task, directorReady, error line'],
      [seq(items).join() === '0,1,3', 'item-2 typing row created then hidden'],
      [items.at(-1).messageKey === 'error' && items.at(-1).tone === 'error', 'error system line with error tone'],
      [items.at(-1).params.error === 'boom', 'error line carries the message param'],
    ],
  },

  {
    name: 'identity is backfilled from the saved agent config',
    events: [
      { type: 'run-start', runId: 'r', content: 't' },
      { type: 'task-created', runId: 'r', agentId: 'doubao', agentName: '豆包' },
      { type: 'agent-start', runId: 'r', agentId: 'doubao', agentName: '豆包' },
      { type: 'agent-message', runId: 'r', agentId: 'doubao', agentName: '豆包', content: '回复' },
    ],
    expect: (items) => {
      const agent = items.find((i) => i.kind === 'speech').agent
      return [
        [agent.agentId === 'doubao', 'agent id kept'],
        [agent.agentName === '豆包', 'name kept'],
        [agent.providerId === 'custom-uuid', 'providerId backfilled from config'],
        [agent.model === 'custom-uuid/doubao-pro', 'model backfilled from config'],
        [agent.color === '#1f6bff', 'color backfilled from config'],
      ]
    },
  },

  {
    name: 'unknown agent id falls back to event-only identity',
    events: [
      { type: 'run-start', runId: 'r', content: 't' },
      { type: 'task-created', runId: 'r', agentId: 'stranger', agentName: '陌生人' },
      { type: 'agent-message', runId: 'r', agentId: 'stranger', agentName: '陌生人', providerId: 'openai', model: 'gpt-4o', content: 'hi' },
    ],
    expect: (items) => {
      const agent = items.find((i) => i.kind === 'speech').agent
      return [
        [agent.agentId === 'stranger', 'unknown agent id kept'],
        [agent.agentName === '陌生人', 'event name kept'],
        [agent.providerId === 'openai' && agent.model === 'gpt-4o', 'event provider/model kept'],
        [agent.color === undefined, 'no color invented for unknown agent'],
      ]
    },
  },

  {
    name: 'clusterHead groups consecutive same-agent bubbles and resets on system rows',
    events: [
      { type: 'run-start', runId: 'r', content: 't' },
      { type: 'task-created', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-start', runId: 'r', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-message', runId: 'r', agentId: 'gpt', agentName: 'GPT助手', content: '第一条' },
      { type: 'agent-message', runId: 'r', agentId: 'gpt', agentName: 'GPT助手', content: '第二条' },
      { type: 'agent-tool', runId: 'r', agentId: 'gpt', agentName: 'GPT助手', tool: 'web_search' },
      { type: 'agent-message', runId: 'r', agentId: 'gpt', agentName: 'GPT助手', content: '第三条' },
    ],
    expect: (items) => {
      const bubbles = speechOf(items, 'gpt')
      return [
        [bubbles.map((i) => i.text).join('|') === '第一条|第二条|第三条', 'three bubbles in order'],
        [bubbles.map((i) => i.clusterHead).join() === 'true,false,true', 'intervening system row resets the cluster head'],
        [bubbles.every((i) => i.agent.agentId === 'gpt'), 'all bubbles share the speaker identity'],
      ]
    },
  },

  {
    name: 'directed delegation round keeps prose bubble and final answer separate',
    events: [
      { type: 'run-start', runId: 'r1', content: '写一首关于秋天的诗' },
      { type: 'task-created', runId: 'r1', agentId: 'doubao', agentName: '豆包', providerId: 'custom-uuid', model: 'custom-uuid/doubao-pro' },
      { type: 'agent-start', runId: 'r1', agentId: 'doubao', agentName: '豆包', providerId: 'custom-uuid', model: 'custom-uuid/doubao-pro' },
      { type: 'agent-stream', runId: 'r1', operationId: 'stream:doubao:aaa:0', agentId: 'doubao', agentName: '豆包', content: '我来规划一下。' },
      { type: 'agent-message', runId: 'r1', operationId: 'stream:doubao:aaa:0', agentId: 'doubao', agentName: '豆包', content: '我来规划一下。\n```tool {"tool":"delegate_task","args":{"agentId":"gpt","task":"先写一版草稿"}}\n```' },
      { type: 'agent-delegated', runId: 'r1', fromAgentId: 'doubao', fromAgentName: '豆包', toAgentId: 'gpt', toAgentName: 'GPT助手', content: '先写一版草稿' },
      { type: 'agent-start', runId: 'r1', agentId: 'gpt', agentName: 'GPT助手', providerId: 'openai', model: 'gpt-4o' },
      { type: 'agent-stream', runId: 'r1', operationId: 'stream:gpt:bbb:0', agentId: 'gpt', agentName: 'GPT助手', content: '草稿：秋风...' },
      { type: 'agent-message', runId: 'r1', operationId: 'stream:gpt:bbb:0', agentId: 'gpt', agentName: 'GPT助手', content: '草稿：秋风起兮白云飞' },
      { type: 'agent-start', runId: 'r1', agentId: 'doubao', agentName: '豆包' },
      { type: 'agent-message', runId: 'r1', agentId: 'doubao', agentName: '豆包', content: '成稿：《秋》……' },
      { type: 'run-complete', runId: 'r1' },
    ],
    expect: (items) => [
      [items[0].kind === 'task' && items[0].text === '写一首关于秋天的诗', 'task row first'],
      [!items.some((i) => i.kind === 'typing'), 'all typing rows settled'],
      [speechOf(items, 'doubao').map((i) => i.text).join('|') === '我来规划一下。|成稿：《秋》……', 'pre-tool prose kept, director round two is a new bubble'],
      [!speechOf(items, 'doubao').some((i) => i.text.includes('```')), 'tool fences stripped from bubbles'],
      [speechOf(items, 'gpt')[0].text === '草稿：秋风起兮白云飞', 'peer final bubble'],
      [items.some((i) => i.kind === 'delegation' && i.from.agentId === 'doubao' && i.to.agentId === 'gpt' && i.text === '先写一版草稿'), 'delegation card from->to'],
      [items.at(-1).messageKey === 'runComplete', 'run complete line last'],
    ],
  },

  {
    name: 'parallel mode shows synthesizer line, assignments and handoffs',
    events: [
      { type: 'run-start', runId: 'p1', content: '分析这份表格' },
      { type: 'task-created', runId: 'p1', agentId: 'gpt', agentName: 'GPT助手', providerId: 'openai', model: 'gpt-4o' },
      { type: 'task-assigned', runId: 'p1', agentId: 'doubao', agentName: '豆包' },
      { type: 'task-assigned', runId: 'p1', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-start', runId: 'p1', agentId: 'doubao', agentName: '豆包' },
      { type: 'agent-message', runId: 'p1', agentId: 'doubao', agentName: '豆包', content: '我的分析：……' },
      { type: 'agent-start', runId: 'p1', agentId: 'gpt', agentName: 'GPT助手' },
      { type: 'agent-message', runId: 'p1', agentId: 'gpt', agentName: 'GPT助手', content: '我的分析：……' },
      { type: 'handoff', runId: 'p1', fromAgentId: 'doubao', fromAgentName: '豆包', toAgentId: 'gpt', toAgentName: 'GPT助手' },
      { type: 'run-complete', runId: 'p1' },
    ],
    mode: 'parallel',
    expect: (items) => [
      [items.some((i) => i.messageKey === 'synthesizerReady'), 'synthesizer ready line'],
      [!items.some((i) => i.messageKey === 'directorReady'), 'no director line in parallel mode'],
      [items.filter((i) => i.messageKey === 'taskAssigned').map((i) => i.params.agent).join('|') === '豆包|GPT助手', 'two task-assigned lines in order'],
      [items.some((i) => i.messageKey === 'handoff' && i.params.from === '豆包' && i.params.to === 'GPT助手'), 'handoff line params'],
      [speechOf(items, 'doubao').length === 1 && speechOf(items, 'gpt').length === 1, 'one bubble per assigned agent'],
    ],
  },

  {
    name: 'multi-level delegation chain keeps cards and peer turns distinct',
    events: [
      { type: 'run-start', runId: 'c1', content: '大任务' },
      { type: 'task-created', runId: 'c1', agentId: 'root', agentName: '主管' },
      { type: 'agent-delegated', runId: 'c1', fromAgentId: 'root', fromAgentName: '主管', toAgentId: 'a', toAgentName: '阿A', content: '子任务1' },
      { type: 'agent-start', runId: 'c1', agentId: 'a', agentName: '阿A' },
      { type: 'agent-delegated', runId: 'c1', fromAgentId: 'a', fromAgentName: '阿A', toAgentId: 'b', toAgentName: '阿B', content: '孙任务' },
      { type: 'agent-start', runId: 'c1', agentId: 'b', agentName: '阿B' },
      { type: 'agent-message', runId: 'c1', agentId: 'b', agentName: '阿B', content: '孙任务结果' },
      { type: 'agent-message', runId: 'c1', agentId: 'a', agentName: '阿A', content: '子任务1汇总' },
      { type: 'agent-delegated', runId: 'c1', fromAgentId: 'root', fromAgentName: '主管', toAgentId: 'a', toAgentName: '阿A', content: '子任务2' },
      { type: 'agent-message', runId: 'c1', agentId: 'a', agentName: '阿A', content: '子任务2结果' },
      { type: 'agent-message', runId: 'c1', agentId: 'root', agentName: '主管', content: '最终答复' },
      { type: 'run-complete', runId: 'c1' },
    ],
    agents: AGENTS3,
    expect: (items) => {
      const cards = items.filter((i) => i.kind === 'delegation')
      const aBubbles = speechOf(items, 'a').map((i) => i.text)
      return [
        [cards.length === 3, 'three delegation cards'],
        [cards.map((i) => `${i.from.agentId}->${i.to.agentId}`).join('|') === 'root->a|a->b|root->a', 'card chain identities in order'],
        [cards[2].text === '子任务2', 'second root->A card kept separate from the first'],
        [aBubbles.join('|') === '子任务1汇总|子任务2结果', 'repeated peer turns are separate bubbles'],
        [items.some((i) => i.kind === 'speech' && i.agent.agentId === 'root' && i.text === '最终答复'), 'director final answer present'],
      ]
    },
  },
]

let failures = 0
let totalAssertions = 0

const fail = (msg) => {
  failures++
  console.error(`FAIL: ${msg}`)
}

for (const testCase of CASES) {
  const label = `case "${testCase.name}"`
  let items
  try {
    items = buildCollaborationTranscript(
      testCase.events,
      testCase.agents ?? AGENTS,
      testCase.mode ?? 'directed',
    )
  } catch (error) {
    fail(`${label} threw: ${error && error.message ? error.message : error}`)
    continue
  }
  let assertions
  try {
    assertions = testCase.expect(items)
  } catch (error) {
    fail(`${label} assertion hook threw: ${error && error.message ? error.message : error}`)
    continue
  }
  if (!Array.isArray(assertions) || assertions.length === 0) {
    fail(`${label} asserts nothing -- a golden case that cannot fail is worthless`)
    continue
  }
  let caseFailures = 0
  for (const [cond, description] of assertions) {
    totalAssertions++
    if (!cond) {
      caseFailures++
      fail(`${label} :: ${description}`)
    }
  }
  if (caseFailures === 0) {
    console.log(`PASS: ${label} (${assertions.length} assertions)`)
  } else {
    console.error(`PASS: ${label} -> ${assertions.length - caseFailures}/${assertions.length} assertions held`)
    console.error(`  input events: ${JSON.stringify(testCase.events.map((e) => e.type))}`)
    console.error(`  output: ${JSON.stringify(items.map((i) => ({ kind: i.kind, key: i.key, text: i.text, messageKey: i.messageKey })))}`)
  }
}

// ---- pure helpers -----------------------------------------------------------
const unitAssertions = [
  [stripToolFences('```tool {"tool":"x"}\n```\n\n你好') === '你好', 'stripToolFences keeps prose after a closed fence'],
  [stripToolFences('纯文本') === '纯文本', 'stripToolFences passes plain text through'],
  [stripToolFencesLive('正文\n```tool {"tool":"de') === '正文', 'stripToolFencesLive hides the unclosed fence tail'],
  [stripToolFencesLive('```tool {"tool":"x"}\n```') === '', 'stripToolFencesLive returns empty for a fence-only stream'],
  [isSystemLineKey('error') === true, 'isSystemLineKey accepts a known key'],
  [isSystemLineKey('notAKey') === false, 'isSystemLineKey rejects an unknown key'],
  [isSystemLineKey(undefined) === false, 'isSystemLineKey rejects undefined'],
]
for (const [cond, description] of unitAssertions) {
  totalAssertions++
  if (!cond) fail(`unit :: ${description}`)
  else console.log(`PASS: unit :: ${description}`)
}

console.log(`\n${CASES.length} golden cases, ${totalAssertions} assertions, ${failures} failure(s)`)
process.exit(failures ? 1 : 0)
