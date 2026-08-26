import formulaJs from '@formulajs/formulajs'
import { Parser } from '@fortune-sheet/formula-parser'

type FormulaRuntime = Record<string, unknown> & {
  TEXT?: (value: unknown, format: unknown) => unknown
}

const PATCH_FLAG = Symbol.for('wps.formulajs.text-compatibility-v1')
const PARSER_PATCH_FLAG = Symbol.for('wps.formula-parser.compatibility-v1')

function unquoteFormatLiteral(value: string): string {
  return value
    .replace(/"([^"]*)"/g, '$1')
    .replace(/\\(.)/g, '$1')
    .replace(/_/g, '')
}

function excelSerialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000)
}

function formatDate(value: unknown, pattern: string): string | null {
  const normalized = pattern.toLocaleLowerCase()
  if (!/[ydhs]/.test(normalized) && !/(^|[^a])m{3,4}([^a]|$)/.test(normalized)) return null
  const date = value instanceof Date
    ? value
    : typeof value === 'number' && Number.isFinite(value)
      ? excelSerialToDate(value)
      : null
  if (!date || Number.isNaN(date.getTime())) return null

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const longMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const hours = date.getUTCHours()
  const hasAmPm = /am\/pm/i.test(pattern)
  const replacements: Array<[RegExp, string]> = [
    [/yyyy/gi, String(date.getUTCFullYear()).padStart(4, '0')],
    [/yy/gi, String(date.getUTCFullYear() % 100).padStart(2, '0')],
    [/dddd/gi, weekdays[date.getUTCDay()]],
    [/ddd/gi, weekdays[date.getUTCDay()].slice(0, 3)],
    [/dd/gi, String(date.getUTCDate()).padStart(2, '0')],
    [/d/gi, String(date.getUTCDate())],
    [/mmmm/gi, longMonths[date.getUTCMonth()]],
    [/mmm/gi, months[date.getUTCMonth()]],
    [/mm/gi, String(date.getUTCMonth() + 1).padStart(2, '0')],
    [/m/gi, String(date.getUTCMonth() + 1)],
    [/hh/gi, String(hasAmPm ? (hours % 12 || 12) : hours).padStart(2, '0')],
    [/h/gi, String(hasAmPm ? (hours % 12 || 12) : hours)],
    [/ss/gi, String(date.getUTCSeconds()).padStart(2, '0')],
    [/s/gi, String(date.getUTCSeconds())],
    [/am\/pm/gi, hours >= 12 ? 'PM' : 'AM'],
  ]
  let result = pattern
  for (const [token, replacement] of replacements) result = result.replace(token, replacement)
  return unquoteFormatLiteral(result)
}

function chooseNumberSection(value: number, format: string): { pattern: string; absolute: boolean } {
  const sections = format.split(';')
  if (value > 0 || sections.length === 1) return { pattern: sections[0], absolute: false }
  if (value < 0) return { pattern: sections[1] || sections[0], absolute: sections.length > 1 }
  return { pattern: sections[2] || sections[0], absolute: false }
}

function formatNumber(value: number, format: string): string {
  const { pattern, absolute } = chooseNumberSection(value, format)
  const placeholder = pattern.match(/[0#?,]+(?:\.[0#?]+)?/)
  if (!placeholder) return unquoteFormatLiteral(pattern)
  const numericPattern = placeholder[0]
  const percentCount = (pattern.match(/%/g) || []).length
  const decimalPattern = numericPattern.split('.')[1] || ''
  const minimumFractionDigits = (decimalPattern.match(/0/g) || []).length
  const maximumFractionDigits = decimalPattern.length
  const scaled = (absolute ? Math.abs(value) : value) * (100 ** percentCount)
  const formatted = scaled.toLocaleString('en-US', {
    useGrouping: numericPattern.includes(','),
    minimumFractionDigits,
    maximumFractionDigits,
  })
  const start = placeholder.index ?? 0
  return unquoteFormatLiteral(`${pattern.slice(0, start)}${formatted}${pattern.slice(start + numericPattern.length)}`)
}

function columnLabelToNumber(label: string): number {
  return [...label.toUpperCase()].reduce((value, character) => (
    value * 26 + character.charCodeAt(0) - 64
  ), 0)
}

function rewriteReferenceFunctions(formula: string): string {
  // The Formula.js ROW/COLUMN exports use statistical matrix semantics rather
  // than Excel reference semantics. Resolve direct A1 references before the
  // parser evaluates them and loses their coordinate metadata.
  const chunks = formula.split(/("(?:[^"]|"")*")/g)
  return chunks.map((chunk, index) => {
    if (index % 2 === 1) return chunk
    return chunk
      .replace(
        /\bROW\s*\(\s*(?:(?:'[^']+'|[A-Za-z0-9_]+)!)?\$?[A-Za-z]{1,3}\$?(\d+)(?::\$?[A-Za-z]{1,3}\$?\d+)?\s*\)/gi,
        (_match, row: string) => row,
      )
      .replace(
        /\bCOLUMN\s*\(\s*(?:(?:'[^']+'|[A-Za-z0-9_]+)!)?\$?([A-Za-z]{1,3})\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?\s*\)/gi,
        (_match, column: string) => String(columnLabelToNumber(column)),
      )
  }).join('')
}

function installParserCompatibility(): void {
  const prototype = Parser.prototype as typeof Parser.prototype & { [PARSER_PATCH_FLAG]?: boolean }
  if (prototype[PARSER_PATCH_FLAG]) return
  prototype[PARSER_PATCH_FLAG] = true
  const originalParse = prototype.parse
  prototype.parse = function patchedParse(
    this: Parser,
    formula: string,
    options?: Record<string, unknown>,
  ) {
    this.setFunction('TEXT', (parameters: unknown[]) => {
      const [value, format] = parameters
      if (typeof format !== 'string') throw new TypeError('TEXT format must be a string')
      const dateResult = formatDate(value, format)
      if (dateResult !== null) return dateResult
      const numericValue = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(numericValue)) throw new TypeError('TEXT value must be numeric or a date')
      return formatNumber(numericValue, format)
    })
    return originalParse.call(this, rewriteReferenceFunctions(formula), options)
  }
}

/**
 * Formula.js 2.9.3 exports TEXT but deliberately throws "not implemented".
 * Fortune Sheet therefore parses the name but produces #ERROR!. This focused
 * compatibility adapter fills that one advertised gap without replacing or
 * upgrading either formula engine.
 */
export function installFormulaCompatibility(): void {
  const runtime = formulaJs as unknown as FormulaRuntime & { [PATCH_FLAG]?: boolean }
  if (runtime[PATCH_FLAG]) return
  runtime[PATCH_FLAG] = true
  runtime.TEXT = (value: unknown, format: unknown) => {
    if (typeof format !== 'string') throw new TypeError('TEXT format must be a string')
    const dateResult = formatDate(value, format)
    if (dateResult !== null) return dateResult
    const numericValue = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(numericValue)) throw new TypeError('TEXT value must be numeric or a date')
    return formatNumber(numericValue, format)
  }
  installParserCompatibility()
}

installFormulaCompatibility()
