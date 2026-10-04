import { NotepadModal } from '../../../components/NotepadModal'
import { dialogButtonClass, inputClass, primaryDialogButtonClass } from '../dialog-styles'

export function InsertLinkDialog({
  title,
  cancelLabel,
  displayTextLabel,
  addressLabel,
  textPlaceholder,
  addressPlaceholder,
  insertActionLabel,
  linkText,
  linkUrl,
  onLinkTextChange,
  onLinkUrlChange,
  onClose,
  onSubmit,
}: {
  title: string
  cancelLabel: string
  displayTextLabel: string
  addressLabel: string
  textPlaceholder: string
  addressPlaceholder: string
  insertActionLabel: string
  linkText: string
  linkUrl: string
  onLinkTextChange: (value: string) => void
  onLinkUrlChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}) {
  return (
    <NotepadModal title={title} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <label className="mb-1.5 block text-[13px]" htmlFor="notepad-link-text">{displayTextLabel}</label>
        <input
          id="notepad-link-text"
          className={inputClass}
          value={linkText}
          placeholder={textPlaceholder}
          onChange={(event) => onLinkTextChange(event.target.value)}
        />
        <label className="mb-1.5 mt-3 block text-[13px]" htmlFor="notepad-link-address">{addressLabel}</label>
        <input
          id="notepad-link-address"
          className={inputClass}
          value={linkUrl}
          placeholder={addressPlaceholder}
          onChange={(event) => onLinkUrlChange(event.target.value)}
          autoFocus
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="submit"
            className={primaryDialogButtonClass}
            disabled={!linkUrl.trim()}
          >
            {insertActionLabel}
          </button>
          <button type="button" className={dialogButtonClass} onClick={onClose}>{cancelLabel}</button>
        </div>
      </form>
    </NotepadModal>
  )
}
