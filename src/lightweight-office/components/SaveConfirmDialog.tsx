import { useEffect } from 'react'
import { TriangleAlert, X } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/runtime'

interface SaveConfirmDialogProps {
  fileName: string
  isOpen: boolean
  onSave: () => void | Promise<void>
  onDontSave: () => void
  onCancel: () => void
}

export function SaveConfirmDialog({
  fileName,
  isOpen,
  onSave,
  onDontSave,
  onCancel,
}: SaveConfirmDialogProps) {
  const { language } = useTranslation()
  const isZh = language.startsWith('zh')

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // Prevent propagation to underlying editors
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCancel()
        return
      }

      if (event.key === 's' || event.key === 'S') {
        if (!event.ctrlKey && !event.metaKey) {
          event.preventDefault()
          event.stopPropagation()
          void onSave()
          return
        }
      }

      if (event.key === 'n' || event.key === 'N') {
        if (!event.ctrlKey && !event.metaKey) {
          event.preventDefault()
          event.stopPropagation()
          onDontSave()
          return
        }
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        void onSave()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, onCancel, onDontSave, onSave])

  if (!isOpen) return null

  const titleText = isZh ? '是否保存文档？' : 'Save Document?'
  const messageText = isZh
    ? `是否保存对 "${fileName}" 的更改？`
    : `Do you want to save the changes you made to "${fileName}"?`
  const saveText = isZh ? '保存(S)' : 'Save (S)'
  const dontSaveText = isZh ? '不保存(N)' : "Don't Save (N)"
  const cancelText = isZh ? '取消' : 'Cancel'

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1px] select-none"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <section
        className="flex w-full max-w-[420px] flex-col rounded-2xl border border-black/10 bg-[#f9f9f9] p-5 text-[#1f1f1f] shadow-2xl dark:border-white/10 dark:bg-[#202020] dark:text-[#f5f5f5]"
        role="dialog"
        aria-modal="true"
        aria-label={titleText}
      >
        <header className="flex items-center justify-between">
          <h2 className="flex items-center gap-2.5 text-[16px] font-semibold text-foreground dark:text-[#f5f5f5]">
            <TriangleAlert className="h-5 w-5 text-amber-500 fill-amber-500/20 shrink-0" />
            {titleText}
          </h2>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/10 dark:hover:text-[#f5f5f5] transition-colors"
            aria-label={cancelText}
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="mt-4 mb-6">
          <p className="text-[14px] leading-relaxed text-foreground/90 dark:text-[#e0e0e0]">
            {messageText}
          </p>
        </div>

        <footer className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            className="flex h-8 min-w-[76px] items-center justify-center rounded-lg bg-[#0078d4] px-4 text-[13px] font-medium text-white shadow-sm hover:bg-[#106ebe] active:bg-[#005a9e] transition-colors cursor-pointer"
            onClick={() => void onSave()}
          >
            {saveText}
          </button>
          <button
            type="button"
            className="flex h-8 min-w-[76px] items-center justify-center rounded-lg border border-black/10 bg-secondary/80 px-4 text-[13px] font-medium text-foreground hover:bg-secondary active:bg-secondary/60 dark:border-white/10 dark:bg-[#303030] dark:text-[#f5f5f5] dark:hover:bg-[#3a3a3a] transition-colors cursor-pointer"
            onClick={onDontSave}
          >
            {dontSaveText}
          </button>
          <button
            type="button"
            className="flex h-8 min-w-[64px] items-center justify-center rounded-lg border border-black/10 bg-secondary/80 px-4 text-[13px] font-medium text-foreground hover:bg-secondary active:bg-secondary/60 dark:border-white/10 dark:bg-[#303030] dark:text-[#f5f5f5] dark:hover:bg-[#3a3a3a] transition-colors cursor-pointer"
            onClick={onCancel}
          >
            {cancelText}
          </button>
        </footer>
      </section>
    </div>
  )
}
