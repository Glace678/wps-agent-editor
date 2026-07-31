import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  Bold,
  Check,
  ChevronDown,
  ChevronRight,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MoreHorizontal,
  Pilcrow,
  RemoveFormatting,
  Settings,
  Strikethrough,
  Table2,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslation } from '@/lib/i18n/runtime'
import { cn } from '@/lib/utils'
import {
  createMenubarState,
  isMenubarTop,
  isMenubarTopOpen,
  menubarDismiss,
  menubarOpenChange,
  menubarPointerEnterTop,
  menubarSettleAfterClose,
  type MenubarTop,
} from './notepad-menubar'
import { formattingTierFromWidth } from './notepad-commandbar-layout'

interface NotepadCommandBarProps {
  canUndo: boolean
  canRedo: boolean
  hasSelection: boolean
  wordWrap: boolean
  statusBar: boolean
  formattingEnabled: boolean
  zoom: number
  recentFiles: Array<{ path: string; name: string }>
  markdownView: 'formatted' | 'syntax'
  markdownEnabled?: boolean
  onNew: () => void
  onNewMarkdown: () => void
  onNewWindow: () => void
  onOpen: () => void
  onOpenRecent: (path: string) => void
  onSave: () => void
  onSaveAs: () => void
  onSaveAll: () => void
  onPageSetup: () => void
  onPrint: () => void
  onClose: () => void
  onCloseWindow: () => void
  onExit: () => void
  onUndo: () => void
  onRedo: () => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  onDelete: () => void
  onFind: () => void
  onFindNext: () => void
  onFindPrevious: () => void
  onReplace: () => void
  onGoTo: () => void
  onSelectAll: () => void
  onTimeDate: () => void
  onClearFormat: () => void
  onSearchWeb: () => void
  onFont: () => void
  onToggleWrap: () => void
  onToggleStatusBar: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onMarkdownView: (view: 'formatted' | 'syntax') => void
  onFormat: (command: string) => void
  onInsertTable: (rows: number, columns: number) => void
  onSettings: () => void
}

const contentClass =
  'z-[10000] min-w-[232px] max-w-[360px] rounded-md border border-black/10 bg-[#f9f9f9] p-1 text-[13px] text-[#1f1f1f] shadow-xl dark:border-white/10 dark:bg-[#2c2c2c] dark:text-[#f5f5f5]'

/** Top-level File/Edit/View content: shared shell + open animation class. */
const menubarContentClass = `${contentClass} notepad-menubar-content`

/** Compact shell for short format pickers (heading / list styles). Keeps File/Edit/View on the wide menubar shell. */
/**
 * Heading / list style popups: content-fit width with a generous max so
 * localized labels (e.g. RU/DE/PT “numbered/bulleted list”) do not overflow.
 * Still clearly smaller than the File/Edit/View menubar shell (min 232).
 */
const compactFormatContentClass =
  'z-[10000] min-w-[120px] max-w-[280px] w-max rounded-md border border-black/10 bg-[#f9f9f9] p-1 text-[13px] text-[#1f1f1f] shadow-xl dark:border-white/10 dark:bg-[#2c2c2c] dark:text-[#f5f5f5]'

/** Compact shell for insert-table picker (toolbar + overflow subcontent).
 * Tighter than the old fixed 144px shell. max-w must fit 5×20 + 4×4 grid (116px) + p-1.5 (12px) → ≥128px. */
const compactTableContentClass =
  'z-[10000] w-max min-w-0 max-w-[128px] rounded-md border border-black/10 bg-[#f9f9f9] p-1.5 text-[13px] text-[#1f1f1f] shadow-xl dark:border-white/10 dark:bg-[#2c2c2c] dark:text-[#f5f5f5]'

const itemClass =
  'flex h-8 cursor-default select-none items-center gap-3 rounded-[4px] px-2 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-black/[0.07] dark:data-[highlighted]:bg-white/[0.08]'

const tooltipClass =
  'whitespace-nowrap rounded-[2px] border-0 bg-[#666] px-1.5 py-1.5 text-center text-[12px] leading-normal text-white shadow-none'

function Shortcut({ children }: { children: string }) {
  return <span className="ml-auto pl-8 text-[12px] text-black/55 dark:text-white/55">{children}</span>
}

