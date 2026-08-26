const EXCEL_TOOLBAR_POPUP_SELECTOR = [
  '.fortune-toolbar-combo-popup',
  '.fortune-toolbar-more-container',
  '.toolbar-item-sub-menu',
  '.condition-format-sub-menu',
  '.fortune-border-select-menu',
].join(',')

const EXCEL_TOOLBAR_NESTED_POPUP_SELECTOR = [
  '.toolbar-item-sub-menu',
  '.condition-format-sub-menu',
  '.fortune-border-select-menu',
].join(',')

const EXCEL_BORDER_OPTION_SELECTOR = '.fortune-border-select-option'
const EXCEL_BORDER_SUBMENU_SELECTOR = '.fortune-border-select-menu'
const EXCEL_BORDER_COLOR_PREVIEW_SELECTOR = '.fortune-border-color-preview'

export const EXCEL_TOOLBAR_POPUP_EDGE_INSET = 8

/**
 * The color palette opens on click only; the line-style flyout opens on hover.
 * Fortune's own markup distinguishes the two rows by the color preview swatch.
 */
function isBorderColorOption(option: HTMLElement): boolean {
  return option.querySelector(EXCEL_BORDER_COLOR_PREVIEW_SELECTOR) !== null
}

function setStyleValue(
  style: CSSStyleDeclaration,
  property: 'maxWidth' | 'minWidth' | 'width' | 'translate',
  value: string,
) {
  if (style[property] !== value) style[property] = value
}

function readFiniteNumber(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isVisiblePopup(popup: HTMLElement): boolean {
  const style = getComputedStyle(popup)
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && popup.getClientRects().length > 0
}

function getBorderOptionFromEventTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element) || target.closest(EXCEL_BORDER_SUBMENU_SELECTOR)) return null
  return target.closest<HTMLElement>(EXCEL_BORDER_OPTION_SELECTOR)
}

let activeBorderOption: HTMLElement | null = null

export function setActiveBorderOption(option: HTMLElement | null, shell: HTMLElement): void {
  if (activeBorderOption && activeBorderOption !== option) {
    delete activeBorderOption.dataset.excelBorderOptionActive
    const prevSubmenu = activeBorderOption.querySelector<HTMLElement>(EXCEL_BORDER_SUBMENU_SELECTOR)
    if (prevSubmenu) {
      delete prevSubmenu.dataset.excelBorderSubmenuActive
      prevSubmenu.style.display = 'none'
    }
  }

  activeBorderOption = option

  if (option) {
    option.dataset.excelBorderOptionActive = 'true'
    const submenu = option.querySelector<HTMLElement>(EXCEL_BORDER_SUBMENU_SELECTOR)
    if (submenu) {
      submenu.dataset.excelBorderSubmenuActive = 'true'
      submenu.style.display = 'block'
      const shellRect = shell.getBoundingClientRect()
      placeBorderSubmenu(shell, submenu, shellRect)
    }
  }
}

/**
 * Dedicated placement for FortuneSheet border submenus (color picker and style picker).
 * Must expand to the LEFT of the main border popup and never overlap or obscure
 * "边框颜色" or "边框样式" or any part of the main border popup.
 */
