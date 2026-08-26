import { useEffect, useRef, useState } from 'react'
import { Bug, ChevronRight } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/runtime'
import { useDebugStore } from '@/stores/debug.store'
import { usePanelStore } from '@/stores/panel.store'

export function DebugConsoleView() {
  const { t } = useTranslation()
  const status = useDebugStore((s) => s.status)
  const sessionFile = useDebugStore((s) => s.sessionFile)
  const kind = useDebugStore((s) => s.kind)
  const frames = useDebugStore((s) => s.frames)
  const variables = useDebugStore((s) => s.variables)
  const breakpoints = useDebugStore((s) => s.breakpoints)
  const consoleLines = useDebugStore((s) => s.consoleLines)
  const navigateToLine = usePanelStore((s) => s.navigateToLine)
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [consoleLines, status])

  const evaluate = () => {
    const expression = input.trim()
    if (!expression || status === 'idle') return
    setInput('')
    useDebugStore.getState().addConsoleLine({ kind: 'eval', text: `> ${expression}` })
    void window.api.lw.debugEvaluate(expression, crypto.randomUUID())
  }

  const breakpointEntries = Object.entries(breakpoints)

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className="w-60 shrink-0 overflow-auto border-r bg-black/[0.02] dark:bg-white/[0.02]" data-testid="debug-panel-sidebar">
        {status === 'idle' ? (
          <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-xs text-muted-foreground">
            <Bug className="h-5 w-5 opacity-40" />
            <p>{t('bottomPanel.debugNotRunning')}</p>
            <p className="text-[11px]">{t('bottomPanel.debugStartHint')}</p>
          </div>
        ) : (
          <>
            <section className="border-b">
              <h3 className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <ChevronRight className="h-3 w-3" />
                {t('bottomPanel.variables')}
              </h3>
              <div className="pb-1">
                {variables.length === 0 && (
                  <p className="px-3 py-1 text-[11px] text-muted-foreground">
                    {t('bottomPanel.noVariables')}
                  </p>
                )}
                {variables.map((variable) => (
                  <div key={variable.name} className="flex items-start gap-2 px-3 py-0.5 text-xs">
                    <span className="shrink-0 font-mono text-primary">{variable.name}</span>
                    <span className="min-w-0 break-all font-mono text-foreground/80">{variable.value}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="border-b">
              <h3 className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <ChevronRight className="h-3 w-3" />
                {t('bottomPanel.callStack')}
              </h3>
              <div className="pb-1">
                {frames.length === 0 && (
                  <p className="px-3 py-1 text-[11px] text-muted-foreground">{t('bottomPanel.noFrames')}</p>
                )}
                {frames.map((frame) => {
                  const sameFile = sessionFile && frame.file && frame.file.replace(/\\/g, '/') === sessionFile.replace(/\\/g, '/')
                  const fileName = frame.file.split(/[/\\]/).pop() || frame.file
                  return (
                    <button
                      type="button"
                      key={frame.index}
                      className="flex w-full items-start gap-2 px-3 py-0.5 text-left text-xs hover:bg-black/[0.06] dark:hover:bg-white/[0.08] disabled:opacity-50"
                      disabled={!sameFile}
                      onClick={() => navigateToLine(frame.line, frame.column)}
                      title={frame.file}
                    >
                      <span className="max-w-[40%] truncate font-mono">{frame.name}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                        {fileName}:{frame.line}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
            <section>
              <h3 className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <ChevronRight className="h-3 w-3" />
                {t('bottomPanel.breakpoints')}
              </h3>
              <div className="pb-1">
                {breakpointEntries.length === 0 && (
                  <p className="px-3 py-1 text-[11px] text-muted-foreground">{t('bottomPanel.noBreakpoints')}</p>
                )}
                {breakpointEntries.map(([file, lines]) => (
                  <div key={file} className="px-3 py-0.5">
                    <p className="truncate text-[11px] text-muted-foreground">
                      {file.split(/[/\\]/).pop()}
                    </p>
                    <div className="flex flex-wrap gap-1 py-0.5">
                      {lines.map((line) => (
                        <button
                          type="button"
                          key={line}
                          className="rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-[11px] hover:bg-black/[0.1] dark:bg-white/[0.08] dark:hover:bg-white/[0.14]"
                          onClick={() => navigateToLine(line, 1, file)}
                        >
                          {line}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs leading-5"
          data-testid="debug-console-output"
        >
          {consoleLines.length === 0 && (
            <p className="text-muted-foreground">{t('bottomPanel.debugConsoleEmpty')}</p>
          )}
          {consoleLines.map((line) => (
            <div
              key={line.id}
              className={`whitespace-pre-wrap break-all ${
                line.kind === 'err'
                  ? 'text-red-600 dark:text-red-400'
                  : line.kind === 'eval'
                    ? 'text-blue-700 dark:text-blue-300'
                    : line.kind === 'system'
                      ? 'text-muted-foreground italic'
                      : 'text-foreground/90'
              }`}
            >
              {line.text}
            </div>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t px-3 py-1.5">
          <span className={`font-mono text-xs ${status === 'paused' ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
            {kind === 'python' ? '>>>' : '>'}
          </span>
          <input
            className="min-w-0 flex-1 border-0 bg-transparent font-mono text-xs outline-none"
            placeholder={status === 'idle' ? t('bottomPanel.debugConsoleIdle') : t('bottomPanel.debugConsolePlaceholder')}
            value={input}
            disabled={status === 'idle'}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') evaluate()
            }}
            aria-label={t('bottomPanel.debugConsolePlaceholder')}
          />
        </div>
      </div>
    </div>
  )
}
