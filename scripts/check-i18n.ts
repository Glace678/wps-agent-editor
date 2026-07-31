import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TextDecoder } from 'node:util'
import { languages, setLanguage, translations } from '../src/lib/i18n'
import { t } from '../src/lib/i18n/translate'
import { t as electronT } from '../electron/i18n/translate'
import { OFFICE_SHORTCUT_CATALOG } from '../src/lib/office-shortcuts/catalog'
import { getShortcutCommandTranslationKey } from '../src/lib/office-shortcuts/i18n'
import type {
  LanguageCode,
  Translation,
  TranslationKey,
} from '../src/lib/i18n/types'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const localeDirectory = resolve(projectRoot, 'src/lib/i18n/locales')
const electronLocaleDirectory = resolve(projectRoot, 'electron/i18n/locales')
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function flatten(tree: unknown, prefix = ''): Map<string, string> {
  const result = new Map<string, string>()
  assert(typeof tree === 'object' && tree !== null, `Expected an object at ${prefix || '<root>'}`)

  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      result.set(path, value)
    } else {
      for (const [nestedKey, nestedValue] of flatten(value, path)) {
        result.set(nestedKey, nestedValue)
      }
    }
  }

  return result
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)]
    .map((match) => match[1])
    .sort()
}

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length
}

const localeEntries = Object.entries(translations) as [LanguageCode, Translation][]
const expectedCodes = ['zh-CN', 'en', 'ja', 'es', 'pt', 'de', 'fr', 'ru', 'ar']
const windowsNotepadFontPreviews = {
  'zh-CN': '海浪的声音平静了我的心灵。',
  en: 'The sound of ocean waves calms my soul.',
  ja: '海の波の音が私の心を落ち着かせます。',
  es: 'El sonido de las olas del mar me calma el alma.',
  pt: 'O som das ondas do oceano acalma minha alma.',
  de: 'Das Rauschen der Wellen des Ozeans beruhigt meine Seele.',
  fr: 'Les sons des vagues de l’océan apaisent mon âme.',
  ru: 'Звуки океана успокаивают меня.',
  ar: 'صوت أمواج المحيط يهدئ روحي.',
} satisfies Record<LanguageCode, string>
const languageCodes = languages.map(({ code }) => code)
const registeredCodes = localeEntries.map(([code]) => code)
const expectedFiles = languageCodes
  .map((code) => `${code}.ts`)
  .sort()
const actualFiles = readdirSync(localeDirectory)
  .filter((name) => name.endsWith('.ts'))
  .sort()

assert(
  JSON.stringify(languageCodes) === JSON.stringify(expectedCodes),
  `Unexpected language list. Expected ${expectedCodes.join(', ')}, received ${languageCodes.join(', ')}.`,
)
assert(
  JSON.stringify([...registeredCodes].sort()) === JSON.stringify([...languageCodes].sort()),
  'The language list and translation registry are out of sync.',
)
assert(
  JSON.stringify(actualFiles) === JSON.stringify(expectedFiles),
  `Unexpected locale files. Expected ${expectedFiles.join(', ')}, received ${actualFiles.join(', ')}.`,
)
assert(!existsSync(electronLocaleDirectory), 'Electron must not contain a duplicate locales directory.')

for (const code of languageCodes) {
  assert(
    translations[code].notepad.fontPreview === windowsNotepadFontPreviews[code],
    `${code}: the font preview must match Windows Notepad SettingFontSampleText.`,
  )
}

const english = flatten(translations.en)
const englishKeys = [...english.keys()].sort()

for (const [code, translation] of localeEntries) {
  const current = flatten(translation)
  const currentKeys = [...current.keys()].sort()

  assert(
    JSON.stringify(currentKeys) === JSON.stringify(englishKeys),
    `${code}: key tree differs from en.`,
  )

  for (const key of englishKeys) {
    const englishValue = english.get(key)!
    const localizedValue = current.get(key)!
    assert(localizedValue.trim().length > 0, `${code}:${key} is empty.`)
    assert(
      JSON.stringify(placeholders(localizedValue)) ===
        JSON.stringify(placeholders(englishValue)),
      `${code}:${key} has a different placeholder set.`,
    )
  }

  const body = [...current.values()].join('\n')
  assert(!body.includes('\uFFFD'), `${code}: contains the Unicode replacement character.`)
  assert(!body.includes('�?'), `${code}: contains a damaged UTF-8 sequence.`)
  assert(!body.includes('…'), `${code}: use three periods for ellipses.`)
  assert(!/\[(?:WordEditor|LightweightOffice)\]/.test(body), `${code}: contains debug log text.`)
  assert(!body.includes(' MB)'), `${code}: contains the old download fragment.`)
  assert(body.includes('insert_text'), `${code}: insert_text was translated or removed.`)
  assert(body.includes('append_paragraph'), `${code}: append_paragraph was translated or removed.`)
  assert(body.includes('replace_text'), `${code}: replace_text was translated or removed.`)
  assert(body.includes('read_document'), `${code}: read_document was translated or removed.`)
  assert(body.includes('```tool'), `${code}: the tool code-block identifier is missing.`)
  if (code !== 'en') {
    const identical = englishKeys.filter((key) => current.get(key) === english.get(key))
    assert(
      identical.length < englishKeys.length * 0.3,
      `${code}: ${identical.length}/${englishKeys.length} values are copied from English.`,
    )
    assert(
      translation.agents.customAssistantPrompt !== translations.en.agents.customAssistantPrompt,
      `${code}: an Agent system prompt was copied from English.`,
    )
  }
}

