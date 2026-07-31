import type { TranslationKey } from '../i18n'
import type { ShortcutBinding } from './types'

type Translate = (key: TranslationKey) => string

export function getShortcutCommandTranslationKey(bindingId: string): TranslationKey {
  const [head = '', ...tail] = bindingId.split('.')
  const key = head + tail
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('')
  return `shortcutCommands.${key}` as TranslationKey
}

export function getLocalizedShortcutCommandLabel(
  binding: ShortcutBinding,
  translate: Translate,
): string {
  return translate(getShortcutCommandTranslationKey(binding.id))
}
