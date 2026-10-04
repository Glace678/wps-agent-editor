export interface LiveOperationContext {
  operationId: string
  runId?: string
}

/** Serializes visible edits and lets the user stop a run between operations. */
export class LiveOperationQueue {
  // Bound the cancelled-run markers so an unbounded stream of external runIds
  // cannot grow the set (and process memory) without limit.
  private static readonly MAX_CANCELLED_RUNS = 1000

  private tail: Promise<void> = Promise.resolve()
  private readonly cancelledRuns = new Set<string>()

  enqueue<T>(context: LiveOperationContext, operation: () => Promise<T> | T): Promise<T> {
    const execute = async (): Promise<T> => {
      if (context.runId && this.cancelledRuns.has(context.runId)) {
        throw new Error('AGENT_RUN_CANCELLED')
      }
      return operation()
    }
    const result = this.tail.then(execute, execute)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  cancelRun(runId: string): void {
    this.cancelledRuns.add(runId)
    // Evict the oldest markers (Set preserves insertion order) once over cap.
    if (this.cancelledRuns.size > LiveOperationQueue.MAX_CANCELLED_RUNS) {
      const oldest = this.cancelledRuns.values().next().value
      if (oldest !== undefined) this.cancelledRuns.delete(oldest)
    }
  }

  clearRun(runId: string): void {
    this.cancelledRuns.delete(runId)
  }

  isCancelled(runId?: string): boolean {
    return Boolean(runId && this.cancelledRuns.has(runId))
  }
}
