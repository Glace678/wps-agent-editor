import { t } from '@/lib/i18n/translate'
import type { LanguageCode } from '@/lib/i18n'

export interface SystemFontFace {
  familyName: string
  displayName: string
  faceName: string
  weight: number
  style: 'normal' | 'italic' | 'oblique'
  stretch: number
}

/**
 * The common default for Word, Notepad, and Excel. Keeping it in the shared
 * library makes Fortune Sheet's numeric font references deterministic too.
 */
export const DEFAULT_OFFICE_FONT_FAMILY = 'Segoe UI'

const FALLBACK_SYSTEM_FONT_FAMILIES = [
  'Microsoft YaHei',
  'Microsoft YaHei UI',
  'SimSun',
  'NSimSun',
  'FangSong',
  'KaiTi',
  'SimHei',
  'DengXian',
  'Segoe UI',
  'Consolas',
  'Courier New',
]

const FALLBACK_CHINESE_FONT_DISPLAY_NAMES: Record<string, string> = {
  'Microsoft YaHei': '微软雅黑',
  'Microsoft YaHei UI': '微软雅黑 UI',
  SimSun: '宋体',
  NSimSun: '新宋体',
  FangSong: '仿宋',
  KaiTi: '楷体',
  SimHei: '黑体',
  DengXian: '等线',
}

export function createFallbackSystemFontFaces(language: LanguageCode): SystemFontFace[] {
  return FALLBACK_SYSTEM_FONT_FAMILIES.flatMap((familyName) => {
    const displayName = language === 'zh-CN'
      ? FALLBACK_CHINESE_FONT_DISPLAY_NAMES[familyName] || familyName
      : familyName
    return [
      { familyName, displayName, faceName: t('fontFace.regular', language), weight: 400, style: 'normal' as const, stretch: 5 },
      { familyName, displayName, faceName: t('fontFace.italic', language), weight: 400, style: 'italic' as const, stretch: 5 },
      { familyName, displayName, faceName: t('fontFace.bold', language), weight: 700, style: 'normal' as const, stretch: 5 },
      { familyName, displayName, faceName: t('fontFace.boldItalic', language), weight: 700, style: 'italic' as const, stretch: 5 },
    ]
  })
}

export const FALLBACK_SYSTEM_FONT_FACES: SystemFontFace[] = createFallbackSystemFontFaces('en')

const systemFontFacesPromises = new Map<LanguageCode, Promise<SystemFontFace[]>>()

export function loadSystemFontFaces(language: LanguageCode): Promise<SystemFontFace[]> {
  let request = systemFontFacesPromises.get(language)
  if (!request) {
    const fallback = createFallbackSystemFontFaces(language)
    request = window.api.lw.listFonts(language)
      .then((faces) => faces.length > 0 ? faces : fallback)
      .catch(() => fallback)
    systemFontFacesPromises.set(language, request)
  }
  return request
}

export function normalizeSystemFontFamilyName(familyName: string): string {
  return familyName.trim().replace(/["']/g, '').toLowerCase()
}

/** CJK ideographs (ext-A + unified + compat) — a font is "Chinese" when either
 * of its names carries them (宋体 / 黑体 / 微软雅黑 …). */
const CJK_TEXT_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/** Latin family names of common Chinese fonts on Windows. Needed when fonts are
 * scanned for a non-Chinese UI, where displayName stays English (SimSun) even
 * though the font belongs in the Chinese section. */
const CHINESE_FONT_FAMILY_KEYS = new Set([
  'simsun',
  'nsimsun',
  'simhei',
  'fangsong',
  'kaiti',
  'dengxian',
  'dengxianlight',
  'microsoftyahei',
  'microsoftyaheiui',
  'microsoftjhenghei',
  'microsoftjhengheiui',
  'youyuan',
  'lisu',
  'mingliu',
  'pmingliu',
  'dfkaisb',
  'stkaiti',
  'stfangsong',
  'stsong',
  'stzhongsong',
  'stxihei',
  'stliti',
  'stxinwei',
  'stxingkai',
  'sthupo',
  'stcaiyun',
  'stxiyuan',
])

export function isChineseFontFamily(familyName: string, displayName = ''): boolean {
  return CJK_TEXT_RE.test(familyName)
    || CJK_TEXT_RE.test(displayName)
    || CHINESE_FONT_FAMILY_KEYS.has(familyName.toLowerCase().replace(/[\s'"_-]+/g, ''))
}

export interface FontFamilyEntry {
  familyName: string
  displayName: string
}

/** 'zh-CN' ICU collation orders CJK strings by pinyin (等线 < 仿宋 < 黑体 …). */
const PINYIN_COLLATOR = new Intl.Collator('zh-CN', { numeric: true })
const LATIN_COLLATOR = new Intl.Collator('en', { numeric: true })

/** Shared menu ordering: Chinese fonts first (sorted by pinyin), then Western
 * fonts sorted A→Z. This is the one ordering every editor (Word, Excel,
 * Notepad) applies to the shared system font inventory. */
export function compareFontFamilyEntries(a: FontFamilyEntry, b: FontFamilyEntry): number {
  const aChinese = isChineseFontFamily(a.familyName, a.displayName)
  const bChinese = isChineseFontFamily(b.familyName, b.displayName)
  if (aChinese !== bChinese) return aChinese ? -1 : 1
  if (aChinese) {
    return PINYIN_COLLATOR.compare(a.displayName, b.displayName)
      || PINYIN_COLLATOR.compare(a.familyName, b.familyName)
  }
  return LATIN_COLLATOR.compare(a.familyName, b.familyName)
}

/**
 * Deduplicated font families in shared menu order. `pinFirst` hoists one family
 * (for example the spreadsheet default) above the Chinese/Western sections —
 * Fortune Sheet renders cells without an explicit font in `fontarray[0]`, so
 * Excel must keep its default at index zero.
 */
export function getOrderedFontFamilyEntries(
  faces: readonly SystemFontFace[],
  options?: { pinFirst?: string },
): FontFamilyEntry[] {
  const byKey = new Map<string, FontFamilyEntry>()
  for (const face of faces) {
    const familyName = face.familyName.trim()
    const key = normalizeSystemFontFamilyName(familyName)
    if (!familyName || !key || byKey.has(key)) continue
    byKey.set(key, { familyName, displayName: face.displayName.trim() || familyName })
  }

  const pinFirst = options?.pinFirst?.trim()
  const pinKey = pinFirst ? normalizeSystemFontFamilyName(pinFirst) : ''
  if (pinKey && !byKey.has(pinKey) && pinFirst) {
    byKey.set(pinKey, { familyName: pinFirst, displayName: pinFirst })
  }

  const pinned = pinKey ? byKey.get(pinKey) : undefined
  if (pinned) byKey.delete(pinKey)
  const rest = [...byKey.values()].sort(compareFontFamilyEntries)
  return pinned ? [pinned, ...rest] : rest
}

export function getSystemFontFamilyNames(faces: SystemFontFace[]): string[] {
  return getOrderedFontFamilyEntries(faces).map((entry) => entry.familyName)
}

export function getSystemFontDisplayName(
  faces: SystemFontFace[],
  familyName: string,
): string {
  const familyKey = normalizeSystemFontFamilyName(familyName)
  return faces.find(
    (face) => normalizeSystemFontFamilyName(face.familyName) === familyKey,
  )?.displayName || familyName
}
