import type { ProviderDefinition, ProviderModel } from '../types/provider'
import {
  getProviderSearchAliasBundle,
  getProviderSearchContextReplacements,
  getProviderSearchQueryReplacements,
  type ProviderSearchAliasTerm,
  type ProviderSearchLocale,
} from './provider-search-aliases'

const TEXT_WEIGHTS = {
  exact: 100,
  prefix: 76,
  contains: 52,
} as const

const ALIAS_WEIGHTS = {
  exact: 92,
  prefix: 70,
  contains: 48,
} as const

// Family aliases are deliberately weaker than a direct provider alias. This
// keeps first-party entries at the top while still collecting every gateway
// that exposes the same model family.
const FAMILY_WEIGHTS = {
  exact: 58,
  prefix: 44,
  contains: 30,
} as const

const MODEL_WEIGHTS = {
  exact: 64,
  prefix: 50,
  contains: 34,
} as const

const LOCALIZED_ALIAS_BONUS = 7

const QUERY_VARIANTS: Record<string, readonly string[]> = {
  qwen: ['qwen', 'tongyi', 'qianwen'],
  xiaomi: ['xiaomi', 'mimo'],
  tencent: ['tencent', 'hunyuan'],
  baidu: ['baidu', 'qianfan', 'ernie', 'wenxin'],
  doubao: ['doubao', 'seed'],
  deepseek: ['deepseek'],
  kimi: ['kimi', 'moonshot'],
  zhipu: ['zhipu', 'zai', 'glm', 'chatglm'],
  minimax: ['minimax'],
  stepfun: ['stepfun', 'step'],
  siliconflow: ['siliconflow'],
  modelscope: ['modelscope'],
  google: ['google', 'gemini', 'gemma', 'vertex'],
  azure: ['azure', 'microsoft'],
  amazon: ['amazon', 'aws', 'bedrock', 'nova'],
  meta: ['meta', 'llama'],
  openai: ['openai', 'gpt', 'codex'],
  anthropic: ['anthropic', 'claude'],
  mistral: ['mistral', 'mixtral', 'codestral', 'magistral'],
  cohere: ['cohere', 'command'],
  nvidia: ['nvidia', 'nemotron'],
  xai: ['xai', 'grok'],
  huggingface: ['huggingface'],
  perplexity: ['perplexity', 'sonar'],
}

interface IndexedText {
  readonly raw: string
  readonly normalized: string
  readonly compact: string
}

interface SearchWeights {
  readonly exact: number
  readonly prefix: number
  readonly contains: number
}

interface IndexedModel {
  readonly model: ProviderModel
  readonly text: IndexedText
}

interface QueryPart {
  readonly primary: IndexedText
  readonly variants: readonly IndexedText[]
}

export interface ProviderSearchIndexEntry {
  readonly provider: ProviderDefinition
  readonly position: number
  readonly providerText: readonly IndexedText[]
  readonly aliasText: readonly IndexedText[]
  readonly localizedAliasText: readonly IndexedText[]
  readonly familyText: readonly IndexedText[]
  readonly localizedFamilyText: readonly IndexedText[]
  readonly models: readonly IndexedModel[]
  readonly relevanceBoost: number
  readonly language: ProviderSearchLocale
}

export type ProviderSearchIndex = readonly ProviderSearchIndexEntry[]

export type ProviderSearchMatchKind = 'provider' | 'alias' | 'model'

export interface ProviderSearchResult {
  readonly provider: ProviderDefinition
  readonly score: number
  readonly matchKind: ProviderSearchMatchKind | null
  readonly matchedModels: readonly ProviderModel[]
}

export function normalizeProviderSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function indexText(value: string | undefined): IndexedText | null {
  if (!value?.trim()) return null
  const normalized = normalizeProviderSearchText(value)
  if (!normalized) return null
  return { raw: value, normalized, compact: normalized.replace(/\s+/g, '') }
}

function uniqueTexts(values: readonly (string | undefined)[]): readonly IndexedText[] {
  const seen = new Set<string>()
  const result: IndexedText[] = []
  for (const value of values) {
    const indexed = indexText(value)
    if (!indexed || seen.has(indexed.normalized)) continue
    seen.add(indexed.normalized)
    result.push(indexed)
  }
  return result
}

