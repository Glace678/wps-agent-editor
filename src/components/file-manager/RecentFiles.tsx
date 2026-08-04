import { useCallback, useEffect, useState } from 'react'
import { Check, Clock } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/runtime'
import { useFileStore } from '@/stores/file.store'
import { useEditorStore } from '@/stores/editor.store'
import { FileHoverCard } from './FileHoverCard'
import { FileIcon } from './FileIcon'
import { FILE_LIST_ROW_HOVER_BORDER } from './file-list-row-styles'
import { RecentFileContextMenu, type RecentFileMenuAction } from './RecentFileContextMenu'
import {
  ConfirmDialog,
  FileInfoDialog,
  HistoryDialog,
  MessageDialog,
  RenameDialog,
  ShareDialog,
} from './RecentFileDialogs'
import type { FileStatInfo, RecentFile } from '@/types/file'

interface RecentFilesProps {
  files: RecentFile[]
  onOpen: (path: string) => void
}

type DialogState =
  | { kind: 'info'; file: RecentFile; stat: FileStatInfo }
  | { kind: 'rename'; file: RecentFile }
  | { kind: 'share'; files: RecentFile[] }
  | { kind: 'history'; file: RecentFile }
  | { kind: 'delete'; file: RecentFile }
  | { kind: 'message'; title: string; message: string }

interface MenuState {
  x: number
  y: number
  file: RecentFile
}

