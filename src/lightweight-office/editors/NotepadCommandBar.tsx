import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  Bold,
  Check,
  ChevronDown,
  ChevronRight,
  Indent,
  Italic,
  Link,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MoreHorizontal,
  Outdent,
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

/** Top-level File/Edit/View content marker; switching menus intentionally has no animation. */
const menubarContentClass = `${contentClass} notepad-menubar-content`

/** Compact shell for short format pickers (heading / list styles). Keeps File/Edit/View on the wide menubar shell. */
const compactFormatContentClass =
  'z-[10000] min-w-[120px] max-w-[280px] w-max rounded-md border border-black/10 bg-[#f9f9f9] p-1 text-[13px] text-[#1f1f1f] shadow-xl dark:border-white/10 dark:bg-[#2c2c2c] dark:text-[#f5f5f5]'

const headingFormatContentClass =
  'z-[10000] min-w-[180px] max-w-[320px] w-max rounded-md border border-black/10 bg-[#f9f9f9] p-1 text-[#1f1f1f] shadow-xl dark:border-white/10 dark:bg-[#2c2c2c] dark:text-[#f5f5f5]'

/** Compact shell for insert-table picker (toolbar + overflow subcontent).
 * Tighter than the old fixed 144px shell. max-w must fit 5×20 + 4×4 grid (116px) + p-1.5 (12px) → ≥128px. */
const compactTableContentClass =
  'z-[10000] w-max min-w-0 max-w-[128px] rounded-md border border-black/10 bg-[#f9f9f9] p-1.5 text-[13px] text-[#1f1f1f] shadow-xl dark:border-white/10 dark:bg-[#2c2c2c] dark:text-[#f5f5f5]'

const horizontalFormatContentClass =
  'z-[10000] flex w-max min-w-0 items-center gap-0.5 rounded-lg border border-black/10 bg-[#f9f9f9] p-1 text-[13px] text-[#1f1f1f] shadow-xl dark:border-white/10 dark:bg-[#2c2c2c] dark:text-[#f5f5f5]'

const itemClass =
  'flex h-8 cursor-default select-none items-center gap-3 rounded-[4px] px-2 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-black/[0.07] dark:data-[highlighted]:bg-white/[0.08]'

const tooltipClass =
  'whitespace-nowrap rounded-xl border-0 bg-[#555] px-3.5 py-1.5 text-center text-[15px] font-medium leading-normal text-white shadow-md'

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

