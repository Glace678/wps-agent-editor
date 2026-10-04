import { create } from 'zustand'

export type BottomPanelTab = 'problems' | 'output' | 'debug-console' | 'terminal' | 'references'

export interface ReferenceItem {
  line: number
  column: number
  preview: string
}

export interface RunOutputData {
  text: string
  command: string
  exitCode: number | null
  success: boolean
  errorCode?: string
}

export const BOTTOM_PANEL_HEIGHT_KEY = 'officeagentic-bottom-panel-height'
export const BOTTOM_PANEL_TAB_KEY = 'officeagentic-bottom-panel-tab'

export const PANEL_MIN_HEIGHT = 96
export const PANEL_MAX_HEIGHT_RATIO = 0.55

function clampHeight(height: number): number {
  return Number.isFinite(height) ? Math.max(PANEL_MIN_HEIGHT, Math.min(800, height)) : 200
}

function loadHeight(): number {
  try {
    const raw = localStorage.getItem(BOTTOM_PANEL_HEIGHT_KEY)
    return clampHeight(raw ? Number(raw) : 200)
  } catch {
    return 200
  }
}

/** Fault-tolerant write: in-memory state must never depend on storage success. */
function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable (private mode / quota / security policy).
  }
}

function loadTab(): BottomPanelTab {
  try {
    const raw = localStorage.getItem(BOTTOM_PANEL_TAB_KEY)
    if (raw === 'problems' || raw === 'output' || raw === 'debug-console' || raw === 'terminal' || raw === 'references') {
      return raw
    }
  } catch {
    // ignore
  }
  return 'output'
}

interface PanelState {
  open: boolean
  tab: BottomPanelTab
  height: number
  outputText: string
  runOutput: RunOutputData | null
  referencesSymbol: string
  references: ReferenceItem[]
  pendingNavigation: { line: number; column: number; file?: string; nonce: number } | null

  setOpen: (open: boolean) => void
  toggleOpen: () => void
  setTab: (tab: BottomPanelTab) => void
  openTab: (tab: BottomPanelTab) => void
  setHeight: (height: number) => void
  showRunResult: (output: RunOutputData) => void
  clearOutput: () => void
  setReferences: (symbol: string, items: ReferenceItem[]) => void
  navigateToLine: (line: number, column?: number, file?: string) => void
}

export const usePanelStore = create<PanelState>((set, get) => ({
  open: false,
  tab: loadTab(),
  height: loadHeight(),
  outputText: '',
  runOutput: null,
  referencesSymbol: '',
  references: [],
  pendingNavigation: null,

  setOpen: (open) => set({ open }),
  toggleOpen: () => set((state) => ({ open: !state.open })),
  setTab: (tab) => {
    set({ tab })
    persist(BOTTOM_PANEL_TAB_KEY, tab)
  },
  openTab: (tab) => {
    set({ open: true, tab })
    persist(BOTTOM_PANEL_TAB_KEY, tab)
  },
  setHeight: (height) => {
    // Reuse the same finite-check + clamp as the restore path so the current
    // session never persists an out-of-range / non-finite height.
    const clamped = clampHeight(height)
    set({ height: clamped })
    persist(BOTTOM_PANEL_HEIGHT_KEY, String(clamped))
  },
  showRunResult: (output) => {
    set({
      outputText: output.text,
      runOutput: output,
      open: true,
      tab: 'output',
    })
  },
  clearOutput: () => set({ outputText: '', runOutput: null }),
  setReferences: (symbol, items) => {
    set({ referencesSymbol: symbol, references: items, open: true, tab: 'references' })
  },
  navigateToLine: (line, column = 1, file) => {
    const nonce = Date.now()
    const next = get().pendingNavigation?.nonce ?? 0
    set({ pendingNavigation: { line, column, file, nonce: Math.max(nonce, next + 1) } })
  },
}))
