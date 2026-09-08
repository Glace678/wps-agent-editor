import { desktopApi } from '@/platform'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n/runtime'
import type { TerminalEvent } from '@/types/desktop-api'
import type { IDisposable, Terminal as XTermTerminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'

export const TERMINAL_KILL_ACTIVE_EVENT = 'wae:terminal-kill-active'

interface TerminalSessionView {
  id: string
  ordinal: number
  cwd: string
  status: 'starting' | 'running' | 'exited' | 'error'
}

interface TerminalRuntime {
  terminal: XTermTerminal
  fitAddon: FitAddon
  resizeObserver: ResizeObserver
  disposables: IDisposable[]
}

function disposeTerminalRuntime(runtime: TerminalRuntime): void {
  runtime.resizeObserver.disconnect()
  for (const disposable of runtime.disposables) disposable.dispose()
  runtime.terminal.dispose()
}

let terminalDependencies: Promise<{
  Terminal: typeof import('@xterm/xterm').Terminal
  FitAddon: typeof import('@xterm/addon-fit').FitAddon
}> | null = null

function loadTerminalDependencies() {
  terminalDependencies ??= Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('@xterm/xterm/css/xterm.css'),
  ]).then(([xterm, fit]) => ({ Terminal: xterm.Terminal, FitAddon: fit.FitAddon }))
  return terminalDependencies
}

