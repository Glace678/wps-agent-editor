import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, History, RotateCcw } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/runtime'
import { useEditorStore } from '@/stores/editor.store'
import { useAgentStore } from '@/stores/agent.store'
import type { ArtifactRevisionRecord } from '@/types/artifact-review'

export function ArtifactHistoryPanel() {
  const { language, t } = useTranslation()
  const currentFile = useEditorStore((state) => state.currentFile)
  const activeDraft = useAgentStore((state) => state.artifactDraft)
  const setArtifactReview = useAgentStore((state) => state.setArtifactReview)
  const [records, setRecords] = useState<ArtifactRevisionRecord[]>([])
  const [collapsed, setCollapsed] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => window.api.artifact.onEvent((event) => {
    if (event.type === 'draft-saved') setRefresh((value) => value + 1)
  }), [])

  useEffect(() => {
    let cancelled = false
    if (!currentFile) {
      setRecords([])
      return
    }
    void window.api.artifact.listHistory(currentFile).then((items) => {
      if (!cancelled) setRecords(items)
    }).catch(() => {
      if (!cancelled) setRecords([])
    })
    return () => { cancelled = true }
  }, [currentFile, refresh])

  if (!currentFile || activeDraft || records.length === 0) return null

  const reopen = async (record: ArtifactRevisionRecord) => {
    if (busyId) return
    setBusyId(record.revisionId)
    setError('')
    try {
      const result = await window.api.artifact.reopenHistory(currentFile, record.revisionId)
      setArtifactReview(result.manifest, result.reviewState ?? null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusyId('')
    }
  }

  const dateFormatter = new Intl.DateTimeFormat(language, {
    dateStyle: 'short',
    timeStyle: 'short',
  })

  return (
    <section className="border-b border-border/70 bg-background/30" data-testid="artifact-history-panel">
      <button
        type="button"
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-[11px] font-semibold hover:bg-accent/45"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        <History className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{t('artifactReview.historyTitle')}</span>
        <span className="font-normal tabular-nums text-muted-foreground">{records.length}</span>
      </button>
      {!collapsed && (
        <div className="max-h-40 overflow-y-auto border-t border-border/50">
          {records.map((record) => (
            <div key={record.revisionId} className="flex min-h-10 items-center gap-2 border-b border-border/40 px-3 py-1.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-medium">{dateFormatter.format(record.createdAt)}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {t('artifactReview.historyChanges', { count: record.enabledOperationIds.length })}
                </div>
              </div>
              <button
                type="button"
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-border px-2 text-[10px] hover:bg-accent disabled:opacity-40"
                disabled={Boolean(busyId)}
                onClick={() => void reopen(record)}
              >
                <RotateCcw className="h-3.5 w-3.5" /> {t('artifactReview.historyReopen')}
              </button>
            </div>
          ))}
          {error && <p className="border-t border-border/50 px-3 py-2 text-[10px] text-destructive">{t('artifactReview.commandFailed', { error })}</p>}
        </div>
      )}
    </section>
  )
}
