/**
 * Unit + structural checks: Writing / Editing&Proofreading / Local built-in
 * agents are removed from defaults and i18n, while custom/new agent paths remain.
 *
 * Run: npx tsx scripts/test-remove-builtin-agents.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REMOVED_BUILT_IN_AGENT_IDS,
  filterRemovedBuiltInAgents,
  isRemovedBuiltInAgentId,
  createAgent,
} from '../electron/services/agent-store.service.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

let passed = 0
function test(name, fn) {
  try {
    fn()
    console.log(`PASS  ${name}`)
    passed += 1
  } catch (err) {
    console.error(`FAIL  ${name}`)
    console.error(err)
    process.exitCode = 1
  }
}

const REMOVED_IDS = ['agent-writer', 'agent-editor', 'agent-local']
const REMOVED_I18N_STEMS = [
  'writingAssistant',
  'writingAssistantDesc',
  'writingAssistantPrompt',
  'editingProofreading',
  'editingProofreadingDesc',
  'editingProofreadingPrompt',
  'localAssistant',
  'localAssistantDesc',
  'localAssistantPrompt',
]

// --- Unit tests on shipped pure filter / createAgent ---

test('REMOVED_BUILT_IN_AGENT_IDS contains exactly the three retired presets', () => {
  assert.equal(REMOVED_BUILT_IN_AGENT_IDS.size, 3)
  for (const id of REMOVED_IDS) {
    assert.ok(REMOVED_BUILT_IN_AGENT_IDS.has(id), id)
    assert.equal(isRemovedBuiltInAgentId(id), true)
  }
  assert.equal(isRemovedBuiltInAgentId('custom-uuid'), false)
})

test('filterRemovedBuiltInAgents drops the three ids and keeps custom agents', () => {
  const mixed = [
    { id: 'agent-writer', name: 'W' },
    { id: 'agent-editor', name: 'E' },
    { id: 'agent-local', name: 'L' },
    { id: 'user-1', name: 'Mine' },
  ]
  const out = filterRemovedBuiltInAgents(mixed)
  assert.deepEqual(out.map((a) => a.id), ['user-1'])
})

test('createAgent does not use removed built-in ids and keeps custom/new defaults', () => {
  const agent = createAgent({})
  assert.equal(isRemovedBuiltInAgentId(agent.id), false)
  for (const id of REMOVED_IDS) {
    assert.notEqual(agent.id, id)
  }
  // createAgent falls back to i18n new/custom strings via t(); names are non-empty
  assert.ok(typeof agent.name === 'string' && agent.name.length > 0)
  assert.ok(typeof agent.systemPrompt === 'string' && agent.systemPrompt.length > 0)
  assert.ok(Array.isArray(agent.tools))
})

// --- Structural checks ---

const storeSrc = read('electron/services/agent-store.service.ts')
const checkI18n = read('scripts/check-i18n.ts')
const en = read('src/lib/i18n/locales/en.ts')
const zh = read('src/lib/i18n/locales/zh-CN.ts')

test('getDefaultAgents no longer seeds the three built-in agents', () => {
  assert.match(storeSrc, /function getDefaultAgents\(\):\s*AgentConfig\[\]\s*\{\s*return\s*\[\s*\]/)
  // No name/role/systemPrompt assignment from the three removed i18n keys
  assert.doesNotMatch(storeSrc, /agents\.writingAssistant/)
  assert.doesNotMatch(storeSrc, /agents\.editingProofreading/)
  assert.doesNotMatch(storeSrc, /agents\.localAssistant/)
})

test('getAgents/saveAgents use filterRemovedBuiltInAgents', () => {
  assert.match(storeSrc, /filterRemovedBuiltInAgents/)
  assert.match(storeSrc, /export function filterRemovedBuiltInAgents/)
  assert.match(storeSrc, /createAgent/)
  assert.match(storeSrc, /agents\.newAgent/)
  assert.match(storeSrc, /agents\.customAssistant/)
})

test('locale keys for the three presets are removed (en + zh-CN)', () => {
  for (const [name, src] of [['en', en], ['zh-CN', zh]]) {
    for (const stem of REMOVED_I18N_STEMS) {
      assert.doesNotMatch(src, new RegExp(`\\b${stem}:`), `${name} ${stem}`)
    }
    assert.match(src, /newAgent:/, `${name} newAgent`)
    assert.match(src, /customAssistant:/, `${name} customAssistant`)
    assert.match(src, /customAssistantPrompt:/, `${name} customAssistantPrompt`)
  }
})

test('all locale files drop the nine dead agent keys', () => {
  const dir = path.join(root, 'src/lib/i18n/locales')
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8')
    for (const stem of REMOVED_I18N_STEMS) {
      assert.doesNotMatch(src, new RegExp(`\\b${stem}:`), `${file} ${stem}`)
    }
  }
})

test('check-i18n no longer requires the three removed prompt fields', () => {
  assert.doesNotMatch(checkI18n, /writingAssistantPrompt/)
  assert.doesNotMatch(checkI18n, /editingProofreadingPrompt/)
  assert.doesNotMatch(checkI18n, /localAssistantPrompt/)
  assert.match(checkI18n, /customAssistantPrompt/)
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
