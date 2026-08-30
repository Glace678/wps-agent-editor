import { desktopApi } from '@/platform'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/lib/i18n/runtime'
import { useDebugStore } from '@/stores/debug.store'
import { usePanelStore } from '@/stores/panel.store'
import type { TerminalEvent } from '@/types/desktop-api'

interface TerminalLine {
  id: string
  kind: 'out' | 'in' | 'sys'
  text: string
}

let terminalLineId = 0

export function TerminalView() {
  const { t } = useTranslation()
  const [lines, setLines] = useState<TerminalLine[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const dispose = desktopApi.process.onTerminalEvent((event: TerminalEvent) => {
      if (event?.type === 'output') {
        setLines((prev) => [...prev, { id: `t${terminalLineId++}`, kind: 'out' as const, text: String(event.text ?? '') }].slice(-2000))
      } else if (event?.type === 'exit') {
        setRunning(false)
        setLines((prev) => [...prev, {
          id: `t${terminalLineId++}`,
          kind: 'sys' as const,
          text: `[${t('bottomPanel.terminalExited')} (${String(event.code ?? '')})]`,
        }])
      }
    })
    return dispose
  }, [t])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const submit = () => {
    const command = input.trim()
    if (!command) return
    setInput('')
    setRunning(true)
    setLines((prev) => [...prev, { id: `t${terminalLineId++}`, kind: 'in' as const, text: command }])
    void desktopApi.process.terminalExec(command)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs leading-5">
        {lines.length === 0 && (
          <p className="text-muted-foreground">{t('bottomPanel.terminalEmpty')}</p>
        )}
        {lines.map((line) => (
          <div
            key={line.id}
            className={
              line.kind === 'in'
                ? 'whitespace-pre-wrap break-all text-foreground'
                : line.kind === 'sys'
                  ? 'whitespace-pre-wrap break-all text-muted-foreground'
                  : 'whitespace-pre-wrap break-all text-foreground/90'
            }
          >
            {line.text}
          </div>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t px-3 py-1.5">
        <span className={`font-mono text-xs ${running ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
          ❯
        </span>
        <input
          className="min-w-0 flex-1 border-0 bg-transparent font-mono text-xs outline-none"
          placeholder={t('bottomPanel.terminalPlaceholder')}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          aria-label={t('bottomPanel.terminalPlaceholder')}
        />
      </div>
    </div>
  )
}
