import { Canvas, locale } from '@fortune-sheet/core'
import type { Context } from '@fortune-sheet/core'
import {
  getSystemFontDisplayName,
  getSystemFontFamilyNames,
  normalizeSystemFontFamilyName,
  type SystemFontFace,
} from './system-fonts'

const PATCH_FLAG = Symbol.for('wps.fortune.native-dark-canvas')
const TEXT_PATCH_FLAG = Symbol.for('wps.fortune.crisp-dark-cell-text')
const CRISP_TEXT_EXTRA_PASSES = 2
const DARK_CANVASES = new WeakSet<HTMLCanvasElement>()
const WORKSHEET_CANVASES = new Set<HTMLCanvasElement>()
const PENDING_CANVASES = new WeakSet<HTMLCanvasElement>()
const DRAW_METHODS = [
  'drawMain',
  'drawRowHeader',
  'drawColumnHeader',
  'drawFreezeLine',
] as const
const FORTUNE_LANGUAGES = ['en', 'zh', 'es', 'ru', 'zh-TW', 'hi'] as const

type CanvasDrawMethod = (this: Canvas, ...args: unknown[]) => unknown
type FortuneInlineTextStyle = { fc?: string }
type FortuneTextWord = { inline?: boolean; style?: FortuneInlineTextStyle | string }
type FortuneTextInfo = { values?: FortuneTextWord[] }
type SavedInlineColor = {
  style: FortuneInlineTextStyle
  hadOwnColor: boolean
  color: string | undefined
}
type SpreadsheetFontMenuItem = {
  familyName: string
  menuName: string
}

function isWorksheetCanvas(canvas: HTMLCanvasElement) {
  return canvas.classList.contains('fortune-sheet-canvas')
    && canvas.closest('.excel-editor-shell') !== null
}

function isDarkMode() {
  return document.documentElement.classList.contains('dark')
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

function parseCanvasColor(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null
  const color = value.trim().toLowerCase()
  const shortHex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(color)
  if (shortHex) {
    return shortHex.slice(1).map((channel) => Number.parseInt(channel + channel, 16)) as [
      number,
      number,
      number,
    ]
  }

  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(color)
  if (hex) {
    return hex.slice(1).map((channel) => Number.parseInt(channel, 16)) as [
      number,
      number,
      number,
    ]
  }

  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/.exec(color)
  if (!rgb) return null
  return rgb.slice(1, 4).map((channel) => Number(channel)) as [number, number, number]
}

function shouldSharpenDarkText(value: unknown) {
  const rgb = parseCanvasColor(value)
  if (!rgb) return false
  const darkest = Math.min(...rgb)
  const lightest = Math.max(...rgb)
  const average = (rgb[0] + rgb[1] + rgb[2]) / 3

  // Normalize only dark neutral text. Saturated semantic colors and light text
  // on explicitly dark workbook fills keep their authored appearance.
  return lightest - darkest <= 12 && average <= 128
}

/**
 * Invert the already rasterized backing pixels without resizing or filtering
 * the canvas. This keeps Fortune Sheet's native device-pixel-ratio text edges
 * intact: white cells become true black and dark glyphs become crisp light
 * glyphs, with no compositor resampling pass.
 */
function invertBackingPixels(canvas: HTMLCanvasElement) {
  if (canvas.width === 0 || canvas.height === 0) return false

  const context = canvas.getContext('2d')
  if (!context) return false

  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalCompositeOperation = 'difference'
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.restore()
  return true
}

function restoreNativeLightPixels(canvas: HTMLCanvasElement) {
  if (!DARK_CANVASES.has(canvas)) return
  if (invertBackingPixels(canvas)) DARK_CANVASES.delete(canvas)
}

function syncWorksheetCanvasTheme() {
  for (const canvas of WORKSHEET_CANVASES) {
    if (!canvas.isConnected || !isWorksheetCanvas(canvas)) {
      WORKSHEET_CANVASES.delete(canvas)
      continue
    }

    if (isDarkMode()) {
      if (!DARK_CANVASES.has(canvas) && invertBackingPixels(canvas)) {
        DARK_CANVASES.add(canvas)
      }
    } else {
      restoreNativeLightPixels(canvas)
    }
  }
}

function scheduleNativeDarkPixels(canvas: HTMLCanvasElement) {
  if (PENDING_CANVASES.has(canvas)) return
  PENDING_CANVASES.add(canvas)

  queueMicrotask(() => {
    PENDING_CANVASES.delete(canvas)
    if (!canvas.isConnected || !isWorksheetCanvas(canvas)) return

    if (isDarkMode()) {
      if (!DARK_CANVASES.has(canvas) && invertBackingPixels(canvas)) {
        DARK_CANVASES.add(canvas)
      }
    } else {
      restoreNativeLightPixels(canvas)
    }
  })
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
      const manageDarkPixels = isWorksheetCanvas(canvas)
      if (manageDarkPixels) {
        WORKSHEET_CANVASES.add(canvas)
        // Fortune re-applies its integer CSS size on every container resize
        // (updateContextWithCanvas), so re-snap on every draw.
        snapCanvasCssSizeToBacking(canvas)
        restoreNativeLightPixels(canvas)
      }

      try {
        return original.apply(this, args)
      } finally {
        if (manageDarkPixels) scheduleNativeDarkPixels(canvas)
      }
    }
  }

  prototype[PATCH_FLAG] = true

  const themeObserver = new MutationObserver(syncWorksheetCanvasTheme)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
}

