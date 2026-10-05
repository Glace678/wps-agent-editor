import type { Editor } from '@superdoc-dev/react'
import { observeDocumentMutations } from './dom-observer'

export interface InstallWordAlignmentPolicyOptions {
  getEditor: () => Editor | null
}

const ALIGNMENT_KEYS = ['left', 'center', 'right', 'justify'] as const
type AlignmentKey = (typeof ALIGNMENT_KEYS)[number]

function getActiveAlignment(editor: unknown): AlignmentKey {
  if (!editor || typeof editor !== 'object') return 'left'
  const ed = editor as {
    isActive?: (name: string | { textAlign: string }) => boolean
    getAttributes?: (name: string) => Record<string, unknown>
  }

  try {
    if (typeof ed.isActive === 'function') {
      if (ed.isActive({ textAlign: 'center' }) || ed.isActive('alignCenter')) return 'center'
      if (ed.isActive({ textAlign: 'right' }) || ed.isActive('alignRight')) return 'right'
      if (ed.isActive({ textAlign: 'justify' }) || ed.isActive('alignJustify')) return 'justify'
      if (ed.isActive({ textAlign: 'left' }) || ed.isActive('alignLeft')) return 'left'
    }
    if (typeof ed.getAttributes === 'function') {
      const para = ed.getAttributes('paragraph')
      if (para && typeof para.textAlign === 'string') {
        const align = para.textAlign.toLowerCase()
        if (ALIGNMENT_KEYS.includes(align as AlignmentKey)) return align as AlignmentKey
      }
      const heading = ed.getAttributes('heading')
      if (heading && typeof heading.textAlign === 'string') {
        const align = heading.textAlign.toLowerCase()
        if (ALIGNMENT_KEYS.includes(align as AlignmentKey)) return align as AlignmentKey
      }
    }
  } catch {
    // ignore
  }

  return 'left'
}

export function installWordAlignmentPolicy(options: InstallWordAlignmentPolicyOptions): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {}

  // Track every button we bound so cleanup can remove the listeners and reset the
  // state we applied (otherwise old closures survive on reused DOM nodes).
  const boundButtons = new Map<HTMLElement, () => void>()

  const updateAlignmentButtons = (container: HTMLElement) => {
    let editor: Editor | null = null
    try {
      editor = options.getEditor()
    } catch {
      editor = null
    }
    const activeAlignment = getActiveAlignment(editor)
    const buttons = Array.from(container.querySelectorAll<HTMLElement>('.sd-button-icon'))

    buttons.forEach((btn) => {
      // Remove any initial browser focus box on mount
      if (document.activeElement === btn) {
        btn.blur()
      }

      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase()
      // Only select when we can recognize the button by its (stable) command
      // label. Without a usable label, do NOT guess by position — order can shift.
      const isMatch = !!ariaLabel && (
        (activeAlignment === 'left' && ariaLabel.includes('left')) ||
        (activeAlignment === 'center' && ariaLabel.includes('center')) ||
        (activeAlignment === 'right' && ariaLabel.includes('right')) ||
        (activeAlignment === 'justify' && ariaLabel.includes('justify'))
      )

      if (isMatch) {
        btn.classList.add('sd-selected')
        btn.setAttribute('data-active', 'true')
        btn.setAttribute('aria-selected', 'true')
      } else {
        btn.classList.remove('sd-selected')
        btn.removeAttribute('data-active')
        btn.removeAttribute('aria-selected')
      }

      if (!btn.dataset.wordAlignBound) {
        btn.dataset.wordAlignBound = 'true'
        const handler = () => {
          buttons.forEach((b) => {
            b.classList.remove('sd-selected')
            b.removeAttribute('data-active')
            b.removeAttribute('aria-selected')
          })
          btn.classList.add('sd-selected')
          btn.setAttribute('data-active', 'true')
          btn.setAttribute('aria-selected', 'true')
        }
        btn.addEventListener('click', handler)
        boundButtons.set(btn, handler)
      }
    })
  }

  // Alignment state only changes on selection moves, not on every DOM mutation
  // ProseMirror emits while typing. Coalescing keeps one query per frame.
  const scan = () => {
    document.querySelectorAll<HTMLElement>('.alignment-buttons').forEach((container) => {
      try {
        updateAlignmentButtons(container)
      } catch {
        // A single bad container must not stop the rest of the scan.
      }
    })
  }

  const stop = observeDocumentMutations(scan)
  return () => {
    stop()
    for (const [btn, handler] of boundButtons) {
      btn.removeEventListener('click', handler)
      delete btn.dataset.wordAlignBound
      btn.classList.remove('sd-selected')
      btn.removeAttribute('data-active')
      btn.removeAttribute('aria-selected')
    }
    boundButtons.clear()
  }
}
