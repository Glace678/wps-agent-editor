import { Check, ChevronDown } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'

export type MarkdownViewMode = 'formatted' | 'syntax'

export function MarkdownViewModeSelect({
  view,
  formattedLabel,
  syntaxLabel,
  onChange,
}: {
  view: MarkdownViewMode
  formattedLabel: string
  syntaxLabel: string
  onChange: (next: MarkdownViewMode) => void
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex min-w-[70px] flex-[1_1_180px] cursor-default select-none items-center justify-center gap-1 border-l border-black/10 px-3 text-center outline-none hover:bg-black/[0.06] data-[state=open]:bg-black/[0.08] dark:border-white/[0.08] dark:hover:bg-white/[0.08] dark:data-[state=open]:bg-white/[0.12]"
          aria-label={view === 'formatted' ? formattedLabel : syntaxLabel}
          data-testid="notepad-status-view-mode"
        >
          <span className="truncate">
            {view === 'formatted' ? formattedLabel : syntaxLabel}
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content sideOffset={4} align="center" className="z-[10000] min-w-[160px] rounded-md border border-black/10 bg-[#f9f9f9] p-1 text-[13px] shadow-xl dark:border-white/10 dark:bg-[#2c2c2c] dark:text-[#f5f5f5]">
          <DropdownMenu.CheckboxItem
            className="relative flex h-8 cursor-default select-none items-center rounded-[4px] px-2 pl-8 outline-none data-[highlighted]:bg-black/[0.07] dark:data-[highlighted]:bg-white/[0.08]"
            checked={view === 'formatted'}
            onCheckedChange={() => {
              onChange('formatted')
            }}
          >
            <DropdownMenu.ItemIndicator className="absolute left-2">
              <Check className="h-4 w-4" />
            </DropdownMenu.ItemIndicator>
            {formattedLabel}
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.CheckboxItem
            className="relative flex h-8 cursor-default select-none items-center rounded-[4px] px-2 pl-8 outline-none data-[highlighted]:bg-black/[0.07] dark:data-[highlighted]:bg-white/[0.08]"
            checked={view === 'syntax'}
            onCheckedChange={() => onChange('syntax')}
          >
            <DropdownMenu.ItemIndicator className="absolute left-2">
              <Check className="h-4 w-4" />
            </DropdownMenu.ItemIndicator>
            {syntaxLabel}
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
