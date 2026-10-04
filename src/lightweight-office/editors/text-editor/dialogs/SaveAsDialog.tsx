import { NotepadModal } from '../../../components/NotepadModal'
import { dialogButtonClass, inputClass, primaryDialogButtonClass } from '../dialog-styles'
import type { LineEnding, TextEncoding } from '../../text-editor-utils'

export function SaveAsDialog({
  title,
  cancelLabel,
  continueLabel,
  encodingLabel,
  lineEndingLabel,
  encoding,
  lineEnding,
  onEncodingChange,
  onLineEndingChange,
  onClose,
  onContinue,
}: {
  title: string
  cancelLabel: string
  continueLabel: string
  encodingLabel: string
  lineEndingLabel: string
  encoding: TextEncoding
  lineEnding: LineEnding
  onEncodingChange: (value: TextEncoding) => void
  onLineEndingChange: (value: LineEnding) => void
  onClose: () => void
  onContinue: () => void
}) {
  return (
    <NotepadModal title={title} onClose={onClose}>
      <div className="space-y-3 text-[13px]">
        <div>
          <label className="mb-1.5 block" htmlFor="notepad-save-encoding">{encodingLabel}</label>
          <select
            id="notepad-save-encoding"
            className={inputClass}
            value={encoding}
            onChange={(event) => onEncodingChange(event.target.value as TextEncoding)}
          >
            <option value="utf-8">UTF-8</option>
            <option value="utf-16le">UTF-16 LE</option>
            <option value="utf-16be">UTF-16 BE</option>
            <option value="ansi">ANSI</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block" htmlFor="notepad-save-line-ending">{lineEndingLabel}</label>
          <select
            id="notepad-save-line-ending"
            className={inputClass}
            value={lineEnding}
            onChange={(event) => onLineEndingChange(event.target.value as LineEnding)}
          >
            <option value="crlf">Windows (CRLF)</option>
            <option value="lf">Unix (LF)</option>
            <option value="cr">Macintosh (CR)</option>
          </select>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={dialogButtonClass} onClick={onClose}>{cancelLabel}</button>
        <button type="button" className={primaryDialogButtonClass} onClick={onContinue}>{continueLabel}</button>
      </div>
    </NotepadModal>
  )
}
