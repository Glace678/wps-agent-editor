import { NotepadModal } from '../../../components/NotepadModal'
import { dialogButtonClass, inputClass, primaryDialogButtonClass } from '../dialog-styles'

export function GoToLineDialog({
  title,
  cancelLabel,
  lineNumberLabel,
  goActionLabel,
  lineRangeText,
  lineCount,
  value,
  onChange,
  onClose,
  onConfirm,
}: {
  title: string
  cancelLabel: string
  lineNumberLabel: string
  goActionLabel: string
  lineRangeText: string
  lineCount: number
  value: string
  onChange: (value: string) => void
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <NotepadModal title={title} onClose={onClose}>
      <label className="mb-2 block text-[13px]" htmlFor="notepad-go-to-line">{lineNumberLabel}</label>
      <input
        id="notepad-go-to-line"
        type="number"
        min={1}
        max={lineCount}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onConfirm()
        }}
        className={inputClass}
        autoFocus
      />
      <p className="mt-2 text-[12px] opacity-60">{lineRangeText}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={dialogButtonClass} onClick={onClose}>{cancelLabel}</button>
        <button type="button" className={primaryDialogButtonClass} onClick={onConfirm}>{goActionLabel}</button>
      </div>
    </NotepadModal>
  )
}
