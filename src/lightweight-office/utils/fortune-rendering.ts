import { Canvas, locale } from '@fortune-sheet/core'
import type { Context } from '@fortune-sheet/core'
import {
  getSystemFontDisplayName,
  getSystemFontFamilyNames,
  normalizeSystemFontFamilyName,
  type SystemFontFace,
} from './system-fonts'

const PATCH_FLAG = Symbol.for('wps.fortune.worksheet-canvas-sizing')
const DRAW_METHODS = [
  'drawMain',
  'drawRowHeader',
  'drawColumnHeader',
  'drawFreezeLine',
] as const
const FORTUNE_LANGUAGES = ['en', 'zh', 'es', 'ru', 'zh-TW', 'hi'] as const

type CanvasDrawMethod = (this: Canvas, ...args: unknown[]) => unknown
type SpreadsheetFontMenuItem = {
  familyName: string
  menuName: string
}

function isWorksheetCanvas(canvas: HTMLCanvasElement) {
  return canvas.classList.contains('fortune-sheet-canvas')
    && canvas.closest('.excel-editor-shell') !== null
}

/**
 * Fortune sizes the worksheet backing store as ceil(cssWidth × DPR) device
 * pixels but leaves the CSS box at the integer cssWidth. At fractional DPR
 * (Windows 125% / 134% / 150% display scaling) the texture is then squeezed
 * into a slightly smaller box and every glyph is bilinearly resampled — the
 * sheet looks softly blurred, and whether it shows depends on how close
 * cssWidth × DPR lands to an integer (why it appears "sometimes" and a later
 * relayout seems to fix it). Snap the CSS box to exactly backing ÷ DPR so
 * texels map 1:1 onto device pixels at any panel width.
 */
function snapCanvasCssSizeToBacking(canvas: HTMLCanvasElement) {
  if (canvas.width === 0 || canvas.height === 0) return
  const dpr = window.devicePixelRatio || 1
  const width = `${Math.round((canvas.width / dpr) * 1000) / 1000}px`
  const height = `${Math.round((canvas.height / dpr) * 1000) / 1000}px`
  if (canvas.style.width !== width) canvas.style.width = width
  if (canvas.style.height !== height) canvas.style.height = height
}

function installNativeDarkCanvasRendering() {
  const prototype = Canvas.prototype as unknown as Record<PropertyKey, unknown>
  if (prototype[PATCH_FLAG]) return

  for (const methodName of DRAW_METHODS) {
    const original = prototype[methodName] as CanvasDrawMethod | undefined
    if (typeof original !== 'function') continue

    prototype[methodName] = function patchedFortuneDraw(
      this: Canvas,
      ...args: unknown[]
    ) {
      const canvas = this.canvasElement
      if (isWorksheetCanvas(canvas)) {
        // Fortune re-applies its integer CSS size on every container resize
        // (updateContextWithCanvas), so re-snap on every draw.
        snapCanvasCssSizeToBacking(canvas)
      }
      return original.apply(this, args)
    }
  }

  prototype[PATCH_FLAG] = true
}

function getSharedSpreadsheetFontFamilies(
  fontFaces: readonly SystemFontFace[],
): SpreadsheetFontMenuItem[] {
  const mutableFaces = [...fontFaces]
  const usedMenuNames = new Set<string>()

  return getSystemFontFamilyNames(mutableFaces).map((familyName) => {
    const displayName = getSystemFontDisplayName(mutableFaces, familyName).trim() || familyName
    const displayKey = normalizeSystemFontFamilyName(displayName)
    const menuName = displayKey && !usedMenuNames.has(displayKey)
      ? displayName
      : familyName

    usedMenuNames.add(normalizeSystemFontFamilyName(menuName))
    // The catalog remains one physical-font list. menuName only restores the
    // Windows-localized name Fortune shows (for example 宋体 / 仿宋).
    return { familyName, menuName }
  })
}

/**
 * Fortune Sheet only exposes a short locale-specific font list by default.
 * Replace it with the same system-family inventory consumed by Word and
 * Notepad, while retaining the stable spreadsheet default at index zero.
 */