export function RecentFiles({ files, onOpen }: RecentFilesProps) {
  const { language, t } = useTranslation()
  const setRecentFiles = useFileStore((s) => s.setRecentFiles)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set())

  // Keep selection valid when the recent-file list changes after an operation.
  useEffect(() => {
    const paths = new Set(files.map((file) => file.path))
    setSelectedPaths((current) => {
      const next = new Set([...current].filter((path) => paths.has(path)))
      return next.size === current.size ? current : next
    })
  }, [files])

  const showError = useCallback((message: string) => {
    setDialog({ kind: 'message', title: t('recentFiles.noticeTitle'), message })
  }, [t])

  const renameErrorMessage = useCallback((errorCode?: string) => {
    switch (errorCode) {
      case 'name-exists': return t('recentFiles.errorNameExists')
      case 'invalid-name': return t('recentFiles.errorInvalidName')
      case 'not-found': return t('recentFiles.errorNotFound')
      default: return t('recentFiles.errorOperationFailed')
    }
  }, [t])

  const handleAction = useCallback(async (file: RecentFile, action: RecentFileMenuAction) => {
    setMenu(null)
    switch (action) {
      case 'open':
        onOpen(file.path)
        break
      case 'show-in-folder': {
        const result = await window.api.file.showInFolder(file.path)
        if (!result.success) showError(t('recentFiles.errorNotFound'))
        break
      }
      case 'remove-record':
        setRecentFiles(await window.api.file.removeRecent(file.path))
        break
      case 'info': {
        const stat = await window.api.file.stat(file.path)
        if (!stat.exists) {
          showError(t('recentFiles.errorNotFound'))
        } else {
          setDialog({ kind: 'info', file, stat })
        }
        break
      }
      case 'share': {
        const candidates = files.filter((candidate) => selectedPaths.has(candidate.path))
        const filesToShare = candidates.length > 0 ? candidates : [file]
        const shareable = await Promise.all(
          filesToShare.map(async (candidate) => ({
            file: candidate,
            stat: await window.api.file.stat(candidate.path),
          })),
        )
        const existingFiles = shareable
          .filter(({ stat }) => stat.exists)
          .map(({ file: candidate }) => candidate)

        if (existingFiles.length === 0) {
          showError(t('recentFiles.errorNotFound'))
        } else {
          setDialog({ kind: 'share', files: existingFiles })
        }
        break
      }
      case 'rename': {
        // 正在编辑的文件重命名会让已打开的标签页指向失效路径（可能丢失未保存内容），按 WPS 惯例阻止
        if (useEditorStore.getState().currentFile === file.path) {
          showError(t('recentFiles.errorFileOpen'))
          break
        }
        const stat = await window.api.file.stat(file.path)
        if (!stat.exists) {
          showError(t('recentFiles.errorNotFound'))
        } else {
          setDialog({ kind: 'rename', file })
        }
        break
      }
      case 'history':
        setDialog({ kind: 'history', file })
        break
      case 'delete':
        if (useEditorStore.getState().currentFile === file.path) {
          showError(t('recentFiles.errorFileOpen'))
          break
        }
        setDialog({ kind: 'delete', file })
        break
    }
  }, [files, onOpen, selectedPaths, setRecentFiles, showError, t])

  const submitRename = useCallback(async (file: RecentFile, newName: string) => {
    const result = await window.api.file.rename(file.path, newName)
    if (!result.success) return renameErrorMessage(result.errorCode)
    if (result.recent) setRecentFiles(result.recent)
    setDialog(null)
    return null
  }, [renameErrorMessage, setRecentFiles])

  const confirmDelete = useCallback(async (file: RecentFile) => {
    const result = await window.api.file.delete(file.path)
    if (!result.success) {
      setDialog({
        kind: 'message',
        title: t('recentFiles.deleteTitle'),
        message: t('recentFiles.errorOperationFailed'),
      })
      return
    }
    if (result.recent) setRecentFiles(result.recent)
    setDialog(null)
  }, [setRecentFiles, t])

  if (files.length === 0) {
    return <p className="px-4 py-2 text-xs text-muted-foreground">{t('recentFiles.noRecentFiles')}</p>
  }

  return (
    // 上下留白，避免列表行贴住 ScrollArea 边缘时被裁切
    <div role="listbox" aria-multiselectable="true" className="space-y-0.5 px-2 py-3 select-none">
      {files.map((file, index) => (
        <FileHoverCard
          key={file.path}
          disabled={menu !== null || dialog !== null}
          content={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'hsl(var(--card-foreground))' }}>
                {file.name}
              </div>
              <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', wordBreak: 'break-all' }}>
                {file.path}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                  color: 'hsl(var(--muted-foreground))',
                }}
              >
                <Clock style={{ width: 12, height: 12, flexShrink: 0 }} />
                {formatDate(file.openedAt, language)}
              </div>
            </div>
          }
        >
          <button
            type="button"
            data-recent-file-index={index}
            role="option"
            aria-selected={selectedPaths.has(file.path)}
            className={cn(
              'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
              FILE_LIST_ROW_HOVER_BORDER,
              selectedPaths.has(file.path) && 'bg-accent',
            )}
            onClick={() => setSelectedPaths(new Set([file.path]))}
            onDoubleClick={() => onOpen(file.path)}
            onContextMenu={(event) => {
              // A context menu is only meaningful for an already selected file.
              // Right-clicking an unselected row must not implicitly select it or
              // open the row's actions.
              if (!selectedPaths.has(file.path)) return
              event.preventDefault()
              setMenu({ x: event.clientX, y: event.clientY, file })
            }}
          >
            <span
              role="checkbox"
              aria-checked={selectedPaths.has(file.path)}
              aria-label={file.name}
              data-recent-file-select
              className={cn(
                'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[2px] border transition-opacity',
                selectedPaths.has(file.path)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-black/55 bg-white text-transparent opacity-0 group-hover:opacity-100 hover:border-black dark:border-white/65 dark:bg-[#242424] dark:hover:border-white',
              )}
              onClick={(event) => {
                event.stopPropagation()
                setSelectedPaths((current) => {
                  const next = new Set(current)
                  if (next.has(file.path)) next.delete(file.path)
                  else next.add(file.path)
                  return next
                })
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {selectedPaths.has(file.path) && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <FileIcon filePath={file.path} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{file.name}</p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3 shrink-0" />
                {formatDate(file.openedAt, language)}
              </p>
            </div>
          </button>
        </FileHoverCard>
      ))}

      {menu && (
        <RecentFileContextMenu
          x={menu.x}
          y={menu.y}
          onAction={(action) => void handleAction(menu.file, action)}
          onClose={() => setMenu(null)}
        />
      )}

      {dialog?.kind === 'info' && (
        <FileInfoDialog file={dialog.file} stat={dialog.stat} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'rename' && (
        <RenameDialog
          file={dialog.file}
          onClose={() => setDialog(null)}
          onSubmit={(newName) => submitRename(dialog.file, newName)}
        />
      )}
      {dialog?.kind === 'share' && (
        <ShareDialog files={dialog.files} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'history' && (
        <HistoryDialog file={dialog.file} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('recentFiles.deleteTitle')}
          message={t('recentFiles.deleteMessage', { name: dialog.file.name })}
          confirmLabel={t('recentFiles.deleteConfirm')}
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() => confirmDelete(dialog.file)}
        />
      )}
      {dialog?.kind === 'message' && (
        <MessageDialog title={dialog.title} message={dialog.message} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}
