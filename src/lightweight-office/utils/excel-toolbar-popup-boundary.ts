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
const EXCEL_TOOLBAR_OPTION_SELECTOR = '.fortune-toolbar-select-option'
const EXCEL_BORDER_SUBMENU_CLOSE_DELAY_MS = 500

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

function getBorderOptionFromEventTarget(target: EventTarget | null): HTMLElement | null {
  if (
    !(target instanceof Element)
    || target.closest(EXCEL_BORDER_SUBMENU_SELECTOR)
  ) return null
  return target.closest<HTMLElement>(EXCEL_BORDER_OPTION_SELECTOR)
}

function getBorderCommandFromEventTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element) || target.closest(EXCEL_BORDER_SUBMENU_SELECTOR)) return null
  const command = target.closest<HTMLElement>(EXCEL_TOOLBAR_OPTION_SELECTOR)
  const popup = command?.closest<HTMLElement>('.fortune-toolbar-combo-popup')
  return popup?.querySelector(EXCEL_BORDER_OPTION_SELECTOR) ? command : null
}

function getDirectBorderSubmenu(option: HTMLElement): HTMLElement | null {
  return Array.from(option.children).find(
    (child): child is HTMLElement => (
      child instanceof HTMLElement && child.matches(EXCEL_BORDER_SUBMENU_SELECTOR)
    ),
  ) ?? null
}

function openBorderSubmenu(option: HTMLElement): HTMLElement | null {
  const submenu = getDirectBorderSubmenu(option)
  if (!submenu) return null

  option.parentElement
    ?.querySelectorAll<HTMLElement>(EXCEL_BORDER_SUBMENU_SELECTOR)
    .forEach((candidate) => {
      if (candidate !== submenu && candidate.style.display !== 'none') {
        candidate.style.display = 'none'
      }
    })

  if (submenu.style.display !== 'block') submenu.style.display = 'block'
  return submenu
}

