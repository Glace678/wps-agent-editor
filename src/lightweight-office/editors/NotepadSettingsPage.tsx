import { useEffect, useState, type ComponentType, type ReactNode, type RefObject } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from '@/lib/i18n/runtime'
import type { ThemePreference } from '@/lib/theme'
import type { SystemFontFace } from '../utils/system-fonts'

export function FluentPaletteIcon({ className = 'notepad-settings-card-icon' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M10 2a8 8 0 0 1 3.388 15.249a3.77 3.77 0 0 1-3.291-.059c-.974-.503-1.696-1.467-1.648-2.731c.017-.445.082-.867.143-1.243c.063-.387.118-.712.136-1.015c.018-.297-.004-.533-.078-.732c-.07-.191-.2-.381-.45-.569c-.313-.235-.58-.275-.845-.237c-.3.043-.614.188-1.014.387c-.735.365-1.776.942-2.974.332c-1.102-.562-1.424-1.868-1.22-2.917A8 8 0 0 1 10 2m0 1a7 7 0 0 0-6.871 5.655c-.153.788.126 1.547.691 1.835c.684.348 1.251.074 2.076-.336c.38-.188.834-.412 1.318-.481c.52-.075 1.054.028 1.586.427c.39.292.645.634.788 1.021c.14.379.162.768.14 1.14c-.022.366-.09.753-.149 1.116a9 9 0 0 0-.13 1.12c-.032.812.418 1.448 1.108 1.805a2.77 2.77 0 0 0 2.407.042A7.002 7.002 0 0 0 10 3m2.5 10a1 1 0 1 1 0 2a1 1 0 0 1 0-2m2-2.5a1 1 0 1 1 0 2a1 1 0 0 1 0-2m0-3a1 1 0 1 1 0 2a1 1 0 0 1 0-2m-2-2.5a1 1 0 1 1 0 2a1 1 0 0 1 0-2m-3-.5a1 1 0 1 1 0 2a1 1 0 0 1 0-2" />
    </svg>
  )
}

export function FluentFontIcon({ className = 'notepad-settings-card-icon' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.5 3.5a.5.5 0 0 1 .5.5v4.891C13.53 8.337 14.232 8 15 8c1.657 0 3 1.567 3 3.5S16.657 15 15 15c-.768 0-1.47-.337-2-.891v.391a.5.5 0 0 1-1 0V4a.5.5 0 0 1 .5-.5M15 14c.966 0 2-.97 2-2.5S15.966 9 15 9s-2 .97-2 2.5s1.034 2.5 2 2.5M6.957 3.836a.5.5 0 0 0-.94-.013L3.293 11h-.02v.054l-1.24 3.269a.5.5 0 0 0 .935.354L3.984 12h4.754l.926 2.664a.5.5 0 1 0 .945-.328zM4.363 11l2.1-5.537L8.39 11z" />
    </svg>
  )
}

export function FluentTextWrapIcon({ className = 'notepad-settings-card-icon' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M2 4.5a.5.5 0 0 1 .5-.5h15a.5.5 0 0 1 0 1h-15a.5.5 0 0 1-.5-.5m0 5a.5.5 0 0 1 .5-.5H16a3 3 0 1 1 0 6h-4.293l.647.646a.5.5 0 0 1-.708.708l-1.5-1.5a.5.5 0 0 1 0-.708l1.5-1.5a.5.5 0 0 1 .708.708l-.647.646H16a2 2 0 1 0 0-4H2.5a.5.5 0 0 1-.5-.5m0 5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5" />
    </svg>
  )
}

export function FluentWandIcon({ className = 'notepad-settings-card-icon' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M16.5 2a.5.5 0 0 1 .5.5V3h.5a.5.5 0 0 1 0 1H17v.5a.5.5 0 0 1-1 0V4h-.5a.5.5 0 1 1 0-1h.5v-.5a.5.5 0 0 1 .5-.5m-10 4a.5.5 0 0 0 0-1H6v-.5a.5.5 0 0 0-1 0V5h-.5a.5.5 0 0 0 0 1H5v.5a.5.5 0 0 0 1 0V6zm9 9a.5.5 0 0 0 0-1H15v-.5a.5.5 0 0 0-1 0v.5h-.5a.5.5 0 1 0 0 1h.5v.5a.5.5 0 1 0 1 0V15zm-2.066-8.434a1.914 1.914 0 0 0-2.707 0l-8.166 8.166a1.914 1.914 0 1 0 2.707 2.707l8.166-8.166a1.914 1.914 0 0 0 0-2.707m-2 .707a.914.914 0 0 1 1.293 1.293l-.477.477l-1.293-1.293zM10.25 8.457l1.293 1.293l-6.982 6.982a.914.914 0 0 1-1.293-1.292z" />
    </svg>
  )
}

