import type { AgentCollaborationEvent } from '@/types/agent'

/**
 * Maximum number of collaboration trace events retained in memory per store.
 * Previously this was a blind 500, so long multi-agent runs silently lost
 * their early events — including task and system lines — from both the
 * transcript and the cache-usage totals (wps_06 D2).
 */
export const COLLABORATION_EVENT_LIMIT = 2000

/**
 * Trim the trace to at most {@link COLLABORATION_EVENT_LIMIT} events.
 *
 * The oldest ordinary events are dropped, but each run's `run-start` boundary
 * and previously inserted truncation markers are protected, so no retained run
 * can lose its opening. For every run that loses events, an
 * `events-truncated` marker is inserted right after that run's `run-start`
 * (or before its first surviving event); the marker carries the number of
 * dropped events. Token-usage totals of dropped events are lost by design —
 * that is the unavoidable part of a fixed cap — but the UI can now show that
 * the trace was trimmed instead of silently presenting a partial history.
 */
export function capCollaborationEvents(
  events: AgentCollaborationEvent[],
): AgentCollaborationEvent[] {
  if (events.length <= COLLABORATION_EVENT_LIMIT) return events

  const targetDropCount = events.length - COLLABORATION_EVENT_LIMIT
  const isProtected = (event: AgentCollaborationEvent): boolean =>
    event.type === 'run-start' || event.type === 'events-truncated'

  // Greedily select the oldest drop-eligible events. Only when the trace is
  // pathologically full of protected events do we fall back to dropping the
  // oldest entries regardless.
  const dropIndexes = new Set<number>()
  for (let pass = 0; pass < 2 && dropIndexes.size < targetDropCount; pass++) {
    for (let i = 0; i < events.length && dropIndexes.size < targetDropCount; i++) {
      if (dropIndexes.has(i)) continue
      if (pass === 0 && isProtected(events[i]!)) continue
      dropIndexes.add(i)
    }
  }

  const droppedCountByRun = new Map<string, number>()
  for (const index of dropIndexes) {
    const runId = events[index]!.runId
    droppedCountByRun.set(runId, (droppedCountByRun.get(runId) ?? 0) + 1)
  }

  const runsNeedingMarker = new Set(droppedCountByRun.keys())
  const markedRuns = new Set<string>()
  const output: AgentCollaborationEvent[] = []

  const markerFor = (
    runId: string,
    anchor: AgentCollaborationEvent,
  ): AgentCollaborationEvent => ({
    runId,
    windowLabel: anchor.windowLabel,
    type: 'events-truncated',
    timestamp: anchor.timestamp,
    content: String(droppedCountByRun.get(runId) ?? 0),
  })

  const insertMarkerIfNeeded = (runId: string, anchor: AgentCollaborationEvent) => {
    if (!runsNeedingMarker.has(runId) || markedRuns.has(runId)) return
    output.push(markerFor(runId, anchor))
    markedRuns.add(runId)
  }

  for (let i = 0; i < events.length; i++) {
    if (dropIndexes.has(i)) continue
    const event = events[i]!
    // Prefer the marker immediately after run-start; otherwise before this
    // run's first surviving event.
    output.push(event)
    if (event.type === 'run-start') insertMarkerIfNeeded(event.runId, event)
    insertMarkerIfNeeded(event.runId, event)
  }
  return output
}