/** Move flyout menus out of their scrollable parent list's clipping context. */
function placeNestedPopup(
  shell: HTMLElement,
  popup: HTMLElement,
  shellRect: DOMRect,
): boolean {
  if (!popup.matches(EXCEL_TOOLBAR_NESTED_POPUP_SELECTOR)) return false

  const isBorderSubmenu = popup.matches(EXCEL_BORDER_SUBMENU_SELECTOR)
  const trigger = isBorderSubmenu
    ? popup.parentElement
    : popup.parentElement?.closest<HTMLElement>(
      '.fortune-toolbar-select-option, .condition-format-item',
    ) ?? popup.parentElement
  if (!(trigger instanceof HTMLElement)) return false

  const initialPopupRect = popup.getBoundingClientRect()
  const initialTriggerRect = trigger.getBoundingClientRect()
  if (isBorderSubmenu) {
    popup.dataset.excelPopupAnchorSide = 'left'
    popup.dataset.excelPopupAnchorTopOffset = '0'
  } else if (!popup.dataset.excelPopupAnchorSide) {
    popup.dataset.excelPopupAnchorSide = initialPopupRect.left < initialTriggerRect.left
      ? 'left'
      : 'right'
  }
  if (!isBorderSubmenu && !popup.dataset.excelPopupAnchorTopOffset) {
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
  const popupWidth = Math.max(popupRect.width, popup.scrollWidth)
  const triggerRect = trigger.getBoundingClientRect()
  const leftBoundary = shellRect.left + EXCEL_TOOLBAR_POPUP_EDGE_INSET
  const rightBoundary = shellRect.right - EXCEL_TOOLBAR_POPUP_EDGE_INSET
  const topBoundary = shellRect.top + EXCEL_TOOLBAR_POPUP_EDGE_INSET
  const bottomBoundary = shellRect.bottom - EXCEL_TOOLBAR_POPUP_EDGE_INSET
  const naturalLeft = popup.dataset.excelPopupAnchorSide === 'left'
    ? triggerRect.left - popupWidth
    : triggerRect.right
  const rightmostLeft = Math.max(leftBoundary, rightBoundary - popupWidth)
  const targetLeft = Math.min(Math.max(naturalLeft, leftBoundary), rightmostLeft)
  const topOffset = readFiniteNumber(popup.dataset.excelPopupAnchorTopOffset) ?? 0
  const naturalTop = triggerRect.top + topOffset
  const bottommostTop = Math.max(topBoundary, bottomBoundary - popupRect.height)
  const targetTop = Math.min(Math.max(naturalTop, topBoundary), bottommostTop)
  const currentLeft = readFiniteNumber(popup.style.left) ?? 0
  const currentTop = readFiniteNumber(popup.style.top) ?? 0
  const nextLeft = Math.round((currentLeft + targetLeft - popupRect.left) * 100) / 100
  const nextTop = Math.round((currentTop + targetTop - popupRect.top) * 100) / 100

  setStyleValue(popup.style, 'width', `${popupWidth}px`)
  if (popup.style.left !== `${nextLeft}px`) popup.style.left = `${nextLeft}px`
  if (popup.style.top !== `${nextTop}px`) popup.style.top = `${nextTop}px`
  popup.dataset.excelPopupShiftX = '0'
  popup.dataset.excelPopupEscapedClip = 'true'
  if (isBorderSubmenu) popup.style.zIndex = '10001'
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
  const borderSubmenuCloseTimers = new Map<HTMLElement, number>()
  let pointerX = Number.NaN
  let pointerY = Number.NaN
  let previousPointerX = Number.NaN
  let activeBorderOption: HTMLElement | null = null

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

  const cancelBorderSubmenuClose = (option?: HTMLElement) => {
    if (option) {
      const timer = borderSubmenuCloseTimers.get(option)
      if (timer !== undefined) window.clearTimeout(timer)
      borderSubmenuCloseTimers.delete(option)
      return
    }
    borderSubmenuCloseTimers.forEach((timer) => window.clearTimeout(timer))
    borderSubmenuCloseTimers.clear()
  }

  const closeBorderSubmenu = (option: HTMLElement) => {
    const submenu = getDirectBorderSubmenu(option)
    if (submenu && submenu.style.display !== 'none') submenu.style.display = 'none'
    if (activeBorderOption === option) activeBorderOption = null
  }

  const closeBorderSubmenus = (except?: HTMLElement) => {
    shell.querySelectorAll<HTMLElement>(EXCEL_BORDER_OPTION_SELECTOR).forEach((option) => {
      if (option === except) return
      cancelBorderSubmenuClose(option)
      closeBorderSubmenu(option)
    })
  }

  const isPointerInsideBorderRegion = (option: HTMLElement): boolean => {
    const submenu = getDirectBorderSubmenu(option)
    if (!submenu || !isVisiblePopup(submenu)) return false

    const hit = Number.isFinite(pointerX) && Number.isFinite(pointerY)
      ? document.elementFromPoint(pointerX, pointerY)
      : null
    if (hit && (option.contains(hit) || submenu.contains(hit))) return true

    return [option.getBoundingClientRect(), submenu.getBoundingClientRect()].some((rect) => (
      pointerX >= rect.left
      && pointerX <= rect.right
      && pointerY >= rect.top
      && pointerY <= rect.bottom
    ))
  }

  const scheduleBorderSubmenuClose = (option: HTMLElement) => {
    cancelBorderSubmenuClose(option)
    const timer = window.setTimeout(() => {
      borderSubmenuCloseTimers.delete(option)
      if (!isPointerInsideBorderRegion(option)) closeBorderSubmenu(option)
    }, EXCEL_BORDER_SUBMENU_CLOSE_DELAY_MS)
    borderSubmenuCloseTimers.set(option, timer)
  }

  const isMovingTowardActiveSubmenu = (event: MouseEvent): boolean => {
    const option = activeBorderOption
    const submenu = option ? getDirectBorderSubmenu(option) : null
    if (!option || !submenu || !isVisiblePopup(submenu)) return false
    if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) return false

    const optionRect = option.getBoundingClientRect()
    const submenuRect = submenu.getBoundingClientRect()
    const directionOriginX = (
      Math.abs(event.clientX - pointerX) < 0.01
      && Number.isFinite(previousPointerX)
    ) ? previousPointerX : pointerX
    const movingHorizontallyToward = submenuRect.right <= optionRect.left
      ? event.clientX < directionOriginX
      : event.clientX > directionOriginX
    return movingHorizontallyToward
      && event.clientY >= submenuRect.top - EXCEL_TOOLBAR_POPUP_EDGE_INSET
      && event.clientY <= submenuRect.bottom + EXCEL_TOOLBAR_POPUP_EDGE_INSET
  }

  // Fortune queries below event.target, which is commonly the inner label,
  // preview, or chevron. Delegate from the shell so the entire row works.
  const handleBorderSubmenuOpen = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest(EXCEL_BORDER_SUBMENU_SELECTOR)) {
      const submenu = event.target.closest<HTMLElement>(EXCEL_BORDER_SUBMENU_SELECTOR)
      const option = submenu?.parentElement?.closest<HTMLElement>(EXCEL_BORDER_OPTION_SELECTOR)
      if (option) {
        cancelBorderSubmenuClose(option)
      }
      return
    }
    const option = getBorderOptionFromEventTarget(event.target)
    if (
      event.type !== 'click'
      && option
      && activeBorderOption
      && option !== activeBorderOption
      && isMovingTowardActiveSubmenu(event)
    ) {
      event.stopImmediatePropagation()
      cancelBorderSubmenuClose(activeBorderOption)
      return
    }
    if (option && shell.contains(option) && openBorderSubmenu(option)) {
      activeBorderOption = option
      cancelBorderSubmenuClose(option)
      closeBorderSubmenus(option)
      scheduleFit()
      return
    }

    // A regular border command (for example, diagonal border) is an explicit
    // destination, so an open color/style flyout should not linger there.
    const command = getBorderCommandFromEventTarget(event.target)
    if (!command || !shell.contains(command)) return
    if (
      event.type !== 'click'
      && activeBorderOption
      && isMovingTowardActiveSubmenu(event)
    ) {
      event.stopImmediatePropagation()
      cancelBorderSubmenuClose(activeBorderOption)
      return
    }
    cancelBorderSubmenuClose()
    closeBorderSubmenus()
  }

  // Fortune treats the fixed-position flyout as outside its trigger row and
  // hides both border submenus while the pointer crosses the gap to the flyout.
  const handleBorderSubmenuMouseOut = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return
    const option = event.target.closest<HTMLElement>(EXCEL_BORDER_OPTION_SELECTOR)
    if (!option || !shell.contains(option)) return
    const activeOption = activeBorderOption
    const activeSubmenu = activeOption ? getDirectBorderSubmenu(activeOption) : null
    if (!activeOption || !activeSubmenu || !isVisiblePopup(activeSubmenu)) return

    // Fortune's mouseleave handler hides both flyouts, including when the
    // pointer only crosses the inactive sibling row on its way to the active
    // fixed-position submenu. Own every border-row leave while a flyout is
    // active, then close only that flyout through its per-option timer.
    event.stopImmediatePropagation()
    if (
      event.relatedTarget instanceof Node
      && (activeOption.contains(event.relatedTarget) || activeSubmenu.contains(event.relatedTarget))
    ) {
      cancelBorderSubmenuClose(activeOption)
      return
    }
    if (isMovingTowardActiveSubmenu(event)) {
      cancelBorderSubmenuClose(activeOption)
      return
    }
    scheduleBorderSubmenuClose(activeOption)
  }

  const handlePointerMove = (event: PointerEvent) => {
    if (event.clientX !== pointerX || event.clientY !== pointerY) {
      previousPointerX = pointerX
    }
    pointerX = event.clientX
    pointerY = event.clientY
    if (!(event.target instanceof Element)) return
    const submenu = event.target.closest<HTMLElement>(EXCEL_BORDER_SUBMENU_SELECTOR)
    const option = submenu?.parentElement?.closest<HTMLElement>(EXCEL_BORDER_OPTION_SELECTOR)
      ?? event.target.closest<HTMLElement>(EXCEL_BORDER_OPTION_SELECTOR)
    if (option && shell.contains(option)) {
      cancelBorderSubmenuClose(option)
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
  shell.addEventListener('click', handleBorderSubmenuOpen, true)
  window.addEventListener('mouseover', handleBorderSubmenuOpen, true)
  window.addEventListener('mouseout', handleBorderSubmenuMouseOut, true)
  window.addEventListener('pointermove', handlePointerMove, true)
  shell.addEventListener('pointerover', scheduleFit, true)
  window.addEventListener('resize', scheduleFit)
  scheduleFit()

  return () => {
    popupObserver.disconnect()
    shellResizeObserver.disconnect()
    shell.removeEventListener('click', scheduleFit, true)
    shell.removeEventListener('click', handleBorderSubmenuOpen, true)
    window.removeEventListener('mouseover', handleBorderSubmenuOpen, true)
    window.removeEventListener('mouseout', handleBorderSubmenuMouseOut, true)
    window.removeEventListener('pointermove', handlePointerMove, true)
    shell.removeEventListener('pointerover', scheduleFit, true)
    window.removeEventListener('resize', scheduleFit)
    if (frame !== null) cancelAnimationFrame(frame)
    cancelBorderSubmenuClose()
  }
}
