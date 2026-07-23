import type { ExpandedQuery } from './intelligence'
import type { OperatorsResult } from './search-operators'
import type { LiveSearchSource, SearchPlan } from './search-settings'
import type { SearchLens } from '../types/search'

export type QueryPurpose = 'broad' | 'semantic' | 'official' | 'document' | 'freshness' | 'portal'

export interface QueryVariant {
  query: string
  purpose: QueryPurpose
  priority: number
}

export interface RetrievalTask {
  source: LiveSearchSource
  query: string
  purpose: QueryPurpose
}

export interface SearchOrchestrationPlan {
  variants: QueryVariant[]
  tasks: RetrievalTask[]
}

const TARGETED_SOURCE_ORDER: LiveSearchSource[] = ['searxng', 'bing', 'duckduckgo', 'google']
const MAX_QUERY_VARIANTS = 6
const MAX_LIVE_TASKS = 14

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function addVariant(
  variants: QueryVariant[],
  seen: Set<string>,
  query: string | undefined,
  purpose: QueryPurpose,
  priority: number
) {
  const normalized = normalizeQuery(query || '')
  const key = normalized.toLowerCase()
  if (!normalized || seen.has(key) || variants.length >= MAX_QUERY_VARIANTS) return
  seen.add(key)
  variants.push({ query: normalized, purpose, priority })
}

function findFirst(values: string[], pattern: RegExp): string | undefined {
  return values.find(value => pattern.test(value))
}

function restoreExplicitOperators(query: string, operators: OperatorsResult): string {
  const pieces = [query]
  for (const site of operators.includedSites) pieces.push(`site:${site}`)
  for (const site of operators.excludedSites) pieces.push(`-site:${site}`)
  for (const fileType of operators.fileTypes) pieces.push(`filetype:${fileType}`)
  for (const term of operators.inTitleTerms) pieces.push(`intitle:${term}`)
  for (const term of operators.inUrlTerms) pieces.push(`inurl:${term}`)
  for (const phrase of operators.exactPhrases) pieces.push(`"${phrase}"`)
  for (const term of operators.excludedTerms) pieces.push(`-${term}`)
  return normalizeQuery(pieces.join(' '))
}

export function buildQueryVariants(
  query: string,
  lens: SearchLens,
  expanded: ExpandedQuery,
  operators: OperatorsResult,
  currentYear = new Date().getFullYear()
): QueryVariant[] {
  const variants: QueryVariant[] = []
  const seen = new Set<string>()
  const explicitQuery = restoreExplicitOperators(query, operators)

  addVariant(variants, seen, explicitQuery, 'broad', 100)

  const semantic = findFirst(
    expanded.expansions,
    lens === 'procurement'
      ? /\b(rfp|rfq|solicitation|bid|tender|procurement)\b/i
      : lens === 'pricing'
        ? /fee schedule|pricing|cash pay|self-pay|cost|rate/i
        : lens === 'provider'
          ? /clinic|provider|occupational medicine|services offered/i
          : /information|overview|research|report|guide|official/i
  ) || expanded.expansions[0]
  addVariant(variants, seen, semantic, 'semantic', 90)

  const official = findFirst(expanded.withOperators, /site:\.(?:gov|us)\b/i)
    || findFirst(expanded.expansions, /site:\.(?:gov|us)\b/i)
  const document = findFirst(expanded.withOperators, /filetype:pdf/i)
    || findFirst(expanded.expansions, /filetype:pdf|\bpdf\b/i)
  const freshness = findFirst(
    expanded.expansions,
    new RegExp(`(?:${currentYear}.*(?:open|active|due|closing)|(?:open|active|due|closing).*${currentYear})`, 'i')
  ) || findFirst(expanded.expansions, /currently open|responses due|submission deadline|closing date/i)
  const portal = findFirst(
    expanded.withOperators,
    /site:(?:sam\.gov|ionwave\.net|bonfirehub\.com|planetbids\.com|bidnetdirect\.com)/i
  ) || findFirst(
    expanded.expansions,
    /site:(?:sam\.gov|ionwave\.net|bonfirehub\.com|planetbids\.com|bidnetdirect\.com)/i
  )

  if (['government', 'procurement', 'legal', 'medical', 'academic'].includes(lens)) {
    addVariant(variants, seen, official, 'official', 85)
  }
  if (['pdf', 'government', 'procurement', 'pricing', 'academic', 'financial'].includes(lens)) {
    addVariant(variants, seen, document, 'document', 80)
  }
  if (lens === 'procurement' || lens === 'news') {
    addVariant(variants, seen, freshness, 'freshness', 75)
  }
  if (lens === 'procurement') {
    addVariant(variants, seen, portal, 'portal', 70)
  }

  for (const candidate of [...expanded.withOperators, ...expanded.expansions]) {
    addVariant(variants, seen, candidate, 'semantic', 50)
  }

  return variants.sort((left, right) => right.priority - left.priority)
}

function orderedTargetedSources(selected: LiveSearchSource[]): LiveSearchSource[] {
  const selectedSet = new Set(selected)
  return TARGETED_SOURCE_ORDER.filter(source => selectedSet.has(source))
}

export function buildRetrievalTasks(variants: QueryVariant[], plan: SearchPlan): RetrievalTask[] {
  if (variants.length === 0 || plan.liveSources.length === 0) return []

  const tasks: RetrievalTask[] = []
  const seen = new Set<string>()
  const addTask = (source: LiveSearchSource, variant: QueryVariant) => {
    if (tasks.length >= MAX_LIVE_TASKS) return
    const key = `${source}:${variant.query.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    tasks.push({ source, query: variant.query, purpose: variant.purpose })
  }

  const broadVariants = variants.filter(variant => variant.purpose === 'broad' || variant.purpose === 'semantic').slice(0, 2)
  for (const variant of broadVariants) {
    for (const source of plan.liveSources) addTask(source, variant)
  }

  const targetedSources = orderedTargetedSources(plan.liveSources)
  const targetedVariants = variants.filter(variant => !broadVariants.includes(variant))
  for (const variant of targetedVariants) {
    const sources = targetedSources.length > 1 ? targetedSources.slice(0, 2) : targetedSources
    for (const source of sources) addTask(source, variant)
  }

  return tasks
}

export function buildSearchOrchestrationPlan(
  query: string,
  lens: SearchLens,
  expanded: ExpandedQuery,
  operators: OperatorsResult,
  plan: SearchPlan,
  currentYear = new Date().getFullYear()
): SearchOrchestrationPlan {
  const variants = buildQueryVariants(query, lens, expanded, operators, currentYear)
  return {
    variants,
    tasks: buildRetrievalTasks(variants, plan),
  }
}
