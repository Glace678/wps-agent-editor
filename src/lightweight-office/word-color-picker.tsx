import React, { useMemo, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ArrowLeft, Palette, RotateCcw } from 'lucide-react'
import type { Editor } from '@superdoc-dev/react'
import type { LanguageCode } from '../lib/i18n'
import {
  ExcelCircularColorPicker,
  hexToRgb,
  rgbToHex,
} from './components/ExcelCircularColorPicker'
import type { SuperToolbarLike } from './word-toolbar-overflow'

/** The 8x8 palette used by Fortune Sheet/Excel. Keep the order stable. */
export const EXCEL_COLOR_PALETTE: readonly (readonly string[])[] = [
  ['#000000', '#444444', '#666666', '#999999', '#cccccc', '#eeeeee', '#f3f3f3', '#ffffff'],
  ['#f00f00', '#f90f90', '#ff0ff0', '#0f00f0', '#0ff0ff', '#00f00f', '#90f90f', '#f0ff0f'],
  ['#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#cfe2f3', '#d9d2e9', '#ead1dc'],
  ['#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#9fc5e8', '#b4a7d6', '#d5a6bd'],
  ['#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6fa8dc', '#8e7cc3', '#c27ba0'],
  ['#c00c00', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3d85c6', '#674ea7', '#a64d79'],
  ['#900900', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#0b5394', '#351c75', '#741b47'],
  ['#600600', '#783f04', '#7f6000', '#274e13', '#0c343d', '#073763', '#20124d', '#4c1130'],
] as const

interface WordColorPickerLabels {
  color: string
  custom: string
  reset: string
  back: string
}

const WORD_COLOR_PICKER_LABELS: Record<LanguageCode, WordColorPickerLabels> = {
  'zh-CN': { color: '字体颜色', custom: '更多颜色', reset: '重置颜色', back: '返回调色板' },
  en: { color: 'Text color', custom: 'More colors', reset: 'Reset color', back: 'Back to palette' },
  ja: { color: '文字の色', custom: 'その他の色', reset: '色をリセット', back: 'パレットに戻る' },
  es: { color: 'Color del texto', custom: 'Más colores', reset: 'Restablecer color', back: 'Volver a la paleta' },
  pt: { color: 'Cor do texto', custom: 'Mais cores', reset: 'Redefinir cor', back: 'Voltar à paleta' },
  de: { color: 'Textfarbe', custom: 'Weitere Farben', reset: 'Farbe zurücksetzen', back: 'Zur Palette' },
  fr: { color: 'Couleur du texte', custom: 'Autres couleurs', reset: 'Réinitialiser la couleur', back: 'Retour à la palette' },
  ru: { color: 'Цвет текста', custom: 'Другие цвета', reset: 'Сбросить цвет', back: 'Назад к палитре' },
  ar: { color: 'لون النص', custom: 'ألوان أخرى', reset: 'إعادة تعيين اللون', back: 'العودة إلى اللوحة' },
}

function getWordColorPickerLabels(language?: LanguageCode): WordColorPickerLabels {
  return WORD_COLOR_PICKER_LABELS[language ?? 'en'] ?? WORD_COLOR_PICKER_LABELS.en
}

/** Normalize toolbar/CSS colors to the six-digit format accepted by the picker. */
export function normalizeWordColor(value: unknown): string {
  const raw = String(value ?? '').trim()
  const fromHex = hexToRgb(raw)
  if (fromHex) return rgbToHex(fromHex)

  const rgbMatch = raw.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
  if (rgbMatch) {
    const values = rgbMatch.slice(1, 4).map(Number)
    if (values.every(Number.isFinite)) {
      return rgbToHex({ r: values[0], g: values[1], b: values[2] })
    }
  }
  return '#000000'
}

function isLightSwatch(color: string): boolean {
  const rgb = hexToRgb(color)
  if (!rgb) return false
  return (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 > 170
}

export interface WordFontColorPickerProps {
  initialColor?: string
  language?: LanguageCode
  onApply: (color: string) => void
  onReset: () => void
  onModeChange?: (customOpen: boolean) => void
}

/** Excel-compatible palette with the shared circular custom-color editor. */
export function WordFontColorPicker({
  initialColor = '#000000',
  language,
  onApply,
  onReset,
  onModeChange,
}: WordFontColorPickerProps) {
  const labels = useMemo(() => getWordColorPickerLabels(language), [language])
  const selectedColor = useMemo(() => normalizeWordColor(initialColor), [initialColor])
  const [customOpen, setCustomOpen] = useState(false)

  const openCustomPicker = () => {
    setCustomOpen(true)
    onModeChange?.(true)
  }

  const openPalette = () => {
    setCustomOpen(false)
    onModeChange?.(false)
  }

  return (
    <div
      className={`word-font-color-picker${customOpen ? ' word-font-color-picker--custom' : ''}`}
      data-word-font-color-picker="true"
      role="group"
      aria-label={labels.color}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {!customOpen ? (
        <>
          <div className="word-font-color-picker__palette" role="grid" aria-label={labels.color}>
            {EXCEL_COLOR_PALETTE.flatMap((row, rowIndex) => row.map((color, columnIndex) => {
              const normalized = normalizeWordColor(color)
              const selected = normalized === selectedColor
              return (
                <button
                  key={`${rowIndex}-${columnIndex}-${color}`}
                  type="button"
                  className="word-font-color-picker__swatch"
                  data-word-color-swatch={normalized}
                  aria-label={`${labels.color} ${normalized}`}
                  aria-pressed={selected}
                  title={normalized}
                  style={{ backgroundColor: normalized }}
                  onClick={() => onApply(normalized)}
                >
                  {selected && (
                    <span
                      className="word-font-color-picker__check"
                      style={{ color: isLightSwatch(normalized) ? '#1f2937' : '#ffffff' }}
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                  )}
                </button>
              )
            }))}
          </div>
          <div className="word-font-color-picker__actions">
            <button
              type="button"
              className="word-font-color-picker__reset"
              data-word-color-reset="true"
              onClick={onReset}
              title={labels.reset}
            >
              <RotateCcw size={14} strokeWidth={1.8} aria-hidden="true" />
              <span>{labels.reset}</span>
            </button>
            <button
              type="button"
              className="word-font-color-picker__custom"
              data-word-color-custom="true"
              onClick={openCustomPicker}
              title={labels.custom}
            >
              <Palette size={14} strokeWidth={1.8} aria-hidden="true" />
              <span>{labels.custom}</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="word-font-color-picker__custom-heading">
            <button
              type="button"
              className="word-font-color-picker__back"
              aria-label={labels.back}
              title={labels.back}
              onClick={openPalette}
            >
              <ArrowLeft size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <span>{labels.custom}</span>
          </div>
          <ExcelCircularColorPicker
            initialColor={selectedColor}
            onConfirm={onApply}
            onReset={onReset}
          />
        </>
      )}
    </div>
  )
}

interface RefValue<T> {
  value: T
}

interface WordColorToolbarItem {
  name?: RefValue<string> | string
  type?: string
  command?: string
  expand?: RefValue<boolean>
  iconColor?: RefValue<string>
}

interface WordColorToolbar extends SuperToolbarLike {
  activeEditor?: Editor | null
  getToolbarItemByName?: (name: string) => WordColorToolbarItem | undefined
  emitCommand?: (payload: { item: WordColorToolbarItem; argument?: string | null }) => void
}

export interface InstallWordFontColorPickerOptions {
  toolbar: WordColorToolbar | null | undefined
  root?: HTMLElement | null
  language?: LanguageCode
  getEditor?: () => Editor | null
}

interface MountedPicker {
  menu: HTMLElement
  host: HTMLElement
  grid: HTMLElement
  renderOption: HTMLElement | null
  mount: HTMLElement
  root: Root
  originalGridDisplay: string
}

function readRef<T>(value: T | RefValue<T> | undefined): T | undefined {
  if (value && typeof value === 'object' && 'value' in value) {
    return (value as RefValue<T>).value
  }
  return value as T | undefined
}

function findColorItem(toolbar: WordColorToolbar): WordColorToolbarItem | null {
  const direct = toolbar.getToolbarItemByName?.('color')
  if (direct) return direct
  const all = [...(toolbar.toolbarItems ?? []), ...(toolbar.overflowItems ?? [])] as WordColorToolbarItem[]
  return all.find((item) => readRef(item.name) === 'color') ?? null
}

function isVisibleMenu(menu: HTMLElement): boolean {
  if (!menu.isConnected) return false
  if (menu.getAttribute('aria-hidden') === 'true') return false
  const style = window.getComputedStyle(menu)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function invokeEditorCommand(editor: Editor | null, name: string, argument?: string): boolean {
  const commands = editor?.commands as unknown as Record<string, unknown> | undefined
  const command = commands?.[name]
  if (typeof command !== 'function' || !editor?.commands) return false
  ;(command as (value?: string) => unknown).call(editor.commands, argument)
  return true
}

/**
 * Replace SuperDoc's 7-column color grid while keeping its toolbar command
 * pipeline. The menu is teleported to body, so this adapter watches the body
 * and cleans up roots when SuperDoc closes or rebuilds the dropdown.
 */
export function installWordFontColorPicker({
  toolbar,
  root: ownerRoot,
  language,
  getEditor: resolveEditor,
}: InstallWordFontColorPickerOptions): () => void {
  if (!toolbar || typeof document === 'undefined' || !document.body) return () => {}

  const toolbarRoot = ownerRoot ?? toolbar.toolbarContainer ?? null
  const mounted = new Map<HTMLElement, MountedPicker>()
  let pendingTrigger: HTMLElement | null = null
  let decorationTimer: number | null = null

  const getActiveEditor = () => resolveEditor?.() ?? toolbar.activeEditor ?? null

  const ownsTrigger = (trigger: HTMLElement): boolean => {
    if (!toolbarRoot) return true
    return toolbarRoot.contains(trigger) || Boolean(trigger.closest('.word-editor-panel'))
  }

  const closeMenu = (menu: HTMLElement, item = findColorItem(toolbar)) => {
    if (item?.expand && typeof item.expand === 'object') item.expand.value = false
    else {
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }
  }

  const applyColor = (menu: HTMLElement, value: string) => {
    const color = normalizeWordColor(value)
    const item = findColorItem(toolbar)
    if (item?.iconColor) item.iconColor.value = color

    try {
      if (item && toolbar.emitCommand) {
        toolbar.emitCommand({ item, argument: color })
      } else if (!invokeEditorCommand(getActiveEditor(), 'setColor', color)) {
        return
      }
    } catch (error) {
      console.warn('[WordEditor] setColor failed:', error)
      invokeEditorCommand(getActiveEditor(), 'setColor', color)
    }
    closeMenu(menu, item)
  }

  const resetColor = (menu: HTMLElement) => {
    const item = findColorItem(toolbar)
    if (item?.iconColor) item.iconColor.value = '#000000'
    try {
      // Passing null through emitCommand follows the same pending-mark path as
      // a normal color selection and maps to SuperDoc's unsetColor behavior.
      if (item && toolbar.emitCommand) toolbar.emitCommand({ item, argument: null })
      else if (!invokeEditorCommand(getActiveEditor(), 'unsetColor')) return
    } catch (error) {
      console.warn('[WordEditor] unsetColor failed:', error)
      invokeEditorCommand(getActiveEditor(), 'unsetColor')
    }
    closeMenu(menu, item)
  }

  const disposeMenu = (state: MountedPicker) => {
    try {
      state.root.unmount()
    } catch {
      // React can already be unmounting while SuperDoc removes a Teleport.
    }
    if (state.grid.isConnected) state.grid.style.display = state.originalGridDisplay
    state.host.classList.remove('word-font-color-render-host')
    state.renderOption?.classList.remove('word-font-color-render-option')
    state.mount.remove()
    if (state.menu.isConnected) delete state.menu.dataset.wordFontColorMenu
    mounted.delete(state.menu)
  }

  const syncMountedMenu = (state: MountedPicker): boolean => {
    const grid = state.menu.querySelector<HTMLElement>('.options-grid-wrap')
    if (!grid) return false
    const host = grid.parentElement ?? state.menu
    const renderOption = grid.closest<HTMLElement>('.toolbar-dropdown-option')

    if (state.grid !== grid) {
      if (state.grid.isConnected) state.grid.style.display = state.originalGridDisplay
      state.grid = grid
      state.originalGridDisplay = grid.style.display
    }
    if (state.host !== host) {
      state.host.classList.remove('word-font-color-render-host')
      state.host = host
    }
    if (state.renderOption !== renderOption) {
      state.renderOption?.classList.remove('word-font-color-render-option')
      state.renderOption = renderOption
    }

    state.host.classList.add('word-font-color-render-host')
    state.grid.style.display = 'none'
    state.renderOption?.classList.add('word-font-color-render-option')
    if (state.mount.parentElement !== state.host) state.host.appendChild(state.mount)
    return true
  }

  const cleanupClosedMenus = () => {
    for (const state of mounted.values()) {
      if (!state.menu.isConnected) {
        disposeMenu(state)
      } else if (isVisibleMenu(state.menu)) {
        // Vue can reconcile the render-only slot after a toolbar state update.
        // Move the existing root into the newest host so HSV state survives.
        syncMountedMenu(state)
      }
    }
  }

  const menuCandidates = (): HTMLElement[] => {
    const seen = new Set<HTMLElement>()
    const result: HTMLElement[] = []
    for (const menu of document.querySelectorAll<HTMLElement>(
      '.toolbar-dropdown-menu, .sd-toolbar-dropdown-menu',
    )) {
      if (seen.has(menu) || !isVisibleMenu(menu) || !menu.querySelector('.options-grid-wrap')) continue
      seen.add(menu)
      result.push(menu)
    }
    return result
  }

  const findColorMenu = (): HTMLElement | null => {
    const candidates = menuCandidates()
    if (candidates.length === 0) return null
    const trigger = pendingTrigger?.isConnected
      ? pendingTrigger
      : toolbarRoot?.querySelector<HTMLElement>("[data-item='btn-color']")
    if (!trigger) return candidates[candidates.length - 1]

    const triggerRect = trigger.getBoundingClientRect()
    let best = candidates[candidates.length - 1]
    let bestScore = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      const rect = candidate.getBoundingClientRect()
      const score = Math.abs(rect.left - triggerRect.left) + Math.abs(rect.top - triggerRect.bottom)
      if (score < bestScore) {
        best = candidate
        bestScore = score
      }
    }
    return best
  }

  // SuperDoc measures the menu before React replaces its native grid. Reapply
  // the same fixed-position calculation after the custom panel changes width,
  // without dispatching a global resize that would rebuild the toolbar.
  const repositionMenu = (menu: HTMLElement) => {
    if (!menu.isConnected) return
    const trigger = pendingTrigger?.isConnected
      ? pendingTrigger
      : toolbarRoot?.querySelector<HTMLElement>("[data-item='btn-color']")
    if (!trigger) return

    const triggerRect = trigger.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    const menuWidth = menuRect.width || menu.offsetWidth
    const menuHeight = menu.scrollHeight || menuRect.height
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
    const gutter = 8
    const gap = 4
    const belowTop = triggerRect.bottom + gap
    const aboveBottom = triggerRect.top - gap
    const availableBelow = Math.max(0, viewportHeight - belowTop - gutter)
    const availableAbove = Math.max(0, aboveBottom - gutter)
    const openAbove = availableBelow < menuHeight && availableAbove > availableBelow
    const maxHeight = openAbove ? availableAbove : availableBelow
    const renderHeight = menuHeight ? Math.min(menuHeight, maxHeight) : maxHeight
    const top = openAbove
      ? Math.max(gutter, aboveBottom - renderHeight)
      : belowTop
    const maxLeft = Math.max(gutter, viewportWidth - menuWidth - gutter)
    const left = Math.min(Math.max(gutter, triggerRect.left), maxLeft)

    menu.style.top = `${top}px`
    menu.style.left = `${left}px`
    menu.style.maxHeight = `${maxHeight}px`
  }

  const decorate = () => {
    cleanupClosedMenus()
    const item = findColorItem(toolbar)
    const expanded = item?.expand ? Boolean(readRef(item.expand)) : Boolean(pendingTrigger)
    if (!expanded) {
      pendingTrigger = null
      return
    }

    const menu = findColorMenu()
    if (!menu) return
    const existing = mounted.get(menu)
    if (existing) {
      syncMountedMenu(existing)
      return
    }

    const grid = menu.querySelector<HTMLElement>('.options-grid-wrap')
    if (!grid) return
    const host = grid.parentElement ?? menu
    const renderOption = grid.closest<HTMLElement>('.toolbar-dropdown-option')
    const originalGridDisplay = grid.style.display
    const mount = document.createElement('div')
    mount.className = 'word-font-color-picker-mount'
    host.classList.add('word-font-color-render-host')
    grid.style.display = 'none'
    menu.dataset.wordFontColorMenu = 'true'
    renderOption?.classList.add('word-font-color-render-option')
    host.appendChild(mount)

    const initialColor = normalizeWordColor(readRef(findColorItem(toolbar)?.iconColor) ?? '#000000')
    const reactRoot = createRoot(mount)
    const state: MountedPicker = {
      menu,
      host,
      grid,
      renderOption,
      mount,
      root: reactRoot,
      originalGridDisplay,
    }
    mounted.set(menu, state)
    reactRoot.render(
      <WordFontColorPicker
        initialColor={initialColor}
        language={language}
        onApply={(color) => applyColor(menu, color)}
        onReset={() => resetColor(menu)}
        onModeChange={() => {
          requestAnimationFrame(() => repositionMenu(menu))
        }}
      />,
    )
    requestAnimationFrame(() => repositionMenu(menu))
    pendingTrigger = null
  }

  const schedule = () => {
    if (decorationTimer !== null) return
    decorationTimer = window.setTimeout(() => {
      decorationTimer = null
      decorate()
    }, 0)
  }

  const handleTriggerClick = (event: Event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const trigger = target.closest<HTMLElement>("[data-item='btn-color']")
    if (!trigger || !ownsTrigger(trigger)) return
    pendingTrigger = trigger
    schedule()
  }

  const handleTriggerKeyDown = (event: KeyboardEvent) => {
    if (!['Enter', ' ', 'Spacebar', 'ArrowDown'].includes(event.key)) return
    handleTriggerClick(event)
  }

  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  document.addEventListener('click', handleTriggerClick, true)
  document.addEventListener('keydown', handleTriggerKeyDown, true)
  schedule()

  return () => {
    observer.disconnect()
    document.removeEventListener('click', handleTriggerClick, true)
    document.removeEventListener('keydown', handleTriggerKeyDown, true)
    if (decorationTimer !== null) window.clearTimeout(decorationTimer)
    for (const state of [...mounted.values()]) disposeMenu(state)
    mounted.clear()
  }
}
