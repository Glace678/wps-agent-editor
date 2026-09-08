import type { Editor } from '@superdoc-dev/react'

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

  let stopped = false

  const updateAlignmentButtons = (container: HTMLElement) => {
    const editor = options.getEditor()
    const activeAlignment = getActiveAlignment(editor)
    const buttons = Array.from(container.querySelectorAll<HTMLElement>('.sd-button-icon'))

    buttons.forEach((btn, index) => {
      // Remove any initial browser focus box on mount
      if (document.activeElement === btn) {
        btn.blur()
      }

      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase()
      const isMatch =
        (activeAlignment === 'left' && (index === 0 || ariaLabel.includes('left'))) ||
        (activeAlignment === 'center' && (index === 1 || ariaLabel.includes('center'))) ||
        (activeAlignment === 'right' && (index === 2 || ariaLabel.includes('right'))) ||
        (activeAlignment === 'justify' && (index === 3 || ariaLabel.includes('justify')))

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
        btn.addEventListener('click', () => {
          buttons.forEach((b) => {
            b.classList.remove('sd-selected')
            b.removeAttribute('data-active')
            b.removeAttribute('aria-selected')
          })
          btn.classList.add('sd-selected')
          btn.setAttribute('data-active', 'true')
          btn.setAttribute('aria-selected', 'true')
        })
      }
    })
  }

  const scan = () => {
    if (stopped) return
    document.querySelectorAll<HTMLElement>('.alignment-buttons').forEach(updateAlignmentButtons)
  }

  const observer = new MutationObserver(scan)
  observer.observe(document.body, { childList: true, subtree: true })
  scan()

  return () => {
    stopped = true
    observer.disconnect()
  }
}
