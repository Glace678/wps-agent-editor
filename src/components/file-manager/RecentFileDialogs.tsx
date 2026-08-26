import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDate, formatFileSize, formatShortDate } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/runtime'
import { useEditorStore } from '@/stores/editor.store'
import { FileIcon } from './FileIcon'
import type { FileStatInfo, FileVersion, RecentFile } from '@/types/file'

function ModalShell({
  title,
  onClose,
  children,
  testId,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  testId?: string
}) {
  const { t } = useTranslation()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-black/25 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="flex max-h-[calc(100%-2rem)] w-full max-w-[380px] flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
      >
        <header className="flex shrink-0 items-center justify-between px-4 pb-1 pt-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t('recentFiles.cancel')}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-4 pb-4 pt-1">{children}</div>
      </section>
    </div>,
    document.body,
  )
}

function InfoRow({ label, value, breakAll }: { label: string; value: string; breakAll?: boolean }) {
  return (
    <div className="flex gap-3 py-1 text-[13px]">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className={breakAll ? 'break-all' : undefined}>{value}</span>
    </div>
  )
}

export function FileInfoDialog({
  file,
  stat,
  onClose,
}: {
  file: RecentFile
  stat: FileStatInfo
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <ModalShell title={t('recentFiles.infoTitle')} onClose={onClose} testId="file-info-dialog">
      <div className="mb-2 flex items-center gap-2 border-b border-border pb-2">
        <FileIcon filePath={file.path} />
        <span className="break-all text-sm font-medium">{file.name}</span>
      </div>
      <InfoRow label={t('recentFiles.infoModified')} value={formatShortDate(stat.modifiedAt)} />
      <InfoRow label={t('recentFiles.infoCreated')} value={formatShortDate(stat.createdAt)} />
      <InfoRow label={t('recentFiles.infoSize')} value={formatFileSize(stat.size)} />
      <InfoRow label={t('recentFiles.infoType')} value={stat.extension || '-'} />
      <InfoRow label={t('recentFiles.infoLocation')} value={file.path} breakAll />
    </ModalShell>
  )
}

export function RenameDialog({
  file,
  onClose,
  onSubmit,
}: {
  file: RecentFile
  onClose: () => void
  onSubmit: (newName: string) => Promise<string | null>
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(file.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    const dot = file.name.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 ? dot : file.name.length)
  }, [file.name])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      const message = await onSubmit(value)
      if (message) setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell title={t('recentFiles.renameTitle')} onClose={onClose} testId="rename-dialog">
      <input
        ref={inputRef}
        className="h-8 w-full rounded-lg border border-input bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring"
        value={value}
        placeholder={t('recentFiles.renamePlaceholder')}
        onChange={(event) => {
          setValue(event.target.value)
          setError(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void submit()
        }}
      />
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>{t('recentFiles.cancel')}</Button>
        <Button size="sm" disabled={busy || !value.trim()} onClick={() => void submit()}>
          {t('recentFiles.confirm')}
        </Button>
      </div>
    </ModalShell>
  )
}