export function TerminalView({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<TerminalSessionView[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const sessionsRef = useRef(sessions)
  const activeSessionIdRef = useRef(activeSessionId)
  const runtimesRef = useRef(new Map<string, TerminalRuntime>())
  const hostsRef = useRef(new Map<string, HTMLDivElement>())
  const initializingRef = useRef(new Set<string>())
  const closedSessionIdsRef = useRef(new Set<string>())
  const initializedRef = useRef(false)
  const nextOrdinalRef = useRef(1)

  sessionsRef.current = sessions
  activeSessionIdRef.current = activeSessionId

  const disposeRuntime = useCallback((sessionId: string) => {
    const runtime = runtimesRef.current.get(sessionId)
    if (!runtime) return
    disposeTerminalRuntime(runtime)
    runtimesRef.current.delete(sessionId)
  }, [])

  const closeSession = useCallback((sessionId: string) => {
    closedSessionIdsRef.current.add(sessionId)
    void desktopApi.process.terminalKill(sessionId).catch((error) => {
      console.error('[terminal] Failed to terminate PTY session', error)
    })
    disposeRuntime(sessionId)
    setSessions((current) => {
      const index = current.findIndex((session) => session.id === sessionId)
      const next = current.filter((session) => session.id !== sessionId)
      if (activeSessionIdRef.current === sessionId) {
        setActiveSessionId(next[Math.min(index, Math.max(0, next.length - 1))]?.id ?? null)
      }
      return next
    })
  }, [disposeRuntime])

  const createSession = useCallback(() => {
    if (sessionsRef.current.length >= 4) return
    const session: TerminalSessionView = {
      id: crypto.randomUUID(),
      ordinal: nextOrdinalRef.current++,
      cwd: '',
      status: 'starting',
    }
    initializedRef.current = true
    setSessions((current) => [...current, session])
    setActiveSessionId(session.id)
  }, [])

  useEffect(() => {
    if (active && !initializedRef.current) createSession()
  }, [active, createSession])

  useEffect(() => {
    for (const session of sessions) {
      if (runtimesRef.current.has(session.id) || initializingRef.current.has(session.id)) continue
      const host = hostsRef.current.get(session.id)
      if (!host) continue
      initializingRef.current.add(session.id)
      void (async () => {
        let pendingRuntime: TerminalRuntime | null = null
        try {
          const { Terminal, FitAddon } = await loadTerminalDependencies()
          if (closedSessionIdsRef.current.has(session.id)) return
          const currentHost = hostsRef.current.get(session.id)
          if (!currentHost || currentHost !== host) return
          const terminal = new Terminal({
            allowProposedApi: false,
            convertEol: false,
            cursorBlink: true,
            fontFamily: 'Cascadia Mono, Consolas, monospace',
            fontSize: 12,
            scrollback: 5000,
            theme: {
              background: '#00000000',
              foreground: '#d4d4d4',
              cursor: '#d4d4d4',
              selectionBackground: '#264f78',
            },
          })
          const fitAddon = new FitAddon()
          terminal.loadAddon(fitAddon)
          terminal.open(host)
          fitAddon.fit()

          const disposables: IDisposable[] = []
          const resizeObserver = new ResizeObserver(() => {
            if (!host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) return
            fitAddon.fit()
            void desktopApi.process.terminalResize(session.id, terminal.cols, terminal.rows)
              .catch(() => undefined)
          })
          resizeObserver.observe(host)
          disposables.push(terminal.onData((data) => {
            void desktopApi.process.terminalWrite(session.id, data).catch((error) => {
              terminal.write(`\r\n[${String(error)}]\r\n`)
            })
          }))
          pendingRuntime = { terminal, fitAddon, resizeObserver, disposables }
          if (closedSessionIdsRef.current.has(session.id) || hostsRef.current.get(session.id) !== host) {
            disposeTerminalRuntime(pendingRuntime)
            pendingRuntime = null
            return
          }
          runtimesRef.current.set(session.id, pendingRuntime)

          const result = await desktopApi.process.terminalStart(
            session.id,
            { cols: terminal.cols, rows: terminal.rows },
            (event: TerminalEvent) => {
              if (event.sessionId !== session.id) return
              if (closedSessionIdsRef.current.has(session.id)) return
              if (runtimesRef.current.get(session.id)?.terminal !== terminal) return
              if (event.type === 'output' && event.text) terminal.write(event.text)
              if (event.type === 'exit') {
                setSessions((current) => current.map((item) => item.id === session.id
                  ? { ...item, status: 'exited' }
                  : item))
              }
            },
          )
          if (closedSessionIdsRef.current.has(session.id) || hostsRef.current.get(session.id) !== host) {
            void desktopApi.process.terminalKill(session.id).catch(() => undefined)
            disposeRuntime(session.id)
            pendingRuntime = null
            return
          }
          setSessions((current) => current.map((item) => item.id === session.id
            ? { ...item, cwd: result.cwd, status: 'running' }
            : item))
          if (activeSessionIdRef.current === session.id) {
            requestAnimationFrame(() => {
              fitAddon.fit()
              terminal.focus()
            })
          }
        } catch (error) {
          if (closedSessionIdsRef.current.has(session.id)) {
            disposeRuntime(session.id)
            pendingRuntime = null
            return
          }
          console.error('[terminal] Failed to start PTY session', error)
          setSessions((current) => current.map((item) => item.id === session.id
            ? { ...item, status: 'error' }
            : item))
          runtimesRef.current.get(session.id)?.terminal.write(`\r\n[${String(error)}]\r\n`)
        } finally {
          initializingRef.current.delete(session.id)
        }
      })()
    }
  }, [sessions])

  useEffect(() => {
    if (!active || !activeSessionId) return
    const runtime = runtimesRef.current.get(activeSessionId)
    if (!runtime) return
    requestAnimationFrame(() => {
      runtime.fitAddon.fit()
      runtime.terminal.focus()
      void desktopApi.process.terminalResize(
        activeSessionId,
        runtime.terminal.cols,
        runtime.terminal.rows,
      ).catch(() => undefined)
    })
  }, [active, activeSessionId, sessions])

  useEffect(() => {
    const killActive = () => {
      const sessionId = activeSessionIdRef.current
      if (sessionId) closeSession(sessionId)
    }
    window.addEventListener(TERMINAL_KILL_ACTIVE_EVENT, killActive)
    return () => window.removeEventListener(TERMINAL_KILL_ACTIVE_EVENT, killActive)
  }, [closeSession])

  useEffect(() => () => {
    const sessionIds = new Set([
      ...sessionsRef.current.map((session) => session.id),
      ...initializingRef.current,
      ...runtimesRef.current.keys(),
    ])
    for (const sessionId of sessionIds) {
      closedSessionIdsRef.current.add(sessionId)
      void desktopApi.process.terminalKill(sessionId).catch(() => undefined)
      disposeRuntime(sessionId)
    }
  }, [disposeRuntime])

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#1e1e1e] text-[#d4d4d4]"
      data-testid="terminal-view"
    >
      <div className="flex h-7 shrink-0 items-center border-b border-white/10 bg-[#181818] px-1">
        <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`flex h-7 shrink-0 items-center border-r border-white/10 ${activeSessionId === session.id ? 'bg-[#1e1e1e]' : 'bg-[#181818]'}`}
              role="tab"
              aria-selected={activeSessionId === session.id}
              data-testid={`terminal-tab-${session.ordinal}`}
              data-terminal-status={session.status}
            >
              <button
                type="button"
                className="flex h-full min-w-0 items-center gap-2 px-2 text-[11px]"
                onClick={() => setActiveSessionId(session.id)}
                title={session.cwd || `${t('bottomPanel.terminal')} ${session.ordinal}`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${session.status === 'running' ? 'bg-emerald-400' : session.status === 'starting' ? 'bg-amber-400' : 'bg-zinc-500'}`} />
                <span className="max-w-28 truncate">{t('bottomPanel.terminal')} {session.ordinal}</span>
              </button>
              <button
                type="button"
                className="mr-1 grid h-5 w-5 place-items-center text-zinc-400 hover:bg-white/10 hover:text-white"
                onClick={() => closeSession(session.id)}
                aria-label={`${t('bottomPanel.killTerminal')} ${session.ordinal}`}
                data-testid={`terminal-close-${session.ordinal}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-zinc-300 hover:bg-white/10 hover:text-white"
          onClick={createSession}
          disabled={sessions.length >= 4}
          aria-label={t('bottomPanel.terminal')}
          data-testid="terminal-new"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        {sessions.map((session) => (
          <div
            key={session.id}
            ref={(element) => {
              if (element) hostsRef.current.set(session.id, element)
              else hostsRef.current.delete(session.id)
            }}
            className={`absolute inset-0 px-2 py-1 ${activeSessionId === session.id ? 'block' : 'hidden'}`}
            data-terminal-session-id={session.id}
            data-terminal-ordinal={session.ordinal}
          />
        ))}
      </div>
    </div>
  )
}
