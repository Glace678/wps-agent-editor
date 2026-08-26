import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import { locale, type Context } from '@fortune-sheet/core'
import {
  EXCEL_FUNCTION_CATALOG,
  getExcelFunction,
  type ExcelFunctionCategory,
} from '@/lib/excel-functions/catalog'
import type { LanguageCode } from '@/lib/i18n/types'

interface ExcelFunctionSuggestionsProps {
  shellRef: RefObject<HTMLDivElement>
  language: LanguageCode
}

interface SuggestionPosition {
  left: number
  top: number
  width: number
}

interface FormulaQuery {
  input: HTMLElement
  query: string
  start: number
  end: number
}

interface FunctionSuggestion {
  name: string
  category: string
  summary: string
  syntax: string
  example?: string
  parameters: readonly string[]
  verified: boolean
}

const COPY: Record<LanguageCode, {
  verified: string
  unverified: string
  parameters: string
  example: string
  noResults: string
}> = {
  'zh-CN': { verified: '已验证', unverified: '未验证', parameters: '参数', example: '示例', noResults: '没有匹配的函数' },
  en: { verified: 'Verified', unverified: 'Unverified', parameters: 'Parameters', example: 'Example', noResults: 'No matching functions' },
  ja: { verified: '検証済み', unverified: '未検証', parameters: '引数', example: '例', noResults: '一致する関数がありません' },
  es: { verified: 'Verificada', unverified: 'Sin verificar', parameters: 'Parámetros', example: 'Ejemplo', noResults: 'No hay funciones coincidentes' },
  pt: { verified: 'Verificada', unverified: 'Não verificada', parameters: 'Parâmetros', example: 'Exemplo', noResults: 'Nenhuma função correspondente' },
  de: { verified: 'Verifiziert', unverified: 'Nicht verifiziert', parameters: 'Parameter', example: 'Beispiel', noResults: 'Keine passenden Funktionen' },
  fr: { verified: 'Vérifiée', unverified: 'Non vérifiée', parameters: 'Paramètres', example: 'Exemple', noResults: 'Aucune fonction correspondante' },
  ru: { verified: 'Проверено', unverified: 'Не проверено', parameters: 'Параметры', example: 'Пример', noResults: 'Подходящие функции не найдены' },
  ar: { verified: 'تم التحقق', unverified: 'غير متحقق', parameters: 'المعلمات', example: 'مثال', noResults: 'لا توجد دوال مطابقة' },
}

const FORMULA_INPUT_SELECTOR = '#luckysheet-functionbox-cell'
const QUERY_BOUNDARIES = '=+-*/^&,(;<>'
const MAX_SUGGESTIONS = 12

function getCaretOffset(input: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection?.anchorNode || !input.contains(selection.anchorNode)) {
    return input.textContent?.length ?? 0
  }
  const range = document.createRange()
  range.selectNodeContents(input)
  try {
    range.setEnd(selection.anchorNode, selection.anchorOffset)
    return range.toString().length
  } catch {
    return input.textContent?.length ?? 0
  }
}

