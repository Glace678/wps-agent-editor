import { ar } from './locales/ar'
import { de } from './locales/de'
import { en } from './locales/en'
import { es } from './locales/es'
import { fr } from './locales/fr'
import { ja } from './locales/ja'
import { pt } from './locales/pt'
import { ru } from './locales/ru'
import { zhCN } from './locales/zh-CN'
import type { LanguageCode, Translation } from './types'

export const translations = {
  'zh-CN': zhCN,
  en,
  ja,
  es,
  pt,
  de,
  fr,
  ru,
  ar,
} satisfies Record<LanguageCode, Translation>

export { currentLanguage, getLanguage, languages, setLanguage } from './types'
export type {
  LanguageCode,
  Translation,
  TranslationKey,
  TranslationParams,
  TranslationSection,
} from './types'
