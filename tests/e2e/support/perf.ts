// D3: heavy interaction paths are measured against explicit perf budgets and
// reported as *performance regressions* (a distinct failure with a
// perf-report attachment), rather than being hidden behind an inflated
// test.setTimeout. Budgets widen in CI via WAE_PERF_BUDGET_FACTOR (a float
// multiplier, e.g. 2.5).
import type { TestInfo } from '@playwright/test'

interface PerfRecord {
  name: string
  durationMs: number
  budgetMs: number
}

const recordsByTest = new Map<string, PerfRecord[]>()

const ciFactor = () => {
  const value = Number(process.env.WAE_PERF_BUDGET_FACTOR)
  return Number.isFinite(value) && value >= 1 ? value : 1
}

export function effectiveBudget(localBudgetMs: number): number {
  return Math.round(localBudgetMs * ciFactor())
}

/** Run `fn`, recording its duration against `localBudgetMs`. */
export async function perfBudget<T>(
  testInfo: TestInfo,
  name: string,
  localBudgetMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    const durationMs = performance.now() - start
    const key = testInfo.testId
    const list = recordsByTest.get(key) ?? []
    list.push({ name, durationMs, budgetMs: effectiveBudget(localBudgetMs) })
    recordsByTest.set(key, list)
  }
}

/**
 * Attach the perf report and fail with a performance-regression message when
 * any measured leg exceeded its budget. Call from the test after its
 * functional assertions, so a slow leg is never masked by test timeout.
 */
export function assertPerfBudgets(testInfo: TestInfo): void {
  const records = recordsByTest.get(testInfo.testId) ?? []
  if (records.length === 0) return
  const report = records.map((record) => ({
    leg: record.name,
    durationMs: Math.round(record.durationMs),
    budgetMs: record.budgetMs,
    overBudgetMs: Math.round(record.durationMs - record.budgetMs),
  }))
  testInfo.attach('perf-report.json', {
    body: JSON.stringify({ ciFactor: ciFactor(), legs: report }, null, 2),
    contentType: 'application/json',
  })
  const regressions = report.filter((record) => record.overBudgetMs > 0)
  if (regressions.length > 0) {
    throw new Error(
      `Performance regression in: ${regressions
        .map((record) => `${record.leg} (${record.durationMs}ms > ${record.budgetMs}ms budget)`)
        .join('; ')}. See perf-report.json attachment.`,
    )
  }
}