function MenuItem({
  children,
  shortcut,
  disabled,
  className,
  onSelect,
}: {
  children: ReactNode
  shortcut?: string
  disabled?: boolean
  className?: string
  onSelect: () => void
}) {
  return (
    <DropdownMenu.Item className={cn(itemClass, className)} disabled={disabled} onSelect={onSelect}>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <Shortcut>{shortcut}</Shortcut>}
    </DropdownMenu.Item>
  )
}

function CheckItem({
  checked,
  children,
  testId,
  onSelect,
}: {
  checked: boolean
  children: ReactNode
  testId?: string
  onSelect: () => void
}) {
  return (
    <DropdownMenu.CheckboxItem
      className={cn(itemClass, 'pl-8')}
      checked={checked}
      data-testid={testId}
      onCheckedChange={onSelect}
    >
      <DropdownMenu.ItemIndicator className="absolute left-2">
        <Check className="h-4 w-4" />
      </DropdownMenu.ItemIndicator>
      {children}
    </DropdownMenu.CheckboxItem>
  )
}

function MenuTrigger({
  label,
  testId,
  menubarTop,
  onPointerEnter,
}: {
  label: string
  testId: string
  /** Marks this control as a File/Edit/View hot-track target. */
  menubarTop: MenubarTop
  onPointerEnter?: () => void
}) {
  return (
    <DropdownMenu.Trigger asChild>
      <button
        type="button"
        className="flex h-7 min-w-12 w-auto shrink-0 items-center justify-start whitespace-nowrap rounded-[4px] px-2 text-[14px] leading-none text-inherit outline-none hover:bg-black/[0.06] focus-visible:bg-black/[0.06] data-[state=open]:bg-[#e5e5e5] dark:hover:bg-white/[0.07] dark:focus-visible:bg-white/[0.07] dark:data-[state=open]:bg-[#3b3b3b]"
        aria-label={label}
        data-testid={testId}
        data-menubar-top={menubarTop}
        onPointerEnter={onPointerEnter}
      >
        {label}
      </button>
    </DropdownMenu.Trigger>
  )
}

function CommandBarTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className={tooltipClass}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function ToolbarButton({
  label,
  shortcut,
  pressed,
  testId,
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  pressed?: boolean
  testId?: string
  onClick: () => void
  children: ReactNode
}) {
  const description = shortcut ? `${label} (${shortcut})` : label
  return (
    <CommandBarTooltip label={description}>
      <button
        type="button"
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] outline-none hover:bg-black/[0.07] focus-visible:ring-2 focus-visible:ring-[#4f93e7] dark:hover:bg-white/[0.08]',
          pressed && 'bg-black/[0.09] dark:bg-white/[0.11]',
        )}
        aria-label={description}
        aria-pressed={pressed}
        data-testid={testId}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
      >
        {children}
      </button>
    </CommandBarTooltip>
  )
}

function BoldGlyph() {
  return <span aria-hidden="true" className="text-[16px] font-bold leading-none">B</span>
}