function installSharedSpreadsheetFontLibrary(fontFaces: readonly SystemFontFace[]) {
  const fontFamilies = getSharedSpreadsheetFontFamilies(fontFaces)
  const fontIndexes = new Map<string, number>()
  for (const [index, font] of fontFamilies.entries()) {
    fontIndexes.set(normalizeSystemFontFamilyName(font.familyName), index)
    fontIndexes.set(normalizeSystemFontFamilyName(font.menuName), index)
  }

  for (const lang of FORTUNE_LANGUAGES) {
    const localeData = locale({ lang } as unknown as Context)
    const previousFamilies = [...localeData.fontarray]
    const fontMap = localeData.fontjson as unknown as Record<string, number>
    const aliases = new Map<string, number>()
    for (const [alias, index] of Object.entries(fontMap)) {
      const previousFamily = previousFamilies[index]
      const nextIndex = previousFamily
        ? fontIndexes.get(normalizeSystemFontFamilyName(previousFamily))
        : undefined
      const aliasKey = normalizeSystemFontFamilyName(alias)
      if (nextIndex !== undefined && aliasKey) aliases.set(aliasKey, nextIndex)
    }

    // Accept both canonical and localized family names from imported HTML,
    // existing workbooks, and the localized menu labels.
    for (const face of fontFaces) {
      const index = fontIndexes.get(normalizeSystemFontFamilyName(face.familyName))
      const displayName = normalizeSystemFontFamilyName(face.displayName)
      if (index !== undefined && displayName) aliases.set(displayName, index)
    }

    localeData.fontarray.splice(
      0,
      localeData.fontarray.length,
      ...fontFamilies.map((font) => font.menuName),
    )
    for (const key of Object.keys(fontMap)) delete fontMap[key]
    fontFamilies.forEach(({ familyName, menuName }, index) => {
      fontMap[normalizeSystemFontFamilyName(familyName)] = index
      fontMap[normalizeSystemFontFamilyName(menuName)] = index
    })
    for (const [alias, index] of aliases) {
      if (fontMap[alias] === undefined) fontMap[alias] = index
    }
  }
}

function fillMissingLocaleKeys(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): number {
  let filled = 0
  for (const [key, value] of Object.entries(source)) {
    const current = target[key]
    if (current === undefined || current === null) {
      target[key] = value
      filled += 1
    } else if (
      typeof value === 'object' && value !== null && !Array.isArray(value)
      && typeof current === 'object' && !Array.isArray(current)
    ) {
      filled += fillMissingLocaleKeys(current as Record<string, unknown>, value as Record<string, unknown>)
    }
  }
  return filled
}

let localeGapsFilled = false

/**
 * @fortune-sheet/core ships incomplete locales: 'es' lacks insertLink,
 * linkTypeList, currencyDetail and splitText.splitSymbols, and locale() has no
 * per-key fallback. Components dereference those keys unguarded, so with the
 * Spanish UI a hyperlink card / split-text / currency dialog throws and React
 * unmounts the whole tree (blank window). Backfill every gap from 'en' once.
 */
function polyfillFortuneLocaleGaps() {
  if (localeGapsFilled) return
  localeGapsFilled = true
  const english = locale({ lang: 'en' } as unknown as Context) as unknown as Record<string, unknown>
  for (const lang of FORTUNE_LANGUAGES) {
    if (lang === 'en') continue
    const localeData = locale({ lang } as unknown as Context) as unknown as Record<string, unknown>
    const filled = fillMissingLocaleKeys(localeData, english)
    if (filled > 0) {
      console.log(`[fortune-rendering] backfilled ${filled} missing '${lang}' locale keys from en`)
    }
  }
}

export function configureFortuneRendering(fontFaces?: readonly SystemFontFace[]) {
  // The import-time call installs the canvas patches only. Wait for Excel to
  // supply its fallback/full shared catalog before replacing Fortune's locale
  // data, so the original localized aliases can be migrated as well.
  polyfillFortuneLocaleGaps()
  if (fontFaces) installSharedSpreadsheetFontLibrary(fontFaces)
  installNativeDarkCanvasRendering()
  installCrispDarkCellText()
}
