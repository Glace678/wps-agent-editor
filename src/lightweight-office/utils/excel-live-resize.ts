import { flushSync } from 'react-dom'

/**
 * Live preview for Fortune column/row resize drags.
 *
 * Fortune's native drag only moves a guide line and commits the new size on
 * mouseup, so the sheet content never reflows while dragging. This module
 * mirrors the drag and pushes the size through `applyOp` — Fortune's
 * history-free op channel — every animation frame, which re-runs the
 * visibledatacolumn/-row layout and repaints the canvas in real time.
 *
 * On mouseup (capture phase, i.e. BEFORE Fortune's own bubble-phase commit)
 * the original size map is restored so that:
 *  - Fortune's commit computes `original + delta` (no double apply), and
 *  - undo history / collaboration ops stay exactly as without the preview:
 *    a single native entry per resize.
 * Restore and commit run inside the same mouseup dispatch, so React batches
 * them into one render — no visible flicker.
 *
 * Frozen panes shift drag coordinates (fixPositionOnFrozenCells); for frozen
 * sheets the preview backs off and Fortune's native behavior is untouched.
 */

interface FortuneSheetLike {
  frozen?: unknown
  zoomRatio?: number
  data?: unknown[][]
  config?: {
    columnlen?: Record<string, number>
    rowlen?: Record<string, number>
    colhidden?: Record<string, number>
    rowhidden?: Record<string, number>
  }
}

export interface FortuneWorkbookApiLike {
  applyOp(ops: Array<{ op: string; path: Array<string | number>; value: unknown }>): void
  getSheet(): FortuneSheetLike | null | undefined
  getColumnWidth(columns: number[]): Record<number, number>
  getRowHeight(rows: number[]): Record<number, number>
}

type ResizeAxis = 'col' | 'row'

/** Fortune clamps resized tracks to 10px minimum (handleOverlayMouseUp). */
const MIN_TRACK_LEN = 10
/** The native grab handle spans ~10px around a track edge. */
const EDGE_TOLERANCE = 8
/**
 * The preview stays this many px behind the cursor. Fortune's mouseup commit
 * skips deltas under 3px; the lag keeps the residual delta above the
 * threshold so the native commit always finalizes (and writes the sheet file
 * config + the single undo entry). Visually the release snap is imperceptible.
 */
const PREVIEW_LAG = 5

interface DragSession {
  axis: ResizeAxis
  index: number
  originalLen: number
  /** Snapshot of config.columnlen / rowlen restored if the drag is canceled. */
  originalMap: Record<string, number>
  startClient: number
  /** Fortune's luckysheet_*_change_size_start[0] (content coordinates). */
  startNative: number
  zoom: number
  lastApplied: number | null
}