function FormattingDropdown({
  label,
  trigger,
  children,
  contentClassName = contentClass,
}: {
  label: string
  trigger: ReactNode
  children: ReactNode
  contentClassName?: string
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <CommandBarTooltip label={label}>
        <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      </CommandBarTooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={4}
          align="start"
          className={contentClassName}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function FormattingMenu({ onFormat }: { onFormat: (command: string) => void }) {
  const { t } = useTranslation()
  return (
    <>
      <FormattingDropdown
        label={t('notepad.headingStyles')}
        contentClassName={compactFormatContentClass}
        trigger={(
          <button
            type="button"
            className="flex h-8 w-14 shrink-0 items-center justify-center gap-1 rounded-[4px] text-[13px] outline-none hover:bg-black/[0.07] data-[state=open]:bg-[#e5e5e5] dark:hover:bg-white/[0.08] dark:data-[state=open]:bg-[#3b3b3b]"
            aria-label={t('notepad.headingStyles')}
            data-testid="notepad-heading-menu"
          >
            <span className="font-medium">H1</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
        )}
      >
        <MenuItem className="gap-2 px-2 whitespace-nowrap" onSelect={() => onFormat('paragraph')}><span className="flex items-center gap-2 whitespace-nowrap"><Pilcrow className="h-4 w-4 shrink-0" />{t('notepad.bodyText')}</span></MenuItem>
        <MenuItem className="gap-2 px-2 whitespace-nowrap" onSelect={() => onFormat('heading-1')}><span className="flex items-center gap-2 whitespace-nowrap"><Heading1 className="h-4 w-4 shrink-0" />{t('notepad.heading1')}</span></MenuItem>
        <MenuItem className="gap-2 px-2 whitespace-nowrap" onSelect={() => onFormat('heading-2')}><span className="flex items-center gap-2 whitespace-nowrap"><Heading2 className="h-4 w-4 shrink-0" />{t('notepad.heading2')}</span></MenuItem>
        <MenuItem className="gap-2 px-2 whitespace-nowrap" onSelect={() => onFormat('heading-3')}><span className="flex items-center gap-2 whitespace-nowrap"><Heading3 className="h-4 w-4 shrink-0" />{t('notepad.heading3')}</span></MenuItem>
      </FormattingDropdown>

      <FormattingDropdown
        label={t('notepad.listStyles')}
        contentClassName={compactFormatContentClass}
        trigger={(
          <button
            type="button"
            className="flex h-8 w-14 shrink-0 items-center justify-center gap-1 rounded-[4px] outline-none hover:bg-black/[0.07] data-[state=open]:bg-[#e5e5e5] dark:hover:bg-white/[0.08] dark:data-[state=open]:bg-[#3b3b3b]"
            aria-label={t('notepad.listStyles')}
            data-testid="notepad-list-menu"
          >
            <List className="h-4 w-4" />
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
        )}
      >
        <MenuItem className="gap-2 px-2 whitespace-nowrap" onSelect={() => onFormat('bullet-list')}><span className="flex items-center gap-2 whitespace-nowrap"><List className="h-4 w-4 shrink-0" />{t('notepad.bulletList')}</span></MenuItem>
        <MenuItem className="gap-2 px-2 whitespace-nowrap" onSelect={() => onFormat('number-list')}><span className="flex items-center gap-2 whitespace-nowrap"><ListOrdered className="h-4 w-4 shrink-0" />{t('notepad.numberedList')}</span></MenuItem>
        <MenuItem className="gap-2 px-2 whitespace-nowrap" onSelect={() => onFormat('check-list')}><span className="flex items-center gap-2 whitespace-nowrap"><ListChecks className="h-4 w-4 shrink-0" />{t('notepad.taskList')}</span></MenuItem>
      </FormattingDropdown>
    </>
  )
}

interface TableSelection {
  rows: number
  columns: number
}

function TableInsertGrid({
  selection,
  onSelectionChange,
  onInsertTable,
}: {
  selection: TableSelection
  onSelectionChange: (selection: TableSelection) => void
  onInsertTable: (rows: number, columns: number) => void
}) {
  const { t } = useTranslation()
  const rows = 5
  const columns = 5

  return (
    <div
      className="notepad-table-size-grid"
      role="grid"
      aria-label={t('notepad.selectTableSize')}
      onPointerLeave={() => onSelectionChange({ rows: 1, columns: 1 })}
    >
      {Array.from({ length: rows * columns }, (_, index) => {
        const row = Math.floor(index / columns) + 1
        const column = (index % columns) + 1
        const selected = row <= selection.rows && column <= selection.columns
        return (
          <button
            key={`${row}-${column}`}
            type="button"
            className={cn(
              'notepad-table-size-cell h-5 w-5 outline-none',
              selected && 'notepad-table-size-cell-selected',
            )}
            aria-label={t('notepad.tableCellLabel', { row, column })}
            onPointerEnter={() => onSelectionChange({ rows: row, columns: column })}
            onFocus={() => onSelectionChange({ rows: row, columns: column })}
            onClick={() => onInsertTable(row, column)}
          />
        )
      })}
    </div>
  )
}

function TableInsertPicker({ onInsertTable }: { onInsertTable: (rows: number, columns: number) => void }) {
  const { t } = useTranslation()
  const [selection, setSelection] = useState<TableSelection>({ rows: 1, columns: 1 })

  return (
    <>
      <div className="mb-2 px-1 text-left text-[12px] leading-4 text-black/65 dark:text-white/65">
        {t('notepad.tableSizeLabel', {
          rows: selection.rows,
          columns: selection.columns,
        })}
      </div>
      <TableInsertGrid
        selection={selection}
        onSelectionChange={setSelection}
        onInsertTable={onInsertTable}
      />
      <DropdownMenu.Separator className="my-2 h-px bg-black/10 dark:bg-white/10" />
      <MenuItem
        className="h-6 gap-1 px-1.5"
        onSelect={() => onInsertTable(selection.rows, selection.columns)}
      >
        {t('notepad.insertTable')}
      </MenuItem>
      <MenuItem className="h-6 gap-1 px-1.5" disabled onSelect={() => undefined}>
        <span className="flex min-w-0 flex-1 items-center justify-between gap-1">
          <span className="truncate">{t('notepad.editTable')}</span>
          <ChevronRight className="h-4 w-4 shrink-0 opacity-60" />
        </span>
      </MenuItem>
    </>
  )
}

function TableInsertMenu({ onInsertTable }: { onInsertTable: (rows: number, columns: number) => void }) {
  const { t } = useTranslation()
  return (
    <DropdownMenu.Root modal={false}>
      <CommandBarTooltip label={t('notepad.insertTable')}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="flex h-8 w-14 shrink-0 items-center justify-center gap-2 rounded-[4px] outline-none hover:bg-black/[0.07] data-[state=open]:bg-[#e5e5e5] dark:hover:bg-white/[0.08] dark:data-[state=open]:bg-[#3b3b3b]"
            aria-label={t('notepad.insertTable')}
            data-testid="notepad-table-menu"
          >
            <Table2 className="h-4 w-4" />
            <ChevronDown className="relative -left-px h-3 w-3 opacity-60" />
          </button>
        </DropdownMenu.Trigger>
      </CommandBarTooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content sideOffset={4} align="start" className={compactTableContentClass}>
          <TableInsertPicker onInsertTable={onInsertTable} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/**
 * Overflow "⋯" menu for format actions that no longer fit as icons.
 * At tier 0 (narrowest bar) it is the ONLY formatting control: it absorbs the
 * heading / list styles too, keeping the center column at a single 32px icon
 * so File/Edit/View and the settings button always stay visible.
 */
function OverflowFormattingMenu({
  tier,
  onFormat,
  onInsertTable,
}: {
  tier: number
  onFormat: (command: string) => void
  onInsertTable: (rows: number, columns: number) => void
}) {
  const { t } = useTranslation()
  if (tier >= 6) return null
  return (
    <FormattingDropdown
      label={tier < 1 ? t('notepad.formatting') : t('notepad.moreOptions')}
      trigger={(
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] outline-none hover:bg-black/[0.07] data-[state=open]:bg-[#e5e5e5] dark:hover:bg-white/[0.08] dark:data-[state=open]:bg-[#3b3b3b]"
          aria-label={tier < 1 ? t('notepad.formatting') : t('notepad.moreOptions')}
          data-testid="notepad-format-overflow"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}
    >
      {tier < 1 && (
        <>
          <MenuItem onSelect={() => onFormat('paragraph')}><span className="flex items-center gap-3"><Pilcrow className="h-4 w-4" />{t('notepad.bodyText')}</span></MenuItem>
          <MenuItem onSelect={() => onFormat('heading-1')}><span className="flex items-center gap-3"><Heading1 className="h-4 w-4" />{t('notepad.heading1')}</span></MenuItem>
          <MenuItem onSelect={() => onFormat('heading-2')}><span className="flex items-center gap-3"><Heading2 className="h-4 w-4" />{t('notepad.heading2')}</span></MenuItem>
          <MenuItem onSelect={() => onFormat('heading-3')}><span className="flex items-center gap-3"><Heading3 className="h-4 w-4" />{t('notepad.heading3')}</span></MenuItem>
          <DropdownMenu.Separator className="my-1 h-px bg-black/10 dark:bg-white/10" />
          <MenuItem onSelect={() => onFormat('bullet-list')}><span className="flex items-center gap-3"><List className="h-4 w-4" />{t('notepad.bulletList')}</span></MenuItem>
          <MenuItem onSelect={() => onFormat('number-list')}><span className="flex items-center gap-3"><ListOrdered className="h-4 w-4" />{t('notepad.numberedList')}</span></MenuItem>
          <MenuItem onSelect={() => onFormat('check-list')}><span className="flex items-center gap-3"><ListChecks className="h-4 w-4" />{t('notepad.taskList')}</span></MenuItem>
          <DropdownMenu.Separator className="my-1 h-px bg-black/10 dark:bg-white/10" />
        </>
      )}
      {tier < 2 && <MenuItem shortcut="Ctrl+B" onSelect={() => onFormat('bold')}><span className="flex items-center gap-3"><Bold className="h-4 w-4" />{t('notepad.bold')}</span></MenuItem>}
      {tier < 3 && <MenuItem shortcut="Ctrl+I" onSelect={() => onFormat('italic')}><span className="flex items-center gap-3"><Italic className="h-4 w-4" />{t('notepad.italic')}</span></MenuItem>}
      {tier < 4 && <MenuItem shortcut="Ctrl+Shift+X" onSelect={() => onFormat('strikethrough')}><span className="flex items-center gap-3"><Strikethrough className="h-4 w-4" />{t('notepad.strikethrough')}</span></MenuItem>}
      {tier < 5 && <MenuItem shortcut="Ctrl+K" onSelect={() => onFormat('link')}><span className="flex items-center gap-3"><Link className="h-4 w-4" />{t('notepad.link')}</span></MenuItem>}
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger className={itemClass}>
          <span className="flex items-center gap-3"><Table2 className="h-4 w-4" />{t('notepad.table')}</span>
          <ChevronRight className="ml-auto h-4 w-4" />
        </DropdownMenu.SubTrigger>
        <DropdownMenu.Portal>
          <DropdownMenu.SubContent sideOffset={4} className={compactTableContentClass}>
            <TableInsertPicker onInsertTable={onInsertTable} />
          </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Sub>
      <MenuItem shortcut="Ctrl+Space" onSelect={() => onFormat('clear-format')}><span className="flex items-center gap-3"><RemoveFormatting className="h-4 w-4" />{t('notepad.clearFormatting')}</span></MenuItem>
    </FormattingDropdown>
  )
}

/**
 * Pick how many format icons fit in the command bar.
 * layoutKey (e.g. language) re-binds the observer when chrome remounts or labels change.
 * Ignore width ≤ 0 so a detached/remounted observer never collapses the toolbar to empty.
 */
function useFormattingTier(ref: RefObject<HTMLDivElement>, layoutKey?: string | number): number {
  const [tier, setTier] = useState(6)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => {
      const next = formattingTierFromWidth(element.clientWidth)
      // Detached nodes / remount frames report 0 — keep last good tier (icons stay visible).
      if (next === null) return
      setTier(next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [ref, layoutKey])
  return tier
}

export function NotepadCommandBar(props: NotepadCommandBarProps) {
  const { t, language } = useTranslation()
  const barRef = useRef<HTMLDivElement>(null)
  // Re-measure when language changes (menu label widths change); do not remount the bar.
  const formattingTier = useFormattingTier(barRef, language)
  const [menuState, setMenuState] = useState(createMenubarState)
  /** Which File/Edit/View label the pointer last entered (for hot-track settle). */
  const pointerOverMenubarTopRef = useRef<MenubarTop | null>(null)
  /** Defers Radix close so sibling pointerenter can hot-track-switch first. */
  const menubarCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelDeferredMenubarClose = () => {
    if (menubarCloseTimerRef.current != null) {
      clearTimeout(menubarCloseTimerRef.current)
      menubarCloseTimerRef.current = null
    }
  }

  const handleMenubarOpenChange = (top: MenubarTop, open: boolean) => {
    if (open) {
      cancelDeferredMenubarClose()
      pointerOverMenubarTopRef.current = top
      setMenuState((state) => menubarOpenChange(state, top, open))
      return
    }
    // Radix often fires close when leaving a trigger *before* the next top's
    // pointerenter. Defer, then either open the top under the pointer or idle.
    cancelDeferredMenubarClose()
    menubarCloseTimerRef.current = setTimeout(() => {
      menubarCloseTimerRef.current = null
      setMenuState((state) => {
        const closed = menubarOpenChange(state, top, false)
        return menubarSettleAfterClose(closed, pointerOverMenubarTopRef.current)
      })
    }, 50)
  }

  const handleMenubarPointerEnter = (top: MenubarTop) => {
    pointerOverMenubarTopRef.current = top
    cancelDeferredMenubarClose()
    // Always try hot-track switch when active or a menu is open.
    setMenuState((state) => menubarPointerEnterTop(state, top))
  }

  /** True full dismiss (item click / outside / Escape) — ends hot-track. */
  const dismissMenubar = () => {
    cancelDeferredMenubarClose()
    pointerOverMenubarTopRef.current = null
    setMenuState(menubarDismiss())
  }

  const onMenubarPointerDownOutside = (event: { target: EventTarget; preventDefault: () => void }) => {
    const el = event.target instanceof Element ? event.target : null
    const overTop = el?.closest?.('[data-menubar-top]')?.getAttribute('data-menubar-top')
    if (isMenubarTop(overTop)) {
      // Moving onto another File/Edit/View label — do not dismiss hot-track.
      event.preventDefault()
      pointerOverMenubarTopRef.current = overTop
      setMenuState({ open: overTop, active: true })
      return
    }
    dismissMenubar()
  }
  // Radix types PointerDownOutsideEvent narrowly; keep a compatible adapter.
  const onMenubarPointerDownOutsideRadix = onMenubarPointerDownOutside as (event: Event) => void

  return (
    <TooltipProvider delayDuration={450}>
      <div
        ref={barRef}
        // Force LTR chrome so html[dir=rtl] (Arabic) does not reverse/clip the toolbar.
        dir="ltr"
        className="notepad-commandbar h-[33px] shrink-0 overflow-hidden bg-[#f3f3f3] text-[#1f1f1f] dark:bg-[#2c2c2c] dark:text-white"
        data-testid="notepad-commandbar"
        data-formatting-tier={formattingTier}
        data-language={language}
      >
        {/* 左列 min 为 max-content：窄窗口（Agent 助手拉到最大）时
            文件/编辑/查看菜单保持完整宽度，不被居中工具栏挤压 */}
        <div className="grid h-full w-full grid-cols-[minmax(max-content,1fr)_auto_minmax(0,1fr)] items-center px-0">
        <div
          className="flex min-w-0 items-center gap-0 overflow-hidden pl-2"
          role="menubar"
          aria-label={t('notepad.menuBar')}
          data-testid="notepad-menubar"
        >
          <DropdownMenu.Root
            modal={false}
            open={isMenubarTopOpen(menuState, 'file')}
            onOpenChange={(open) => handleMenubarOpenChange('file', open)}
          >
            <MenuTrigger
              label={t('menu.file')}
              testId="notepad-menu-file"
              menubarTop="file"
              onPointerEnter={() => handleMenubarPointerEnter('file')}
            />
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                sideOffset={2}
                align="start"
                className={menubarContentClass}
                onCloseAutoFocus={(event) => event.preventDefault()}
                onEscapeKeyDown={() => dismissMenubar()}
                onPointerDownOutside={onMenubarPointerDownOutsideRadix}
              >
                <MenuItem shortcut="Ctrl+N" onSelect={props.onNew}>{t('notepad.newTab')}</MenuItem>
                <MenuItem shortcut="Ctrl+Shift+N" onSelect={props.onNewWindow}>{t('notepad.newWindow')}</MenuItem>
                <MenuItem onSelect={props.onNewMarkdown}>{t('notepad.newMarkdownTab')}</MenuItem>
                <MenuItem shortcut="Ctrl+O" onSelect={props.onOpen}>{t('notepad.open')}</MenuItem>
                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger className={itemClass}>
                    {t('notepad.recent')}
                    <ChevronRight className="ml-auto h-4 w-4" />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent sideOffset={4} className={contentClass}>
                      {props.recentFiles.length === 0
                        ? <DropdownMenu.Item className={itemClass} disabled>{t('recentFiles.noRecentFiles')}</DropdownMenu.Item>
                        : props.recentFiles.map((file) => (
                          <MenuItem key={file.path} onSelect={() => props.onOpenRecent(file.path)}>{file.name}</MenuItem>
                        ))}
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
                <DropdownMenu.Separator className="my-1 h-px bg-black/10 dark:bg-white/10" />
                <MenuItem shortcut="Ctrl+S" onSelect={props.onSave}>{t('agentConfig.save')}</MenuItem>
                <MenuItem shortcut="Ctrl+Shift+S" onSelect={props.onSaveAs}>{t('notepad.saveAs')}</MenuItem>
                <MenuItem shortcut="Ctrl+Alt+S" onSelect={props.onSaveAll}>{t('notepad.saveAll')}</MenuItem>
                <DropdownMenu.Separator className="my-1 h-px bg-black/10 dark:bg-white/10" />
                <MenuItem onSelect={props.onPageSetup}>{t('notepad.pageSetup')}</MenuItem>
                <MenuItem shortcut="Ctrl+P" onSelect={props.onPrint}>{t('notepad.print')}</MenuItem>
                <DropdownMenu.Separator className="my-1 h-px bg-black/10 dark:bg-white/10" />
                <MenuItem shortcut="Ctrl+W" onSelect={props.onClose}>{t('notepad.closeTab')}</MenuItem>
                <MenuItem shortcut="Alt+F4" onSelect={props.onCloseWindow}>{t('notepad.closeWindow')}</MenuItem>
                <MenuItem onSelect={props.onExit}>{t('menu.quit')}</MenuItem>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <DropdownMenu.Root
            modal={false}
            open={isMenubarTopOpen(menuState, 'edit')}
            onOpenChange={(open) => handleMenubarOpenChange('edit', open)}
          >
            <MenuTrigger
              label={t('menu.edit')}
              testId="notepad-menu-edit"
              menubarTop="edit"
              onPointerEnter={() => handleMenubarPointerEnter('edit')}
            />
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                sideOffset={2}
                align="start"
                className={menubarContentClass}
                onCloseAutoFocus={(event) => event.preventDefault()}
                onEscapeKeyDown={() => dismissMenubar()}
                onPointerDownOutside={onMenubarPointerDownOutsideRadix}
              >
                <MenuItem shortcut="Ctrl+Z" disabled={!props.canUndo} onSelect={props.onUndo}>{t('menu.undo')}</MenuItem>
                {props.canRedo && <MenuItem shortcut="Ctrl+Y" onSelect={props.onRedo}>{t('menu.redo')}</MenuItem>}
                <DropdownMenu.Separator className="my-1 h-px bg-black/10 dark:bg-white/10" />
                <MenuItem shortcut="Ctrl+X" disabled={!props.hasSelection} onSelect={props.onCut}>{t('menu.cut')}</MenuItem>
                <MenuItem shortcut="Ctrl+C" disabled={!props.hasSelection} onSelect={props.onCopy}>{t('menu.copy')}</MenuItem>
                <MenuItem shortcut="Ctrl+V" onSelect={props.onPaste}>{t('menu.paste')}</MenuItem>
                <MenuItem shortcut="Del" disabled={!props.hasSelection} onSelect={props.onDelete}>{t('notepad.delete')}</MenuItem>
                <MenuItem shortcut="Ctrl+Space" onSelect={props.onClearFormat}>{t('notepad.clearFormatting')}</MenuItem>
                <DropdownMenu.Separator className="my-1 h-px bg-black/10 dark:bg-white/10" />
                <MenuItem disabled={!props.hasSelection} onSelect={props.onSearchWeb}>{t('notepad.searchBing')}</MenuItem>
                <DropdownMenu.Separator className="my-1 h-px bg-black/10 dark:bg-white/10" />
                <MenuItem shortcut="Ctrl+F" onSelect={props.onFind}>{t('notepad.find')}</MenuItem>
                <MenuItem shortcut="F3" onSelect={props.onFindNext}>{t('notepad.findNext')}</MenuItem>
                <MenuItem shortcut="Shift+F3" onSelect={props.onFindPrevious}>{t('notepad.findPrevious')}</MenuItem>
                <MenuItem shortcut="Ctrl+H" onSelect={props.onReplace}>{t('notepad.replace')}</MenuItem>
                <MenuItem shortcut="Ctrl+G" onSelect={props.onGoTo}>{t('notepad.goTo')}</MenuItem>
                <DropdownMenu.Separator className="my-1 h-px bg-black/10 dark:bg-white/10" />
                <MenuItem shortcut="Ctrl+A" onSelect={props.onSelectAll}>{t('menu.selectAll')}</MenuItem>
                <MenuItem shortcut="F5" onSelect={props.onTimeDate}>{t('notepad.timeDate')}</MenuItem>
                <MenuItem onSelect={props.onFont}>{t('notepad.font')}</MenuItem>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <DropdownMenu.Root
            modal={false}
            open={isMenubarTopOpen(menuState, 'view')}
            onOpenChange={(open) => handleMenubarOpenChange('view', open)}
          >
            <MenuTrigger
              label={t('menu.view')}
              testId="notepad-menu-view"
              menubarTop="view"
              onPointerEnter={() => handleMenubarPointerEnter('view')}
            />
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                sideOffset={2}
                align="start"
                className={menubarContentClass}
                onCloseAutoFocus={(event) => event.preventDefault()}
                onEscapeKeyDown={() => dismissMenubar()}
                onPointerDownOutside={onMenubarPointerDownOutsideRadix}
              >
                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger className={itemClass}>
                    {t('notepad.zoom')}
                    <ChevronRight className="ml-auto h-4 w-4" />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent sideOffset={4} className={contentClass}>
                      <MenuItem shortcut="Ctrl++" onSelect={props.onZoomIn}>{t('menu.zoomIn')}</MenuItem>
                      <MenuItem shortcut="Ctrl+-" onSelect={props.onZoomOut}>{t('menu.zoomOut')}</MenuItem>
                      <MenuItem shortcut="Ctrl+0" onSelect={props.onZoomReset}>{t('notepad.resetZoom')}</MenuItem>
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
                <CheckItem checked={props.statusBar} onSelect={props.onToggleStatusBar}>{t('notepad.statusBar')}</CheckItem>
                <CheckItem checked={props.wordWrap} testId="notepad-word-wrap-menu-item" onSelect={props.onToggleWrap}>{t('notepad.wordWrap')}</CheckItem>
                <DropdownMenu.Sub>
                  <DropdownMenu.SubTrigger className={itemClass} disabled={props.markdownEnabled === false}>
                    {t('notepad.markdown')}
                    <ChevronRight className="ml-auto h-4 w-4" />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent sideOffset={4} className={contentClass}>
                      <CheckItem checked={props.markdownView === 'formatted'} onSelect={() => props.onMarkdownView('formatted')}>{t('notepad.formattedView')}</CheckItem>
                      <CheckItem checked={props.markdownView === 'syntax'} onSelect={() => props.onMarkdownView('syntax')}>{t('notepad.syntaxView')}</CheckItem>
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        <div className="flex shrink-0 items-center justify-self-center gap-0" role="toolbar" aria-label={t('notepad.textFormatting')}>
          {props.formattingEnabled && formattingTier >= 1 && <FormattingMenu onFormat={props.onFormat} />}
          {props.formattingEnabled && formattingTier >= 2 && <ToolbarButton label={t('notepad.bold')} shortcut="Ctrl+B" onClick={() => props.onFormat('bold')}><BoldGlyph /></ToolbarButton>}
          {props.formattingEnabled && formattingTier >= 3 && <ToolbarButton label={t('notepad.italic')} shortcut="Ctrl+I" onClick={() => props.onFormat('italic')}><Italic className="h-4 w-4" /></ToolbarButton>}
          {props.formattingEnabled && formattingTier >= 4 && <ToolbarButton label={t('notepad.strikethrough')} shortcut="Ctrl+Shift+X" onClick={() => props.onFormat('strikethrough')}><Strikethrough className="h-4 w-4" /></ToolbarButton>}
          {props.formattingEnabled && formattingTier >= 5 && <ToolbarButton label={t('notepad.link')} shortcut="Ctrl+K" onClick={() => props.onFormat('link')}><Link2 className="h-4 w-4" /></ToolbarButton>}
          {props.formattingEnabled && formattingTier >= 6 && <TableInsertMenu onInsertTable={props.onInsertTable} />}
          {props.formattingEnabled && formattingTier >= 6 && <ToolbarButton label={t('notepad.clearFormatting')} shortcut="Ctrl+Space" onClick={() => props.onFormat('clear-format')}><RemoveFormatting className="h-4 w-4" /></ToolbarButton>}
          {props.formattingEnabled && <OverflowFormattingMenu tier={formattingTier} onFormat={props.onFormat} onInsertTable={props.onInsertTable} />}
        </div>

        <div className="mr-2 flex shrink-0 items-center justify-end justify-self-end gap-0.5">
          <ToolbarButton label={t('notepad.settings')} testId="notepad-settings-button" onClick={props.onSettings}><Settings className="h-4 w-4" /></ToolbarButton>
        </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
