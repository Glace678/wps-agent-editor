import { getLanguage, translations } from './index'
import type {
  LanguageCode,
  Translation,
  TranslationKey,
  TranslationParams,
} from './types'

function findTranslation(root: Translation, key: TranslationKey): string | undefined {
  let value: unknown = root

  for (const segment of key.split('.')) {
    if (typeof value !== 'object' || value === null || !(segment in value)) {
      return undefined
    }

    value = (value as Record<string, unknown>)[segment]
  }

  return typeof value === 'string' ? value : undefined
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template

  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (placeholder, name: string) => {
    const value = params[name]
    return value === undefined ? placeholder : String(value)
  })
}

export function t(key: TranslationKey, language?: LanguageCode): string
export function t(
  key: TranslationKey,
  params?: TranslationParams,
  language?: LanguageCode,
): string
export function t(
  key: TranslationKey,
  paramsOrLanguage?: TranslationParams | LanguageCode,
  language?: LanguageCode,
): string {
  const params = typeof paramsOrLanguage === 'string' ? undefined : paramsOrLanguage
  const activeLanguage =
    typeof paramsOrLanguage === 'string'
      ? paramsOrLanguage
      : language ?? getLanguage()

  const localized = findTranslation(translations[activeLanguage], key)
  const fallback = findTranslation(translations.en, key)

  return interpolate(localized ?? fallback ?? key, params)
}