function uniqueAliasTexts(terms: readonly ProviderSearchAliasTerm[], language?: ProviderSearchLocale): readonly IndexedText[] {
  const values = terms
    .filter((term) => language === undefined || term.locale === undefined || term.locale === language)
    .map((term) => term.value)
  return uniqueTexts(values)
}

function replaceAliases(query: string, replacements: readonly { aliases: readonly string[]; canonical: string }[]): string {
  const ordered = replacements
    .flatMap(({ aliases, canonical }) => aliases.map((alias) => ({ alias: normalizeProviderSearchText(alias), canonical })))
    .filter(({ alias }) => alias.length > 0)
    .sort((left, right) => right.alias.length - left.alias.length)
  let result = query
  for (const { alias, canonical } of ordered) {
    // Latin aliases must match complete normalized tokens. Without the
    // boundary check, the context word "models" corrupts "modelscope" and
    // short aliases can match inside unrelated brand names.
    if (/^[a-z\d ]+$/i.test(alias)) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      result = result.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'g'), `$1${canonical}`)
    } else {
      result = result.split(alias).join(canonical)
    }
  }
  return result
}

function canonicalizeQuery(value: string): string {
  let query = normalizeProviderSearchText(value)
  if (!query) return ''
  const originalQuery = query

  query = replaceAliases(query, getProviderSearchQueryReplacements())
  query = replaceAliases(query, getProviderSearchContextReplacements())
  return query.replace(/\s+/g, ' ').trim() || originalQuery
}

function queryVariants(value: string): readonly IndexedText[] {
  const normalized = normalizeProviderSearchText(value)
  const values = QUERY_VARIANTS[normalized] ?? [normalized]
  return uniqueTexts(values)
}

function createQueryParts(queryValue: string): { full: QueryPart; parts: readonly QueryPart[] } {
  const fullPrimary = indexText(queryValue) as IndexedText
  const parts = queryValue
    .split(' ')
    .filter(Boolean)
    .map((part) => {
      const primary = indexText(part) as IndexedText
      return { primary, variants: queryVariants(part) }
    })
  return {
    full: { primary: fullPrimary, variants: queryVariants(queryValue) },
    parts,
  }
}

interface ScoreOptions {
  /**
   * Provider names such as "AI-ROUTER" or "302.AI" lose their separators
   * during normalization, so a fragment that spans the separator ("irouter",
   * "kuio") would never match. Provider identity text additionally allows
   * compact substring matching so any part of a display name stays reachable.
   */
  readonly allowCompactSubstring?: boolean
}

function scoreText(text: IndexedText, query: IndexedText, weights: SearchWeights, options?: ScoreOptions): number {
  if (text.normalized === query.normalized || text.compact === query.compact) return weights.exact
  if (text.normalized.startsWith(query.normalized) || text.compact.startsWith(query.compact)) return weights.prefix
  // Do not use compact substring matching here: joining word boundaries made
  // "MiMo" match "Kimi Modell" and produced many unrelated suggestions.
  if (text.normalized.includes(query.normalized)) return weights.contains
  if (options?.allowCompactSubstring && text.compact.includes(query.compact)) return weights.contains
  return 0
}

function bestTextScore(
  fields: readonly IndexedText[],
  queries: readonly IndexedText[],
  weights: SearchWeights,
  options?: ScoreOptions,
): { score: number; field: IndexedText | null } {
  let score = 0
  let field: IndexedText | null = null
  for (const candidate of fields) {
    for (const query of queries) {
      const candidateScore = scoreText(candidate, query, weights, options)
      if (candidateScore > score) {
        score = candidateScore
        field = candidate
      }
    }
  }
  return { score, field }
}

