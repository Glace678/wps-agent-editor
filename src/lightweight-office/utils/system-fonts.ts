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

export function getSystemFontFamilyNames(faces: SystemFontFace[]): string[] {
  const familiesByName = new Map<string, string>()
  for (const face of faces) {
    const familyName = face.familyName.trim()
    const key = normalizeSystemFontFamilyName(familyName)
    if (familyName && key && !familiesByName.has(key)) {
      familiesByName.set(key, familyName)
    }
  }

  const defaultKey = normalizeSystemFontFamilyName(DEFAULT_OFFICE_FONT_FAMILY)
  const defaultFamily = familiesByName.get(defaultKey) || DEFAULT_OFFICE_FONT_FAMILY
  const otherFamilies = [...familiesByName.entries()]
    .filter(([key]) => key !== defaultKey)
    .map(([, familyName]) => familyName)
    .sort((left, right) => left.localeCompare(right))

  return [defaultFamily, ...otherFamilies]
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
