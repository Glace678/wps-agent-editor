// Menu-driven paste fallback (wps_05 #8).
//
// Binary editors (Word/Excel) return false from their paste handlers and defer
// to the WebView, but Chromium rejects document.execCommand('paste'), so the
// old menu fallback was a silent no-op. We read the clipboard ourselves and
// insert into the focused editable surface; when that is impossible (canvas
// editors such as Excel, or the clipboard permission is denied), a transient
// hint tells the user to press Ctrl+V — the one path that always works.

const HINT_ID = 'officeagentic-paste-hint'
const HINT_VISIBLE_MS = 2500

let hintTimer: ReturnType<typeof setTimeout> | null = null

function showPasteHint(message: string): void {
  let host = document.getElementById(HINT_ID)
  if (!host) {
    host = document.createElement('div')
    host.id = HINT_ID
    host.className =
      'pointer-events-none fixed bottom-12 left-1/2 z-[12000] -translate-x-1/2 rounded-md bg-foreground/85 px-3 py-1.5 text-xs font-medium text-background shadow-lg'
    host.setAttribute('role', 'status')
    host.setAttribute('aria-live', 'polite')
    document.body.appendChild(host)
  }
  host.textContent = message

  if (hintTimer) clearTimeout(hintTimer)
  hintTimer = setTimeout(() => {
    hintTimer = null
    document.getElementById(HINT_ID)?.remove()
  }, HINT_VISIBLE_MS)
}

function isEditable(target: Element): boolean {
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) {
    const type = target.type.toLowerCase()
    return type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit'
  }
  // getAttribute('contenteditable') also covers inherited plain-text editing.
  return target.getAttribute('contenteditable') === 'true'
}

export async function performClipboardPaste(hintMessage: string): Promise<void> {
  let text: string | null = null
  try {
    text = await navigator.clipboard.readText()
  } catch {
    // Permission denied / unavailable (non-secure context): the native
    // shortcut is the remaining option.
    showPasteHint(hintMessage)
    return
  }

  if (!text) return // empty clipboard: nothing to paste, stay silent

  const target = document.activeElement instanceof Element ? document.activeElement : null
  if (target && isEditable(target)) {
    try {
      // execCommand operates on the selection inside the focused editable.
      if (document.execCommand('insertText', false, text)) return
    } catch {
      // Fall through to the hint.
    }
  }

  showPasteHint(hintMessage)
}