/** lodash sortedIndex equivalent — Fortune uses it in col/rowLocation. */
function lowerBound(sorted: number[], value: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Mirror calcRowColSize: cumulative far edges of each track, zoom applied. */
function computeTrackEdges(
  lens: Record<number, number>,
  hidden: Record<string, number> | undefined,
  count: number,
  zoom: number,
): number[] {
  const edges: number[] = []
  let acc = 0
  for (let i = 0; i < count; i += 1) {
    if (hidden?.[i] != null) {
      edges.push(acc)
      continue
    }
    acc += Math.round(((lens[i] ?? 0) + 1) * zoom)
    edges.push(acc)
  }
  return edges
}

/**
 * Attach live resize preview to the Excel shell. Returns a cleanup function.
 * `getApi` is read per event so Workbook remounts (file/language key changes)
 * do not stale the handle.
 */
export function attachExcelLiveResize(
  shell: HTMLElement,
  getApi: () => FortuneWorkbookApiLike | null,
): () => void {
  let session: DragSession | null = null
  let frame: number | null = null
  let pendingClient = 0

  const applyLen = (len: number) => {
    const api = getApi()
    if (!api || !session || session.lastApplied === len) return
    session.lastApplied = len
    shell.dataset.excelLiveResizeLen = String(len)
    // Two patches per frame, atomically:
    //  - the previewed track size (content reflows immediately);
    //  - Fortune's drag-start marker, advanced by the applied delta, so its
    //    own mouseup commit computes original + total-delta from the previewed
    //    state. The preview therefore needs NO restore dispatch at mouseup —
    //    the commit runs under exactly the native queue conditions, which is
    //    what keeps fortune-sheet's impure undo push from double-recording
    //    (React re-executes updaters that share a queue with a skipped one).
    // flushSync keeps every preview apply synchronous so no low-priority
    // preview update is ever pending when the discrete commit dispatches.
    flushSync(() => {
      api.applyOp([
        {
          op: 'replace',
          path: ['config', session!.axis === 'col' ? 'columnlen' : 'rowlen'],
          value: { ...session!.originalMap, [session!.index]: len },
        },
        {
          op: 'replace',
          path: [session!.axis === 'col'
            ? 'luckysheet_cols_change_size_start'
            : 'luckysheet_rows_change_size_start'],
          value: [
            session!.startNative + (len - session!.originalLen) * session!.zoom,
            session!.index,
          ],
        },
      ])
    })
  }

  /** Mirror Fortune's own guide-line DOM updates (mouseRender) for the axis. */
  const moveGuideLine = (event: MouseEvent) => {
    if (!session) return
    const header = shell.querySelector<HTMLElement>(
      session.axis === 'col' ? '.fortune-col-header' : '.fortune-row-header',
    )
    const line = shell.querySelector<HTMLElement>('.fortune-change-size-line')
    const handle = shell.querySelector<HTMLElement>(
      session.axis === 'col' ? '.fortune-cols-change-size' : '.fortune-rows-change-size',
    )
    if (!header) return
    const rect = header.getBoundingClientRect()
    if (session.axis === 'col') {
      const x = event.clientX - rect.left + header.scrollLeft
      if (line) line.style.left = `${x}px`
      if (handle) handle.style.left = `${x - 2}px`
    } else {
      const y = event.clientY - rect.top + header.scrollTop
      if (line) line.style.top = `${y}px`
      if (handle) handle.style.top = `${y}px`
    }
  }

  const onMove = (event: MouseEvent) => {
    if (!session) return
    // Exclusive drag capture: Fortune's own mousemove handlers dispatch
    // continuous-priority context updates that can sit skipped in the hook
    // queue when the discrete mouseup commit renders — and React's rebase
    // then re-executes the commit updater, double-recording the resize in
    // fortune-sheet's impure undo push. During a preview session we swallow
    // mousemove entirely and reproduce the only thing Fortune's move handler
    // does mid-drag: tracking the guide line / handle DOM styles.
    event.stopPropagation()
    moveGuideLine(event)
    pendingClient = session.axis === 'col' ? event.clientX : event.clientY
    if (frame != null) return
    frame = requestAnimationFrame(() => {
      frame = null
      if (!session) return
      const delta = (pendingClient - session.startClient) / session.zoom
      applyLen(Math.max(
        MIN_TRACK_LEN,
        Math.round(session.originalLen + delta) - PREVIEW_LAG,
      ))
    })
  }

  const endSession = (restoreForCancel: boolean) => {
    if (!session) return
    if (frame != null) {
      cancelAnimationFrame(frame)
      frame = null
    }
    if (restoreForCancel && session.lastApplied !== null) {
      // Canceled drag (window blur): no Fortune commit will follow, so put
      // the original sizes back ourselves.
      const { axis, originalMap } = session
      getApi()?.applyOp([{
        op: 'replace',
        path: ['config', axis === 'col' ? 'columnlen' : 'rowlen'],
        value: originalMap,
      }])
    }
    session = null
    shell.dataset.excelLiveResize = 'idle'
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('mouseup', onUp, true)
    window.removeEventListener('blur', onBlur)
  }

  // Normal release performs NO state dispatch here: the preview already
  // advanced Fortune's drag-start marker, so Fortune's own bubble-phase
  // commit finalizes original + total delta under native queue conditions.
  const onUp = () => endSession(false)
  const onBlur = () => endSession(true)

  const beginSession = (axis: ResizeAxis, event: MouseEvent) => {
    const api = getApi()
    const sheet = api?.getSheet()
    if (!api || !sheet || sheet.frozen) return
    const zoom = sheet.zoomRatio ?? 1
    const count = axis === 'col' ? (sheet.data?.[0]?.length ?? 0) : (sheet.data?.length ?? 0)
    if (count <= 0) return
    const header = shell.querySelector<HTMLElement>(
      axis === 'col' ? '.fortune-col-header' : '.fortune-row-header',
    )
    if (!header) return

    // Header scroll offset mirrors ctx.scrollLeft / scrollTop (kept in sync by
    // Fortune), so this reproduces the content-coordinate x/y of the drag.
    const rect = header.getBoundingClientRect()
    const pointer = axis === 'col'
      ? event.clientX - rect.left + header.scrollLeft
      : event.clientY - rect.top + header.scrollTop

    const indices = Array.from({ length: count }, (_, i) => i)
    const lens = axis === 'col' ? api.getColumnWidth(indices) : api.getRowHeight(indices)
    const hidden = axis === 'col' ? sheet.config?.colhidden : sheet.config?.rowhidden
    const edges = computeTrackEdges(lens, hidden, count, zoom)

    // Same lookup Fortune performs in col/rowLocation on the native mousedown.
    let index = lowerBound(edges, pointer)
    if (index >= edges.length) index = edges.length - 1

    // The press must sit on a track edge our model agrees with; if layouts
    // disagree (unexpected sheet state), fall back to native behavior.
    const nearestEdge = Math.min(
      Math.abs((edges[index] ?? Number.POSITIVE_INFINITY) - pointer),
      Math.abs((index > 0 ? edges[index - 1] : 0) - pointer),
    )
    if (nearestEdge > EDGE_TOLERANCE) {
      shell.dataset.excelLiveResize = `rejected:${axis}:${index}:${Math.round(nearestEdge)}`
      return
    }

    // Observability for tests (and post-mortem debugging).
    shell.dataset.excelLiveResize = `${axis}:${index}`
    const originalMapSource = axis === 'col' ? sheet.config?.columnlen : sheet.config?.rowlen
    session = {
      axis,
      index,
      originalLen: lens[index] ?? MIN_TRACK_LEN,
      originalMap: { ...(originalMapSource ?? {}) },
      startClient: axis === 'col' ? event.clientX : event.clientY,
      startNative: pointer,
      zoom,
      lastApplied: null,
    }
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseup', onUp, true)
    window.addEventListener('blur', onBlur)
  }

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || session) return
    const target = event.target instanceof Element ? event.target : null
    if (!target) return
    if (target.closest('.fortune-cols-change-size')) beginSession('col', event)
    else if (target.closest('.fortune-rows-change-size')) beginSession('row', event)
  }

  shell.addEventListener('mousedown', onMouseDown, true)
  return () => {
    shell.removeEventListener('mousedown', onMouseDown, true)
    endSession(false)
  }
}