export function FluentOpenFileIcon({ className = 'notepad-settings-card-icon' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M6 4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2.5a.5.5 0 0 1 1 0V14a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h2.5a.5.5 0 0 1 0 1zm5-.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0V4.707l-4.146 4.147a.5.5 0 0 1-.708-.708L15.293 4H11.5a.5.5 0 0 1-.5-.5" />
    </svg>
  )
}

export function FluentTabDesktopIcon({ className = 'notepad-settings-card-icon' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M2.997 5.5a2.5 2.5 0 0 1 2.5-2.5h9a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5h-9a2.5 2.5 0 0 1-2.5-2.5zm13 .5v-.5a1.5 1.5 0 0 0-1.5-1.5h-5.5v1.5a.5.5 0 0 0 .5.5zm-8-2h-2.5a1.5 1.5 0 0 0-1.5 1.5v9a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V7h-6.5a1.5 1.5 0 0 1-1.5-1.5z" />
    </svg>
  )
}

export function FluentClockIcon({ className = 'notepad-settings-card-icon' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M10 2a8 8 0 1 1 0 16a8 8 0 0 1 0-16m0 1a7 7 0 1 0 0 14a7 7 0 0 0 0-14m-.5 2a.5.5 0 0 1 .492.41L10 5.5V10h2.5a.5.5 0 0 1 .09.992L12.5 11h-3a.5.5 0 0 1-.492-.41L9 10.5v-5a.5.5 0 0 1 .5-.5" />
    </svg>
  )
}

export function FluentSpellCheckIcon({ className = 'notepad-settings-card-icon' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M4.943 3a.5.5 0 0 1 .464.333l1.774 5a.5.5 0 0 1-.942.334L5.98 7.94V8H3.73l-.264.68a.5.5 0 1 1-.932-.36l1.935-5A.5.5 0 0 1 4.943 3m-.028 1.938L4.117 7h1.53zm12.493-.409c-.246-.686-.604-1.106-1.053-1.328C15.945 3 15.522 3 15.246 3h-.027c-.554 0-.994.19-1.327.487c-.322.288-.521.656-.646.99a4 4 0 0 0-.245 1.288v.026L13 5.799v.026c0 .383 0 1.085.25 1.724c.13.335.334.67.656.936c.325.268.742.445 1.257.503c.417.046 1.663.013 2.23-1.246a.5.5 0 1 0-.911-.41c-.293.648-.93.693-1.208.662c-.344-.039-.571-.149-.73-.28a1.26 1.26 0 0 1-.363-.529c-.176-.45-.181-.981-.181-1.382V5.79l.003-.059a3.3 3.3 0 0 1 .18-.905c.09-.241.214-.45.375-.593c.15-.135.355-.233.66-.233c.304 0 .51.008.694.098c.158.078.371.257.555.769a.5.5 0 1 0 .941-.338m-5.935 1.307c.196-.267.32-.622.32-1.077q-.001-.564-.218-.96a1.44 1.44 0 0 0-.564-.57C10.605 3 10.165 3 10.003 3H8.5a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .5.5h1.75c.218 0 .662-.035 1.07-.271c.446-.26.798-.736.798-1.488q-.002-.575-.246-.977a1.45 1.45 0 0 0-.399-.428M10.521 4.1c.07.039.13.093.176.178c.049.089.096.236.096.48c0 .398-.15.544-.275.62a1 1 0 0 1-.495.122H9V4h1c.158 0 .361.01.52.1M9.364 6.5h.822c.187 0 .433.007.628.103c.087.043.154.1.204.18c.05.083.1.221.1.458c0 .384-.152.537-.301.623A1.2 1.2 0 0 1 10.25 8H9V6.5zm4.387 4.317a.5.5 0 1 0-.774-.634l-3.741 4.573l-1.882-1.882a.5.5 0 0 0-.708.707l2.273 2.273a.5.5 0 0 0 .74-.037z" />
    </svg>
  )
}

