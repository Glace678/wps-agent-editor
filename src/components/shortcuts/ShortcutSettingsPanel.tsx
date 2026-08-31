import { Fragment, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  areShortcutChordsEquivalent,
  captureShortcutChord,
  findShortcutConflicts,
  formatChordDisplay,
  getChordOverrides,
  getLocalizedShortcutCommandLabel,
  getOfficeShortcutCatalog,
  getShortcutSettingsRows,
  saveChordOverrides,
  type ShortcutBinding,
  type ShortcutCategory,
  type ShortcutModifier,
} from '@/lib/office-shortcuts'
import { useTranslation, type TranslationApi } from '@/lib/i18n/runtime'

export { getShortcutSettingsRows }

const CATEGORY_KEY = {
  file: 'shortcutSettings.categoryFile',
  edit: 'shortcutSettings.categoryEdit',
  format: 'shortcutSettings.categoryFormat',
  view: 'shortcutSettings.categoryView',
  navigate: 'shortcutSettings.categoryNavigate',
  insert: 'shortcutSettings.categoryInsert',
  help: 'shortcutSettings.categoryHelp',
} as const

function contextLabel(binding: ShortcutBinding, t: TranslationApi['t']): string {
  if (binding.contexts.includes('all')) return t('shortcutSettings.allContexts')
  return binding.contexts
    .map((c) => (c === 'word' ? 'Word' : c === 'excel' ? 'Excel' : t('shortcutSettings.textContext')))
    .join(' / ')
}

/**
 * 快捷键设置 — driven by the same OFFICE_SHORTCUT_CATALOG used at runtime.
 */