function placeBorderSubmenu(
  shell: HTMLElement,
  submenu: HTMLElement,
  shellRect: DOMRect,
): boolean {
  if (!submenu.matches(EXCEL_BORDER_SUBMENU_SELECTOR)) return false

  const option = submenu.closest<HTMLElement>(EXCEL_BORDER_OPTION_SELECTOR)
  const mainPopup = submenu.closest<HTMLElement>('.fortune-toolbar-combo-popup')
    || option?.closest<HTMLElement>('.fortune-toolbar-combo-popup')
  if (!option || !mainPopup) return false

  const isColorSubmenu =
    submenu.querySelector('#fortune-custom-color, #fortune-change-color, .excel-circular-color-picker') !== null
    || option.querySelector('.fortune-border-color-preview') !== null

  // Width is 356px for Circular Color Picker and 120px for Style Picker
  const targetWidth = isColorSubmenu ? 356 : 120
  const widthCss = `${targetWidth}px`

  setStyleValue(submenu.style, 'width', widthCss)
  setStyleValue(submenu.style, 'minWidth', widthCss)
  setStyleValue(submenu.style, 'maxWidth', widthCss)
  submenu.style.boxSizing = 'border-box'

  const mainPopupRect = mainPopup.getBoundingClientRect()
  const optionRect = option.getBoundingClientRect()

  // Expand to the LEFT of the main popup with a 4px gap so main popup is 100% visible
  const gap = 4
  const naturalLeft = mainPopupRect.left - targetWidth - gap
  const leftBoundary = shellRect.left + EXCEL_TOOLBAR_POPUP_EDGE_INSET
  const targetLeft = Math.max(leftBoundary, naturalLeft)

  // Align vertically: align bottom of submenu with bottom of main popup, clamped within shell
  const submenuHeight = submenu.offsetHeight || (isColorSubmenu ? 195 : 240)
  const naturalTop = Math.min(
    optionRect.top,
    mainPopupRect.bottom - submenuHeight,
  )
  const topBoundary = shellRect.top + EXCEL_TOOLBAR_POPUP_EDGE_INSET
  const bottomBoundary = shellRect.bottom - EXCEL_TOOLBAR_POPUP_EDGE_INSET
  const targetTop = Math.max(
    topBoundary,
    Math.min(naturalTop, bottomBoundary - submenuHeight),
  )

  if (submenu.style.position !== 'fixed') submenu.style.position = 'fixed'
  if (submenu.style.right !== 'auto') submenu.style.right = 'auto'
  if (submenu.style.bottom !== 'auto') submenu.style.bottom = 'auto'
  if (submenu.style.zIndex !== '1005') submenu.style.zIndex = '1005'
  setStyleValue(submenu.style, 'translate', '')

  // `.excel-editor-shell` sets `contain: layout paint size`, which makes the
  // shell — not the viewport — the containing block for fixed descendants, so
  // style.left/top resolve against the shell origin. Fortune also writes its
  // own hover-position values into these properties. Apply the viewport-space
  // target as a delta from the currently rendered position, which lands on the
  // right values no matter which ancestor is the containing block or what the
  // inline properties held before.
  if (!submenu.style.left) submenu.style.left = '0px'
  if (!submenu.style.top) submenu.style.top = '0px'
  const renderedRect = submenu.getBoundingClientRect()
  const currentLeft = readFiniteNumber(submenu.style.left) ?? 0
  const currentTop = readFiniteNumber(submenu.style.top) ?? 0
  const nextLeft = Math.round((currentLeft + targetLeft - renderedRect.left) * 100) / 100
  const nextTop = Math.round((currentTop + targetTop - renderedRect.top) * 100) / 100

  if (submenu.style.left !== `${nextLeft}px`) submenu.style.left = `${nextLeft}px`
  if (submenu.style.top !== `${nextTop}px`) submenu.style.top = `${nextTop}px`

  submenu.dataset.excelPopupAnchorSide = 'left'
  submenu.dataset.excelPopupShiftX = '0'
  submenu.dataset.excelPopupEscapedClip = 'true'
  return true
}

function openBorderSubmenu(option: HTMLElement, shell: HTMLElement): HTMLElement | null {
  const submenu = Array.from(option.children).find(
    (child): child is HTMLElement => (
      child instanceof HTMLElement && child.matches(EXCEL_BORDER_SUBMENU_SELECTOR)
    ),
  )
  if (!submenu) return null

  setActiveBorderOption(option, shell)
  return submenu
}