export function FluentAutoCorrectIcon({ className = 'notepad-settings-card-icon' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.18 2.926a2.975 2.975 0 0 0-4.26-.054l-9.375 9.375a2.44 2.44 0 0 0-.655 1.194l-.878 3.95a.5.5 0 0 0 .597.597l3.926-.873a2.5 2.5 0 0 0 1.234-.678l7.98-7.98l.337.336a1 1 0 0 1 0 1.414l-.94.94a.5.5 0 0 0 .708.706l.939-.94a2 2 0 0 0 0-2.828l-.336-.336l.67-.67a2.975 2.975 0 0 0 .052-4.153m-3.553.653a1.975 1.975 0 0 1 2.793 2.793L7.062 15.73a1.5 1.5 0 0 1-.744.409l-3.16.702l.708-3.183a1.43 1.43 0 0 1 .387-.704z" />
    </svg>
  )
}

type SpellCheckFormat = 'txt' | 'markdown' | 'subtitles' | 'lrc' | 'lic'

interface NotepadSettingsPageProps {
  open: boolean
  initialSection?: 'theme' | 'font' | 'startup' | 'spelling'
  pageRef: RefObject<HTMLElement>
  onClose: () => void
  themePreference: ThemePreference
  onThemePreferenceChange: (value: ThemePreference) => void
  fontFamily: string
  fontFamilies: string[]
  systemFontFaces: SystemFontFace[]
  selectedFontFaces: SystemFontFace[]
  fontFaceName: string
  fontWeight: number
  fontStyle: SystemFontFace['style']
  fontStretch: number
  fontSize: number
  fontSizeInput: string
  onFontFamilyChange: (value: string) => void
  onFontFaceChange: (value: string) => void
  onFontSizeChange: (value: string) => void
  wordWrap: boolean
  formattingEnabled: boolean
  onWordWrapChange: () => void
  onFormattingChange: () => void
  openFileBehavior: 'tab' | 'window'
  onOpenFileBehaviorChange: (value: 'tab' | 'window') => void
  startupBehavior: 'restore' | 'new'
  onStartupBehaviorChange: (value: 'restore' | 'new') => void
  recentFilesEnabled: boolean
  onRecentFilesChange: () => void
  spellCheck: boolean
  onSpellCheckChange: () => void
  spellCheckFormats: Record<SpellCheckFormat, boolean>
  onSpellCheckFormatChange: (format: SpellCheckFormat) => void
  autoCorrect: boolean
  onAutoCorrectChange: () => void
}

const spellCheckFormats: Array<{ key: SpellCheckFormat; label: string }> = [
  { key: 'txt', label: '.txt' },
  { key: 'markdown', label: '.md' },
  { key: 'subtitles', label: '.srt / .ass' },
  { key: 'lrc', label: '.lrc' },
  { key: 'lic', label: '.lic' },
]

function fontFaceValue(face: Pick<SystemFontFace, 'faceName' | 'weight' | 'style' | 'stretch'>): string {
  return `${face.weight}|${face.style}|${face.stretch}|${encodeURIComponent(face.faceName)}`
}

function fontStretchValue(stretch: number): string {
  return [
    'normal',
    'ultra-condensed',
    'extra-condensed',
    'condensed',
    'semi-condensed',
    'normal',
    'semi-expanded',
    'expanded',
    'extra-expanded',
    'ultra-expanded',
  ][stretch] || 'normal'
}

function SelectField({
  id,
  value,
  onChange,
  children,
  className = '',
}: {
  id: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
  className?: string
}) {
  return (
    <span className={`notepad-settings-select-wrap ${className}`}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="notepad-settings-select"
      >
        {children}
      </select>
      <ChevronDown className="notepad-settings-select-chevron" aria-hidden="true" />
    </span>
  )
}

function SettingToggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: () => void
}) {
  const { language } = useTranslation()
  const onLabel = language === 'zh-CN' ? '\u5f00' : 'On'
  const offLabel = language === 'zh-CN' ? '\u5173' : 'Off'
  return (
    <span className="notepad-settings-toggle-wrap">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`notepad-settings-toggle ${checked ? 'is-checked' : ''}`}
        onClick={onChange}
      >
        <span className="notepad-settings-toggle-thumb" />
      </button>
      <span className="notepad-settings-toggle-state" aria-hidden="true">{checked ? onLabel : offLabel}</span>
    </span>
  )
}

function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="notepad-settings-card">{children}</div>
}

