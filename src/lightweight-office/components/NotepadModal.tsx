import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from '@/lib/i18n/runtime'

/**
 * Fixed inset overlay used by the Windows-11-Notepad-style dialogs: Go to,
 * Insert link, Page setup and Save as. Backdrop click closes; header height
 * grows for the wide settings-style variant.
 */
export function NotepadModal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/25 p-4 backdrop-blur-[1px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className={`flex max-h-[calc(100%-2rem)] w-full flex-col rounded-2xl border border-black/10 bg-[#f9f9f9] text-[#1f1f1f] shadow-2xl dark:border-white/10 dark:bg-[#2b2b2b] dark:text-[#f5f5f5] ${wide ? 'max-w-[720px]' : 'max-w-[400px]'}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className={`flex items-center justify-between px-5 ${wide ? 'h-14' : 'h-12'}`}>
          <h2 className={wide ? 'text-[20px] font-semibold' : 'text-[16px] font-semibold'}>{title}</h2>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-black/[0.07] dark:hover:bg-white/[0.08]"
            aria-label={t('menu.close')}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 pb-5">{children}</div>
      </section>
    </div>
  )
}
