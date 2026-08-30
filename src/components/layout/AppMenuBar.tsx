import { desktopApi } from '@/platform'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useTranslation } from '@/lib/i18n/runtime'
import type { TranslationKey } from '@/lib/i18n/types'
import { cn } from '@/lib/utils'
import { AGENT_COLLABORATION_ENABLED } from '@/lib/agent-collaboration'
import type { AppMenuAction } from '@/types/app-menu'

type AppMenuTop = 'file' | 'edit' | 'view' | 'agent' | 'help'
type AppMenuEntry = 'separator' | readonly [AppMenuAction, TranslationKey, string?]

const menus: ReadonlyArray<{ top: AppMenuTop; label: TranslationKey; items: readonly AppMenuEntry[] }> = [
  { top: 'file', label: 'menu.file', items: [
    ['open-file', 'menu.openFile', 'Ctrl+O'], ['open-folder', 'menu.openFolder', 'Ctrl+Shift+O'], 'separator',
    ['save', 'menu.save', 'Ctrl+S'], ['print', 'menu.print', 'Ctrl+P'], 'separator', ['quit', 'menu.quit', 'Alt+F4'],
  ] },
  { top: 'edit', label: 'menu.edit', items: [
    ['undo', 'menu.undo', 'Ctrl+Z'], ['redo', 'menu.redo', 'Ctrl+Y'], 'separator',
    ['cut', 'menu.cut', 'Ctrl+X'], ['copy', 'menu.copy', 'Ctrl+C'], ['paste', 'menu.paste', 'Ctrl+V'], 'separator',
    ['select-all', 'menu.selectAll', 'Ctrl+A'],
  ] },
  { top: 'view', label: 'menu.view', items: [
    ['reload', 'menu.reload', 'Ctrl+R'], ['force-reload', 'menu.forceReload', 'Ctrl+Alt+Shift+R'],
    ['toggle-dev-tools', 'menu.toggleDevTools', 'Ctrl+Shift+I'], 'separator',
    ['reset-zoom', 'menu.resetZoom', 'Ctrl+0'], ['zoom-in', 'menu.zoomIn', 'Ctrl++'], ['zoom-out', 'menu.zoomOut', 'Ctrl+-'],
    'separator', ['toggle-fullscreen', 'menu.toggleFullscreen', 'F11'],
  ] },
  { top: 'agent', label: 'menu.agent', items: [
    ['new-agent', 'menu.newAgent'],
    ...(AGENT_COLLABORATION_ENABLED
      ? [['run-multi-agent', 'menu.runMultiAgent', 'Ctrl+Shift+A'] as const]
      : []),
  ] },
  { top: 'help', label: 'menu.help', items: [['show-about', 'menu.aboutTitle']] },
]

const contentClass = 'z-[10000] min-w-[210px] rounded-xl border border-border bg-popover p-1.5 text-[13px] text-popover-foreground shadow-lg'
const itemClass = 'flex h-7 cursor-default select-none items-center gap-3 rounded-md px-2.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground'
const triggerClass = 'flex h-7 min-w-10 shrink-0 items-center justify-center rounded-md px-2.5 text-[13px] leading-none outline-none hover:bg-accent focus-visible:bg-accent data-[state=open]:bg-accent text-foreground'

export function AppMenuBar({ className }: { className?: string }) {
  const { language, t } = useTranslation()
  const direction = language === 'ar' ? 'rtl' : 'ltr'
  const [openMenu, setOpenMenu] = useState<AppMenuTop | null>(null)
  const openMenuRef = useRef<AppMenuTop | null>(null)
  const hoverOpenedMenuRef = useRef<AppMenuTop | null>(null)
  const triggerPointerDownRef = useRef<{ top: AppMenuTop; wasOpen: boolean } | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  const clearCloseTimer = () => {
    if (closeTimerRef.current === null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }
  const setMenu = (top: AppMenuTop | null) => {
    clearCloseTimer()
    if (top === null) hoverOpenedMenuRef.current = null
    openMenuRef.current = top
    setOpenMenu(top)
  }
  useEffect(() => () => clearCloseTimer(), [])

  if (desktopApi.app.platform === 'darwin') return null

  const handleOpenChange = (top: AppMenuTop, open: boolean) => {
    if (open) return setMenu(top)
    clearCloseTimer()
    // A prior root closes as the pointer enters its sibling. Let the sibling win.
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      if (openMenuRef.current === top) setMenu(null)
    }, 0)
  }
  const handlePointerEnter = (top: AppMenuTop) => {
    if (openMenuRef.current !== null && openMenuRef.current !== top) {
      hoverOpenedMenuRef.current = top
      setMenu(top)
    }
  }
  const handleTriggerPointerDown = (
    top: AppMenuTop,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button === 0 && !event.ctrlKey) {
      triggerPointerDownRef.current = {
        top,
        // Moving across an open menubar opens the sibling on hover. The first
        // click on that sibling must keep it open instead of toggling it shut.
        wasOpen: event.currentTarget.dataset.state === 'open'
          && hoverOpenedMenuRef.current !== top,
      }
      // Radix toggles on pointerdown. WebView2 can drop that internal toggle while
      // still delivering click, so keep click as the single cross-runtime path.
      event.preventDefault()
    }
  }
  const handleTriggerClick = (
    top: AppMenuTop,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0 || event.ctrlKey) return
    const pointerDown = triggerPointerDownRef.current
    triggerPointerDownRef.current = null
    const wasOpen = pointerDown?.top === top
      ? pointerDown.wasOpen
      : openMenuRef.current === top
    hoverOpenedMenuRef.current = null
    setMenu(wasOpen ? null : top)
  }
  const handleAction = (action: AppMenuAction) => {
    setMenu(null)
    void desktopApi.app.performMenuAction(action)
  }

  return (
    <div className={cn('flex h-8 shrink-0 items-center gap-0.5', className)} role='menubar' aria-label={t('notepad.menuBar')}>
      {menus.map((menu) => (
        <DropdownMenu.Root
          key={menu.top}
          modal={false}
          dir={direction}
          open={openMenu === menu.top}
          onOpenChange={(open) => handleOpenChange(menu.top, open)}
        >
          <DropdownMenu.Trigger asChild>
            <button
              type='button'
              className={triggerClass}
              data-testid={'app-menu-' + menu.top}
              onPointerDown={(event) => handleTriggerPointerDown(menu.top, event)}
              onClick={(event) => handleTriggerClick(menu.top, event)}
              onPointerEnter={() => handlePointerEnter(menu.top)}
            >
              {t(menu.label)}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              sideOffset={0}
              align='start'
              className={contentClass}
              data-testid={'app-menu-content-' + menu.top}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onEscapeKeyDown={() => setMenu(null)}
            >
              {menu.items.map((item, index) => item === 'separator' ? (
                <DropdownMenu.Separator
                  key={menu.top + '-' + index}
                  className='my-1 h-px bg-border'
                />
              ) : (
                <DropdownMenu.Item
                  key={item[0]}
                  className={itemClass}
                  data-testid={'app-menu-action-' + item[0]}
                  onSelect={() => handleAction(item[0])}
                >
                  <span className='min-w-0 flex-1 truncate'>{t(item[1])}</span>
                  {item[2] && <span className='ml-auto pl-6 text-[12px] text-muted-foreground'>{item[2]}</span>}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ))}
    </div>
  )
}
