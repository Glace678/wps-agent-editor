import type { en } from './locales/en'

type WidenStrings<T> = T extends string
  ? string
  : { [K in keyof T]: WidenStrings<T[K]> }

export type Translation = WidenStrings<typeof en>

export type TranslationSection = keyof typeof en

export type TranslationKey = {
  [Section in TranslationSection]: `${Section}.${keyof (typeof en)[Section] & string}`
}[TranslationSection]

export type TranslationParams = Record<string, string | number>

export const languages = [
  { code: 'zh-CN', name: 'Simplified Chinese', nativeName: '简体中文' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'pt', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
] as const

export type LanguageCode = (typeof languages)[number]['code']

export let currentLanguage: LanguageCode = 'zh-CN'

export function setLanguage(language: LanguageCode): void {
  currentLanguage = language
}

export function getLanguage(): LanguageCode {
  return currentLanguage
}
