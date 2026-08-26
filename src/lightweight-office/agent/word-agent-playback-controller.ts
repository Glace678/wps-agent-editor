import type {
  AgentUserDocumentActivity,
  WordEditPlan,
  WordEditPlanStep,
  WordPlaybackControl,
  WordPlaybackState,
} from '@/types/document'

export const MAX_WORD_PLAN_STEPS = 200
export const MAX_WORD_PLAN_TARGETS = 500
const MAX_WORD_PLAN_INPUT_STEPS = 2_000

export interface PreparedWordPlanStep {
  step: WordEditPlanStep
  range?: { from: number; to: number }
  page?: number
  resolvedTargets?: number
  text?: string
  metadata?: Record<string, unknown>
}

export interface WordPlanStepResult {
  success: boolean
  changed?: boolean
  skipped?: boolean
  conflict?: boolean
  error?: string
  result?: unknown
}

export interface WordPlaybackAdapter {
  getRevision: () => number
  prepare: (step: WordEditPlanStep, context: { index: number; total: number }) => Promise<PreparedWordPlanStep>
  commit: (prepared: PreparedWordPlanStep, context: { index: number; total: number }) => Promise<WordPlanStepResult>
  onVisual?: (
    phase: 'locate' | 'before' | 'commit' | 'after' | 'clear',
    prepared: PreparedWordPlanStep,
    state: WordPlaybackState,
  ) => void | Promise<void>
  onState?: (state: WordPlaybackState) => void
}

export interface WordPlaybackResult {
  success: boolean
  planId: string
  completed: number
  total: number
  appliedStepIds: string[]
  skippedStepIds: string[]
  remainingSteps: WordEditPlanStep[]
  requiresReplan: boolean
  interruptedBy?: AgentUserDocumentActivity
  error?: string
}

function cloneState(state: WordPlaybackState): WordPlaybackState {
  return { ...state }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

function compareVisualOrder(a: WordEditPlanStep, b: WordEditPlanStep): number {
  const pageA = a.anchor?.page ?? Number.MAX_SAFE_INTEGER
  const pageB = b.anchor?.page ?? Number.MAX_SAFE_INTEGER
  if (pageA !== pageB) return pageA - pageB
  const offsetA = a.anchor?.position?.offset ?? Number.MAX_SAFE_INTEGER
  const offsetB = b.anchor?.position?.offset ?? Number.MAX_SAFE_INTEGER
  if (offsetA !== offsetB) return offsetA - offsetB
  return 0
}

/** Stable topological sort; independent steps are ordered by visible document location. */
export function orderWordPlanSteps(steps: WordEditPlanStep[]): WordEditPlanStep[] {
  const byId = new Map<string, WordEditPlanStep>()
  const indexById = new Map<string, number>()
  steps.forEach((step, index) => {
    if (!step.id.trim()) throw new Error('WORD_PLAN_STEP_ID_REQUIRED')
    if (byId.has(step.id)) throw new Error(`WORD_PLAN_DUPLICATE_STEP:${step.id}`)
    byId.set(step.id, step)
    indexById.set(step.id, index)
  })

  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const step of steps) {
    const dependencies = [...new Set(step.dependsOn ?? [])]
    indegree.set(step.id, dependencies.length)
    for (const dependency of dependencies) {
      if (!byId.has(dependency)) throw new Error(`WORD_PLAN_UNKNOWN_DEPENDENCY:${dependency}`)
      const list = dependents.get(dependency) ?? []
      list.push(step.id)
      dependents.set(dependency, list)
    }
  }

  const ready = steps.filter((step) => indegree.get(step.id) === 0)
  const sortReady = () => ready.sort((a, b) => (
    compareVisualOrder(a, b) || (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0)
  ))
  sortReady()

  const result: WordEditPlanStep[] = []
  while (ready.length > 0) {
    const step = ready.shift()!
    result.push(step)
    for (const dependentId of dependents.get(step.id) ?? []) {
      const next = (indegree.get(dependentId) ?? 1) - 1
      indegree.set(dependentId, next)
      if (next === 0) ready.push(byId.get(dependentId)!)
    }
    sortReady()
  }

  if (result.length !== steps.length) throw new Error('WORD_PLAN_DEPENDENCY_CYCLE')
  return result
}

export function validateWordEditPlan(plan: WordEditPlan): WordEditPlan {
  if (!plan || typeof plan !== 'object') throw new Error('WORD_PLAN_REQUIRED')
  if (!plan.planId?.trim()) throw new Error('WORD_PLAN_ID_REQUIRED')
  if (!Number.isInteger(plan.documentRevision) || plan.documentRevision < 0) {
    throw new Error('WORD_PLAN_REVISION_INVALID')
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) throw new Error('WORD_PLAN_STEPS_REQUIRED')
  if (plan.steps.length > MAX_WORD_PLAN_INPUT_STEPS) throw new Error('WORD_PLAN_STEP_LIMIT')
  for (const step of plan.steps) {
    if (!step.operationId?.trim()) throw new Error(`WORD_PLAN_OPERATION_REQUIRED:${step.id || '?'}`)
    if (step.input === undefined) throw new Error(`WORD_PLAN_INPUT_REQUIRED:${step.id || '?'}`)
    const references = collectStepReferenceIds(step.input)
    for (const reference of references) {
      if (!step.dependsOn?.includes(reference)) {
        throw new Error(`WORD_PLAN_UNDECLARED_DEPENDENCY:${step.id}:${reference}`)
      }
    }
  }
  return { ...plan, steps: orderWordPlanSteps(plan.steps) }
}

