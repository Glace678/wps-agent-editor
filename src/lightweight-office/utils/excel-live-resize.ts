import { getFortuneLiveContext } from './fortune-rendering'

/**
 * Live preview for Fortune column/row resize drags.
 *
 * Fortune's native drag only moves a guide line and commits the new size on
 * mouseup, so the sheet content never reflows while dragging. This module
 * mirrors the drag and pushes the size through `applyOp` — Fortune's
 * history-free op channel — every animation frame, which re-runs the
 * visibledatacolumn/-row layout and repaints the canvas in real time.
 *
 * The blue resize guide line (.fortune-change-size-line and the header handle)
 * is locked to the rendered track edge (visibledatacolumn / visibledatarow)
 * rather than the raw unclamped cursor coordinate, so the blue line and the
 * worksheet grid line coincide to the exact pixel on every frame.
 */

interface FortuneFrozenRangeLike {
  row_focus?: number
  column_focus?: number
}

interface FortuneFrozenLike {
  type?: string
  range?: FortuneFrozenRangeLike
}

interface FortuneSheetLike {
  id?: string
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

const SUPPORTED_FROZEN_TYPES = new Set([
  'row',
  'column',
  'both',
  'rangeRow',
  'rangeColumn',
  'rangeBoth',
])

function isUnsupportedFrozen(frozen: unknown): boolean {
  if (!frozen) return false
  if (typeof frozen !== 'object') return true
  const type = (frozen as FortuneFrozenLike).type
  return typeof type !== 'string' || !SUPPORTED_FROZEN_TYPES.has(type)
}

function isAxisFrozen(axis: ResizeAxis, frozen: FortuneFrozenLike | undefined): boolean {
  if (!frozen?.type) return false
  if (axis === 'col') {
    return frozen.type === 'column'
      || frozen.type === 'rangeColumn'
      || frozen.type === 'both'
      || frozen.type === 'rangeBoth'
  }
  return frozen.type === 'row'
    || frozen.type === 'rangeRow'
    || frozen.type === 'both'
    || frozen.type === 'rangeBoth'
}

interface DragSession {
  axis: ResizeAxis
  index: number
  originalLen: number
  /** Snapshot of config.columnlen / rowlen restored if the drag is canceled. */
  originalMap: Record<string, number>
  /** Initial cumulative track edges (visibledatacolumn / visibledatarow). */
  edges: number[]
  startClient: number
  /** Fortune's luckysheet_*_change_size_start[0] (content coordinates). */
  startNative: number
  zoom: number
  inFreeze: boolean
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

function computeEdgesWithTrackLen(session: DragSession, len: number): number[] {
  const prevEdge = session.index > 0 ? (session.edges[session.index - 1] ?? 0) : 0
  const nextEdge = prevEdge + Math.round((len + 1) * session.zoom)
  const deltaEdge = nextEdge - (session.edges[session.index] ?? nextEdge)
  return session.edges.map((edge, i) => (i >= session.index ? edge + deltaEdge : edge))
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

  /**
   * Position Fortune's guide line (.fortune-change-size-line) and header handle
   * (.fortune-cols-change-size / .fortune-rows-change-size) at the exact
   * rendered track edge (`domEdge - 3` / `domEdge - 4`) so the 1px #0188fb
   * guide border lands on `[domEdge - 2, domEdge - 1]`, matching the 1px
   * worksheet grid line stroked by Canvas (`end - 2 + 0.5`).
   */
  const moveGuideLine = (_event?: MouseEvent) => {
    if (!session) return
    const header = shell.querySelector<HTMLElement>(
      session.axis === 'col' ? '.fortune-col-header' : '.fortune-row-header',
    )
    const line = shell.querySelector<HTMLElement>('.fortune-change-size-line')
    const handle = shell.querySelector<HTMLElement>(
      session.axis === 'col' ? '.fortune-cols-change-size' : '.fortune-rows-change-size',
    )
    if (!header) return
    const liveCtx = getFortuneLiveContext(shell)
    const liveEdges = session.axis === 'col'
      ? liveCtx?.visibledatacolumn
      : liveCtx?.visibledatarow
    const prevEdge = session.index > 0 ? (session.edges[session.index - 1] ?? 0) : 0
    const appliedLen = session.lastApplied ?? session.originalLen
    const fallbackEdge = prevEdge + Math.round((appliedLen + 1) * session.zoom)
    const renderedEdge = liveEdges?.[session.index] ?? fallbackEdge
    const scrollOffset = session.axis === 'col' ? header.scrollLeft : header.scrollTop
    const domEdge = renderedEdge + (session.inFreeze ? scrollOffset : 0)
    if (session.axis === 'col') {
      if (line) line.style.left = `${domEdge - 3}px`
      if (handle) handle.style.left = `${domEdge - 4}px`
    } else {
      if (line) line.style.top = `${domEdge - 3}px`
      if (handle) handle.style.top = `${domEdge - 4}px`
    }
  }

  const applyLen = (len: number) => {
    const api = getApi()
    if (!api || !session || session.lastApplied === len) return
    session.lastApplied = len
    shell.dataset.excelLiveResizeLen = String(len)
    const nextEdges = computeEdgesWithTrackLen(session, len)
    const totalSpan = (nextEdges[nextEdges.length - 1] ?? 0) + (session.axis === 'col' ? 120 : 80)
    // 拖拽预览只下发一次 applyOp，不使用 flushSync：强制同步渲染会让 Fortune
    // 在每个 pointermove 上全画布重排（连带右侧整块数字区），是卡顿根源。
    // 同时在同一个 op 批次内同步更新 visibledatacolumn/visibledatarow，避免
    // Sheet 被动 useEffect 二次渲染导致的 1 帧滞后。
    try {
      api.applyOp([
        {
          op: 'replace',
          path: ['config', session.axis === 'col' ? 'columnlen' : 'rowlen'],
          value: { ...session.originalMap, [session.index]: len },
        },
        {
          op: 'replace',
          path: [session.axis === 'col' ? 'visibledatacolumn' : 'visibledatarow'],
          value: nextEdges,
        },
        {
          op: 'replace',
          path: [session.axis === 'col' ? 'ch_width' : 'rh_height'],
          value: totalSpan,
        },
        {
          op: 'replace',
          path: [session.axis === 'col'
            ? 'luckysheet_cols_change_size_start'
            : 'luckysheet_rows_change_size_start'],
          value: [
            session.startNative + (len - session.originalLen) * session.zoom,
            session.index,
          ],
        },
      ])
      moveGuideLine()
    } catch {
      // A throwing op channel mid-drag must not leave listeners / a half-applied
      // resize behind: treat the drag as canceled and restore the original sizes.
      endSession(true)
    }
  }

  const onMove = (event: MouseEvent) => {
    if (!session) return
    // Exclusive drag capture: Fortune's own mousemove handlers dispatch
    // continuous-priority context updates that can sit skipped in the hook
    // queue when the discrete mouseup commit renders — and React's rebase
    // then re-executes the commit updater, double-recording the resize in
    // fortune-sheet's impure undo push. During a preview session we swallow
    // mousemove entirely and keep the guide line locked to the rendered track.
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
    const finished = session
    if (frame != null) {
      cancelAnimationFrame(frame)
      frame = null
    }
    if (restoreForCancel && session.lastApplied !== null) {
      // Canceled drag (window blur): no Fortune commit will follow, so put
      // the original sizes back ourselves.
      const { axis, originalMap, edges } = session
      const totalSpan = (edges[edges.length - 1] ?? 0) + (axis === 'col' ? 120 : 80)
      getApi()?.applyOp([
        {
          op: 'replace',
          path: ['config', axis === 'col' ? 'columnlen' : 'rowlen'],
          value: originalMap,
        },
        {
          op: 'replace',
          path: [axis === 'col' ? 'visibledatacolumn' : 'visibledatarow'],
          value: edges,
        },
        {
          op: 'replace',
          path: [axis === 'col' ? 'ch_width' : 'rh_height'],
          value: totalSpan,
        },
        {
          op: 'replace',
          path: [axis === 'col' ? 'luckysheet_cols_change_size' : 'luckysheet_rows_change_size'],
          value: false,
        },
      ])
    } else if (!restoreForCancel && finished.lastApplied !== null) {
      // After Fortune's bubble-phase handleOverlayMouseUp runs, ensure
      // sheet.config stays in sync with liveCtx.config even if the release
      // landed within Fortune's < 3px residual threshold (e.g. clamped at
      // MIN_TRACK_LEN = 10 or after a slight pointer recoil before mouseup).
      queueMicrotask(() => {
        const liveCtx = getFortuneLiveContext(shell)
        const sheet = getApi()?.getSheet()
        if (liveCtx?.config && sheet && sheet.config !== liveCtx.config) {
          sheet.config = {
            ...(sheet.config ?? {}),
            ...liveCtx.config,
          }
        }
        const header = shell.querySelector<HTMLElement>(
          finished.axis === 'col' ? '.fortune-col-header' : '.fortune-row-header',
        )
        const handle = shell.querySelector<HTMLElement>(
          finished.axis === 'col' ? '.fortune-cols-change-size' : '.fortune-rows-change-size',
        )
        const liveEdges = finished.axis === 'col'
          ? liveCtx?.visibledatacolumn
          : liveCtx?.visibledatarow
        const finalEdge = liveEdges?.[finished.index]
        if (header && handle && typeof finalEdge === 'number' && Number.isFinite(finalEdge)) {
          const scrollOffset = finished.axis === 'col' ? header.scrollLeft : header.scrollTop
          const domEdge = finalEdge + (finished.inFreeze ? scrollOffset : 0)
          if (finished.axis === 'col') handle.style.left = `${domEdge - 5}px`
          else handle.style.top = `${domEdge - 3}px`
        }
      })
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
    if (!api || !sheet || isUnsupportedFrozen(sheet.frozen) && sheet.frozen) return
    const liveCtx = getFortuneLiveContext(shell)
    const zoom = liveCtx?.zoomRatio ?? sheet.zoomRatio ?? 1
    const count = axis === 'col' ? (sheet.data?.[0]?.length ?? 0) : (sheet.data?.length ?? 0)
    if (count <= 0) return
    const header = shell.querySelector<HTMLElement>(
      axis === 'col' ? '.fortune-col-header' : '.fortune-row-header',
    )
    if (!header) return

    // If a prior drag exited early in handleOverlayMouseUp before syncing
    // ctx.luckysheetfile[idx].config = ctx.config, reconcile sheet.config first
    // so getColumnWidth/getRowHeight and originalMap read the true live sizes.
    if (liveCtx?.config && sheet.config !== liveCtx.config) {
      sheet.config = {
        ...(sheet.config ?? {}),
        ...liveCtx.config,
      }
    }

    const indices = Array.from({ length: count }, (_, i) => i)
    const lens = axis === 'col' ? api.getColumnWidth(indices) : api.getRowHeight(indices)
    const liveLenMap = axis === 'col' ? liveCtx?.config?.columnlen : liveCtx?.config?.rowlen
    if (liveLenMap) {
      for (const [k, v] of Object.entries(liveLenMap)) {
        const idx = Number(k)
        if (Number.isInteger(idx) && idx >= 0 && typeof v === 'number' && Number.isFinite(v)) {
          lens[idx] = v
        }
      }
    }
    const hidden = (axis === 'col'
      ? (liveCtx?.config?.colhidden ?? sheet.config?.colhidden)
      : (liveCtx?.config?.rowhidden ?? sheet.config?.rowhidden))
    const edges = computeTrackEdges(lens, hidden, count, zoom)

    // Header scroll offset mirrors ctx.scrollLeft / scrollTop (kept in sync by
    // Fortune), so this reproduces the content-coordinate x/y of the drag.
    const rect = header.getBoundingClientRect()
    const rawOffset = axis === 'col'
      ? event.clientX - rect.left
      : event.clientY - rect.top
    const startNative = axis === 'col'
      ? event.clientX - rect.left + header.scrollLeft
      : event.clientY - rect.top + header.scrollTop

    const frozen = sheet.frozen as FortuneFrozenLike | undefined
    const hasFreeze = isAxisFrozen(axis, frozen)
    const freezeFocus = axis === 'col'
      ? (frozen?.range?.column_focus ?? 0)
      : (frozen?.range?.row_focus ?? 0)
    const freezeBoundary = hasFreeze ? (edges[freezeFocus] ?? 0) : -1
    const inFreeze = Boolean(hasFreeze && rawOffset <= freezeBoundary + EDGE_TOLERANCE)
    const pointer = inFreeze ? rawOffset : startNative

    // Lookup the nearest track edge. Note that the 5px resize handle spans
    // across the track edge (e.g. [edge - 3, edge + 2] for rows and
    // [edge - 4, edge + 1] for cols), so clicks on the trailing side of the
    // handle have `pointer > edges[c]`, where `lowerBound` returns `c + 1`.
    // Always resolve `index` to whichever adjacent edge is closer!
    let index = lowerBound(edges, pointer)
    if (index >= edges.length) index = edges.length - 1
    const currentEdgeDist = Math.abs((edges[index] ?? Number.POSITIVE_INFINITY) - pointer)
    const prevEdgeDist = index > 0
      ? Math.abs((edges[index - 1] ?? Number.POSITIVE_INFINITY) - pointer)
      : Number.POSITIVE_INFINITY
    if (prevEdgeDist < currentEdgeDist) {
      index -= 1
    }

    // The press must sit on a track edge our model agrees with; if layouts
    // disagree (unexpected sheet state), fall back to native behavior.
    const nearestEdge = Math.min(currentEdgeDist, prevEdgeDist)
    if (nearestEdge > EDGE_TOLERANCE) {
      shell.dataset.excelLiveResize = `rejected:${axis}:${index}:${Math.round(nearestEdge)}`
      return
    }

    // Observability for tests (and post-mortem debugging).
    shell.dataset.excelLiveResize = `${axis}:${index}`
    const originalMapSource = axis === 'col'
      ? (liveCtx?.config?.columnlen ?? sheet.config?.columnlen)
      : (liveCtx?.config?.rowlen ?? sheet.config?.rowlen)
    session = {
      axis,
      index,
      originalLen: lens[index] ?? MIN_TRACK_LEN,
      originalMap: { ...(originalMapSource ?? {}) },
      edges,
      startClient: axis === 'col' ? event.clientX : event.clientY,
      startNative,
      zoom,
      inFreeze,
      lastApplied: null,
    }
    moveGuideLine(event)
    // Fortune's own bubble-phase onColSizeHandleMouseDown / onRowSizeHandleMouseDown
    // runs right after this capture listener. If `pointer > edges[index]`, Fortune's
    // sortedIndex lookup picked `index + 1` and placed `.fortune-change-size-line`
    // one track too far right; snap the guide line and start-index back immediately
    // after the mousedown dispatch finishes.
    const activeSession = session
    queueMicrotask(() => {
      if (session !== activeSession) return
      moveGuideLine(event)
      if (pointer > (edges[index] ?? Number.POSITIVE_INFINITY)) {
        try {
          getApi()?.applyOp([
            {
              op: 'replace',
              path: [axis === 'col'
                ? 'luckysheet_cols_change_size_start'
                : 'luckysheet_rows_change_size_start'],
              value: [activeSession.startNative, activeSession.index],
            },
          ])
        } catch {
          /* ignore if workbook unmounted */
        }
      }
    })
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
    // Teardown has no following Fortune commit, so treat it as a cancel and revert
    // any preview size that landed in config (otherwise it would be persisted).
    endSession(true)
  }
}
