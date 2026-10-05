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
import { useDebugStore } from '@/stores/debug.store'
import { useDocumentDrag } from '@/hooks/use-pointer-drag'
import { ProblemsView } from './panel/ProblemsView'
import { DebugConsoleView } from './panel/DebugConsoleView'
import { TERMINAL_KILL_ACTIVE_EVENT, TerminalView } from './panel/TerminalView'
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
  const [copyOutputFailed, setCopyOutputFailed] = useState(false)
  const copyOutputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onResizeMove = useCallback((event: MouseEvent) => {
    const next = window.innerHeight - event.clientY
    // 小窗口下比例上限可能小于最小高度，用 max 保证下限不被上限吞掉。
    const maxAllowed = Math.max(PANEL_MIN_HEIGHT, window.innerHeight * PANEL_MAX_HEIGHT_RATIO)
    const clamped = Math.min(Math.max(next, PANEL_MIN_HEIGHT), maxAllowed)
    setHeight(clamped)
  }, [setHeight])
  const { start: startResize } = useDocumentDrag(onResizeMove)

  useEffect(() => () => {
    if (copyOutputTimerRef.current) clearTimeout(copyOutputTimerRef.current)
  }, [])

  const handleCopyOutput = useCallback(async () => {
    const text = usePanelStore.getState().outputText
    if (!text) return
    const flashFailure = () => {
      setCopyOutputFailed(true)
      if (copyOutputTimerRef.current) clearTimeout(copyOutputTimerRef.current)
      copyOutputTimerRef.current = setTimeout(() => setCopyOutputFailed(false), 1800)
    }
    if (!navigator.clipboard?.writeText) {
      flashFailure()
      return
    }
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      flashFailure()
    }
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

  return (
    <TooltipProvider delayDuration={450}>
      <div
        className={`${open ? 'flex' : 'hidden'} shrink-0 flex-col border-t bg-card text-foreground`}
        style={{ height: open ? height : 0 }}
        data-testid="bottom-panel"
      >
        <div
          className="h-[4px] shrink-0 cursor-ns-resize bg-transparent hover:bg-primary/40 active:bg-primary/60"
          onMouseDown={(event) => {
            event.preventDefault()
            startResize()
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
                <Tooltip open={copyOutputFailed}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={handleCopyOutput}
                      disabled={!usePanelStore.getState().outputText}
                      aria-label={t('bottomPanel.copyOutput')}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t('recentFiles.errorOperationFailed')}</TooltipContent>
                </Tooltip>
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
                    onClick={() => window.dispatchEvent(new Event(TERMINAL_KILL_ACTIVE_EVENT))}
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
              data-testid="bottom-panel-close"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {tab === 'problems' && <ProblemsView onCountChange={setProblemCount} />}
          {tab === 'output' && <OutputView />}
          {tab === 'debug-console' && <DebugConsoleView />}
          <div className={tab === 'terminal' ? 'flex min-h-0 flex-1' : 'hidden'}>
            <TerminalView active={open && tab === 'terminal'} />
          </div>
          {tab === 'references' && <ReferencesView />}
        </div>
      </div>
    </TooltipProvider>
  )
}
