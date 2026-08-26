import { normalizeSystemFontFamilyName, type SystemFontFace } from './system-fonts'

/**
 * Shared font-search helpers for the Word (SuperDoc) and Excel (Fortune Sheet)
 * font pickers. Both editors render the same system font inventory; keeping the
 * alias table in one place guarantees a search that works in one editor works
 * in the other.
 *
 * Users often type pinyin or the localized Chinese name while the picker shows
 * the other form ("SONG" should find 宋体, "heiti" should find SimHei). Keys are
 * normalized family names (spaces/quotes stripped, lowercased); values are extra
 * searchable terms. Unicode escapes keep Chinese aliases correct regardless of
 * file encoding.
 */
export const FONT_SEARCH_ALIASES: Record<string, string[]> = {
  // 系统默认中文字体
  simsun: ['songti', 'song', '\u5b8b\u4f53'],
  nsimsun: ['xinsongti', 'song', '\u65b0\u5b8b\u4f53'],
  fangsong: ['fangsong', 'fang', '\u4eff\u5b8b'],
  kaiti: ['kaiti', 'kai', '\u6977\u4f53'],
  simhei: ['heiti', 'hei', '\u9ed1\u4f53'],
  dengxian: ['dengxian', 'deng', '\u7b49\u7ebf'],
  microsoftyahei: ['yahei', 'msyh', '\u5fae\u8f6f\u96c5\u9ed1'],
  microsoftyaheiui: ['yahei', 'msyh', '\u5fae\u8f6f\u96c5\u9ed1 ui'],
  // 常见预装中文字体（华文系列、幼圆、隶书等）
  youyuan: ['youyuan', '\u5e7c\u5706'],
  lisu: ['lisu', '\u96b6\u4e66'],
  stkaiti: ['huawenkaiti', '\u534e\u6587\u6977\u4f53'],
  stfangsong: ['huawenfangsong', 'fangsong', '\u534e\u6587\u4eff\u5b8b'],
  stsong: ['huawensong', 'song', '\u534e\u6587\u5b8b\u4f53'],
  stzhongsong: ['huawenzhongsong', '\u534e\u6587\u4e2d\u5b8b'],
  stxihei: ['huawenxihei', '\u534e\u6587\u7ec6\u9ed1'],
  stliti: ['huawenlishu', '\u534e\u6587\u96b6\u4e66'],
  stxinwei: ['huawenxinwei', '\u534e\u6587\u65b0\u9b4f'],
  stxingkai: ['huawenxingkai', '\u534e\u6587\u884c\u6977'],
  sthupo: ['huawenhupo', '\u534e\u6587\u7425\u73c0'],
  stcaiyun: ['huawencaiyun', '\u534e\u6587\u5f69\u4e91'],
  stxiyuan: ['huawenxiyuan', '\u534e\u6587\u7ec6\u5706'],
}

/** NFKC + strip spaces/quotes/dashes + lowercase, so "MS YaHei" ≡ "msyahei". */
export function normalizeFontSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/[\s'"_-]+/g, '')
    .toLocaleLowerCase()
}

export function getFontSearchAliases(familyName: string): string[] {
  return FONT_SEARCH_ALIASES[normalizeFontSearchText(familyName)] || []
}

/**
 * Build familyName → searchable-terms lookup for a font inventory. Terms cover
 * the canonical family name, the localized display name, the face name and any
 * pinyin/Chinese aliases, and the map is keyed by both familyName and
 * displayName so lookups work no matter which one the picker renders.
 */
export function buildFontSearchTerms(
  fontFaces: readonly SystemFontFace[],
): Map<string, string[]> {
  const termsByFamily = new Map<string, string[]>()
  const add = (name: string, terms: string[]) => {
    const keys = new Set([
      normalizeSystemFontFamilyName(name),
      normalizeFontSearchText(name),
    ])
    for (const key of keys) {
      if (!key) continue
      const current = termsByFamily.get(key) || []
      termsByFamily.set(key, [...new Set([...current, ...terms.filter(Boolean)])])
    }
  }
  for (const face of fontFaces) {
    const familyName = face.familyName.trim()
    const displayName = face.displayName.trim() || familyName
    const terms = [familyName, displayName, face.faceName, ...getFontSearchAliases(familyName)]
    add(familyName, terms)
    add(displayName, terms)
  }
  return termsByFamily
}