/** Move flyout menus out of their scrollable parent list's clipping context. */
function placeNestedPopup(
  shell: HTMLElement,
  popup: HTMLElement,
  shellRect: DOMRect,
): boolean {
  if (popup.matches(EXCEL_BORDER_SUBMENU_SELECTOR)) {
    return placeBorderSubmenu(shell, popup, shellRect)
  }

  if (!popup.matches(EXCEL_TOOLBAR_NESTED_POPUP_SELECTOR)) return false

  const trigger = popup.parentElement?.closest<HTMLElement>(
    '.fortune-toolbar-select-option, .condition-format-item',
  ) ?? popup.parentElement
  if (!(trigger instanceof HTMLElement)) return false

  const initialPopupRect = popup.getBoundingClientRect()
  const initialTriggerRect = trigger.getBoundingClientRect()
  if (!popup.dataset.excelPopupAnchorSide) {
    popup.dataset.excelPopupAnchorSide = initialPopupRect.left < initialTriggerRect.left
      ? 'left'
      : 'right'
    popup.dataset.excelPopupAnchorTopOffset = String(
      initialPopupRect.top - initialTriggerRect.top,
    )
  }

  setStyleValue(popup.style, 'translate', '')
  if (popup.style.position !== 'fixed') popup.style.position = 'fixed'
  if (popup.style.right !== 'auto') popup.style.right = 'auto'
  if (popup.style.bottom !== 'auto') popup.style.bottom = 'auto'
  if (!popup.style.left) popup.style.left = '0px'
  if (!popup.style.top) popup.style.top = '0px'

  const popupRect = popup.getBoundingClientRect()
  const triggerRect = trigger.getBoundingClientRect()
  const leftBoundary = shellRect.left + EXCEL_TOOLBAR_POPUP_EDGE_INSET
  const rightBoundary = shellRect.right - EXCEL_TOOLBAR_POPUP_EDGE_INSET
  const topBoundary = shellRect.top + EXCEL_TOOLBAR_POPUP_EDGE_INSET
  const bottomBoundary = shellRect.bottom - EXCEL_TOOLBAR_POPUP_EDGE_INSET
  const naturalLeft = popup.dataset.excelPopupAnchorSide === 'left'
    ? triggerRect.left - popupRect.width
    : triggerRect.right
  const rightmostLeft = Math.max(leftBoundary, rightBoundary - popupRect.width)
  const targetLeft = Math.min(Math.max(naturalLeft, leftBoundary), rightmostLeft)
  const topOffset = readFiniteNumber(popup.dataset.excelPopupAnchorTopOffset) ?? 0
  const naturalTop = triggerRect.top + topOffset
  const bottommostTop = Math.max(topBoundary, bottomBoundary - popupRect.height)
  const targetTop = Math.min(Math.max(naturalTop, topBoundary), bottommostTop)
  const currentLeft = readFiniteNumber(popup.style.left) ?? 0
  const currentTop = readFiniteNumber(popup.style.top) ?? 0
  const nextLeft = Math.round((currentLeft + targetLeft - popupRect.left) * 100) / 100
  const nextTop = Math.round((currentTop + targetTop - popupRect.top) * 100) / 100

  setStyleValue(popup.style, 'width', `${popupRect.width}px`)
  if (popup.style.left !== `${nextLeft}px`) popup.style.left = `${nextLeft}px`
  if (popup.style.top !== `${nextTop}px`) popup.style.top = `${nextTop}px`
  popup.dataset.excelPopupShiftX = '0'
  popup.dataset.excelPopupEscapedClip = 'true'
  return true
}

/**
 * Keep a Fortune toolbar surface inside the current Excel editor viewport.
 * Fortune normally compares combo popups with window.innerWidth, which ignores
 * the space occupied by the resizable Agent sidebar.
 */
