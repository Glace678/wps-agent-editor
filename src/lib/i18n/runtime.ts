import { useCallback, useSyncExternalStore } from 'react'
import { t as translate } from './translate'
import { desktopApi } from '@/platform/desktop'
import {
  getLanguage,
  languages,
  setLanguage,
  type LanguageCode,
  type TranslationKey,
  type TranslationParams,
} from './types'

export const APP_LANGUAGE_STORAGE_KEY = 'wps-agent-language'
export const APP_LANGUAGE_EVENT = 'wps-agent-language-change'

const languageCodes = new Set<LanguageCode>(languages.map(({ code }) => code))
const subscribers = new Set<() => void>()

function normalizeLanguage(value: string | null | undefined): LanguageCode | null {
  if (!value) return null
  if (languageCodes.has(value as LanguageCode)) return value as LanguageCode

  const normalized = value.toLowerCase()
  if (normalized.startsWith('zh')) return 'zh-CN'
  if (normalized.startsWith('pt')) return 'pt'

  const base = normalized.split('-')[0]
  return languages.find(({ code }) => code.toLowerCase() === base)?.code ?? null
}

function detectInitialLanguage(): LanguageCode {
  try {
    const stored = normalizeLanguage(localStorage.getItem(APP_LANGUAGE_STORAGE_KEY))
    if (stored) return stored
  } catch {
    // localStorage can be unavailable in restricted renderer contexts.
  }

  if (typeof navigator !== 'undefined') {
    for (const candidate of navigator.languages ?? [navigator.language]) {
      const detected = normalizeLanguage(candidate)
      if (detected) return detected
    }
  }

  return 'zh-CN'
}

function applyDocumentLanguage(language: LanguageCode): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = language
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
  if (document.body) document.body.dir = 'ltr'
}

function syncNativeMenu(language: LanguageCode): void {
  if (typeof window === 'undefined') return
  void desktopApi.app.setLanguage(language).catch(() => {
    // The browser preview does not expose the Tauri desktop transport.
  })
}

let initialized = false

export function initializeLanguage(): LanguageCode {
  if (!initialized) {
    initialized = true
    setLanguage(detectInitialLanguage())
    syncNativeMenu(getLanguage())
  }
  const language = getLanguage()
  applyDocumentLanguage(language)
  return language
}

export function getAppLanguage(): LanguageCode {
  return initializeLanguage()
}

export function setAppLanguage(language: LanguageCode): void {
  initializeLanguage()
  if (!languageCodes.has(language)) return

  const changed = getLanguage() !== language
  setLanguage(language)
  applyDocumentLanguage(language)

  try {
    localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Keep the in-memory preference even if persistence is unavailable.
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<LanguageCode>(APP_LANGUAGE_EVENT, { detail: language }))
  }

  if (changed) {
    syncNativeMenu(language)
    subscribers.forEach((subscriber) => subscriber())
  }
}

function subscribe(subscriber: () => void): () => void {
  subscribers.add(subscriber)
  return () => subscribers.delete(subscriber)
}

export interface TranslationApi {
  language: LanguageCode
  setLanguage: (language: LanguageCode) => void
  t: (key: TranslationKey, params?: TranslationParams) => string
}

export function useTranslation(): TranslationApi {
  const language = useSyncExternalStore(subscribe, getAppLanguage, getAppLanguage)
  const localizedT = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(key, params, language),
    [language],
  )

  return {
    language,
    setLanguage: setAppLanguage,
    t: localizedT,
  }
}

if (typeof window !== 'undefined') {
  initializeLanguage()
  window.addEventListener('storage', (event) => {
    if (event.key !== APP_LANGUAGE_STORAGE_KEY) return
    const language = normalizeLanguage(event.newValue)
    if (language) setAppLanguage(language)
  })
}
