import {
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Search,
  X,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { LegacyRef } from 'react'
import { dialogButtonClass, inputClass } from './dialog-styles'

export interface FindBarOptions {
  matchCase: boolean
  wrapAround: boolean
}

export function FindBar({
  inputRef,
  labels,
  query,
  replaceMode,
  replaceText,
  options,
  matchCount,
  activeMatch,
  onQueryChange,
  onReplaceTextChange,
  onToggleReplaceMode,
  onOptionsChange,
  onNavigate,
  onReplace,
  onReplaceAll,
  onClose,
}: {
  inputRef?: LegacyRef<HTMLInputElement>
  labels: {
    closeReplaceOptions: string
    openReplaceOptions: string
    find: string
    previous: string
    previousShortcut: string
    next: string
    nextShortcut: string
    moreOptions: string
    matchCase: string
    wrapAround: string
    closeFind: string
    replaceWith: string
    replace: string
    replaceAll: string
  }
  query: string
  replaceMode: boolean
  replaceText: string
  options: FindBarOptions
  matchCount: number
  activeMatch: number
  onQueryChange: (value: string) => void
  onReplaceTextChange: (value: string) => void
  onToggleReplaceMode: () => void
  onOptionsChange: (next: FindBarOptions) => void
  onNavigate: (direction: 1 | -1) => void
  onReplace: () => void
  onReplaceAll: () => void
  onClose: () => void
}) {
  const patchOptions = (patchValue: Partial<FindBarOptions>) =>
    onOptionsChange({ ...options, ...patchValue })

  return (
    <div className="flex shrink-0 items-start justify-end border-b border-black/[0.08] bg-[#f7f7f7] px-2 py-2 dark:border-white/[0.07] dark:bg-[#252525]">
      <div className="flex w-full max-w-[560px] flex-col gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] hover:bg-black/[0.06] dark:hover:bg-white/[0.07]"
            aria-label={replaceMode
              ? labels.closeReplaceOptions
              : labels.openReplaceOptions}
            onClick={onToggleReplaceMode}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${replaceMode ? 'rotate-180' : ''}`} />
          </button>
          <div className="relative min-w-[140px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-55" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  event.stopPropagation()
                  onNavigate(event.shiftKey ? -1 : 1)
                }
              }}
              className={`${inputClass} min-w-[140px] flex-1 pl-8`}
              placeholder={labels.find}
              aria-label={labels.find}
              data-testid="text-find-input"
            />
          </div>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] opacity-55">{matchCount ? `${Math.max(1, activeMatch + 1)}/${matchCount}` : '0/0'}</span>
          <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] hover:bg-black/[0.06] dark:hover:bg-white/[0.07]" aria-label={labels.previous} title={labels.previousShortcut} onClick={() => onNavigate(-1)}>
            <ChevronUp className="h-4 w-4" />
          </button>
          <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] hover:bg-black/[0.06] dark:hover:bg-white/[0.07]" aria-label={labels.next} title={labels.nextShortcut} onClick={() => onNavigate(1)}>
            <ChevronDown className="h-4 w-4" />
          </button>
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] hover:bg-black/[0.06] dark:hover:bg-white/[0.07]" aria-label={labels.moreOptions}>
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content sideOffset={4} align="end" className="z-[10000] min-w-[180px] rounded-md border border-black/10 bg-[#f9f9f9] p-1 text-[13px] shadow-xl dark:border-white/10 dark:bg-[#2c2c2c] dark:text-[#f5f5f5]">
                <DropdownMenu.CheckboxItem
                  className="flex h-8 cursor-default select-none items-center rounded-[4px] px-2 outline-none data-[highlighted]:bg-black/[0.07] dark:data-[highlighted]:bg-white/[0.08]"
                  checked={options.matchCase}
                  onCheckedChange={(checked) => patchOptions({ matchCase: Boolean(checked) })}
                >
                  {labels.matchCase}
                </DropdownMenu.CheckboxItem>
                <DropdownMenu.CheckboxItem
                  className="flex h-8 cursor-default select-none items-center rounded-[4px] px-2 outline-none data-[highlighted]:bg-black/[0.07] dark:data-[highlighted]:bg-white/[0.08]"
                  checked={options.wrapAround}
                  onCheckedChange={(checked) => patchOptions({ wrapAround: Boolean(checked) })}
                >
                  {labels.wrapAround}
                </DropdownMenu.CheckboxItem>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] hover:bg-black/[0.06] dark:hover:bg-white/[0.07]" aria-label={labels.closeFind} onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {replaceMode && (
          <div className="flex min-w-0 items-center gap-1.5">
            <input
              value={replaceText}
              onChange={(event) => onReplaceTextChange(event.target.value)}
              className={`${inputClass} min-w-[140px] flex-1`}
              placeholder={labels.replaceWith}
              aria-label={labels.replaceWith}
              data-testid="text-replace-input"
            />
            <button type="button" className={dialogButtonClass} onClick={onReplace}>
              {labels.replace}
            </button>
            <button type="button" className={dialogButtonClass} onClick={onReplaceAll}>
              {labels.replaceAll}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