function collectStepReferenceIds(value: unknown, result = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return result
  if (!Array.isArray(value) && typeof (value as Record<string, unknown>).$step === 'string') {
    result.add((value as Record<string, unknown>).$step as string)
    return result
  }
  for (const item of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) {
    collectStepReferenceIds(item, result)
  }
  return result
}

/** Execution chunks preserve global order and plan identity while keeping SuperDoc limits local. */
export function chunkWordEditPlan(plan: WordEditPlan): WordEditPlan[] {
  const validated = validateWordEditPlan(plan)
  const chunks: WordEditPlan[] = []
  for (let index = 0; index < validated.steps.length; index += MAX_WORD_PLAN_STEPS) {
    chunks.push({
      ...validated,
      planId: validated.planId,
      steps: validated.steps.slice(index, index + MAX_WORD_PLAN_STEPS),
    })
  }
  return chunks
}

/** Visible time per step. Page transitions stay perceptible while dense local runs accelerate. */
export function wordStepDurationMs(total: number, samePage: boolean): number {
  if (total <= 1) return 900
  if (total <= 15) return Math.round(1100 - ((total - 1) / 14) * 400)
  if (total <= 60) return samePage ? 280 : 520
  return samePage ? Math.max(20, Math.round(22_000 / total)) : Math.max(80, Math.round(28_000 / total))
}

export class WordAgentPlaybackController {
  private state: WordPlaybackState = {
    phase: 'idle',
    completed: 0,
    total: 0,
    followAgent: true,
    skipAnimations: false,
  }

  private cancelled = false
  private softInterrupt: AgentUserDocumentActivity | null = null
  private pauseResolvers = new Set<() => void>()

  constructor(private readonly adapter: WordPlaybackAdapter) {}

  getState(): WordPlaybackState {
    return cloneState(this.state)
  }

  reportUserActivity(activity: AgentUserDocumentActivity): void {
    if (activity.kind === 'viewport' || activity.kind === 'selection') {
      this.patchState({ followAgent: false })
    }
    if (activity.kind === 'edit' && this.state.phase !== 'idle' && this.state.phase !== 'completed') {
      this.softInterrupt = activity
    }
  }

  control(control: WordPlaybackControl): WordPlaybackState {
    switch (control.type) {
      case 'pause':
        if (this.state.phase === 'running') this.patchState({ phase: 'paused' })
        break
      case 'resume':
        if (this.state.phase === 'paused') {
          this.patchState({ phase: 'running' })
          this.releasePauseGate()
        }
        break
      case 'locate':
        this.patchState({ followAgent: true })
        break
      case 'skip-animations':
        this.patchState({ skipAnimations: control.enabled ?? true })
        break
      case 'cancel':
        this.cancelled = true
        this.patchState({ phase: 'cancelled' })
        this.releasePauseGate()
        break
    }
    return this.getState()
  }

