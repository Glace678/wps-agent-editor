import {
  Canvas,
  defaultStyle,
  getFlowdata,
  locale,
} from '@fortune-sheet/core'
import type { Cell, Context } from '@fortune-sheet/core'
import {
  getSystemFontDisplayName,
  getSystemFontFamilyNames,
  normalizeSystemFontFamilyName,
  type SystemFontFace,
} from './system-fonts'

const PATCH_FLAG = Symbol.for('wps.fortune.worksheet-dark-defaults-v2')
const ACTIVE_CELL_PAINT = Symbol('wps.fortune.active-cell-paint')
const DRAW_METHODS = [
  'drawMain',
  'drawRowHeader',
  'drawColumnHeader',
  'drawFreezeLine',
] as const
const CELL_DRAW_METHODS = [
  { name: 'cellRender', contextIndex: 7, conditionalFormatIndex: 9 },
  { name: 'nullCellRender', contextIndex: 6, conditionalFormatIndex: 8 },
  { name: 'cellOverflowRender', contextIndex: 4, conditionalFormatIndex: 10 },
] as const
const FORTUNE_LANGUAGES = ['en', 'zh', 'es', 'ru', 'zh-TW', 'hi'] as const
const DARK_WORKSHEET_BACKGROUND = '#000000'
const DARK_WORKSHEET_TEXT = '#f5f5f5'
const DARK_WORKSHEET_GRID = '#2a2a2a'

type CanvasDrawMethod = (this: Canvas, ...args: unknown[]) => unknown
type ConditionalFormatStyle = {
  cellColor?: unknown
  textColor?: unknown
}
type ConditionalFormatMap = Record<string, ConditionalFormatStyle | undefined>
type CellPaintState = {
  useDarkDefaultBackground: boolean
  useDarkDefaultText: boolean
}
type PatchedCanvas = Canvas & {
  [ACTIVE_CELL_PAINT]?: CellPaintState[]
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

function isColor(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizedCanvasColor(value: CanvasRenderingContext2D['fillStyle']) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, '')
    : ''
}

function isWhiteCanvasColor(value: CanvasRenderingContext2D['fillStyle']) {
  const color = normalizedCanvasColor(value)
  return color === '#fff'
    || color === '#ffffff'
    || color === 'rgb(255,255,255)'
    || color === 'rgba(255,255,255,1)'
}

function isDefaultCanvasTextColor(value: CanvasRenderingContext2D['fillStyle']) {
  const color = normalizedCanvasColor(value)
  return color === '#000'
    || color === '#000000'
    || color === '#333'
    || color === '#333333'
    || color === 'black'
    || color === 'rgb(0,0,0)'
    || color === 'rgba(0,0,0,1)'
    || color === 'rgb(51,51,51)'
    || color === 'rgba(51,51,51,1)'
}

function isFortuneImplicitFontColor(value: unknown) {
  if (!isColor(value)) return true
  const color = value.trim().toLowerCase().replace(/\s+/g, '')
  // Fortune clones this value into newly typed cells even though the user did
  // not choose a font color. A user-picked #333333 remains explicit.
  return color === 'rgb(51,51,51)' || color === 'rgba(51,51,51,1)'
}

function getCellPaintState(
  canvas: Canvas,
  row: number,
  column: number,
  conditionalFormats: unknown,
): CellPaintState {
  const cell = getFlowdata(canvas.sheetCtx)?.[row]?.[column] as Cell | null | undefined
  const conditional = (
    conditionalFormats && typeof conditionalFormats === 'object'
      ? (conditionalFormats as ConditionalFormatMap)[`${row}_${column}`]
      : undefined
  )
  const hasAuthoredBackground = isColor(cell?.bg)
  const hasConditionalBackground = isColor(conditional?.cellColor)
  const useDarkDefaultBackground = !hasAuthoredBackground && !hasConditionalBackground
  const hasAuthoredText = !isFortuneImplicitFontColor(cell?.fc)
  const hasConditionalText = isColor(conditional?.textColor)

  return {
    useDarkDefaultBackground,
    useDarkDefaultText:
      useDarkDefaultBackground && !hasAuthoredText && !hasConditionalText,
  }
}

