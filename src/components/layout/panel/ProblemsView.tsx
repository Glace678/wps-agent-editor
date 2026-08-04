import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/runtime'
import { useEditorStore } from '@/stores/editor.store'
import { usePanelStore } from '@/stores/panel.store'

interface MarkerItem {
  id: string
  severity: number
  line: number
  column: number
  message: string
  source: string
}

function severityName(severity: number): 'error' | 'warning' | 'info' | 'hint' {
  if (severity === 8) return 'error'
  if (severity === 4) return 'warning'
  if (severity === 2) return 'info'
  return 'hint'
}

export function ProblemsView({ onCountChange }: { onCountChange: (count: number) => void }) {
  const { t } = useTranslation()
  const currentFile = useEditorStore((s) => s.currentFile)
  const navigateToLine = usePanelStore((s) => s.navigateToLine)
  const [items, setItems] = useState<MarkerItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const refresh = async () => {
      try {
        const monacoModule = await import('monaco-editor')
        if (cancelled) return
        const all = monacoModule.editor.getModelMarkers({})
        const markers = currentFile
          ? all.filter((marker) => marker.resource.path === `/${currentFile.replace(/\\/g, '/')}`)
          : all
        const sorted = [...markers].sort(
          (a, b) => b.severity - a.severity || a.startLineNumber - b.startLineNumber,
        )
        setItems(sorted.map((marker) => ({
          id: `${marker.resource.toString()}:${marker.startLineNumber}:${marker.startColumn}:${marker.message}`,
          severity: marker.severity,
          line: marker.startLineNumber,
          column: marker.startColumn,
          message: marker.message,
          source: marker.source || 'monaco',
        })))
        setLoading(false)
      } catch {
        // monaco not loaded yet
      }
    }

    void refresh()
    timer = window.setInterval(refresh, 2000)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [currentFile])

  useEffect(() => {
    onCountChange(items.length)
  }, [items.length, onCountChange])

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-muted-foreground">
        {t('bottomPanel.loading')}
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {items.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <CircleCheck className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />
          {t('bottomPanel.problemsNone')}
        </div>
      ) : (
        items.map((item) => {
          const kind = severityName(item.severity)
          const Icon = kind === 'error'
            ? CircleAlert
            : kind === 'warning'
              ? TriangleAlert
              : Info
          const color = kind === 'error'
            ? 'text-red-600 dark:text-red-400'
            : kind === 'warning'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-blue-600 dark:text-blue-400'
          return (
            <button
              type="button"
              key={item.id}
              className="flex w-full items-start gap-2 px-3 py-1 text-left text-xs hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
              onClick={() => navigateToLine(item.line, item.column, currentFile ?? undefined)}
            >
              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${color}`} />
              <span className="min-w-0 flex-1 break-words text-foreground">{item.message}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{item.line}:{item.column}</span>
              <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{item.source}</span>
            </button>
          )
        })
      )}
    </div>
  )
}