function installCrispDarkCellText() {
  const prototype = Canvas.prototype as unknown as Record<PropertyKey, unknown>
  if (prototype[TEXT_PATCH_FLAG]) return

  const original = prototype.cellTextRender as CanvasDrawMethod | undefined
  if (typeof original !== 'function') return

  prototype.cellTextRender = function patchedCellTextRender(
    this: Canvas,
    ...args: unknown[]
  ) {
    const canvas = this.canvasElement
    const context = args[1] as CanvasRenderingContext2D | undefined
    if (!context || !isWorksheetCanvas(canvas) || !isDarkMode()) {
      return original.apply(this, args)
    }

    const textInfo = args[0] as FortuneTextInfo | null | undefined
    const previousFillStyle = context.fillStyle
    const previousFillText = context.fillText
    const hadOwnFillText = Object.prototype.hasOwnProperty.call(context, 'fillText')
    const savedInlineColors: SavedInlineColor[] = []

    if (shouldSharpenDarkText(previousFillStyle)) {
      // The whole worksheet is inverted after Fortune finishes drawing, so
      // #0a becomes the same #f5 used by the sharp live cell editor.
      context.fillStyle = '#0a0a0a'
    }

    for (const word of textInfo?.values ?? []) {
      if (!word.inline || !word.style || typeof word.style === 'string') continue
      if (!shouldSharpenDarkText(word.style.fc)) continue
      savedInlineColors.push({
        style: word.style,
        hadOwnColor: Object.prototype.hasOwnProperty.call(word.style, 'fc'),
        color: word.style.fc,
      })
      word.style.fc = '#0a0a0a'
    }

    context.fillText = function crispDarkFillText(text, x, y, maxWidth) {
      const drawText = () => {
        if (maxWidth === undefined) previousFillText.call(context, text, x, y)
        else previousFillText.call(context, text, x, y, maxWidth)
      }

      drawText()
      if (
        typeof context.fillStyle !== 'string'
        || context.fillStyle.trim().toLowerCase() !== '#0a0a0a'
      ) return

      // Chromium Canvas uses grayscale antialiasing while the active cell
      // editor uses ClearType. Repeating at the identical position raises only
      // edge coverage, without changing glyph metrics or layout.
      for (let pass = 0; pass < CRISP_TEXT_EXTRA_PASSES; pass += 1) {
        drawText()
      }
    }

    try {
      return original.apply(this, args)
    } finally {
      context.fillStyle = previousFillStyle
      if (hadOwnFillText) context.fillText = previousFillText
      else delete (context as unknown as { fillText?: CanvasRenderingContext2D['fillText'] }).fillText
      for (const saved of savedInlineColors) {
        if (saved.hadOwnColor) saved.style.fc = saved.color
        else delete saved.style.fc
      }
    }
  }

  prototype[TEXT_PATCH_FLAG] = true
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