const i18nSourceFiles = [
  ...actualFiles.map((fileName) => resolve(localeDirectory, fileName)),
  resolve(projectRoot, 'src/lib/i18n/index.ts'),
  resolve(projectRoot, 'src/lib/i18n/translate.ts'),
  resolve(projectRoot, 'src/lib/i18n/types.ts'),
  resolve(projectRoot, 'electron/i18n/index.ts'),
  resolve(projectRoot, 'electron/i18n/translate.ts'),
  resolve(projectRoot, 'electron/i18n/types.ts'),
]

for (const filePath of i18nSourceFiles) {
  const bytes = readFileSync(filePath)
  utf8Decoder.decode(bytes)
  assert(
    !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf),
    `${filePath}: UTF-8 BOM is not expected.`,
  )
}

const localeBodies = Object.fromEntries(
  localeEntries.map(([code, translation]) => [code, [...flatten(translation).values()].join('\n')]),
) as Record<LanguageCode, string>

assert(countMatches(localeBodies['zh-CN'], /\p{Script=Han}/gu) > 100, 'zh-CN: insufficient Simplified Chinese text.')
assert(countMatches(localeBodies.ja, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu) > 100, 'ja: insufficient Japanese text.')
assert(countMatches(localeBodies.ru, /\p{Script=Cyrillic}/gu) > 500, 'ru: insufficient Cyrillic text.')
assert(countMatches(localeBodies.ar, /\p{Script=Arabic}/gu) > 500, 'ar: insufficient Arabic text.')
assert(countMatches(localeBodies.pt, /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/gu) > 30, 'pt: Portuguese accents are missing.')

assert(translations.ar.menu.quit.includes('خروج'), 'ar: Quit must use خروج.')
assert(translations.ru.menu.file === 'Файл', 'ru: File must use Cyrillic.')
assert(translations.ja.menu.file === 'ファイル', 'ja: File must use Japanese script.')
assert(translations['zh-CN'].agentConfig.searchProvider.includes('模型服务商'), 'zh-CN: Provider terminology is inconsistent.')
assert(translations.en.providerRegistry.tongyiQianwen === 'Qwen', 'en: Qwen brand name is inconsistent.')
assert(translations['zh-CN'].providerRegistry.tongyiQianwen === '通义千问', 'zh-CN: 通义千问 brand name is inconsistent.')
assert(translations.en.providerRegistry.zhipuAi === 'Zhipu AI', 'en: Zhipu AI brand name is inconsistent.')
assert(translations['zh-CN'].providerRegistry.zhipuAi === '智谱 AI', 'zh-CN: 智谱 AI brand name is inconsistent.')

const shortcutTranslationKeys = OFFICE_SHORTCUT_CATALOG.map((binding) =>
  getShortcutCommandTranslationKey(binding.id))
assert(
  new Set(shortcutTranslationKeys).size === OFFICE_SHORTCUT_CATALOG.length,
  'Shortcut binding ids must map to unique translation keys.',
)
for (const [bindingIndex, key] of shortcutTranslationKeys.entries()) {
  const binding = OFFICE_SHORTCUT_CATALOG[bindingIndex]
  for (const code of languageCodes) {
    assert(t(key, code) !== key, `${code}: missing shortcut translation for ${binding.id}.`)
  }
}

assert(t('pdfViewer.pageNumber', { number: 7 }, 'zh-CN') === '第 7 页', 'Interpolation failed for zh-CN.')
assert(t('notepad.currentZoom', { percent: 125 }, 'en') === 'Zoom 125%', 'Zoom interpolation failed for en.')
assert(t('documentServer.downloadProgress', {
  downloadedMB: 5,
  totalMB: 10,
  percent: 50,
}, 'en') === 'Downloaded 5 MB of 10 MB (50%).', 'Interpolation failed for en.')
assert(t('menu.file', 'ja') === 'ファイル', 'The Japanese menu lookup failed.')
assert(t('menu.file', 'de') === 'Datei', 'The German menu lookup failed.')
assert(t('menu.file', 'fr') === 'Fichier', 'The French menu lookup failed.')
assert(t('menu.file', 'ru') === 'Файл', 'The Russian menu lookup failed.')
assert(
  electronT('menu.quit', 'ar') === t('menu.quit', 'ar'),
  'Electron and renderer do not share the same menu translation.',
)

const japaneseMenu = translations.ja.menu as { file?: string }
const japaneseFileLabel = japaneseMenu.file
delete japaneseMenu.file
assert(t('menu.file', 'ja') === 'File', 'A missing localized value must fall back to English.')
japaneseMenu.file = japaneseFileLabel

assert(t('missing.key' as TranslationKey, 'en') === 'missing.key', 'Unknown keys must fall back to the key itself.')
setLanguage('ru')
assert(t('menu.file') === 'Файл', 'The active-language lookup failed.')
setLanguage('zh-CN')

console.log(`i18n check passed: ${localeEntries.length} locales, ${englishKeys.length} keys per locale.`)
for (const [code, translation] of localeEntries) {
  const current = flatten(translation)
  const identical = code === 'en'
    ? 0
    : englishKeys.filter((key) => current.get(key) === english.get(key)).length
  console.log(`${code}: keys=${current.size}, identicalToEn=${identical}`)
}