function withDarkCellPaint(
  canvas: PatchedCanvas,
  context: CanvasRenderingContext2D,
  state: CellPaintState,
  draw: () => unknown,
) {
  const stack = canvas[ACTIVE_CELL_PAINT] ?? []
  canvas[ACTIVE_CELL_PAINT] = stack
  stack.push(state)

  const hadOwnFillRect = Object.prototype.hasOwnProperty.call(context, 'fillRect')
  const hadOwnFillText = Object.prototype.hasOwnProperty.call(context, 'fillText')
  const originalFillRect = context.fillRect
  const originalFillText = context.fillText
  let paintsCellBackground = true

  context.fillRect = function darkDefaultCellFillRect(x, y, width, height) {
    if (!paintsCellBackground) {
      originalFillRect.call(context, x, y, width, height)
      return
    }

    paintsCellBackground = false
    if (!state.useDarkDefaultBackground) {
      originalFillRect.call(context, x, y, width, height)
      return
    }

    const previousFillStyle = context.fillStyle
    context.fillStyle = DARK_WORKSHEET_BACKGROUND
    try {
      originalFillRect.call(context, x, y, width, height)
    } finally {
      context.fillStyle = previousFillStyle
    }
  }

  // Some Fortune paths (dynamic arrays and checkbox validation) bypass
  // cellTextRender. Keep their implicit text readable too.
  context.fillText = function darkDefaultCellFillText(text, x, y, maxWidth) {
    const previousFillStyle = context.fillStyle
    const replaceDefault = state.useDarkDefaultText
      && isDefaultCanvasTextColor(previousFillStyle)
    if (replaceDefault) context.fillStyle = DARK_WORKSHEET_TEXT
    try {
      if (maxWidth === undefined) originalFillText.call(context, text, x, y)
      else originalFillText.call(context, text, x, y, maxWidth)
    } finally {
      if (replaceDefault) context.fillStyle = previousFillStyle
    }
  }

  try {
    return draw()
  } finally {
    stack.pop()
    if (stack.length === 0) delete canvas[ACTIVE_CELL_PAINT]
    if (hadOwnFillRect) context.fillRect = originalFillRect
    else delete (context as unknown as { fillRect?: CanvasRenderingContext2D['fillRect'] }).fillRect
    if (hadOwnFillText) context.fillText = originalFillText
    else delete (context as unknown as { fillText?: CanvasRenderingContext2D['fillText'] }).fillText
  }
}

function withDarkWorksheetBase(
  context: CanvasRenderingContext2D,
  draw: () => unknown,
) {
  const hadOwnFillRect = Object.prototype.hasOwnProperty.call(context, 'fillRect')
  const originalFillRect = context.fillRect
  const previousGridColor = defaultStyle.strokeStyle
  let paintsWorksheetBase = true

  defaultStyle.strokeStyle = DARK_WORKSHEET_GRID
  context.fillRect = function darkWorksheetBaseFillRect(x, y, width, height) {
    if (!paintsWorksheetBase) {
      originalFillRect.call(context, x, y, width, height)
      return
    }

    paintsWorksheetBase = false
    const previousFillStyle = context.fillStyle
    context.fillStyle = DARK_WORKSHEET_BACKGROUND
    try {
      originalFillRect.call(context, x, y, width, height)
    } finally {
      context.fillStyle = previousFillStyle
    }
  }

  try {
    return draw()
  } finally {
    defaultStyle.strokeStyle = previousGridColor
    if (hadOwnFillRect) context.fillRect = originalFillRect
    else delete (context as unknown as { fillRect?: CanvasRenderingContext2D['fillRect'] }).fillRect
  }
}

