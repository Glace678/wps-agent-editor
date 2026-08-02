import { FileText, Pencil, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from '@/lib/i18n/runtime'

export type PresentationEditDialogMode = 'text' | 'outline'

interface PresentationEditDialogProps {
  mode: PresentationEditDialogMode
  title: string
  body: string
  busy: boolean
  error: string
  onTitleChange: (value: string) => void
  onBodyChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}

export function PresentationEditDialog({
  mode,
  title,
  body,
  busy,
  error,
  onTitleChange,
  onBodyChange,
  onClose,
  onSubmit,
}: PresentationEditDialogProps) {
  const { t } = useTranslation()
  const titleInputRef = useRef<HTMLInputElement>(null)
  const bodyInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (mode === 'text') titleInputRef.current?.focus()
    else bodyInputRef.current?.focus()
  }, [mode])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [busy, onClose])

  return (
    <div
      className="presentation-edit-dialog-overlay"
      role="presentation"
      data-testid="presentation-edit-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <section
        className="presentation-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="presentation-edit-dialog-title"
        data-testid={`presentation-${mode}-dialog`}
      >
        <header className="presentation-edit-dialog-header">
          <span className="presentation-edit-dialog-title-icon" aria-hidden="true">
            {mode === 'text' ? <Pencil /> : <FileText />}
          </span>
          <h2 id="presentation-edit-dialog-title">
            {mode === 'text'
              ? t('presentationViewer.editSlideText')
              : t('presentationViewer.importOutline')}
          </h2>
          <button
            type="button"
            className="presentation-icon-button"
            aria-label={t('presentationViewer.cancel')}
            disabled={busy}
            onClick={onClose}
          >
            <X />
          </button>
        </header>

        <div className="presentation-edit-dialog-body">
          {mode === 'text' ? (
            <>
              <label htmlFor="presentation-slide-title">{t('presentationViewer.slideTitle')}</label>
              <input
                ref={titleInputRef}
                id="presentation-slide-title"
                value={title}
                disabled={busy}
                data-testid="presentation-slide-title-input"
                onChange={(event) => onTitleChange(event.target.value)}
              />
              <label htmlFor="presentation-slide-body">{t('presentationViewer.slideBody')}</label>
              <textarea
                ref={bodyInputRef}
                id="presentation-slide-body"
                value={body}
                disabled={busy}
                rows={9}
                data-testid="presentation-slide-body-input"
                onChange={(event) => onBodyChange(event.target.value)}
              />
            </>
          ) : (
            <>
              <label htmlFor="presentation-outline">{t('presentationViewer.outline')}</label>
              <textarea
                ref={bodyInputRef}
                id="presentation-outline"
                value={body}
                disabled={busy}
                rows={14}
                placeholder={t('presentationViewer.outlinePlaceholder')}
                data-testid="presentation-outline-input"
                onChange={(event) => onBodyChange(event.target.value)}
              />
            </>
          )}
          {error ? <p className="presentation-edit-dialog-error" role="alert">{error}</p> : null}
        </div>

        <footer className="presentation-edit-dialog-footer">
          <button type="button" className="presentation-dialog-button" disabled={busy} onClick={onClose}>
            {t('presentationViewer.cancel')}
          </button>
          <button
            type="button"
            className="presentation-dialog-button presentation-dialog-button--primary"
            disabled={busy || (mode === 'outline' && !body.trim())}
            data-testid="presentation-edit-dialog-submit"
            onClick={onSubmit}
          >
            {busy ? t('presentationViewer.applying') : t('presentationViewer.apply')}
          </button>
        </footer>
      </section>
    </div>
  )
}
