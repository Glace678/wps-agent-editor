import { Fragment } from 'react'
import { NotepadModal } from '../../../components/NotepadModal'
import { dialogButtonClass, inputClass, primaryDialogButtonClass } from '../dialog-styles'

export type NotepadPageSize = 'A4' | 'Letter'
export type NotepadOrientation = 'portrait' | 'landscape'

export interface NotepadPageSetup {
  size: NotepadPageSize
  orientation: NotepadOrientation
  margins: { top: number; right: number; bottom: number; left: number }
  header: string
  footer: string
}

export function PageSetupDialog({
  title,
  cancelLabel,
  confirmLabel,
  labels,
  pageSetup,
  onChange,
  onClose,
}: {
  title: string
  cancelLabel: string
  confirmLabel: string
  labels: {
    paperSize: string
    orientation: string
    portrait: string
    landscape: string
    marginTop: string
    marginBottom: string
    marginLeft: string
    marginRight: string
    header: string
    footer: string
  }
  pageSetup: NotepadPageSetup
  onChange: (next: NotepadPageSetup) => void
  onClose: () => void
}) {
  const marginSides = ['top', 'bottom', 'left', 'right'] as const
  const marginLabels: Record<(typeof marginSides)[number], string> = {
    top: labels.marginTop,
    bottom: labels.marginBottom,
    left: labels.marginLeft,
    right: labels.marginRight,
  }

  const patch = (patchValue: Partial<NotepadPageSetup>) =>
    onChange({ ...pageSetup, ...patchValue })

  return (
    <NotepadModal title={title} onClose={onClose}>
      <div className="grid grid-cols-[100px_1fr] items-center gap-3 text-[13px]">
        <label htmlFor="notepad-page-size">{labels.paperSize}</label>
        <select
          id="notepad-page-size"
          className={inputClass}
          value={pageSetup.size}
          onChange={(event) => patch({ size: event.target.value as NotepadPageSize })}
        >
          <option value="A4">A4</option>
          <option value="Letter">Letter</option>
        </select>
        <label htmlFor="notepad-orientation">{labels.orientation}</label>
        <select
          id="notepad-orientation"
          className={inputClass}
          value={pageSetup.orientation}
          onChange={(event) => patch({ orientation: event.target.value as NotepadOrientation })}
        >
          <option value="portrait">{labels.portrait}</option>
          <option value="landscape">{labels.landscape}</option>
        </select>
        {marginSides.map((side) => (
          <Fragment key={side}>
            <label htmlFor={`notepad-margin-${side}`}>{marginLabels[side]}</label>
            <input
              id={`notepad-margin-${side}`}
              type="number"
              min={5}
              max={50}
              className={inputClass}
              value={pageSetup.margins[side]}
              onChange={(event) => patch({
                margins: {
                  ...pageSetup.margins,
                  [side]: Math.max(5, Math.min(50, Number(event.target.value) || 5)),
                },
              })}
            />
          </Fragment>
        ))}
        <label htmlFor="notepad-print-header">{labels.header}</label>
        <input
          id="notepad-print-header"
          className={inputClass}
          value={pageSetup.header}
          onChange={(event) => patch({ header: event.target.value })}
        />
        <label htmlFor="notepad-print-footer">{labels.footer}</label>
        <input
          id="notepad-print-footer"
          className={inputClass}
          value={pageSetup.footer}
          onChange={(event) => patch({ footer: event.target.value })}
        />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={dialogButtonClass} onClick={onClose}>{cancelLabel}</button>
        <button type="button" className={primaryDialogButtonClass} onClick={onClose}>{confirmLabel}</button>
      </div>
    </NotepadModal>
  )
}