export function fitExcelToolbarPopupToShell(shell: HTMLElement, popup: HTMLElement): void {
  if (!shell.contains(popup) || !isVisiblePopup(popup)) return

  const shellRect = shell.getBoundingClientRect()
  const availableWidth = Math.max(
    1,
    Math.floor(shellRect.width - EXCEL_TOOLBAR_POPUP_EDGE_INSET * 2),
  )

  popup.dataset.excelPopupBoundary = 'true'
  const availableWidthCss = `${availableWidth}px`
  if (popup.style.getPropertyValue('--excel-popup-available-width') !== availableWidthCss) {
    popup.style.setProperty('--excel-popup-available-width', availableWidthCss)
  }

  const preferredWidth = readFiniteNumber(popup.dataset.excelPopupPreferredWidth)
  if (preferredWidth !== null) {
    const width = Math.min(preferredWidth, availableWidth)
    const widthCss = `${width}px`
    setStyleValue(popup.style, 'minWidth', widthCss)
    setStyleValue(popup.style, 'width', widthCss)
    setStyleValue(popup.style, 'maxWidth', widthCss)
    popup.dataset.excelPickerContentWidth = String(width)
  } else {
    if (!popup.dataset.excelPopupNaturalMaxWidth) {
      const computedMaxWidth = getComputedStyle(popup).maxWidth
      const naturalMaxWidth = computedMaxWidth === 'none'
        ? null
        : readFiniteNumber(computedMaxWidth)
      popup.dataset.excelPopupNaturalMaxWidth = naturalMaxWidth === null
        ? 'none'
        : String(naturalMaxWidth)
    }
    const naturalMaxWidth = readFiniteNumber(popup.dataset.excelPopupNaturalMaxWidth)
    const maxWidth = naturalMaxWidth === null
      ? availableWidth
      : Math.min(naturalMaxWidth, availableWidth)
    setStyleValue(popup.style, 'maxWidth', `${maxWidth}px`)
  }

  if (placeNestedPopup(shell, popup, shellRect)) return

  const previousShift = readFiniteNumber(popup.dataset.excelPopupShiftX) ?? 0
  const popupRect = popup.getBoundingClientRect()
  const naturalLeft = popupRect.left - previousShift
  const leftBoundary = shellRect.left + EXCEL_TOOLBAR_POPUP_EDGE_INSET
  const rightBoundary = shellRect.right - EXCEL_TOOLBAR_POPUP_EDGE_INSET
  const rightmostLeft = Math.max(leftBoundary, rightBoundary - popupRect.width)
  const desiredLeft = Math.min(Math.max(naturalLeft, leftBoundary), rightmostLeft)
  const nextShift = Math.round((desiredLeft - naturalLeft) * 100) / 100
  const translate = Math.abs(nextShift) < 0.01 ? '' : `${nextShift}px 0px`

  setStyleValue(popup.style, 'translate', translate)
  popup.dataset.excelPopupShiftX = String(nextShift)
}

/**
 * Refit open toolbar popups when they mount, reveal a submenu, or when the
 * document viewport changes because either sidebar is resized.
 */