export function ShortcutSettingsPanel({ onClose }: { onClose?: () => void }) {
  const { language, t } = useTranslation()
  const catalog = useMemo(() => getOfficeShortcutCatalog(), [])
  const [overrides, setOverrides] = useState<Record<string, string>>(() => getChordOverrides())
  const [filter, setFilter] = useState('')
  const [savedFlash, setSavedFlash] = useState(false)
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [draftChord, setDraftChord] = useState('')
  const [conflicts, setConflicts] = useState<{
    bindingId: string
    bindings: ShortcutBinding[]
  } | null>(null)
  const latchedModifiers = useRef<ShortcutModifier[]>([])

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return catalog.filter((b) => {
      if (!q) return true
      const chord = (overrides[b.id] ?? b.defaultChord).toLowerCase()
      const localizedLabel = getLocalizedShortcutCommandLabel(b, t).toLowerCase()
      return (
        localizedLabel.includes(q)
        || b.label.toLowerCase().includes(q)
        || b.labelEn.toLowerCase().includes(q)
        || b.actionId.toLowerCase().includes(q)
        || chord.includes(q)
        || b.defaultChord.toLowerCase().includes(q)
      )
    })
  }, [catalog, filter, overrides, t])

  const grouped = useMemo(() => {
    const map = new Map<ShortcutCategory, ShortcutBinding[]>()
    for (const b of rows) {
      const list = map.get(b.category) ?? []
      list.push(b)
      map.set(b.category, list)
    }
    return map
  }, [rows])

  const resetAll = () => {
    setRecordingId(null)
    setDraftChord('')
    setConflicts(null)
    latchedModifiers.current = []
    setOverrides({})
    saveChordOverrides({})
    setSavedFlash(true)
    window.setTimeout(() => setSavedFlash(false), 1200)
  }

  const resetOne = (id: string) => {
    const next = { ...overrides }
    delete next[id]
    if (recordingId === id) {
      setRecordingId(null)
      setDraftChord('')
      setConflicts(null)
      latchedModifiers.current = []
    }
    setOverrides(next)
    saveChordOverrides(next)
  }

  const beginRecording = (id: string) => {
    setRecordingId(id)
    setDraftChord('')
    setConflicts(null)
    setSavedFlash(false)
    latchedModifiers.current = []
  }

  const stopRecording = (id: string) => {
    if (recordingId !== id) return
    setRecordingId(null)
    setDraftChord('')
    setConflicts(null)
    latchedModifiers.current = []
  }

  const recordKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
    binding: ShortcutBinding,
  ) => {
    event.preventDefault()
    event.stopPropagation()

    const captured = captureShortcutChord(event.nativeEvent, latchedModifiers.current)
    if (!captured) return

    setDraftChord(captured.chord)
    setConflicts(null)
    if (!captured.complete) {
      latchedModifiers.current = captured.modifiers
      return
    }

    latchedModifiers.current = []
    const nextConflicts = findShortcutConflicts(binding.id, captured.chord, overrides)
    if (nextConflicts.length > 0) {
      setConflicts({ bindingId: binding.id, bindings: nextConflicts })
      return
    }

    const next = { ...overrides }
    if (areShortcutChordsEquivalent(captured.chord, binding.defaultChord)) {
      delete next[binding.id]
    } else {
      next[binding.id] = captured.chord
    }
    setOverrides(next)
    saveChordOverrides(next)
    setRecordingId(null)
    setDraftChord('')
    setSavedFlash(true)
    window.setTimeout(() => setSavedFlash(false), 1200)
    event.currentTarget.blur()
  }

  return (
    <div className="flex max-h-[min(70vh,560px)] flex-col text-[13px]" data-testid="shortcut-settings-panel">
      <p className="mb-3 text-[12px] opacity-70">
        {t('shortcutSettings.importedDescription', { count: catalog.length })}
        <strong className="sr-only" data-testid="shortcut-catalog-count">{catalog.length}</strong>
      </p>
      <input
        className="mb-3 h-[200px] w-full rounded-2xl border border-black/15 bg-white px-6 text-[20px] outline-none focus:border-[#0067c0] dark:border-white/15 dark:bg-[#202020]"
        placeholder={t('shortcutSettings.searchPlaceholder')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label={t('shortcutSettings.searchPlaceholder')}
        data-testid="shortcut-settings-filter"
      />
      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-black/10 dark:border-white/10">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 bg-[#f0f0f0] dark:bg-[#2a2a2a]">
            <tr className="text-[12px] opacity-80">
              <th className="px-2 py-1.5 font-medium">{t('shortcutSettings.command')}</th>
              <th className="px-2 py-1.5 font-medium">{t('shortcutSettings.shortcut')}</th>
              <th className="px-2 py-1.5 font-medium">{t('shortcutSettings.scope')}</th>
              <th className="px-2 py-1.5 font-medium w-16" />
            </tr>
          </thead>
          <tbody>
            {Array.from(grouped.entries()).map(([category, bindings]) => (
              <Fragment key={category}>
                <tr className="bg-black/[0.03] dark:bg-white/[0.04]">
                  <td colSpan={4} className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide opacity-60">
                    {t(CATEGORY_KEY[category])}
                  </td>
                </tr>
                {bindings.map((b) => {
                  const chord = overrides[b.id] ?? b.defaultChord
                  const customized = Boolean(overrides[b.id])
                  const localizedLabel = getLocalizedShortcutCommandLabel(b, t)
                  const isRecording = recordingId === b.id
                  const rowConflicts = conflicts?.bindingId === b.id ? conflicts.bindings : []
                  const shownChord = isRecording && draftChord ? draftChord : chord
                  const conflictDescriptionId = `shortcut-conflict-${b.id}`
                  return (
                    <tr
                      key={b.id}
                      className="border-t border-black/5 dark:border-white/5"
                      data-shortcut-id={b.id}
                      data-action-id={b.actionId}
                      data-default-chord={b.defaultChord}
                    >
                      <td className="px-2 py-1.5">
                        <div>{localizedLabel}</div>
                        {language !== 'en' && (
                          <div className="text-[11px] opacity-50">{b.labelEn}</div>
                        )}
                      </td>
                      <td className="w-[200px] px-2 py-1.5 align-middle">
                        <input
                          readOnly
                          spellCheck={false}
                          value={formatChordDisplay(shownChord)}
                          className={`h-8 w-full max-w-[180px] cursor-text rounded-[4px] border bg-white px-2.5 text-center font-mono text-[12px] font-semibold outline-none transition-colors dark:bg-[#202020] ${
                            rowConflicts.length > 0
                              ? 'border-[#c42b1c] text-[#c42b1c] focus:border-[#c42b1c] focus:ring-1 focus:ring-[#c42b1c]/30'
                              : isRecording
                                ? 'border-[#0067c0] ring-1 ring-[#0067c0]/30'
                                : 'border-black/15 hover:border-black/30 focus:border-[#0067c0] focus:ring-1 focus:ring-[#0067c0]/25 dark:border-white/15 dark:hover:border-white/30'
                          }`}
                          aria-label={t('shortcutSettings.editShortcut', { command: localizedLabel })}
                          aria-invalid={rowConflicts.length > 0}
                          aria-describedby={rowConflicts.length > 0 ? conflictDescriptionId : undefined}
                          data-shortcut-recorder
                          data-testid={`shortcut-recorder-${b.id}`}
                          data-recording={isRecording ? 'true' : 'false'}
                          onFocus={() => beginRecording(b.id)}
                          onClick={() => beginRecording(b.id)}
                          onKeyDown={(event) => recordKeyDown(event, b)}
                          onBlur={() => stopRecording(b.id)}
                        />
                        {customized && !isRecording && (
                          <span className="mt-0.5 block text-[10px] text-[#0f6cbd]">{t('shortcutSettings.modified')}</span>
                        )}
                        {rowConflicts.length > 0 && (
                          <div
                            id={conflictDescriptionId}
                            className="mt-1 max-w-[180px] text-[11px] leading-4 text-[#c42b1c]"
                            role="alert"
                          >
                            {t('shortcutSettings.conflict', {
                              commands: rowConflicts
                                .map((binding) => getLocalizedShortcutCommandLabel(binding, t))
                                .join(' / '),
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-[12px] opacity-70">{contextLabel(b, t)}</td>
                      <td className="px-2 py-1.5">
                        {customized && (
                          <button
                            type="button"
                            className="text-[11px] text-[#0f6cbd] hover:underline"
                            onClick={() => resetOne(b.id)}
                          >
                            {t('shortcutSettings.restore')}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="h-8 rounded-[4px] border border-black/10 px-3 hover:bg-black/[0.04] dark:border-white/10 dark:hover:bg-white/[0.06]"
          onClick={resetAll}
        >
          {t('shortcutSettings.resetAll')}
        </button>
        <div className="flex items-center gap-2">
          {savedFlash && <span className="text-[12px] text-green-600">{t('shortcutSettings.saved')}</span>}
          {onClose && (
            <button
              type="button"
              className="h-8 rounded-[4px] border border-[#0067c0] bg-[#0067c0] px-4 text-white hover:bg-[#005a9e]"
              onClick={onClose}
            >
              {t('shortcutSettings.done')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