function extractFormulaQuery(input: HTMLElement): FormulaQuery | null {
  const text = input.textContent ?? ''
  const caret = getCaretOffset(input)
  const beforeCaret = text.slice(0, caret)
  if (!beforeCaret.trimStart().startsWith('=')) return null

  let boundary = -1
  let inDoubleQuote = false
  let inSingleQuote = false
  for (let index = 0; index < beforeCaret.length; index += 1) {
    const character = beforeCaret[index]
    if (character === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote
    if (character === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote
    if (!inDoubleQuote && !inSingleQuote && QUERY_BOUNDARIES.includes(character)) boundary = index
  }
  if (inDoubleQuote || inSingleQuote) return null

  const segment = beforeCaret.slice(boundary + 1)
  const leadingSpace = segment.length - segment.trimStart().length
  const query = segment.trim()
  if (!query || query.length > 80) return null
  if (!/^[\p{L}][\p{L}\p{N}_.\s&-]*$/u.test(query)) return null
  return {
    input,
    query,
    start: boundary + 1 + leadingSpace,
    end: caret,
  }
}

function positionForInput(shell: HTMLElement, input: HTMLElement): SuggestionPosition {
  const shellRect = shell.getBoundingClientRect()
  const inputRect = input.getBoundingClientRect()
  const availableWidth = Math.max(280, shellRect.width - 16)
  const width = Math.min(720, availableWidth)
  return {
    left: Math.max(8, Math.min(inputRect.left - shellRect.left, shellRect.width - width - 8)),
    top: inputRect.bottom - shellRect.top + 4,
    width,
  }
}

function buildFunctionCatalog(language: LanguageCode): FunctionSuggestion[] {
  // English is the canonical formula-name locale. Other Fortune locales may
  // translate function identifiers, which would make saved formulas non-portable.
  const fortuneFunctions = locale({ lang: 'en' } as Context).functionlist
  const merged = new Map<string, FunctionSuggestion>()
  for (const definition of fortuneFunctions) {
    const name = definition.n.toUpperCase()
    const parameters = definition.p?.map((parameter) => parameter.name) ?? []
    merged.set(name, {
      name,
      category: 'Fortune Sheet',
      summary: definition.d || definition.a || name,
      syntax: `${name}(${parameters.join(', ')})`,
      example: definition.p?.some((parameter) => parameter.example)
        ? `${name}(${definition.p.map((parameter) => parameter.example || parameter.name).join(', ')})`
        : undefined,
      parameters,
      verified: false,
    })
  }
  for (const definition of EXCEL_FUNCTION_CATALOG) {
    const localized = getExcelFunction(definition.name, language)!
    merged.set(definition.name, {
      name: definition.name,
      category: localized.categoryLabel,
      summary: localized.summary,
      syntax: definition.syntax,
      example: definition.example,
      parameters: definition.parameters,
      verified: true,
    })
  }
  return [...merged.values()]
}

function containsCharactersInOrder(value: string, query: string): boolean {
  let queryIndex = 0
  for (const character of value) {
    if (character === query[queryIndex]) queryIndex += 1
    if (queryIndex === query.length) return true
  }
  return false
}

function suggestionScore(suggestion: FunctionSuggestion, query: string): number | null {
  const normalized = query.toLocaleLowerCase()
  const name = suggestion.name.toLocaleLowerCase()
  const category = suggestion.category.toLocaleLowerCase()
  const summary = suggestion.summary.toLocaleLowerCase()
  const syntax = suggestion.syntax.toLocaleLowerCase()
  let score: number | null = null
  if (name === normalized) score = 0
  else if (name.startsWith(normalized)) score = 10
  else if (name.includes(normalized)) score = 20
  else if (category.includes(normalized)) score = 30
  else if (summary.includes(normalized)) score = 40
  else if (containsCharactersInOrder(summary, normalized)) score = 45
  else if (syntax.includes(normalized)) score = 50
  if (score === null) return null
  return score + (suggestion.verified ? 0 : 5)
}

function replaceFormulaQuery(query: FormulaQuery, functionName: string): void {
  const text = query.input.textContent ?? ''
  const insertion = `${functionName}(`
  const nextText = `${text.slice(0, query.start)}${insertion}${text.slice(query.end)}`
  query.input.textContent = nextText
  query.input.focus({ preventScroll: true })
  const selection = window.getSelection()
  const range = document.createRange()
  const textNode = query.input.firstChild ?? query.input.appendChild(document.createTextNode(''))
  const caret = query.start + insertion.length
  range.setStart(textNode, Math.min(caret, textNode.textContent?.length ?? 0))
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)
  query.input.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: insertion,
  }))
}