export function attachExcelToolbarPopupBoundary(shell: HTMLElement): () => void {
  let frame: number | null = null

  const fitOpenPopups = () => {
    frame = null
    const shellRect = shell.getBoundingClientRect()

    // Clean up active border option if unmounted
    if (activeBorderOption && !activeBorderOption.isConnected) {
      activeBorderOption = null
    }

    // If active border option exists, ensure its submenu stays positioned and visible
    if (activeBorderOption && activeBorderOption.isConnected) {
      const submenu = activeBorderOption.querySelector<HTMLElement>(EXCEL_BORDER_SUBMENU_SELECTOR)
      if (submenu) {
        submenu.dataset.excelBorderSubmenuActive = 'true'
        submenu.style.display = 'block'
        placeBorderSubmenu(shell, submenu, shellRect)
      }
    }

    shell.querySelectorAll<HTMLElement>(EXCEL_TOOLBAR_POPUP_SELECTOR).forEach((popup) => {
      fitExcelToolbarPopupToShell(shell, popup)
    })
  }

  const scheduleFit = () => {
    if (frame !== null) return
    frame = requestAnimationFrame(fitOpenPopups)
  }

  // Fortune looks for a submenu under event.target, which is usually the
  // inner label or arrow rather than the border option. Delegate from the
  // shell so hover reliably drives the whole row. Clicks are handled
  // separately by handleBorderClick.
  const handleBorderSubmenuOpen = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (!target || !shell.contains(target)) return

    // If interacting inside the submenu (color wheel, slider, inputs, line styles), keep active
    if (target.closest(EXCEL_BORDER_SUBMENU_SELECTOR)) {
      scheduleFit()
      return
    }

    const option = getBorderOptionFromEventTarget(target)
    if (option && shell.contains(option)) {
      // The color palette must open on click only. Hovering its row must not
      // open it; it just closes any other open submenu and leaves a
      // click-opened palette alone.
      if (isBorderColorOption(option)) {
        if (activeBorderOption && activeBorderOption !== option) {
          setActiveBorderOption(null, shell)
        }
        return
      }
      if (openBorderSubmenu(option, shell)) {
        scheduleFit()
      }
      return
    }

    // Hovering over other regular border options (e.g. All, Outer, None, etc.)
    const regularOption = target.closest<HTMLElement>('.fortune-toolbar-select-option')
    if (regularOption && regularOption.closest('.fortune-toolbar-combo-popup')?.querySelector(EXCEL_BORDER_OPTION_SELECTOR)) {
      setActiveBorderOption(null, shell)
    }
  }

  const handleBorderClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (!target || !shell.contains(target)) return

    // Clicks inside the submenu should not close it
    if (target.closest(EXCEL_BORDER_SUBMENU_SELECTOR)) {
      scheduleFit()
      return
    }

    const option = getBorderOptionFromEventTarget(target)
    if (option && shell.contains(option)) {
      event.preventDefault()
      event.stopPropagation()
      // Clicking the color row toggles its palette. The style row already
      // opens on hover, so its click just keeps it open.
      if (isBorderColorOption(option) && activeBorderOption === option) {
        setActiveBorderOption(null, shell)
      } else {
        setActiveBorderOption(option, shell)
      }
      scheduleFit()
      return
    }

    // Clicking a border type option or outside the border menu
    if (target.closest('.fortune-toolbar-select-option, .fortune-toolbar-button, .fortune-toolbar-combo-button')) {
      setActiveBorderOption(null, shell)
    }
  }

  const handleDocumentPointerDown = (event: MouseEvent | PointerEvent) => {
    const target = event.target as HTMLElement | null
    if (!target) return
    if (!target.closest('.fortune-toolbar-combo-popup, .fortune-border-select-menu, #fortune-custom-color, #fortune-change-color')) {
      setActiveBorderOption(null, shell)
    }
  }

  const popupObserver = new MutationObserver(scheduleFit)
  popupObserver.observe(shell, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style'],
  })

  const shellResizeObserver = new ResizeObserver(scheduleFit)
  shellResizeObserver.observe(shell)
  shell.addEventListener('click', scheduleFit, true)
  shell.addEventListener('click', handleBorderClick, true)
  shell.addEventListener('mouseover', handleBorderSubmenuOpen, true)
  shell.addEventListener('pointerover', scheduleFit, true)
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  window.addEventListener('resize', scheduleFit)
  scheduleFit()

  return () => {
    popupObserver.disconnect()
    shellResizeObserver.disconnect()
    shell.removeEventListener('click', scheduleFit, true)
    shell.removeEventListener('click', handleBorderClick, true)
    shell.removeEventListener('mouseover', handleBorderSubmenuOpen, true)
    shell.removeEventListener('pointerover', scheduleFit, true)
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
    window.removeEventListener('resize', scheduleFit)
    if (frame !== null) cancelAnimationFrame(frame)
  }
}