function SettingsExpander({
  id,
  title,
  description,
  icon: Icon,
  expanded,
  onToggle,
  trailing,
  children,
}: {
  id: string
  title: string
  description?: string
  icon: LucideIcon | ComponentType<{ className?: string }>
  expanded: boolean
  onToggle: () => void
  trailing?: ReactNode
  children: ReactNode
}) {
  const { language } = useTranslation()
  const actionLabel = expanded
    ? (language === 'zh-CN' ? '\u6536\u8d77' : 'Collapse')
    : (language === 'zh-CN' ? '\u5c55\u5f00' : 'Expand')
  return (
    <SettingsCard>
      <div className="notepad-settings-card-header">
        <button
          type="button"
          className="notepad-settings-card-trigger"
          aria-controls={id}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <Icon className="notepad-settings-card-icon" aria-hidden="true" />
          <span className="min-w-0 text-left">
            <span className="block text-[13px] leading-snug">{title}</span>
            {description && <span className="mt-0.5 block text-[11.5px] leading-tight opacity-65">{description}</span>}
          </span>
        </button>
        {trailing}
        <button
          type="button"
          className={`notepad-settings-chevron ${expanded ? 'is-expanded' : ''}`}
          aria-label={`${title} - ${actionLabel}`}
          aria-controls={id}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div id={id} className={`notepad-settings-card-panel ${expanded ? 'is-open' : ''}`} aria-hidden={!expanded}>
        <div className="notepad-settings-card-panel-inner">{children}</div>
      </div>
    </SettingsCard>
  )
}

function SettingsRow({
  icon: Icon,
  title,
  description,
  trailing,
  className = '',
}: {
  icon: LucideIcon | ComponentType<{ className?: string }>
  title: string
  description?: string
  trailing: ReactNode
  className?: string
}) {
  return (
    <SettingsCard>
      <div className={`notepad-settings-row ${className}`}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Icon className="notepad-settings-card-icon" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[13px] leading-snug">{title}</p>
            {description && <p className="mt-0.5 text-[11.5px] leading-tight opacity-65">{description}</p>}
          </div>
        </div>
        {trailing}
      </div>
    </SettingsCard>
  )
}

function RadioOption({
  name,
  value,
  checked,
  label,
  onChange,
}: {
  name: string
  value: string
  checked: boolean
  label: string
  onChange: () => void
}) {
  return (
    <label className="notepad-settings-radio-row">
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="notepad-settings-radio" />
      <span>{label}</span>
    </label>
  )
}