export function ExcelFunctionSuggestions({
  shellRef,
  language,
}: ExcelFunctionSuggestionsProps) {
  const [formulaQuery, setFormulaQuery] = useState<FormulaQuery | null>(null)
  const [position, setPosition] = useState<SuggestionPosition | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const catalog = useMemo(() => buildFunctionCatalog(language), [language])
  const copy = COPY[language]

  const suggestions = useMemo(() => {
    if (!formulaQuery) return []
    return catalog
      .map((suggestion) => ({ suggestion, score: suggestionScore(suggestion, formulaQuery.query) }))
      .filter((candidate): candidate is { suggestion: FunctionSuggestion; score: number } => candidate.score !== null)
      .sort((left, right) => left.score - right.score || left.suggestion.name.localeCompare(right.suggestion.name))
      .slice(0, MAX_SUGGESTIONS)
      .map((candidate) => candidate.suggestion)
  }, [catalog, formulaQuery])

  const close = () => {
    setFormulaQuery(null)
    setPosition(null)
    setActiveIndex(0)
  }

  const refresh = (input: HTMLElement) => {
    const shell = shellRef.current
    if (!shell) return
    const nextQuery = extractFormulaQuery(input)
    if (!nextQuery) {
      close()
      return
    }
    setFormulaQuery(nextQuery)
    setPosition(positionForInput(shell, input))
    setActiveIndex(0)
  }

  const selectSuggestion = (suggestion: FunctionSuggestion) => {
    if (!formulaQuery) return
    replaceFormulaQuery(formulaQuery, suggestion.name)
    close()
  }

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    const handleFormulaEvent = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const input = target.closest<HTMLElement>(FORMULA_INPUT_SELECTOR)
      if (input && shell.contains(input)) refresh(input)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest(FORMULA_INPUT_SELECTOR)) return
      if (!formulaQuery) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        close()
        return
      }
      if (suggestions.length === 0) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopImmediatePropagation()
        const offset = event.key === 'ArrowDown' ? 1 : -1
        setActiveIndex((index) => (index + offset + suggestions.length) % suggestions.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        event.stopImmediatePropagation()
        selectSuggestion(suggestions[Math.min(activeIndex, suggestions.length - 1)])
      }
    }
    const handleFocusOut = (event: FocusEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(FORMULA_INPUT_SELECTOR)) return
      window.setTimeout(() => {
        if (!shell.querySelector('.excel-function-suggestions:hover')) close()
      }, 0)
    }
    const handleResize = () => {
      if (formulaQuery) setPosition(positionForInput(shell, formulaQuery.input))
    }
    shell.addEventListener('input', handleFormulaEvent, true)
    shell.addEventListener('click', handleFormulaEvent, true)
    shell.addEventListener('focusin', handleFormulaEvent, true)
    shell.addEventListener('keydown', handleKeyDown, true)
    shell.addEventListener('focusout', handleFocusOut, true)
    window.addEventListener('resize', handleResize)
    return () => {
      shell.removeEventListener('input', handleFormulaEvent, true)
      shell.removeEventListener('click', handleFormulaEvent, true)
      shell.removeEventListener('focusin', handleFormulaEvent, true)
      shell.removeEventListener('keydown', handleKeyDown, true)
      shell.removeEventListener('focusout', handleFocusOut, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [activeIndex, formulaQuery, shellRef, suggestions])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    shell.classList.toggle('excel-function-suggestions-open', Boolean(formulaQuery))
    return () => shell.classList.remove('excel-function-suggestions-open')
  }, [formulaQuery, shellRef])

  if (!formulaQuery || !position) return null
  const active = suggestions[Math.min(activeIndex, Math.max(0, suggestions.length - 1))]

  return (
    <div
      className="excel-function-suggestions"
      data-testid="excel-function-suggestions"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
      style={position}
      onKeyDown={(event: ReactKeyboardEvent) => event.stopPropagation()}
      role="dialog"
      aria-label="Excel functions"
    >
      {suggestions.length === 0 ? (
        <div className="excel-function-suggestions-empty">{copy.noResults}</div>
      ) : (
        <>
          <div className="excel-function-suggestions-list" role="listbox">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.name}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? 'is-active' : undefined}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSuggestion(suggestion)}
              >
                <span className="excel-function-suggestion-name">{suggestion.name}</span>
                <span className={suggestion.verified ? 'is-verified' : 'is-unverified'}>
                  {suggestion.verified ? copy.verified : copy.unverified}
                </span>
                <span className="excel-function-suggestion-category">{suggestion.category}</span>
              </button>
            ))}
          </div>
          {active && (
            <div className="excel-function-suggestion-details" aria-live="polite">
              <div className="excel-function-suggestion-details-title">{active.name}</div>
              <div className="excel-function-suggestion-summary">{active.summary}</div>
              <code>{active.syntax}</code>
              {active.parameters.length > 0 && (
                <div><strong>{copy.parameters}:</strong> {active.parameters.join(', ')}</div>
              )}
              {active.example && (
                <div><strong>{copy.example}:</strong> <code>{active.example}</code></div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
