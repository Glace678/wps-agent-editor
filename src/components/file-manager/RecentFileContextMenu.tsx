import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  ExternalLink,
  FolderOpen,
  History,
  Info,
  ListX,
  PenLine,
  Share2,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/runtime'
import { APP_THEME_EVENT } from '@/lib/theme'
import { fileHoverCardBoxShadow } from './file-hover-card-styles'
import type { TranslationKey } from '@/lib/i18n/types'

export type RecentFileMenuAction =
  | 'open'
  | 'share'
  | 'rename'
  | 'info'
  | 'history'
  | 'show-in-folder'
  | 'remove-record'
  | 'delete'

interface MenuItem {
  action: RecentFileMenuAction
  labelKey: TranslationKey
  icon: LucideIcon
  danger?: boolean
}

// WPS 风格分组：打开/分享 | 重命名/文件信息/历史版本 | 打开文件位置 | 删除记录/删除文件
const MENU_GROUPS: MenuItem[][] = [
  [
    { action: 'open', labelKey: 'recentFiles.menuOpen', icon: ExternalLink },
    { action: 'share', labelKey: 'recentFiles.menuShare', icon: Share2 },
  ],
  [
    { action: 'rename', labelKey: 'recentFiles.menuRename', icon: PenLine },
    { action: 'info', labelKey: 'recentFiles.menuFileInfo', icon: Info },
    { action: 'history', labelKey: 'recentFiles.menuHistory', icon: History },
  ],
  [
    { action: 'show-in-folder', labelKey: 'recentFiles.menuShowInFolder', icon: FolderOpen },
  ],
  [
    { action: 'remove-record', labelKey: 'recentFiles.menuRemoveRecord', icon: ListX },
    { action: 'delete', labelKey: 'recentFiles.menuDeleteFile', icon: Trash2, danger: true },
  ],
]

const VIEW_PAD = 8

function readDocumentIsDark(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.classList.contains('dark')
}

interface RecentFileContextMenuProps {
  /** 鼠标右键位置（视口坐标） */
  x: number
  y: number
  onAction: (action: RecentFileMenuAction) => void
  onClose: () => void
}

/**
 * 「最近」列表的右键菜单。
 *
 * 与 FileHoverCard 同理：portal 到 body、position:fixed 像素定位、
 * box-shadow 画描边，避免 Electron 下 transform 弹层的半边框问题。
 */
export function RecentFileContextMenu({ x, y, onAction, onClose }: RecentFileContextMenuProps) {
  const { t } = useTranslation()
  const menuRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const [isDark, setIsDark] = useState(readDocumentIsDark)

  // 先隐藏渲染测量尺寸，放不下时向指针另一侧翻转（原生菜单行为），
  // 避免菜单被夹取后滑到指针正下方、危险项落在光标上
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = x
    let top = y
    if (left + rect.width + VIEW_PAD > vw) left = Math.max(VIEW_PAD, x - rect.width)
    if (top + rect.height + VIEW_PAD > vh) top = Math.max(VIEW_PAD, y - rect.height)
    setCoords({ top, left })
  }, [x, y])

  // 打开时聚焦首项，关闭时还原焦点（配合 role=menu 的键盘可达性）
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => previouslyFocused?.focus()
  }, [])

  useEffect(() => {
    const sync = () => setIsDark(readDocumentIsDark())
    window.addEventListener(APP_THEME_EVENT, sync)
    return () => window.removeEventListener(APP_THEME_EVENT, sync)
  }, [])

  const handleOutsidePointer = useCallback((event: Event) => {
    if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return
    // 原生菜单行为：用左键点外部关闭菜单时，这次点击只负责关闭，
    // 不能同时触发底下的控件（如误开另一份文件）。右键不吞，让新菜单能弹出。
    if (event instanceof PointerEvent && event.button === 0) {
      const swallowClick = (clickEvent: Event) => {
        clickEvent.preventDefault()
        clickEvent.stopPropagation()
      }
      document.addEventListener('click', swallowClick, { capture: true, once: true })
      setTimeout(() => document.removeEventListener('click', swallowClick, true), 350)
    }
    onClose()
  }, [onClose])

  const handleMenuKeyDown = useCallback((event: ReactKeyboardEvent) => {
    const menu = menuRef.current
    if (!menu) return
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    if (items.length === 0) return
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(currentIndex + 1) % items.length].focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(currentIndex - 1 + items.length) % items.length].focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      items[0].focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      items[items.length - 1].focus()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const handleScroll = (event: Event) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return
      onClose()
    }
    const handleClose = () => onClose()
    // capture 阶段监听，保证点在其他可停止冒泡的组件上也能关掉菜单
    document.addEventListener('pointerdown', handleOutsidePointer, true)
    document.addEventListener('contextmenu', handleOutsidePointer, true)
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleClose)
    window.addEventListener('blur', handleClose)
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer, true)
      document.removeEventListener('contextmenu', handleOutsidePointer, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleClose)
      window.removeEventListener('blur', handleClose)
    }
  }, [handleOutsidePointer, onClose])

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      data-testid="recent-file-context-menu"
      onKeyDown={handleMenuKeyDown}
      style={{
        position: 'fixed',
        top: coords ? coords.top : y,
        left: coords ? coords.left : x,
        visibility: coords ? 'visible' : 'hidden',
        zIndex: 2147483000,
        minWidth: 184,
        borderRadius: 8,
        backgroundColor: 'hsl(var(--card))',
        color: 'hsl(var(--card-foreground))',
        border: 'none',
        outline: 'none',
        boxShadow: fileHoverCardBoxShadow(isDark),
        padding: '4px 0',
        boxSizing: 'border-box',
      }}
    >
      {MENU_GROUPS.map((group, groupIndex) => (
        <div key={group[0].action} role="group">
          {groupIndex > 0 && <div className="mx-2 my-1 h-px bg-border" />}
          {group.map(({ action, labelKey, icon: Icon, danger }) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              data-testid={`recent-menu-${action}`}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] hover:bg-accent focus:bg-accent focus:outline-none',
                danger ? 'text-destructive hover:text-destructive focus:text-destructive' : 'text-card-foreground',
              )}
              onClick={() => onAction(action)}
            >
              <Icon className={cn('h-3.5 w-3.5 shrink-0', danger ? '' : 'text-muted-foreground')} />
              {t(labelKey)}
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  )
}