function HeadingMenuItem({
  children,
  className,
  onSelect,
}: {
  children: ReactNode
  className?: string
  onSelect: () => void
}) {
  return (
    <DropdownMenu.Item
      className={cn(
        'flex cursor-default select-none items-center whitespace-nowrap rounded-[4px] px-3.5 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-black/[0.07] dark:data-[highlighted]:bg-white/[0.08]',
        className,
      )}
      onSelect={onSelect}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
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

function OverflowIconButton({
  label,
  shortcut,
  testId,
  onSelect,
  children,
}: {
  label: string
  shortcut?: string
  testId?: string
  onSelect: () => void
  children: ReactNode
}) {
  const description = shortcut ? `${label} (${shortcut})` : label
  return (
    <CommandBarTooltip label={description}>
      <DropdownMenu.Item
        className="flex h-8 w-8 shrink-0 cursor-default select-none items-center justify-center rounded-[4px] outline-none hover:bg-black/[0.07] focus-visible:ring-2 focus-visible:ring-[#4f93e7] data-[highlighted]:bg-black/[0.07] dark:hover:bg-white/[0.08] dark:data-[highlighted]:bg-white/[0.08]"
        aria-label={description}
        data-testid={testId}
        onMouseDown={(event) => event.preventDefault()}
        onSelect={onSelect}
      >
        {children}
      </DropdownMenu.Item>
    </CommandBarTooltip>
  )
}

export function FormatSettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className || 'h-4 w-4'}
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Letter A */}
      <path d="M 4.5 3.25 L 1.75 12.5" />
      <path d="M 4.5 3.25 L 7.25 10" />
      <path d="M 2.9 8.75 H 6.1" />

      {/* Paint brush outline */}
      <path d="M 9.75 6 V 3.5 C 9.75 2.6 11.25 2.6 11.25 3.5 V 6 H 13 V 13.5 H 8 V 6 H 9.75 Z" />

      {/* Bristle diagonal line */}
      <path d="M 8 13.5 L 11.5 8.75" />
    </svg>
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
  align = 'start',
}: {
  label: string
  trigger: ReactNode
  children: ReactNode
  contentClassName?: string
  align?: 'start' | 'center' | 'end'
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <CommandBarTooltip label={label}>
        <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      </CommandBarTooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={4}
          align={align}
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
        contentClassName={headingFormatContentClass}
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
        <HeadingMenuItem className="min-h-[58px] py-2 text-[32px] font-semibold leading-[1.2] whitespace-nowrap" onSelect={() => onFormat('heading-1')}>{t('notepad.headingTitle')}</HeadingMenuItem>
        <HeadingMenuItem className="min-h-[58px] py-2 text-[26px] font-semibold leading-[1.25] whitespace-nowrap" onSelect={() => onFormat('heading-2')}>{t('notepad.headingSubtitle')}</HeadingMenuItem>
        <HeadingMenuItem className="min-h-[56px] py-2 text-[22px] font-semibold leading-[1.3] whitespace-nowrap" onSelect={() => onFormat('heading-3')}>{t('notepad.headingHeading')}</HeadingMenuItem>
        <HeadingMenuItem className="min-h-[54px] py-2 text-[19px] font-semibold leading-[1.3] whitespace-nowrap" onSelect={() => onFormat('heading-4')}>{t('notepad.headingSubheading')}</HeadingMenuItem>
        <HeadingMenuItem className="min-h-[52px] py-2 text-[16.5px] font-normal leading-[1.3] whitespace-nowrap" onSelect={() => onFormat('heading-5')}>{t('notepad.headingSection')}</HeadingMenuItem>
        <HeadingMenuItem className="min-h-[50px] py-2 text-[15px] font-normal leading-[1.3] whitespace-nowrap" onSelect={() => onFormat('heading-6')}>{t('notepad.headingSubsection')}</HeadingMenuItem>
        <HeadingMenuItem className="min-h-[40px] py-2 text-[14px] font-normal leading-[1.3] whitespace-nowrap" onSelect={() => onFormat('paragraph')}>{t('notepad.bodyText')}</HeadingMenuItem>
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
        <DropdownMenu.Separator className="my-1 h-px bg-black/10 dark:bg-white/10" />
        <MenuItem className="gap-2 px-2 whitespace-nowrap" onSelect={() => onFormat('increase-indent')}><span className="flex items-center gap-2 whitespace-nowrap"><Indent className="h-4 w-4 shrink-0" />{t('notepad.increaseIndent')}</span></MenuItem>
        <MenuItem className="gap-2 px-2 whitespace-nowrap" onSelect={() => onFormat('decrease-indent')}><span className="flex items-center gap-2 whitespace-nowrap"><Outdent className="h-4 w-4 shrink-0" />{t('notepad.decreaseIndent')}</span></MenuItem>
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
 * At tier 0 (narrowest bar) it is hidden in favor of the single format-brush icon.
 * At tiers 1..5 it shows remaining overflow formatting actions.
 * At tier >= 6 all actions fit in the main bar, so it is hidden.
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
  if (tier < 1 || tier >= 6) return null
  return (
    <FormattingDropdown
      label={t('notepad.moreOptions')}
      contentClassName={horizontalFormatContentClass}
      align="center"
      trigger={(
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] outline-none hover:bg-black/[0.07] data-[state=open]:bg-[#e5e5e5] dark:hover:bg-white/[0.08] dark:data-[state=open]:bg-[#3b3b3b]"
          aria-label={t('notepad.moreOptions')}
          data-testid="notepad-format-overflow"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}
    >
      {tier < 2 && (
        <OverflowIconButton label={t('notepad.bold')} shortcut="Ctrl+B" onSelect={() => onFormat('bold')}>
          <BoldGlyph />
        </OverflowIconButton>
      )}
      {tier < 3 && (
        <OverflowIconButton label={t('notepad.italic')} shortcut="Ctrl+I" onSelect={() => onFormat('italic')}>
          <Italic className="h-4 w-4" />
        </OverflowIconButton>
      )}
      {tier < 4 && (
        <OverflowIconButton label={t('notepad.strikethrough')} shortcut="Ctrl+Shift+X" onSelect={() => onFormat('strikethrough')}>
          <Strikethrough className="h-4 w-4" />
        </OverflowIconButton>
      )}
      {tier < 5 && (
        <OverflowIconButton label={t('notepad.link')} shortcut="Ctrl+K" onSelect={() => onFormat('link')}>
          <Link2 className="h-4 w-4" />
        </OverflowIconButton>
      )}
      <DropdownMenu.Sub>
        <CommandBarTooltip label={t('notepad.insertTable')}>
          <DropdownMenu.SubTrigger
            className="flex h-8 w-11 shrink-0 cursor-default select-none items-center justify-center gap-1 rounded-[4px] outline-none hover:bg-black/[0.07] data-[highlighted]:bg-black/[0.07] data-[state=open]:bg-black/[0.09] dark:hover:bg-white/[0.08] dark:data-[highlighted]:bg-white/[0.08] dark:data-[state=open]:bg-white/[0.11]"
            aria-label={t('notepad.insertTable')}
            onMouseDown={(event) => event.preventDefault()}
          >
            <Table2 className="h-4 w-4" />
            <ChevronDown className="h-3 w-3 opacity-60" />
          </DropdownMenu.SubTrigger>
        </CommandBarTooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.SubContent sideOffset={4} className={compactTableContentClass}>
            <TableInsertPicker onInsertTable={onInsertTable} />
          </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Sub>
      <OverflowIconButton label={t('notepad.clearFormatting')} shortcut="Ctrl+Space" onSelect={() => onFormat('clear-format')}>
        <RemoveFormatting className="h-4 w-4" />
      </OverflowIconButton>
    </FormattingDropdown>
  )
}

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
  const openMenuRef = useRef<MenubarTop | null>(null)
  const menubarCloseTimerRef = useRef<number | null>(null)
  const [formatPanelOpen, setFormatPanelOpen] = useState(false)

  useEffect(() => {
    if (formattingTier > 0) setFormatPanelOpen(false)
  }, [formattingTier])

  const clearMenubarCloseTimer = () => {
    if (menubarCloseTimerRef.current === null) return
    window.clearTimeout(menubarCloseTimerRef.current)
    menubarCloseTimerRef.current = null
  }

  const setMenubar = (top: MenubarTop | null) => {
    clearMenubarCloseTimer()
    openMenuRef.current = top
    setMenuState(top === null ? menubarDismiss() : { open: top, active: true })
  }

  useEffect(() => () => clearMenubarCloseTimer(), [])

  const handleMenubarOpenChange = (top: MenubarTop, open: boolean) => {
    if (open) return setMenubar(top)
    clearMenubarCloseTimer()
    // A prior root closes as the pointer enters its sibling. Let the sibling win.
    menubarCloseTimerRef.current = window.setTimeout(() => {
      menubarCloseTimerRef.current = null
      if (openMenuRef.current === top) setMenubar(null)
    }, 0)
  }

  const handleMenubarPointerEnter = (top: MenubarTop) => {
    if (openMenuRef.current !== null && openMenuRef.current !== top) setMenubar(top)
  }

  /** True full dismiss (item click / outside / Escape) — ends hot-track. */
  const dismissMenubar = () => {
    clearMenubarCloseTimer()
    openMenuRef.current = null
    setMenuState(menubarDismiss())
  }

  const onMenubarPointerDownOutside = (event: { target: EventTarget; preventDefault: () => void }) => {
    const el = event.target instanceof Element ? event.target : null
    const overTop = el?.closest?.('[data-menubar-top]')?.getAttribute('data-menubar-top')
    if (isMenubarTop(overTop)) {
      // Moving onto another File/Edit/View label — do not dismiss hot-track.
      event.preventDefault()
      openMenuRef.current = overTop
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
                data-testid="notepad-menu-content-file"
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
                data-testid="notepad-menu-content-edit"
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
                data-testid="notepad-menu-content-view"
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
          {props.formattingEnabled && formattingTier === 0 && (
            <ToolbarButton
              label={t('notepad.formatSettings')}
              pressed={formatPanelOpen}
              testId="notepad-format-brush-button"
              onClick={() => setFormatPanelOpen((value) => !value)}
            >
              <FormatSettingsIcon className="h-4 w-4" />
            </ToolbarButton>
          )}
          {props.formattingEnabled && formattingTier >= 1 && <OverflowFormattingMenu tier={formattingTier} onFormat={props.onFormat} onInsertTable={props.onInsertTable} />}
        </div>

        <div className="mr-2 flex shrink-0 items-center justify-end justify-self-end gap-0.5">
          <ToolbarButton label={t('notepad.settings')} testId="notepad-settings-button" onClick={props.onSettings}><Settings className="h-4 w-4" /></ToolbarButton>
        </div>
        </div>
      </div>

      {props.formattingEnabled && formatPanelOpen && formattingTier === 0 && (
        <div
          dir="ltr"
          className="flex shrink-0 flex-wrap items-center gap-0 border-b border-black/[0.08] bg-[#f7f7f7] px-1 py-1 dark:border-white/[0.07] dark:bg-[#252525]"
          role="toolbar"
          aria-label={t('notepad.textFormatting')}
          data-testid="notepad-format-paint-panel"
        >
          <FormattingMenu onFormat={props.onFormat} />
          <ToolbarButton label={t('notepad.bold')} shortcut="Ctrl+B" onClick={() => props.onFormat('bold')}><BoldGlyph /></ToolbarButton>
          <ToolbarButton label={t('notepad.italic')} shortcut="Ctrl+I" onClick={() => props.onFormat('italic')}><Italic className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton label={t('notepad.strikethrough')} shortcut="Ctrl+Shift+X" onClick={() => props.onFormat('strikethrough')}><Strikethrough className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton label={t('notepad.link')} shortcut="Ctrl+K" onClick={() => props.onFormat('link')}><Link2 className="h-4 w-4" /></ToolbarButton>
          <TableInsertMenu onInsertTable={props.onInsertTable} />
          <ToolbarButton label={t('notepad.clearFormatting')} shortcut="Ctrl+Space" onClick={() => props.onFormat('clear-format')}><RemoveFormatting className="h-4 w-4" /></ToolbarButton>
        </div>
      )}
    </TooltipProvider>
  )
}
