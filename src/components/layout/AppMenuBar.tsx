import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/lib/i18n/runtime'
import type { TranslationKey } from '@/lib/i18n/types'
import { cn } from '@/lib/utils'
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
    ['new-agent', 'menu.newAgent'], ['run-multi-agent', 'menu.runMultiAgent', 'Ctrl+Shift+A'],
  ] },
  { top: 'help', label: 'menu.help', items: [
    ['open-onlyoffice-docs', 'menu.onlyOfficeDocs'], ['show-about', 'menu.aboutTitle'],
  ] },
]

const contentClass = 'z-[10000] min-w-[208px] rounded-[4px] border border-black/10 bg-card p-1 text-[13px] text-card-foreground shadow-lg dark:border-white/10'
const itemClass = 'flex h-8 cursor-default select-none items-center gap-3 rounded-[3px] px-2 outline-none data-[highlighted]:bg-black/[0.07] dark:data-[highlighted]:bg-white/[0.08]'
const triggerClass = 'flex h-7 min-w-11 shrink-0 items-center justify-center rounded-[3px] px-2 text-[13px] leading-none outline-none hover:bg-black/[0.06] focus-visible:bg-black/[0.06] data-[state=open]:bg-black/[0.09] dark:hover:bg-white/[0.07] dark:focus-visible:bg-white/[0.07] dark:data-[state=open]:bg-white/[0.11]'

export function AppMenuBar({ className }: { className?: string }) {
  const { t } = useTranslation()
  const [openMenu, setOpenMenu] = useState<AppMenuTop | null>(null)
  const openMenuRef = useRef<AppMenuTop | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  const clearCloseTimer = () => {
    if (closeTimerRef.current === null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }
  const setMenu = (top: AppMenuTop | null) => {
    clearCloseTimer()
    openMenuRef.current = top
    setOpenMenu(top)
  }
  useEffect(() => () => clearCloseTimer(), [])

  if (window.api.platform === 'darwin') return null

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
    if (openMenuRef.current !== null && openMenuRef.current !== top) setMenu(top)
  }
  const handleAction = (action: AppMenuAction) => {
    setMenu(null)
    void window.api.appMenu.perform(action)
  }

  return (
    <div className={cn('flex h-8 shrink-0 items-center gap-0', className)} role='menubar' aria-label={t('notepad.menuBar')}>
      {menus.map((menu) => (
        <DropdownMenu.Root
          key={menu.top}
          modal={false}
          open={openMenu === menu.top}
          onOpenChange={(open) => handleOpenChange(menu.top, open)}
        >
          <DropdownMenu.Trigger asChild>
            <button
              type='button'
              className={triggerClass}
              data-testid={'app-menu-' + menu.top}
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
              onPointerDownOutside={() => setMenu(null)}
            >
              {menu.items.map((item, index) => item === 'separator' ? (
                <DropdownMenu.Separator
                  key={menu.top + '-' + index}
                  className='my-1 h-px bg-black/10 dark:bg-white/10'
                />
              ) : (
                <DropdownMenu.Item
                  key={item[0]}
                  className={itemClass}
                  data-testid={'app-menu-action-' + item[0]}
                  onSelect={() => handleAction(item[0])}
                >
                  <span className='min-w-0 flex-1 truncate'>{t(item[1])}</span>
                  {item[2] && <span className='ml-auto pl-6 text-[12px] text-black/55 dark:text-white/55'>{item[2]}</span>}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ))}
    </div>
  )
}
