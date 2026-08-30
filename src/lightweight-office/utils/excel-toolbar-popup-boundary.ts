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

export const EXCEL_TOOLBAR_POPUP_EDGE_INSET = 8

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

/** Move flyout menus out of their scrollable parent list's clipping context. */
function placeNestedPopup(
  shell: HTMLElement,
  popup: HTMLElement,
  shellRect: DOMRect,
): boolean {
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
    shell.querySelectorAll<HTMLElement>(EXCEL_TOOLBAR_POPUP_SELECTOR).forEach((popup) => {
      fitExcelToolbarPopupToShell(shell, popup)
    })
  }

  const scheduleFit = () => {
    if (frame !== null) return
    frame = requestAnimationFrame(fitOpenPopups)
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
  shell.addEventListener('pointerover', scheduleFit, true)
  window.addEventListener('resize', scheduleFit)
  scheduleFit()

  return () => {
    popupObserver.disconnect()
    shellResizeObserver.disconnect()
    shell.removeEventListener('click', scheduleFit, true)
    shell.removeEventListener('pointerover', scheduleFit, true)
    window.removeEventListener('resize', scheduleFit)
    if (frame !== null) cancelAnimationFrame(frame)
  }
}
