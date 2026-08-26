import assert from 'node:assert/strict'
import type { AgentUserDocumentActivity, WordEditPlan, WordEditPlanStep } from '../src/types/document'
import {
  WordAgentPlaybackController,
  chunkWordEditPlan,
  orderWordPlanSteps,
  validateWordEditPlan,
  wordStepDurationMs,
} from '../src/lightweight-office/agent/word-agent-playback-controller'
import { invalidatesApproval, isCurrentApprovalResponse } from '../src/lib/word-agent-approval'

const step = (
  id: string,
  page: number,
  dependsOn?: string[],
): WordEditPlanStep => ({
  id,
  operationId: 'replace',
  input: { text: id },
  anchor: { page, position: { offset: page * 10 } },
  dependsOn,
})

function makePlan(steps: WordEditPlanStep[], revision = 2): WordEditPlan {
  return { planId: 'plan-1', documentRevision: revision, version: 1, steps }
}

async function verifyOrderingAndValidation(): Promise<void> {
  const ordered = orderWordPlanSteps([
    step('third-page', 3),
    step('first-page', 1),
    step('dependent', 1, ['third-page']),
  ])
  assert.deepEqual(ordered.map((item) => item.id), ['first-page', 'third-page', 'dependent'])
  assert.throws(() => orderWordPlanSteps([step('a', 1, ['b']), step('b', 2, ['a'])]), /DEPENDENCY_CYCLE/)
  assert.throws(() => orderWordPlanSteps([step('a', 1), step('a', 2)]), /DUPLICATE_STEP/)
  const largePlan = validateWordEditPlan(makePlan(Array.from({ length: 201 }, (_, index) => step(`s${index}`, 1))))
  assert.deepEqual(chunkWordEditPlan(largePlan).map((chunk) => chunk.steps.length), [200, 1])
  assert.throws(() => validateWordEditPlan(makePlan([
    step('create', 1),
    {
      ...step('use', 2),
      input: { target: { $step: 'create', path: 'ref' } },
    },
  ])), /UNDECLARED_DEPENDENCY/)
}

async function verifyAdaptiveTiming(): Promise<void> {
  assert.equal(wordStepDurationMs(1, false), 900)
  assert.ok(wordStepDurationMs(15, false) >= 700)
  assert.ok(wordStepDurationMs(30, true) < wordStepDurationMs(30, false))
  assert.ok(wordStepDurationMs(80, true) <= 275)
}

async function verifyPlaybackAndSoftInterrupt(): Promise<void> {
  const committed: string[] = []
  const states: string[] = []
  let controller: WordAgentPlaybackController
  controller = new WordAgentPlaybackController({
    getRevision: () => 2,
    prepare: async (current) => ({ step: current, page: current.anchor?.page, resolvedTargets: 1 }),
    commit: async (prepared) => {
      committed.push(prepared.step.id)
      if (prepared.step.id === 'one') {
        const activity: AgentUserDocumentActivity = {
          eventId: 'user-edit-1',
          timestamp: Date.now(),
          documentRevision: 3,
          kind: 'edit',
          before: 'old',
          after: 'new',
        }
        controller.reportUserActivity(activity)
      }
      return { success: true, changed: true }
    },
    onState: (state) => states.push(state.phase),
  })
  controller.control({ type: 'skip-animations' })
  const result = await controller.play(makePlan([step('one', 1), step('two', 2)]), {
    runId: 'run-1',
    agentName: 'Writer',
  })
  assert.deepEqual(committed, ['one'])
  assert.equal(result.requiresReplan, true)
  assert.deepEqual(result.remainingSteps.map((item) => item.id), ['two'])
  assert.equal(result.interruptedBy?.eventId, 'user-edit-1')
  assert.ok(states.includes('interrupted'))
}

async function verifyControlsAndLimits(): Promise<void> {
  const controller = new WordAgentPlaybackController({
    getRevision: () => 4,
    prepare: async (current) => ({ step: current, resolvedTargets: 501 }),
    commit: async () => ({ success: true }),
  })
  controller.reportUserActivity({
    eventId: 'viewport-1',
    timestamp: Date.now(),
    documentRevision: 4,
    kind: 'viewport',
  })
  assert.equal(controller.getState().followAgent, false)
  assert.equal(controller.control({ type: 'locate' }).followAgent, true)
  controller.control({ type: 'skip-animations' })
  assert.equal(controller.getState().skipAnimations, true)
  const result = await controller.play(makePlan([step('large', 1)], 4))
  assert.equal(result.success, false)
  assert.match(result.error ?? '', /TARGET_LIMIT/)
}

async function verifyPauseGate(): Promise<void> {
  let resumed = false
  let committedAfterResume = false
  let controller: WordAgentPlaybackController
  controller = new WordAgentPlaybackController({
    getRevision: () => 7,
    prepare: async (current) => ({ step: current, resolvedTargets: 1 }),
    commit: async () => {
      committedAfterResume = resumed
      return { success: true }
    },
    onVisual: (phase) => {
      if (phase !== 'locate') return
      controller.control({ type: 'pause' })
      setTimeout(() => {
        resumed = true
        controller.control({ type: 'resume' })
      }, 10)
    },
  })
  controller.control({ type: 'skip-animations' })
  const result = await controller.play(makePlan([step('paused-step', 1)], 7))
  assert.equal(result.success, true)
  assert.equal(committedAfterResume, true)
}

async function verifyApprovalGuards(): Promise<void> {
  const request = {
    approvalId: 'approval-1',
    runId: 'run-1',
    planId: 'plan-2',
    planVersion: 3,
    documentRevision: 9,
    documentApiRevision: '20',
    remainingSteps: 4,
    requestedAt: Date.now(),
  }
  assert.equal(isCurrentApprovalResponse(request, {
    approvalId: 'approval-1',
    runId: 'run-1',
    planId: 'plan-2',
    planVersion: 3,
    documentRevision: 9,
    documentApiRevision: '20',
    decision: 'continue',
  }), true)
  assert.equal(isCurrentApprovalResponse(request, {
    approvalId: 'approval-1',
    runId: 'run-1',
    planId: 'plan-2',
    planVersion: 2,
    documentRevision: 9,
    documentApiRevision: '20',
    decision: 'continue',
  }), false)
  assert.equal(invalidatesApproval(request, {
    eventId: 'viewport',
    runId: 'run-1',
    timestamp: Date.now(),
    documentRevision: 10,
    documentApiRevision: '21',
    kind: 'viewport',
  }), false)
  assert.equal(invalidatesApproval(request, {
    eventId: 'edit',
    runId: 'run-1',
    timestamp: Date.now(),
    documentRevision: 10,
    documentApiRevision: '21',
    kind: 'edit',
  }), true)
}

async function main(): Promise<void> {
  await verifyOrderingAndValidation()
  await verifyAdaptiveTiming()
  await verifyPlaybackAndSoftInterrupt()
  await verifyControlsAndLimits()
  await verifyPauseGate()
  await verifyApprovalGuards()
  console.log('PASS Word Agent plan validation, ordering, pacing, controls, and soft interruption')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
