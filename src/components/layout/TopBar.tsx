import { FileText, Bot, Sun, Moon } from 'lucide-react'
import { useEditorStore } from '@/stores/editor.store'
import { useAgentStore } from '@/stores/agent.store'
import { useState, useEffect } from 'react'
import { useTranslation } from '@/lib/i18n/runtime'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { LanguageMenu } from './LanguageMenu'
import { AppMenuBar } from './AppMenuBar'
import {
  APP_THEME_EVENT,
  getThemePreference,
  resolveDarkTheme,
  setThemePreference,
  type ThemePreference,
} from '@/lib/theme'

export function TopBar() {
  const { fileName } = useEditorStore()
  const { agents, activeAgentId } = useAgentStore()
  const activeAgent = agents.find((a) => a.id === activeAgentId)
  const { t } = useTranslation()
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference)
  const [isDark, setIsDark] = useState(() => resolveDarkTheme(theme))

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => setIsDark(resolveDarkTheme(theme))
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      setTheme((event as CustomEvent<ThemePreference>).detail)
    }
    window.addEventListener(APP_THEME_EVENT, handleThemeChange)
    return () => window.removeEventListener(APP_THEME_EVENT, handleThemeChange)
  }, [])

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
      document.body.classList.remove('bg-white')
      document.body.classList.add('bg-black')
    } else {
      document.documentElement.classList.remove('dark')
      document.body.classList.remove('bg-black')
      document.body.classList.add('bg-white')
    }
  }, [isDark])

  return (
    <div className="flex h-10 items-center justify-between border-b bg-card px-3">
      <div className="flex min-w-0 items-center gap-3">
        <AppMenuBar />
        <div className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
        <FileText className="h-5 w-5 text-muted-foreground" />
        <span className="truncate text-sm font-medium">
          {fileName || t('appShell.noFile')}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {activeAgent && (
          <div className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1">
            <Bot className="h-3.5 w-3.5" style={{ color: activeAgent.color }} />
            <span className="text-xs font-medium">{activeAgent.name}</span>
          </div>
        )}
        <LanguageMenu />
        <TooltipProvider delayDuration={450}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type='button'
                onClick={() => setThemePreference(isDark ? 'light' : 'dark')}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary hover:bg-accent transition-colors"
                aria-label={isDark ? t('appShell.switchLightTheme') : t('appShell.switchDarkTheme')}
                data-testid='theme-toggle'
              >
                {isDark ? (
                  <Sun className="h-4 w-4 text-yellow-500" />
                ) : (
                  <Moon className="h-4 w-4 text-blue-600" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="whitespace-nowrap rounded-[2px] border-0 bg-[#666] px-1.5 py-1.5 text-center text-[12px] leading-normal text-white shadow-none">
              {isDark ? t('appShell.switchLightTheme') : t('appShell.switchDarkTheme')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  )
}
