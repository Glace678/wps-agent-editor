import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Globe } from 'lucide-react'
import { languages, type LanguageCode } from '@/lib/i18n'
import { useTranslation } from '@/lib/i18n/runtime'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export function LanguageMenu() {
  const { language, setLanguage, t } = useTranslation()
  const direction = language === 'ar' ? 'rtl' : 'ltr'

  return (
    <TooltipProvider delayDuration={450}>
      <DropdownMenu.Root modal={false} dir={direction}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary transition-colors hover:bg-accent"
                aria-label={t('appShell.changeLanguage')}
                data-testid="language-menu-trigger"
              >
                <Globe className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </button>
            </DropdownMenu.Trigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="whitespace-nowrap rounded-[2px] border-0 bg-[#666] px-1.5 py-1.5 text-center text-[12px] leading-normal text-white shadow-none">
            {t('appShell.changeLanguage')}
          </TooltipContent>
        </Tooltip>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[10000] min-w-[218px] rounded-md border border-black/10 bg-card p-1.5 text-card-foreground shadow-xl dark:border-white/10"
          aria-label={t('appShell.languageMenu')}
          data-testid="language-menu"
        >
          <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('appShell.languageMenu')}
          </div>
          <DropdownMenu.RadioGroup
            value={language}
            onValueChange={(value) => setLanguage(value as LanguageCode)}
          >
            {languages.map((option) => (
              <DropdownMenu.RadioItem
                key={option.code}
                value={option.code}
                lang={option.code}
                dir={option.code === 'ar' ? 'rtl' : 'ltr'}
                className="relative flex min-h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                data-testid={`language-option-${option.code}`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  <DropdownMenu.ItemIndicator>
                    <Check className="h-3.5 w-3.5 text-primary" />
                  </DropdownMenu.ItemIndicator>
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{option.nativeName}</span>
                {option.nativeName !== option.name && (
                  <span className="truncate text-[11px] text-muted-foreground">{option.name}</span>
                )}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    </TooltipProvider>
  )
}