function localizedScore(
  allFields: readonly IndexedText[],
  localizedFields: readonly IndexedText[],
  queries: readonly IndexedText[],
  weights: SearchWeights,
): { score: number; field: IndexedText | null } {
  const all = bestTextScore(allFields, queries, weights)
  const localized = bestTextScore(localizedFields, queries, weights)
  if (localized.score > 0 && localized.score + LOCALIZED_ALIAS_BONUS > all.score) {
    return { score: localized.score + LOCALIZED_ALIAS_BONUS, field: localized.field }
  }
  return all
}

function providerModelScore(
  entry: ProviderSearchIndexEntry,
  queries: readonly IndexedText[],
): { score: number; models: readonly ProviderModel[] } {
  const matches = entry.models
    .map(({ model, text }) => ({
      model,
      score: Math.max(...queries.map((query) => scoreText(text, query, MODEL_WEIGHTS))),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.model.id.localeCompare(right.model.id))
  return {
    score: matches[0]?.score ?? 0,
    models: matches.map(({ model }) => model),
  }
}

function rankedMatchedModels(
  entry: ProviderSearchIndexEntry,
  fullQueries: readonly IndexedText[],
  queryParts: readonly QueryPart[],
): readonly ProviderModel[] {
  const matches = entry.models
    .map(({ model, text }, position) => {
      const fullScore = Math.max(...fullQueries.map((query) => scoreText(text, query, MODEL_WEIGHTS)))
      const partScores = queryParts.map((part) => Math.max(...part.variants.map((query) => scoreText(text, query, MODEL_WEIGHTS))))
      return {
        model,
        position,
        fullScore,
        matchingParts: partScores.filter((score) => score > 0).length,
        score: fullScore * 4 + partScores.reduce((sum, partScore) => sum + partScore, 0),
      }
    })
    .filter(({ fullScore, matchingParts }) => fullScore > 0 || matchingParts > 0)

  const fullMatches = matches.filter(({ fullScore }) => fullScore > 0)
  const maxMatchingParts = matches.reduce((maximum, match) => Math.max(maximum, match.matchingParts), 0)
  const relevantMatches = fullMatches.length > 0
    ? fullMatches
    : matches.filter(({ matchingParts }) => matchingParts === maxMatchingParts)

  return relevantMatches
    .sort((left, right) => right.score - left.score || left.position - right.position)
    .map(({ model }) => model)
}

export function createProviderSearchIndex(
  providers: readonly ProviderDefinition[],
  language: ProviderSearchLocale = 'zh-CN',
): ProviderSearchIndex {
  return providers.map((provider, position) => {
    const bundle = getProviderSearchAliasBundle(provider)
    return {
      provider,
      position,
      providerText: uniqueTexts([provider.name, provider.id]),
      aliasText: uniqueAliasTexts(bundle.provider),
      localizedAliasText: uniqueAliasTexts(bundle.provider, language),
      familyText: uniqueAliasTexts(bundle.family),
      localizedFamilyText: uniqueAliasTexts(bundle.family, language),
      models: (provider.models ?? [])
        .map((model) => {
          const text = indexText(`${model.id} ${model.name}`)
          return text ? { model, text } : null
        })
        .filter((entry): entry is IndexedModel => entry !== null),
      relevanceBoost: bundle.relevanceBoost,
      language,
    }
  })
}

/**
 * "provider-names" (default) decides inclusion purely through provider
 * identity — display name, id, and curated provider aliases. Hosting a
 * matching model no longer surfaces unrelated gateways. Model pickers that
 * must find entries by model name opt into "provider-names-and-models".
 */
export type ProviderSearchScope = 'provider-names' | 'provider-names-and-models'

export interface ProviderSearchOptions {
  readonly scope?: ProviderSearchScope
}

const NO_FIELD_SCORE: { score: number; field: IndexedText | null } = { score: 0, field: null }
const NO_MODEL_SCORE: { score: number; models: readonly ProviderModel[] } = { score: 0, models: [] }

export function searchProviderIndex(
  index: ProviderSearchIndex,
  rawQuery: string,
  options?: ProviderSearchOptions,
): ProviderSearchResult[] {
  const includeModelMatches = options?.scope === 'provider-names-and-models'
  const queryValue = canonicalizeQuery(rawQuery)
  if (!queryValue) {
    return index.map(({ provider }) => ({
      provider,
      score: 0,
      matchKind: null,
      matchedModels: [],
    }))
  }

  const { full, parts } = createQueryParts(queryValue)
  const results: Array<ProviderSearchResult & { position: number }> = []

  for (const entry of index) {
    const directFull = bestTextScore(entry.providerText, full.variants, TEXT_WEIGHTS, { allowCompactSubstring: true })
    const aliasFull = localizedScore(entry.aliasText, entry.localizedAliasText, full.variants, ALIAS_WEIGHTS)
    const familyFull = includeModelMatches
      ? localizedScore(entry.familyText, entry.localizedFamilyText, full.variants, FAMILY_WEIGHTS)
      : NO_FIELD_SCORE
    const modelFull = includeModelMatches
      ? providerModelScore(entry, full.variants)
      : NO_MODEL_SCORE
    let tokenScore = 0
    let bestKind: ProviderSearchMatchKind | null = null
    let bestKindScore = 0
    let allPartsMatch = true
    let providerMatchedParts = 0

    for (const part of parts) {
      const direct = bestTextScore(entry.providerText, part.variants, TEXT_WEIGHTS, { allowCompactSubstring: true })
      const alias = localizedScore(entry.aliasText, entry.localizedAliasText, part.variants, ALIAS_WEIGHTS)
      const family = includeModelMatches
        ? localizedScore(entry.familyText, entry.localizedFamilyText, part.variants, FAMILY_WEIGHTS)
        : NO_FIELD_SCORE
      const model = includeModelMatches
        ? providerModelScore(entry, part.variants)
        : NO_MODEL_SCORE
      const partScore = Math.max(direct.score, alias.score, family.score, model.score)
      if (!partScore) {
        allPartsMatch = false
        break
      }
      tokenScore += partScore
      if (direct.score > 0 || alias.score > 0) providerMatchedParts += 1
      if (direct.score >= bestKindScore) {
        bestKind = 'provider'
        bestKindScore = direct.score
      }
      if (alias.score > bestKindScore) {
        bestKind = 'alias'
        bestKindScore = alias.score
      }
      if (family.score > bestKindScore) {
        bestKind = 'alias'
        bestKindScore = family.score
      }
      if (model.score > bestKindScore) {
        bestKind = 'model'
        bestKindScore = model.score
      }
    }
    if (!allPartsMatch) continue

    const strongestFull = Math.max(directFull.score, aliasFull.score, familyFull.score, modelFull.score)
    if (!strongestFull && !tokenScore) continue
    if (directFull.score >= aliasFull.score && directFull.score >= familyFull.score && directFull.score >= modelFull.score && directFull.score > 0) bestKind = 'provider'
    else if (aliasFull.score >= familyFull.score && aliasFull.score >= modelFull.score && aliasFull.score > 0) bestKind = 'alias'
    else if (familyFull.score >= modelFull.score && familyFull.score > 0) bestKind = 'alias'
    else if (modelFull.score > 0) bestKind = 'model'

    const hasDirectProviderMatch = directFull.score > 0 || aliasFull.score > 0 || providerMatchedParts > 0
    const providerCoverageBonus = providerMatchedParts === parts.length
      ? providerMatchedParts * 45
      : 0

    results.push({
      provider: entry.provider,
      score: strongestFull * 4
        + tokenScore
        + providerCoverageBonus
        + (hasDirectProviderMatch ? entry.relevanceBoost : 0),
      matchKind: bestKind,
      matchedModels: rankedMatchedModels(entry, full.variants, parts),
      position: entry.position,
    })
  }

  return results
    .sort((left, right) => right.score - left.score || left.position - right.position)
    .map(({ position: _position, ...result }) => result)
}

export function searchProviders(
  providers: readonly ProviderDefinition[],
  query: string,
  language: ProviderSearchLocale = 'zh-CN',
  options?: ProviderSearchOptions,
): ProviderSearchResult[] {
  return searchProviderIndex(createProviderSearchIndex(providers, language), query, options)
}

export function normalizeProviderSearchQuery(query: string): string {
  return canonicalizeQuery(query)
}
