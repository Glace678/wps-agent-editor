import { useEffect } from 'react'
import { TriangleAlert, X } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/runtime'
import type { LanguageCode } from '@/lib/i18n'

interface SaveConfirmDialogProps {
  fileName: string
  isOpen: boolean
  onSave: () => void | Promise<void>
  onDontSave: () => void
  onCancel: () => void
}

interface SaveConfirmTexts {
  title: string
  message: (fileName: string) => string
  save: string
  dontSave: string
  cancel: string
}

const SAVE_CONFIRM_TEXTS: Record<LanguageCode, SaveConfirmTexts> = {
  'zh-CN': {
    title: '是否保存文档？',
    message: (f) => `是否保存对 "${f}" 的更改？`,
    save: '保存(S)',
    dontSave: '不保存(N)',
    cancel: '取消',
  },
  en: {
    title: 'Save Document?',
    message: (f) => `Do you want to save the changes you made to "${f}"?`,
    save: 'Save (S)',
    dontSave: "Don't Save (N)",
    cancel: 'Cancel',
  },
  ja: {
    title: 'ドキュメントを保存しますか？',
    message: (f) => `"${f}" への変更を保存しますか？`,
    save: '保存 (S)',
    dontSave: '保存しない (N)',
    cancel: 'キャンセル',
  },
  es: {
    title: '¿Guardar documento?',
    message: (f) => `¿Desea guardar los cambios en "${f}"?`,
    save: 'Guardar (S)',
    dontSave: 'No guardar (N)',
    cancel: 'Cancelar',
  },
  pt: {
    title: 'Salvar documento?',
    message: (f) => `Deseja salvar as alterações em "${f}"?`,
    save: 'Salvar (S)',
    dontSave: 'Não salvar (N)',
    cancel: 'Cancelar',
  },
  de: {
    title: 'Dokument speichern?',
    message: (f) => `Möchten Sie die Änderungen an "${f}" speichern?`,
    save: 'Speichern (S)',
    dontSave: 'Nicht speichern (N)',
    cancel: 'Abbrechen',
  },
  fr: {
    title: 'Enregistrer le document ?',
    message: (f) => `Voulez-vous enregistrer les modifications apportées à « ${f} » ?`,
    save: 'Enregistrer (S)',
    dontSave: 'Ne pas enregistrer (N)',
    cancel: 'Annuler',
  },
  ru: {
    title: 'Сохранить документ?',
    message: (f) => `Сохранить изменения в файле "${f}"?`,
    save: 'Сохранить (S)',
    dontSave: 'Не сохранять (N)',
    cancel: 'Отмена',
  },
  ar: {
    title: 'هل تريد حفظ المستند؟',
    message: (f) => `هل تريد حفظ التغييرات التي تم إجراؤها على "${f}"؟`,
    save: 'حفظ (S)',
    dontSave: 'عدم الحفظ (N)',
    cancel: 'إلغاء',
  },
}

export function SaveConfirmDialog({
  fileName,
  isOpen,
  onSave,
  onDontSave,
  onCancel,
}: SaveConfirmDialogProps) {
  const { language } = useTranslation()
  const texts = SAVE_CONFIRM_TEXTS[language as LanguageCode] ?? SAVE_CONFIRM_TEXTS.en

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

  const titleText = texts.title
  const messageText = texts.message(fileName)
  const saveText = texts.save
  const dontSaveText = texts.dontSave
  const cancelText = texts.cancel

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
