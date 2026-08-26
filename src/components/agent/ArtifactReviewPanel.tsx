import { useMemo, useState } from 'react'
import {
  Check,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  FileCode2,
  LocateFixed,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { useTranslation } from '@/lib/i18n/runtime'
import { cn } from '@/lib/utils'
import { useAgentStore } from '@/stores/agent.store'
import { useEditorStore } from '@/stores/editor.store'
import type { ArtifactReviewCommand } from '@/types/artifact-review'
import { orderArtifactOperations } from '@/lightweight-office/agent/artifact-review-controller'
import { getCodeLanguage } from '@/lib/code-languages'
import { stageCodeBufferSnapshot } from '@/lightweight-office/editors/code-buffer-registry'

function decodeCodePayload(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const source = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    ? bytes.subarray(3)
    : bytes
  return new TextDecoder('utf-8', { fatal: true }).decode(source)
}

export function ArtifactReviewPanel() {
  const { t } = useTranslation()
  const manifest = useAgentStore((state) => state.artifactDraft)
  const review = useAgentStore((state) => state.artifactReview)
  const queue = useAgentStore((state) => state.artifactReviewQueue)
  const setArtifactReview = useAgentStore((state) => state.setArtifactReview)
  const activateArtifactReview = useAgentStore((state) => state.activateArtifactReview)
  const finishArtifactReview = useAgentStore((state) => state.finishArtifactReview)
  const setCurrentFile = useEditorStore((state) => state.setCurrentFile)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const operations = useMemo(
    () => manifest ? orderArtifactOperations(manifest.operations) : [],
    [manifest],
  )
  const batchItems = useMemo(() => {
    if (!manifest) return []
    return manifest.batchId
      ? queue.filter(({ manifest: item }) => item.batchId === manifest.batchId)
      : queue.filter(({ manifest: item }) => item.draftId === manifest.draftId)
  }, [manifest, queue])

  if (!manifest || !review || ['saved', 'discarded'].includes(review.phase)) return null
  const historyMode = manifest.reviewMode === 'history-withdrawal'

  const command = async (value: ArtifactReviewCommand) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      let codeBuffer: { text: string; dirty: boolean } | null = null
      if (manifest.kind === 'code' && (value.type === 'save' || value.type === 'discard')) {
        const payload = await window.api.artifact.getPayload(manifest.draftId)
        codeBuffer = {
          text: decodeCodePayload(value.type === 'save' ? payload.candidateData : payload.originalData),
          dirty: value.type === 'discard' ? Boolean(manifest.textMetadata?.dirty) : false,
        }
      }
      const state = await window.api.artifact.command(manifest.draftId, value)
      setArtifactReview(manifest, state)
      if (codeBuffer && (state.phase === 'saved' || state.phase === 'discarded')) {
        stageCodeBufferSnapshot(manifest.documentId, {
          text: codeBuffer.text,
          metadata: {
            encoding: 'utf-8',
            hasBom: manifest.textMetadata?.hasBom ?? false,
            eol: manifest.textMetadata?.eol ?? (codeBuffer.text.includes('\r\n') ? 'crlf' : 'lf'),
            languageId: manifest.textMetadata?.languageId ?? getCodeLanguage(manifest.documentId)?.language ?? 'plaintext',
            dirty: codeBuffer.dirty,
          },
        })
      }
      if (state.phase === 'saved') {
        window.dispatchEvent(new CustomEvent('artifact-review-file-saved', { detail: { filePath: manifest.documentId } }))
      }
      if (state.phase === 'saved' || state.phase === 'discarded') {
        finishArtifactReview(manifest.draftId, state)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="border-b border-border/70 bg-background/35" data-testid="artifact-review-panel">
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <h3 className="truncate text-xs font-semibold">{t('artifactReview.title')}</h3>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {review.decided}/{review.total} · {manifest.sourceName}
          </p>
        </div>
        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
      </header>

      {batchItems.length > 1 && (
        <div className="border-t border-border/50 px-2 py-1.5" data-testid="artifact-review-file-queue">
          <p className="mb-1 px-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            {batchItems.filter(({ state }) => ['saved', 'discarded'].includes(state.phase)).length}/{batchItems.length} · {t('artifactReview.files')}
          </p>
          <div className="space-y-0.5">
            {batchItems.map((item, index) => {
              const active = item.manifest.draftId === manifest.draftId
              const complete = ['saved', 'discarded'].includes(item.state.phase)
              return (
                <button
                  key={item.manifest.draftId}
                  type="button"
                  className={cn(
                    'flex h-7 w-full items-center gap-1.5 rounded px-1.5 text-left text-[10px] hover:bg-accent',
                    active && 'bg-accent/75 font-medium',
                    complete && 'text-muted-foreground',
                  )}
                  disabled={complete}
                  onClick={() => {
                    activateArtifactReview(item.manifest.draftId)
                    setCurrentFile(item.manifest.documentId, item.manifest.sourceName)
                  }}
                >
                  {complete
                    ? <CircleCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    : <FileCode2 className="h-3.5 w-3.5 shrink-0 text-blue-600" />}
                  <span className="min-w-0 flex-1 truncate">{item.manifest.relativePath ?? item.manifest.sourceName}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {complete ? '✓' : `${index + 1}/${batchItems.length}`}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="max-h-[240px] overflow-y-auto border-y border-border/50">
        {operations.map((operation, index) => {
          const decision = review.decisions[operation.id]
          const active = operation.id === review.currentOperationId
          return (
            <div
              key={operation.id}
              className={cn(
                'group flex min-h-10 items-center gap-2 border-b border-border/40 px-2 py-1.5 last:border-b-0',
                active && 'bg-accent/70',
              )}
              data-operation-id={operation.id}
            >
              <button
                type="button"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] tabular-nums text-muted-foreground hover:bg-background"
                title={t('artifactReview.locateCurrent')}
                onClick={() => void command({ type: 'locate', operationId: operation.id })}
              >
                {active ? <LocateFixed className="h-3.5 w-3.5 text-blue-600" /> : index + 1}
              </button>
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => void command({ type: 'locate', operationId: operation.id })}
              >
                <span className="block truncate text-[11px] font-medium">{operation.label}</span>
                <span className={cn(
                  'block truncate text-[10px] text-muted-foreground',
                  decision?.decision === 'accepted' && 'text-emerald-700 dark:text-emerald-400',
                  decision?.decision === 'rejected' && 'text-red-700 dark:text-red-400',
                  decision?.decision === 'conflict' && 'text-amber-700 dark:text-amber-400',
                )}>
                  {decision?.reason === 'dependency'
                    ? t('artifactReview.dependencyRejected')
                    : t(`artifactReview.${decision?.decision ?? 'pending'}` as const)}
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  className="grid h-6 w-6 place-items-center rounded text-red-700 hover:bg-red-500/10 disabled:opacity-30 dark:text-red-400"
                  aria-label={t(historyMode ? 'artifactReview.withdrawChange' : 'artifactReview.reject')}
                  disabled={busy || decision?.decision === 'conflict'}
                  onClick={() => void command({ type: 'reject', operationId: operation.id })}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="grid h-6 w-6 place-items-center rounded text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-30 dark:text-emerald-400"
                  aria-label={t(historyMode ? 'artifactReview.keepChange' : 'artifactReview.accept')}
                  disabled={busy || decision?.decision === 'conflict'}
                  onClick={() => void command({ type: 'accept', operationId: operation.id })}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {error && (
        <p className="flex items-start gap-1.5 px-3 py-1.5 text-[10px] leading-4 text-destructive" role="alert">
          <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" /> {t('artifactReview.commandFailed', { error })}
        </p>
      )}
      {!review.canSave && !error && (
        <p className="px-3 py-1.5 text-[10px] text-muted-foreground">{t('artifactReview.allDecisionsRequired')}</p>
      )}

      <div className="grid grid-cols-2 gap-1.5 px-2 py-2">
        <button type="button" className="inline-flex h-7 items-center justify-center gap-1 rounded border border-border text-[10px] hover:bg-accent" disabled={busy} onClick={() => void command({ type: 'accept-all' })}>
          <CheckCheck className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" /> {t(historyMode ? 'artifactReview.keepAll' : 'artifactReview.acceptAll')}
        </button>
        <button type="button" className="inline-flex h-7 items-center justify-center gap-1 rounded border border-border text-[10px] hover:bg-accent" disabled={busy} onClick={() => void command({ type: 'reject-all' })}>
          <X className="h-3.5 w-3.5 text-red-700 dark:text-red-400" /> {t(historyMode ? 'artifactReview.withdrawAll' : 'artifactReview.rejectAll')}
        </button>
        <button type="button" className="inline-flex h-7 items-center justify-center gap-1 rounded bg-[#1b5f9c] text-[10px] font-medium text-white disabled:opacity-40" disabled={busy || !review.canSave} onClick={() => void command({ type: 'save' })}>
          <Save className="h-3.5 w-3.5" /> {t('artifactReview.saveSelected')}
        </button>
        <button type="button" className="inline-flex h-7 items-center justify-center gap-1 rounded border border-border text-[10px] hover:bg-accent" disabled={busy} onClick={() => void command({ type: 'discard' })}>
          <Trash2 className="h-3.5 w-3.5" /> {t('artifactReview.discardDraft')}
        </button>
      </div>
    </section>
  )
}
