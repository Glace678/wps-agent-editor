import { create } from 'zustand'
import type {
  DebugEvent,
  DebugFrame,
  DebugStatus,
  DebugVariable,
} from '@/types/code'

export const BREAKPOINT_STORAGE_KEY = 'wps-code-breakpoints'

export interface DebugConsoleLine {
  id: string
  kind: 'out' | 'err' | 'eval' | 'system'
  text: string
}

type BreakpointMap = Record<string, number[]>

function loadBreakpoints(): BreakpointMap {
  try {
    const raw = localStorage.getItem(BREAKPOINT_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as BreakpointMap
    const result: BreakpointMap = {}
    for (const [file, lines] of Object.entries(parsed)) {
      const normalized = (Array.isArray(lines) ? lines : [])
        .filter((line): line is number => Number.isInteger(line) && line > 0)
        .sort((a, b) => a - b)
      if (normalized.length > 0) result[file] = normalized
    }
    return result
  } catch {
    return {}
  }
}

function persistBreakpoints(breakpoints: BreakpointMap): void {
  try {
    localStorage.setItem(BREAKPOINT_STORAGE_KEY, JSON.stringify(breakpoints))
  } catch {
    // ignore
  }
}

let consoleId = 0

interface DebugState {
  status: DebugStatus
  kind: 'node' | 'python' | null
  sessionFile: string | null
  /** 当前暂停执行所在文件（用于行高亮） */
  currentFile: string | null
  currentLine: number | null
  frames: DebugFrame[]
  variables: DebugVariable[]
  breakpoints: BreakpointMap
  consoleLines: DebugConsoleLine[]
  statusMessage: string

  toggleBreakpoint: (file: string, line: number) => void
  clearBreakpoints: (file: string) => void
  startSession: (file: string, kind: 'node' | 'python') => void
  setStatus: (status: DebugStatus, message?: string) => void
  setPaused: (frames: DebugFrame[], variables: DebugVariable[]) => void
  setResumed: () => void
  endSession: (message?: string) => void
  addConsoleLine: (line: Omit<DebugConsoleLine, 'id'>) => void
  clearConsole: () => void
}

export const useDebugStore = create<DebugState>((set, get) => ({
  status: 'idle',
  kind: null,
  sessionFile: null,
  currentFile: null,
  currentLine: null,
  frames: [],
  variables: [],
  breakpoints: loadBreakpoints(),
  consoleLines: [],
  statusMessage: '',

  toggleBreakpoint: (file, line) => {
    const breakpoints = { ...get().breakpoints }
    const lines = [...(breakpoints[file] ?? [])]
    const index = lines.indexOf(line)
    if (index >= 0) {
      lines.splice(index, 1)
    } else {
      lines.push(line)
      lines.sort((a, b) => a - b)
    }
    if (lines.length === 0) delete breakpoints[file]
    else breakpoints[file] = lines
    persistBreakpoints(breakpoints)
    set({ breakpoints })
  },

  clearBreakpoints: (file) => {
    const breakpoints = { ...get().breakpoints }
    if (breakpoints[file]) {
      delete breakpoints[file]
      persistBreakpoints(breakpoints)
      set({ breakpoints })
    }
  },

  startSession: (file, kind) => {
    consoleId += 1
    set({
      status: 'running',
      kind,
      sessionFile: file,
      currentFile: null,
      currentLine: null,
      frames: [],
      variables: [],
      statusMessage: '',
      consoleLines: [{ id: `c${consoleId}`, kind: 'system', text: `调试会话已启动: ${file}` }],
    })
  },

  setStatus: (status, message) => set({ status, statusMessage: message ?? '' }),

  setPaused: (frames, variables) => {
    const top = frames[0]
    set({
      status: 'paused',
      frames,
      variables,
      currentFile: top?.file || null,
      currentLine: top?.line ?? null,
      statusMessage: '已暂停',
    })
  },

  setResumed: () => {
    set({
      status: 'running',
      currentFile: null,
      currentLine: null,
      frames: [],
      variables: [],
      statusMessage: '运行中',
    })
  },

  endSession: (message) => {
    consoleId += 1
    set((state) => ({
      status: 'idle',
      kind: null,
      sessionFile: null,
      currentFile: null,
      currentLine: null,
      frames: [],
      variables: [],
      statusMessage: message ?? '',
      consoleLines: message
        ? [...state.consoleLines, { id: `c${consoleId}`, kind: 'system', text: message }]
        : state.consoleLines,
    }))
  },

  addConsoleLine: (line) => {
    consoleId += 1
    set((state) => ({
      consoleLines: [...state.consoleLines, { ...line, id: `c${consoleId}` }].slice(-2000),
    }))
  },

  clearConsole: () => set({ consoleLines: [] }),
}))

export function handleDebugEvent(event: DebugEvent): void {
  const store = useDebugStore.getState()
  switch (event.event) {
    case 'started':
      // Session already marked by startSession()
      break
    case 'output':
      store.addConsoleLine({ kind: event.kind === 'stderr' ? 'err' : 'out', text: event.text })
      break
    case 'paused':
      store.setPaused(event.frames, event.variables)
      break
    case 'resumed':
      store.setResumed()
      break
    case 'breakpoint-verified':
      break
    case 'eval-result':
      if (event.error !== undefined) {
        store.addConsoleLine({ kind: 'err', text: event.error })
      } else if (event.result !== undefined) {
        store.addConsoleLine({ kind: 'eval', text: event.result })
      }
      break
    case 'error':
      store.addConsoleLine({ kind: 'err', text: event.message })
      store.setStatus('error', event.message)
      break
    case 'exit':
      store.endSession('调试会话已结束。')
      break
  }
}
