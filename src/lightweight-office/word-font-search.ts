import type { LanguageCode } from '../lib/i18n'
import type { SystemFontFace } from './utils/system-fonts'
import {
  buildFontSearchTerms,
  normalizeFontSearchText,
} from './utils/font-search'

export interface WordFontPickerSearchOptions {
  language: LanguageCode
  fontFaces: readonly SystemFontFace[]
  placeholder: string
  emptyMessage: string
}

function getFontOptions(popup: HTMLElement): HTMLElement[] {
  return [...popup.querySelectorAll<HTMLElement>('.sd-font-combobox__option')]
}

function getOptionTerms(option: HTMLElement, termsByFamily: Map<string, string[]>): string[] {
  const name = option.textContent?.trim() || ''
  return [name, ...(termsByFamily.get(normalizeFontSearchText(name)) || [])]
}

function setActiveOption(
  options: HTMLElement[],
  active: HTMLElement | null,
  scrollIntoView = false,
): void {
  for (const option of options) {
    option.classList.toggle('word-font-picker-option-active', option === active)
  }
  if (scrollIntoView) active?.scrollIntoView({ block: 'nearest' })
}

function dispatchOptionSelection(option: HTMLElement): void {
  option.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    view: window,
  }))
}

function closeFontPicker(): void {
  const caret = document.querySelector<HTMLElement>(
    '.sd-font-combobox[data-item="btn-fontFamily"] .sd-font-combobox__caret',
  )
  caret?.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    view: window,
  }))
}

function sizePickerForSearch(popup: HTMLElement, placeholder: string): void {
  // The SuperDoc popup normally sizes itself from the compact toolbar control.
  // Give the new field enough room for the translated hint, while respecting
  // the viewport on narrow windows.
  const estimatedWidth = Math.max(220, placeholder.length * 8 + 42)
  const viewportWidth = Math.max(220, window.innerWidth - 16)
  popup.style.minWidth = `${Math.min(viewportWidth, estimatedWidth)}px`
}

function decorateFontPicker(
  popup: HTMLElement,
  options: WordFontPickerSearchOptions,
  termsByFamily: Map<string, string[]>,
): void {
  if (popup.dataset.wordFontSearchReady === 'true') return
  const fontCombobox = document.querySelector<HTMLElement>(
    '.sd-font-combobox[data-item="btn-fontFamily"]',
  )
  if (!fontCombobox) return

  const fontOptions = getFontOptions(popup)
  if (fontOptions.length === 0) return

  popup.dataset.wordFontSearchReady = 'true'
  popup.classList.add('word-font-picker-listbox')
  sizePickerForSearch(popup, options.placeholder)

  const header = document.createElement('div')
  header.className = 'word-font-picker-search'

  const input = document.createElement('input')
  input.className = 'word-font-picker-search-input'
  input.type = 'text'
  input.inputMode = 'search'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.placeholder = options.placeholder
  input.title = options.placeholder
  input.dir = options.language === 'ar' ? 'rtl' : 'ltr'
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-expanded', 'true')
  input.setAttribute('aria-label', options.placeholder)
  input.setAttribute('data-testid', 'word-font-search')
  header.append(input)

  const empty = document.createElement('div')
  empty.className = 'word-font-picker-empty'
  empty.hidden = true
  empty.textContent = options.emptyMessage

  // SuperDoc renders this list in a body portal. Insert the search control
  // directly in the listbox so it follows the same popup positioning logic.
  popup.insertBefore(header, fontOptions[0])
  popup.append(empty)

  let activeOption: HTMLElement | null = popup.querySelector<HTMLElement>('.sd-selected')
    || fontOptions[0]

  const visibleOptions = () => fontOptions.filter((option) => !option.hidden)
  const filterOptions = () => {
    const query = normalizeFontSearchText(input.value)
    const visible: HTMLElement[] = []
    for (const option of fontOptions) {
      const matches = !query || getOptionTerms(option, termsByFamily).some(
        (term) => normalizeFontSearchText(term).includes(query),
      )
      option.hidden = !matches
      option.setAttribute('aria-hidden', String(!matches))
      if (matches) visible.push(option)
    }

    if (!activeOption || activeOption.hidden) activeOption = visible[0] || null
    setActiveOption(fontOptions, activeOption)
    empty.hidden = query.length === 0 || visible.length > 0
  }

  const moveActive = (direction: 1 | -1) => {
    const visible = visibleOptions()
    if (!visible.length) return
    const currentIndex = activeOption ? visible.indexOf(activeOption) : -1
    const nextIndex = currentIndex < 0
      ? direction === 1 ? 0 : visible.length - 1
      : (currentIndex + direction + visible.length) % visible.length
    activeOption = visible[nextIndex]
    setActiveOption(fontOptions, activeOption, true)
  }

  const applyActive = () => {
    const target = activeOption && !activeOption.hidden
      ? activeOption
      : visibleOptions()[0]
    if (target) dispatchOptionSelection(target)
  }

  const stopInputEvent = (event: Event) => event.stopPropagation()
  input.addEventListener('input', (event) => {
    event.stopPropagation()
    filterOptions()
  })
  input.addEventListener('beforeinput', stopInputEvent)
  input.addEventListener('change', stopInputEvent)
  input.addEventListener('compositionstart', stopInputEvent)
  input.addEventListener('compositionupdate', stopInputEvent)
  input.addEventListener('compositionend', stopInputEvent)
  input.addEventListener('keydown', (event) => {
    event.stopPropagation()
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      applyActive()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeFontPicker()
    }
  })
  input.addEventListener('keyup', stopInputEvent)
  input.addEventListener('keypress', stopInputEvent)

  filterOptions()
  requestAnimationFrame(() => {
    if (popup.isConnected) input.focus({ preventScroll: true })
  })
}

export function installWordFontPickerSearch(
  options: WordFontPickerSearchOptions,
): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {}

  const termsByFamily = buildFontSearchTerms(options.fontFaces)
  let stopped = false
  const scan = () => {
    if (stopped) return
    document.querySelectorAll<HTMLElement>('.sd-font-combobox__listbox').forEach((popup) => {
      decorateFontPicker(popup, options, termsByFamily)
    })
  }

  const observer = new MutationObserver(scan)
  observer.observe(document.body, { childList: true, subtree: true })
  scan()

  return () => {
    stopped = true
    observer.disconnect()
    document.querySelectorAll<HTMLElement>('.word-font-picker-search').forEach((header) => header.remove())
    document.querySelectorAll<HTMLElement>('.word-font-picker-empty').forEach((empty) => empty.remove())
    document.querySelectorAll<HTMLElement>('.word-font-picker-listbox').forEach((popup) => {
      popup.classList.remove('word-font-picker-listbox')
      delete popup.dataset.wordFontSearchReady
    })
  }
}
