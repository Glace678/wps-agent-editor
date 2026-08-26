import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bug,
  ChevronDown,
  CircleAlert,
  Copy,
  SquareTerminal,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslation } from '@/lib/i18n/runtime'
import { usePanelStore, type BottomPanelTab, PANEL_MAX_HEIGHT_RATIO, PANEL_MIN_HEIGHT } from '@/stores/panel.store'
import { handleDebugEvent, useDebugStore } from '@/stores/debug.store'
import type { DebugEvent } from '@/types/code'
import { ProblemsView } from './panel/ProblemsView'
import { DebugConsoleView } from './panel/DebugConsoleView'
import { TerminalView } from './panel/TerminalView'
import { ReferencesView } from './panel/ReferencesView'

function OutputView() {
  const { t } = useTranslation()
  const outputText = usePanelStore((s) => s.outputText)

  return (
    <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs leading-5">
      {outputText || t('bottomPanel.noOutput')}
    </pre>
  )
}

export function BottomPanel() {
  const { t } = useTranslation()
  const open = usePanelStore((s) => s.open)
  const tab = usePanelStore((s) => s.tab)
  const height = usePanelStore((s) => s.height)
  const setTab = usePanelStore((s) => s.setTab)
  const setOpen = usePanelStore((s) => s.setOpen)
  const setHeight = usePanelStore((s) => s.setHeight)
  const references = usePanelStore((s) => s.references)
  const clearOutput = usePanelStore((s) => s.clearOutput)
  const clearConsole = useDebugStore((s) => s.clearConsole)
  const consoleLines = useDebugStore((s) => s.consoleLines)
  const debugStatus = useDebugStore((s) => s.status)
  const [problemCount, setProblemCount] = useState(0)
  const resizeRef = useRef<{ cleanup: (() => void) | null }>({ cleanup: null })
  useEffect(() => {
    const disposeDebug = window.api
      ? window.api.on('lw:debug-event', (payload) => handleDebugEvent(payload as DebugEvent))
      : () => {}
    const disposeTerminal = window.api ? window.api.on('lw:terminal-event', () => {}) : () => {}
    return () => {
      disposeDebug()
      disposeTerminal()
    }
  }, [])

  const startResize = useCallback((startY: number) => {
    const onMove = (event: MouseEvent) => {
      const next = window.innerHeight - event.clientY
      const clamped = Math.min(
        Math.max(next, PANEL_MIN_HEIGHT),
        window.innerHeight * PANEL_MAX_HEIGHT_RATIO,
      )
      setHeight(clamped)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      resizeRef.current.cleanup = null
    }
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    resizeRef.current.cleanup = onUp
  }, [setHeight])

  useEffect(() => () => {
    resizeRef.current.cleanup?.()
  }, [])

  const tabs = useMemo(() => {
    const items: Array<{ id: BottomPanelTab; label: string; icon: React.ReactNode }> = [
      {
        id: 'problems',
        label: t('bottomPanel.problems'),
        icon: <CircleAlert className="h-3.5 w-3.5" />,
      },
      { id: 'output', label: t('bottomPanel.output'), icon: <Terminal className="h-3.5 w-3.5" /> },
      {
        id: 'debug-console',
        label: t('bottomPanel.debugConsole'),
        icon: <Bug className="h-3.5 w-3.5" />,
      },
      {
        id: 'terminal',
        label: t('bottomPanel.terminal'),
        icon: <SquareTerminal className="h-3.5 w-3.5" />,
      },
    ]
    if (references.length > 0) {
      items.push({
        id: 'references',
        label: `${t('bottomPanel.references')} (${references.length})`,
        icon: <Copy className="h-3.5 w-3.5" />,
      })
    }
    return items
  }, [t, references.length])

  if (!open) return null

  return (
    <TooltipProvider delayDuration={450}>
      <div
        className="flex shrink-0 flex-col border-t bg-card text-foreground"
        style={{ height }}
        data-testid="bottom-panel"
      >
        <div
          className="h-[4px] shrink-0 cursor-ns-resize bg-transparent hover:bg-primary/40 active:bg-primary/60"
          onMouseDown={(event) => {
            event.preventDefault()
            startResize(event.clientY)
          }}
          data-testid="bottom-panel-resize-handle"
        />
        <div className="flex h-7 shrink-0 items-center border-b px-2">
          {tabs.map((item) => {
            const active = tab === item.id
            return (
              <button
                type="button"
                key={item.id}
                className={`flex h-full items-center gap-1.5 border-b-2 px-2 text-xs transition-colors ${
                  active
                    ? 'border-primary bg-accent/50 font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setTab(item.id)}
                data-testid={`bottom-tab-${item.id}`}
              >
                {item.icon}
                {item.label}
                {item.id === 'problems' && problemCount > 0 && (
                  <span className="text-[10px] text-muted-foreground">{problemCount}</span>
                )}
              </button>
            )
          })}
          <div className="ml-auto flex items-center gap-0.5">
            {tab === 'output' && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={clearOutput}
                  aria-label={t('bottomPanel.clearOutput')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => void navigator.clipboard.writeText(usePanelStore.getState().outputText)}
                  disabled={!usePanelStore.getState().outputText}
                  aria-label={t('bottomPanel.copyOutput')}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
            {tab === 'debug-console' && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={clearConsole}
                disabled={consoleLines.length === 0}
                aria-label={t('bottomPanel.clearConsole')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            {tab === 'references' && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  usePanelStore.getState().setReferences('', [])
                  setTab('output')
                }}
                aria-label={t('bottomPanel.clearReferences')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            {tab === 'terminal' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => void window.api.lw.terminalKill()}
                    aria-label={t('bottomPanel.killTerminal')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('bottomPanel.killTerminal')}</TooltipContent>
              </Tooltip>
            )}
            {debugStatus !== 'idle' && tab !== 'debug-console' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setTab('debug-console')}
                    aria-label={t('bottomPanel.debugConsole')}
                  >
                    <Bug className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('bottomPanel.debugConsole')}</TooltipContent>
              </Tooltip>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setOpen(false)}
              aria-label={t('bottomPanel.closePanel')}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {tab === 'problems' && <ProblemsView onCountChange={setProblemCount} />}
          {tab === 'output' && <OutputView />}
          {tab === 'debug-console' && <DebugConsoleView />}
          {tab === 'terminal' && <TerminalView />}
          {tab === 'references' && <ReferencesView />}
        </div>
      </div>
    </TooltipProvider>
  )
}
