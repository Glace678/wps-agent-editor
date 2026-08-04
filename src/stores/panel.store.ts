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

export const BOTTOM_PANEL_HEIGHT_KEY = 'wps-bottom-panel-height'
export const BOTTOM_PANEL_TAB_KEY = 'wps-bottom-panel-tab'

export const PANEL_MIN_HEIGHT = 96
export const PANEL_MAX_HEIGHT_RATIO = 0.55

function loadHeight(): number {
  try {
    const raw = localStorage.getItem(BOTTOM_PANEL_HEIGHT_KEY)
    const parsed = raw ? Number(raw) : 200
    return Number.isFinite(parsed) ? Math.max(PANEL_MIN_HEIGHT, Math.min(800, parsed)) : 200
  } catch {
    return 200
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
  navigateToLine: (line: number, column?: number) => void
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
    localStorage.setItem(BOTTOM_PANEL_TAB_KEY, tab)
    set({ tab })
  },
  openTab: (tab) => {
    localStorage.setItem(BOTTOM_PANEL_TAB_KEY, tab)
    set({ open: true, tab })
  },
  setHeight: (height) => {
    localStorage.setItem(BOTTOM_PANEL_HEIGHT_KEY, String(height))
    set({ height })
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
  navigateToLine: (line, column = 1) => {
    const nonce = Date.now()
    const next = get().pendingNavigation?.nonce ?? 0
    set({ pendingNavigation: { line, column, nonce: Math.max(nonce, next + 1) } })
  },
}))