function withDarkWorksheetHeader(
  context: CanvasRenderingContext2D,
  draw: () => unknown,
) {
  const hadOwnFillRect = Object.prototype.hasOwnProperty.call(context, 'fillRect')
  const hadOwnFillText = Object.prototype.hasOwnProperty.call(context, 'fillText')
  const originalFillRect = context.fillRect
  const originalFillText = context.fillText
  const previousGridColor = defaultStyle.strokeStyle

  defaultStyle.strokeStyle = DARK_WORKSHEET_GRID
  context.fillRect = function darkWorksheetHeaderFillRect(x, y, width, height) {
    const previousFillStyle = context.fillStyle
    const replaceWhite = isWhiteCanvasColor(previousFillStyle)
    if (replaceWhite) context.fillStyle = DARK_WORKSHEET_BACKGROUND
    try {
      originalFillRect.call(context, x, y, width, height)
    } finally {
      if (replaceWhite) context.fillStyle = previousFillStyle
    }
  }
  context.fillText = function darkWorksheetHeaderFillText(text, x, y, maxWidth) {
    const previousFillStyle = context.fillStyle
    const replaceDefault = isDefaultCanvasTextColor(previousFillStyle)
    if (replaceDefault) context.fillStyle = DARK_WORKSHEET_TEXT
    try {
      if (maxWidth === undefined) originalFillText.call(context, text, x, y)
      else originalFillText.call(context, text, x, y, maxWidth)
    } finally {
      if (replaceDefault) context.fillStyle = previousFillStyle
    }
  }

  try {
    return draw()
  } finally {
    defaultStyle.strokeStyle = previousGridColor
    if (hadOwnFillRect) context.fillRect = originalFillRect
    else delete (context as unknown as { fillRect?: CanvasRenderingContext2D['fillRect'] }).fillRect
    if (hadOwnFillText) context.fillText = originalFillText
    else delete (context as unknown as { fillText?: CanvasRenderingContext2D['fillText'] }).fillText
  }
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

      if (!isWorksheetCanvas(canvas) || !isDarkMode()) {
        return original.apply(this, args)
      }

      const context = canvas.getContext('2d')
      if (!context) return original.apply(this, args)
      if (methodName === 'drawMain') {
        return withDarkWorksheetBase(context, () => original.apply(this, args))
      }
      if (methodName === 'drawRowHeader' || methodName === 'drawColumnHeader') {
        return withDarkWorksheetHeader(context, () => original.apply(this, args))
      }
      return original.apply(this, args)
    }
  }

  for (const { name, contextIndex, conditionalFormatIndex } of CELL_DRAW_METHODS) {
    const original = prototype[name] as CanvasDrawMethod | undefined
    if (typeof original !== 'function') continue

    prototype[name] = function patchedFortuneCellDraw(
      this: Canvas,
      ...args: unknown[]
    ) {
      if (!isWorksheetCanvas(this.canvasElement) || !isDarkMode()) {
        return original.apply(this, args)
      }

      const context = args[contextIndex] as CanvasRenderingContext2D | undefined
      const row = Number(args[0])
      const column = Number(args[1])
      if (!context || !Number.isInteger(row) || !Number.isInteger(column)) {
        return original.apply(this, args)
      }

      const state = getCellPaintState(
        this,
        row,
        column,
        args[conditionalFormatIndex],
      )
      return withDarkCellPaint(
        this as PatchedCanvas,
        context,
        state,
        () => original.apply(this, args),
      )
    }
  }

  const originalCellTextRender = prototype.cellTextRender as CanvasDrawMethod | undefined
  if (typeof originalCellTextRender === 'function') {
    prototype.cellTextRender = function patchedFortuneCellTextRender(
      this: Canvas,
      ...args: unknown[]
    ) {
      const context = args[1] as CanvasRenderingContext2D | undefined
      const stack = (this as PatchedCanvas)[ACTIVE_CELL_PAINT]
      const state = stack?.[stack.length - 1]
      if (!context || !state?.useDarkDefaultText) {
        return originalCellTextRender.apply(this, args)
      }

      const previousFillStyle = context.fillStyle
      if (isDefaultCanvasTextColor(previousFillStyle)) {
        context.fillStyle = DARK_WORKSHEET_TEXT
      }
      try {
        return originalCellTextRender.apply(this, args)
      } finally {
        context.fillStyle = previousFillStyle
      }
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
}
