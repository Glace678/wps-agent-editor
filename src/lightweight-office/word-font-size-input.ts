/**
 * SuperDoc's font-size field only applies a typed value on Enter/Tab. Clicking
 * straight back into the document (the common "type 100 and click away" flow)
 * silently drops the edit: the field snaps back to the applied size on the
 * next selection update. Re-run SuperDoc's own submit path when the field
 * loses focus with a changed, valid size so click-away applies too.
 */
const SIZE_INPUT_CLASS = 'button-text-input--font-size'
const SIZE_VALUE_RE = /^\d{1,4}(\.5)?$/
const MIN_SIZE = 1
const MAX_SIZE = 1638

function isFontSizeInput(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.classList.contains(SIZE_INPUT_CLASS)
}

let installed = false

export function installWordFontSizeApplyOnBlur(): () => void {
  if (typeof document === 'undefined') return () => {}
  // Idempotent: repeated install calls must not stack duplicate listeners.
  if (installed) return () => {}
  installed = true

  let valueAtFocus: string | null = null
  // When SuperDoc itself handles Enter/Tab, focus still moves and our blur
  // fallback would fire a *second* submit. Remember a keyboard submit happened.
  let keyboardSubmitted = false

  const onFocusIn = (event: FocusEvent) => {
    if (isFontSizeInput(event.target)) valueAtFocus = event.target.value
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isFontSizeInput(event.target)) return
    if (event.key === 'Enter' || event.key === 'Tab') keyboardSubmitted = true
  }

  const onFocusOut = (event: FocusEvent) => {
    const input = event.target
    if (!isFontSizeInput(input)) return
    const startValue = valueAtFocus
    valueAtFocus = null
    if (keyboardSubmitted) {
      keyboardSubmitted = false
      return
    }
    if (startValue === null) return

    const raw = input.value.trim()
    if (raw === startValue || !SIZE_VALUE_RE.test(raw)) return
    const size = Number(raw)
    if (!Number.isFinite(size) || size < MIN_SIZE || size > MAX_SIZE) return

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
      view: window,
    }))
  }

  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('focusout', onFocusOut, true)
  document.addEventListener('keydown', onKeyDown, true)
  return () => {
    installed = false
    document.removeEventListener('focusin', onFocusIn, true)
    document.removeEventListener('focusout', onFocusOut, true)
    document.removeEventListener('keydown', onKeyDown, true)
  }
}
