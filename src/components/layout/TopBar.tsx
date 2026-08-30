import { desktopApi } from '@/platform'
import { Sun, Moon } from 'lucide-react'
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
  const { t } = useTranslation()
  const showAppMenu = desktopApi.app.platform !== 'darwin'
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
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDark])

  return (
    <div className="flex h-10 items-center justify-between border-b bg-card px-3">
      <div className="flex min-w-0 items-center">
        {showAppMenu && <AppMenuBar />}
      </div>

      <div className="flex items-center gap-2">
        <LanguageMenu />
        <TooltipProvider delayDuration={450}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type='button'
                onClick={() => setThemePreference(isDark ? 'light' : 'dark')}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-secondary/60 hover:bg-accent hover:border-border transition-colors"
                aria-label={isDark ? t('appShell.switchLightTheme') : t('appShell.switchDarkTheme')}
                data-testid='theme-toggle'
              >
                {isDark ? (
                  <Sun className="h-3.5 w-3.5 text-amber-400" />
                ) : (
                  <Moon className="h-3.5 w-3.5 text-slate-700" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="whitespace-nowrap rounded-xl border bg-popover px-3.5 py-1.5 text-center text-[12px] font-medium text-popover-foreground shadow-md">
              {isDark ? t('appShell.switchLightTheme') : t('appShell.switchDarkTheme')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  )
}