export function ShareDialog({ files, onClose }: { files: RecentFile[]; onClose: () => void }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<'file' | 'path' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const primaryFile = files[0]
  const isMultiFile = files.length > 1
  const filePaths = files.map((file) => file.path)

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const finish = (kind: 'file' | 'path') => {
    setCopied(kind)
    closeTimer.current = setTimeout(onClose, 900)
  }

  const copyFile = async () => {
    const result = await window.api.file.copyToClipboard(filePaths)
    if (!result.success) {
      setError(t('recentFiles.errorNotFound'))
      return
    }
    finish(result.method ?? 'file')
  }

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(filePaths.join('\n'))
    } catch {
      // Electron renderer clipboard access can fail in previews; ignore and keep UI responsive.
    }
    finish('path')
  }

  const optionClass =
    'flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left hover:bg-accent'

  return (
    <ModalShell title={t('recentFiles.shareTitle')} onClose={onClose} testId="share-dialog">
      <div className="mb-3 flex items-center gap-2">
        <FileIcon filePath={primaryFile.path} />
        <span className="break-all text-[13px] text-muted-foreground">
          {primaryFile.name}
          {isMultiFile ? ` +${files.length - 1}` : ''}
        </span>
      </div>
      {isMultiFile && (
        <div className="mb-3 max-h-36 overflow-y-auto rounded-xl border border-border">
          {files.map((file) => (
            <div key={file.path} className="flex items-center gap-2 border-b border-border px-3 py-2 text-[13px] last:border-b-0">
              <FileIcon filePath={file.path} />
              <span className="min-w-0 truncate" title={file.path}>{file.name}</span>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      <div className="flex flex-col gap-2">
        <button type="button" className={optionClass} onClick={() => void copyFile()}>
          {copied === 'file' ? <Check className="h-4 w-4 shrink-0 text-green-500" /> : <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="min-w-0">
            <span className="block text-[13px]">
              {copied === 'file'
                ? t('recentFiles.shareCopied')
                : isMultiFile
                  ? `${t('recentFiles.shareCopyFile')} (${files.length})`
                  : t('recentFiles.shareCopyFile')}
            </span>
            <span className="block text-xs text-muted-foreground">{t('recentFiles.shareCopyFileHint')}</span>
          </span>
        </button>
        <button type="button" className={optionClass} onClick={() => void copyPath()}>
          {copied === 'path' ? <Check className="h-4 w-4 shrink-0 text-green-500" /> : <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="min-w-0">
            <span className="block text-[13px]">
              {copied === 'path'
                ? t('recentFiles.shareCopied')
                : isMultiFile
                  ? `${t('recentFiles.shareCopyPath')} (${files.length})`
                  : t('recentFiles.shareCopyPath')}
            </span>
            <span className="block break-all whitespace-pre-wrap text-xs text-muted-foreground">
              {filePaths.join('\n')}
            </span>
          </span>
        </button>
      </div>
    </ModalShell>
  )
}

export function HistoryDialog({ file, onClose }: { file: RecentFile; onClose: () => void }) {
  const { language, t } = useTranslation()
  const [versions, setVersions] = useState<FileVersion[] | null>(null)
  const [confirming, setConfirming] = useState<FileVersion | null>(null)
  const [restoredId, setRestoredId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = async () => {
    setVersions(await window.api.file.historyList(file.path))
  }

  useEffect(() => {
    void window.api.file.historyList(file.path).then(setVersions)
  }, [file.path])

  const restore = async (version: FileVersion) => {
    if (busy) return
    if (useEditorStore.getState().currentFile === file.path) {
      setError(t('recentFiles.errorFileOpen'))
      setConfirming(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.file.historyRestore(file.path, version.id)
      if (!result.success) {
        setError(t('recentFiles.errorOperationFailed'))
        return
      }
      setRestoredId(version.id)
      await reload()
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  return (
    <ModalShell title={t('recentFiles.historyTitle')} onClose={onClose} testId="history-dialog">
      <div className="mb-2 flex items-center gap-2">
        <FileIcon filePath={file.path} />
        <span className="break-all text-[13px] text-muted-foreground">{file.name}</span>
      </div>
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      {confirming ? (
        <div>
          <p className="py-2 text-[13px]">
            {t('recentFiles.historyRestoreMessage', { time: formatDate(confirming.savedAt, language) })}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirming(null)}>
              {t('recentFiles.cancel')}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void restore(confirming)}>
              {t('recentFiles.confirm')}
            </Button>
          </div>
        </div>
      ) : versions === null ? null : versions.length === 0 ? (
        <p className="py-3 text-[13px] text-muted-foreground">{t('recentFiles.historyEmpty')}</p>
      ) : (
        <div className="flex flex-col">
          {versions.map((version) => (
            <div
              key={version.id}
              className="flex items-center gap-3 border-b border-border py-2 text-[13px] last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p>{formatDate(version.savedAt, language)}</p>
                <p className="text-xs text-muted-foreground">{formatFileSize(version.size)}</p>
              </div>
              {restoredId === version.id ? (
                <span className="flex items-center gap-1 text-xs text-green-500">
                  <Check className="h-3.5 w-3.5" />
                  {t('recentFiles.historyRestored')}
                </span>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirming(version)}>
                  {t('recentFiles.historyRestore')}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  return (
    <ModalShell title={title} onClose={onCancel} testId="confirm-dialog">
      <p className="break-words py-1 text-[13px]">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>{t('recentFiles.cancel')}</Button>
        <Button
          variant={danger ? 'destructive' : 'default'}
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void Promise.resolve(onConfirm()).finally(() => setBusy(false))
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </ModalShell>
  )
}

export function MessageDialog({
  title,
  message,
  onClose,
}: {
  title: string
  message: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <ModalShell title={title} onClose={onClose} testId="message-dialog">
      <p className="break-words py-1 text-[13px]">{message}</p>
      <div className="mt-4 flex justify-end">
        <Button size="sm" onClick={onClose}>{t('recentFiles.confirm')}</Button>
      </div>
    </ModalShell>
  )
}