export function NotepadSettingsPage({
  open,
  initialSection,
  pageRef,
  onClose,
  themePreference,
  onThemePreferenceChange,
  fontFamily,
  fontFamilies,
  systemFontFaces,
  selectedFontFaces,
  fontFaceName,
  fontWeight,
  fontStyle,
  fontStretch,
  fontSize,
  fontSizeInput,
  onFontFamilyChange,
  onFontFaceChange,
  onFontSizeChange,
  wordWrap,
  formattingEnabled,
  onWordWrapChange,
  onFormattingChange,
  openFileBehavior,
  onOpenFileBehaviorChange,
  startupBehavior,
  onStartupBehaviorChange,
  recentFilesEnabled,
  onRecentFilesChange,
  spellCheck,
  onSpellCheckChange,
  spellCheckFormats: selectedSpellCheckFormats,
  onSpellCheckFormatChange,
  autoCorrect,
  onAutoCorrectChange,
}: NotepadSettingsPageProps) {
  const { language, t } = useTranslation()
  const [expanded, setExpanded] = useState({
    theme: initialSection === 'theme',
    font: initialSection === 'font',
    startup: initialSection === 'startup',
    spelling: initialSection === 'spelling',
  })

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      pageRef.current?.focus({ preventScroll: true })
      if (initialSection === 'font') {
        const fontPanel = document.getElementById('notepad-settings-font-panel')
        fontPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    })
  }, [initialSection, open, pageRef])

  useEffect(() => {
    if (!open) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      const page = pageRef.current
      const target = event.target
      if (event.button !== 0 || !page || !(target instanceof Node) || page.contains(target)) return

      event.preventDefault()
      event.stopPropagation()
      onClose()
    }

    document.addEventListener('click', closeOnOutsideClick, true)
    return () => document.removeEventListener('click', closeOnOutsideClick, true)
  }, [onClose, open, pageRef])

  const toggle = (key: keyof typeof expanded) => {
    setExpanded((value) => ({ ...value, [key]: !value[key] }))
  }

  const selectedFontValue = fontFaceValue({
    faceName: fontFaceName,
    weight: fontWeight,
    style: fontStyle,
    stretch: fontStretch,
  })
  const fontSizeOptions = Array.from({ length: 65 }, (_, index) => index + 8)
  if (fontSizeInput && !fontSizeOptions.includes(Number(fontSizeInput))) {
    fontSizeOptions.push(Number(fontSizeInput))
    fontSizeOptions.sort((a, b) => a - b)
  }

  return (
    <div className="notepad-settings-overlay" data-testid="notepad-settings-overlay">
      <section
        ref={pageRef}
        className="notepad-settings-page"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={t('notepad.notepadSettings')}
        data-testid="notepad-settings-page"
      >
        <header className="notepad-settings-topbar">
          <button type="button" className="notepad-settings-back" onClick={onClose} aria-label={language === 'zh-CN' ? '\u8fd4\u56de' : 'Back'}>
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <Settings className="notepad-settings-app-icon" aria-hidden="true" />
          <span className="notepad-settings-app-name">{t('notepad.settings')}</span>
        </header>

        <div className="notepad-settings-scroll">
          <div className="notepad-settings-content">
            <div className="notepad-settings-column">
            <section aria-labelledby="notepad-settings-appearance">
              <h2 id="notepad-settings-appearance" className="notepad-settings-section-title">{t('notepad.appearance')}</h2>
              <SettingsExpander
                id="notepad-settings-theme-panel"
                title={t('notepad.appTheme')}
                description={t('notepad.appThemeDescription')}
                icon={FluentPaletteIcon}
                expanded={expanded.theme}
                onToggle={() => toggle('theme')}
              >
                <div className="notepad-settings-radio-list">
                  <RadioOption name="notepad-theme" value="light" checked={themePreference === 'light'} label={t('notepad.lightTheme')} onChange={() => onThemePreferenceChange('light')} />
                  <RadioOption name="notepad-theme" value="dark" checked={themePreference === 'dark'} label={t('notepad.darkTheme')} onChange={() => onThemePreferenceChange('dark')} />
                  <RadioOption name="notepad-theme" value="system" checked={themePreference === 'system'} label={t('notepad.useSystemSettings')} onChange={() => onThemePreferenceChange('system')} />
                </div>
              </SettingsExpander>
            </section>

            <section aria-labelledby="notepad-settings-text-format" className="notepad-settings-section">
              <h2 id="notepad-settings-text-format" className="notepad-settings-section-title">{t('notepad.textFormatting')}</h2>
              <SettingsExpander
                id="notepad-settings-font-panel"
                title={t('notepad.font')}
                icon={FluentFontIcon}
                expanded={expanded.font}
                onToggle={() => toggle('font')}
              >
                <div className="notepad-settings-font-controls">
                  <div className="notepad-settings-font-row">
                    <label htmlFor="notepad-font-family">{t('notepad.fontFamily')}</label>
                    <SelectField id="notepad-font-family" value={fontFamily} onChange={onFontFamilyChange}>
                      {!fontFamilies.includes(fontFamily) && <option value={fontFamily}>{fontFamily}</option>}
                      {fontFamilies.map((family) => (
                        <option key={family} value={family}>
                          {systemFontFaces.find((face) => face.familyName === family)?.displayName || family}
                        </option>
                      ))}
                    </SelectField>
                  </div>
                  <div className="notepad-settings-font-row">
                    <label htmlFor="notepad-font-style">{t('notepad.style')}</label>
                    <SelectField id="notepad-font-style" value={selectedFontValue} onChange={onFontFaceChange}>
                      {selectedFontFaces.map((face) => (
                        <option key={fontFaceValue(face)} value={fontFaceValue(face)}>{face.faceName}</option>
                      ))}
                    </SelectField>
                  </div>
                  <div className="notepad-settings-font-row">
                    <label htmlFor="notepad-font-size">{t('notepad.size')}</label>
                    <SelectField id="notepad-font-size" value={fontSizeInput} onChange={onFontSizeChange}>
                      {fontSizeOptions.map((size) => <option key={size} value={String(size)}>{size}</option>)}
                    </SelectField>
                  </div>
                  <p
                    data-testid="notepad-font-preview"
                    dir={language === 'ar' ? 'rtl' : 'ltr'}
                    lang={language}
                    className="notepad-settings-font-preview"
                    style={{
                      fontFamily,
                      fontSize: `${fontSize}px`,
                      fontWeight,
                      fontStyle,
                      fontStretch: fontStretchValue(fontStretch),
                      lineHeight: 1.25,
                    }}
                  >
                    {t('notepad.fontPreview')}
                  </p>
                </div>
              </SettingsExpander>
              <SettingsRow
                icon={FluentTextWrapIcon}
                title={t('notepad.wordWrap')}
                description={t('notepad.wordWrapDescription')}
                trailing={<SettingToggle checked={wordWrap} label={t('notepad.wordWrap')} onChange={onWordWrapChange} />}
              />
              <SettingsRow
                icon={FluentWandIcon}
                title={t('notepad.formatSettings')}
                trailing={<SettingToggle checked={formattingEnabled} label={t('notepad.formatSettings')} onChange={onFormattingChange} />}
              />
            </section>

            <section aria-labelledby="notepad-settings-open" className="notepad-settings-section">
              <h2 id="notepad-settings-open" className="notepad-settings-section-title">{t('notepad.openNotepad')}</h2>
              <SettingsCard>
                <div className="notepad-settings-row">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <FluentOpenFileIcon />
                    <div className="min-w-0">
                      <p className="text-[13px] leading-snug">{t('notepad.openFile')}</p>
                      <p className="mt-0.5 text-[11.5px] leading-tight opacity-65">{t('notepad.openFileDescription')}</p>
                    </div>
                  </div>
                  <SelectField id="notepad-open-files-in" value={openFileBehavior} onChange={(value) => onOpenFileBehaviorChange(value as 'tab' | 'window')}>
                    <option value="tab">{t('notepad.openInNewTab')}</option>
                    <option value="window">{t('notepad.openInNewWindow')}</option>
                  </SelectField>
                </div>
              </SettingsCard>
              <SettingsExpander
                id="notepad-settings-startup-panel"
                title={t('notepad.onStartup')}
                icon={FluentTabDesktopIcon}
                expanded={expanded.startup}
                onToggle={() => toggle('startup')}
              >
                <div className="notepad-settings-radio-list notepad-settings-radio-list-inset">
                  <RadioOption name="notepad-startup" value="restore" checked={startupBehavior === 'restore'} label={t('notepad.continuePreviousSession')} onChange={() => onStartupBehaviorChange('restore')} />
                  <RadioOption name="notepad-startup" value="new" checked={startupBehavior === 'new'} label={t('notepad.startNewSessionDiscard')} onChange={() => onStartupBehaviorChange('new')} />
                </div>
              </SettingsExpander>
              <SettingsRow
                icon={FluentClockIcon}
                title={t('notepad.recentFiles')}
                trailing={<SettingToggle checked={recentFilesEnabled} label={t('notepad.recentFiles')} onChange={onRecentFilesChange} />}
              />
            </section>

            <section aria-labelledby="notepad-settings-spelling" className="notepad-settings-section">
              <h2 id="notepad-settings-spelling" className="notepad-settings-section-title">{t('notepad.spelling')}</h2>
              <SettingsExpander
                id="notepad-settings-spell-panel"
                title={t('notepad.spellCheck')}
                icon={FluentSpellCheckIcon}
                expanded={expanded.spelling}
                onToggle={() => toggle('spelling')}
                trailing={<SettingToggle checked={spellCheck} label={t('notepad.spellCheck')} onChange={onSpellCheckChange} />}
              >
                <div className="notepad-settings-format-list">
                  {spellCheckFormats.map((format) => (
                    <div key={format.key} className="notepad-settings-format-row">
                      <span className={!spellCheck ? 'opacity-45' : ''}>{format.label}</span>
                      <SettingToggle
                        checked={selectedSpellCheckFormats[format.key]}
                        disabled={!spellCheck}
                        label={t('notepad.spellCheckFormat', { format: format.label })}
                        onChange={() => onSpellCheckFormatChange(format.key)}
                      />
                    </div>
                  ))}
                </div>
              </SettingsExpander>
              <SettingsRow
                icon={FluentAutoCorrectIcon}
                title={t('notepad.autoCorrect')}
                description={t('notepad.autoCorrectDescription')}
                trailing={<SettingToggle checked={autoCorrect} disabled={!spellCheck} label={t('notepad.autoCorrect')} onChange={onAutoCorrectChange} />}
              />
            </section>

            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