  async play(
    rawPlan: WordEditPlan,
    identity: Pick<WordPlaybackState, 'runId' | 'agentId' | 'agentName'> = {},
  ): Promise<WordPlaybackResult> {
    this.cancelled = false
    this.softInterrupt = null
    this.patchState({
      ...identity,
      phase: 'validating',
      completed: 0,
      total: rawPlan.steps?.length ?? 0,
      planId: rawPlan.planId,
      currentStepId: undefined,
      currentOperationId: undefined,
      currentAction: undefined,
      message: undefined,
    })

    let plan: WordEditPlan
    try {
      plan = validateWordEditPlan(rawPlan)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.patchState({ phase: 'failed', message })
      return this.result(rawPlan, [], [], rawPlan.steps ?? [], false, undefined, message)
    }

    if (plan.documentRevision !== this.adapter.getRevision()) {
      const message = `WORD_PLAN_REVISION_MISMATCH:${plan.documentRevision}:${this.adapter.getRevision()}`
      this.patchState({ phase: 'failed', message })
      return this.result(plan, [], [], plan.steps, true, undefined, message)
    }

    const preparedSteps: PreparedWordPlanStep[] = []
    let chunkResolvedTargets = 0
    let chunkSteps = 0
    try {
      for (let index = 0; index < plan.steps.length; index += 1) {
        const prepared = await this.adapter.prepare(plan.steps[index], { index, total: plan.steps.length })
        const targets = prepared.resolvedTargets ?? 1
        if (targets > MAX_WORD_PLAN_TARGETS) throw new Error('WORD_PLAN_TARGET_LIMIT')
        if (chunkSteps >= MAX_WORD_PLAN_STEPS || chunkResolvedTargets + targets > MAX_WORD_PLAN_TARGETS) {
          chunkSteps = 0
          chunkResolvedTargets = 0
        }
        chunkSteps += 1
        chunkResolvedTargets += targets
        preparedSteps.push(prepared)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.patchState({ phase: 'failed', message })
      return this.result(plan, [], [], plan.steps, false, undefined, message)
    }

    const applied: string[] = []
    const skipped: string[] = []
    this.patchState({ phase: 'running', total: preparedSteps.length })

    for (let index = 0; index < preparedSteps.length; index += 1) {
      const prepared = preparedSteps[index]
      if (this.cancelled) {
        return this.result(plan, applied, skipped, plan.steps.slice(index), false)
      }
      await this.waitWhilePaused()
      if (this.cancelled) return this.result(plan, applied, skipped, plan.steps.slice(index), false)

      const samePage = index > 0 && prepared.page !== undefined && prepared.page === preparedSteps[index - 1].page
      const duration = this.state.skipAnimations ? 0 : wordStepDurationMs(preparedSteps.length, samePage)
      this.patchState({
        currentStepId: prepared.step.id,
        currentOperationId: prepared.step.operationId,
        currentAction: prepared.step.label ?? prepared.step.operationId,
      })

      await this.adapter.onVisual?.('locate', prepared, this.getState())
      await delay(duration * 0.2)
      await this.waitWhilePaused()
      if (this.cancelled) return this.result(plan, applied, skipped, plan.steps.slice(index), false)
      await this.adapter.onVisual?.('before', prepared, this.getState())
      await delay(duration * 0.32)
      await this.waitWhilePaused()
      if (this.cancelled) {
        await this.adapter.onVisual?.('clear', prepared, this.getState())
        return this.result(plan, applied, skipped, plan.steps.slice(index), false)
      }
      if (this.softInterrupt) {
        await this.adapter.onVisual?.('clear', prepared, this.getState())
        const remaining = plan.steps.slice(index)
        this.patchState({ phase: 'interrupted', message: 'USER_EDIT_REPLAN_REQUIRED' })
        return this.result(plan, applied, skipped, remaining, remaining.length > 0, this.softInterrupt)
      }
      await this.adapter.onVisual?.('commit', prepared, this.getState())

      const stepResult = await this.adapter.commit(prepared, { index, total: preparedSteps.length })
      if (!stepResult.success && !stepResult.conflict && !stepResult.skipped) {
        const message = stepResult.error ?? `WORD_PLAN_STEP_FAILED:${prepared.step.id}`
        await this.adapter.onVisual?.('clear', prepared, this.getState())
        this.patchState({ phase: 'failed', message })
        return this.result(plan, applied, skipped, plan.steps.slice(index), false, undefined, message)
      }

      if (stepResult.skipped || stepResult.conflict) skipped.push(prepared.step.id)
      else applied.push(prepared.step.id)
      this.patchState({ completed: index + 1 })
      await this.waitWhilePaused()
      if (this.cancelled) {
        await this.adapter.onVisual?.('clear', prepared, this.getState())
        return this.result(plan, applied, skipped, plan.steps.slice(index + 1), false)
      }
      await this.adapter.onVisual?.('after', prepared, this.getState())
      await delay(duration * 0.48)
      await this.waitWhilePaused()
      await this.adapter.onVisual?.('clear', prepared, this.getState())

      if (this.softInterrupt) {
        const remaining = plan.steps.slice(index + 1)
        this.patchState({ phase: 'interrupted', message: 'USER_EDIT_REPLAN_REQUIRED' })
        return this.result(plan, applied, skipped, remaining, remaining.length > 0, this.softInterrupt)
      }
    }

    this.patchState({ phase: 'completed', currentStepId: undefined, currentOperationId: undefined, currentAction: undefined })
    return this.result(plan, applied, skipped, [], false)
  }

  private patchState(patch: Partial<WordPlaybackState>): void {
    this.state = { ...this.state, ...patch }
    this.adapter.onState?.(this.getState())
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.state.phase === 'paused' && !this.cancelled) {
      await new Promise<void>((resolve) => this.pauseResolvers.add(resolve))
    }
  }

  private releasePauseGate(): void {
    for (const resolve of this.pauseResolvers) resolve()
    this.pauseResolvers.clear()
  }

  private result(
    plan: WordEditPlan,
    appliedStepIds: string[],
    skippedStepIds: string[],
    remainingSteps: WordEditPlanStep[],
    requiresReplan: boolean,
    interruptedBy?: AgentUserDocumentActivity,
    error?: string,
  ): WordPlaybackResult {
    return {
      success: !error && !this.cancelled,
      planId: plan.planId,
      completed: appliedStepIds.length + skippedStepIds.length,
      total: plan.steps.length,
      appliedStepIds,
      skippedStepIds,
      remainingSteps,
      requiresReplan,
      interruptedBy,
      error: error ?? (this.cancelled ? 'AGENT_RUN_CANCELLED' : undefined),
    }
  }
}
