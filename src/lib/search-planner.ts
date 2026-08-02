import type { ExpandedQuery } from './intelligence'
import type { OperatorsResult } from './search-operators'
import type { SemanticIntentPlan } from './semantic-intent'
import type { LiveSearchSource, SearchPlan } from './search-settings'
import type { SearchLens } from '../types/search'

export type QueryPurpose = 'broad' | 'intent-core' | 'semantic' | 'ai-intent' | 'official' | 'document' | 'freshness' | 'portal'

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
  variantBudget: number
  taskBudget: number
}

const TARGETED_SOURCE_ORDER: LiveSearchSource[] = [
  'searxng',
  'bing',
  'duckduckgo',
  'brave',
  'mojeek',
  'yahoo',
  'google',
]
const DEFAULT_QUERY_VARIANTS = 7
const DEFAULT_LIVE_TASKS = 14

export function searchCandidateLimit(resultsPerPage: number): number {
  return Math.min(80, Math.max(40, resultsPerPage * 3))
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function semanticBudgets(intent?: SemanticIntentPlan): { variants: number; tasks: number } {
  if (!intent || intent.complexity === 'simple') {
    return { variants: DEFAULT_QUERY_VARIANTS, tasks: DEFAULT_LIVE_TASKS }
  }
  if (intent.complexity === 'moderate') return { variants: 9, tasks: 20 }
  return { variants: 12, tasks: 28 }
}

function addVariant(
  variants: QueryVariant[],
  seen: Set<string>,
  query: string | undefined,
  purpose: QueryPurpose,
  priority: number,
  maxVariants: number
) {
  const normalized = normalizeQuery(query || '')
  const key = normalized.toLowerCase()
  if (!normalized || seen.has(key) || variants.length >= maxVariants) return
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

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])\.(?=[a-z0-9])/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function protectedIntentQuery(
  query: string,
  operators: OperatorsResult,
  intent?: SemanticIntentPlan
): string | undefined {
  const hasExplicitOperators = operators.includedSites.length > 0
    || operators.excludedSites.length > 0
    || operators.fileTypes.length > 0
    || operators.inTitleTerms.length > 0
    || operators.inUrlTerms.length > 0
    || operators.exactPhrases.length > 0
    || operators.excludedTerms.length > 0

  if (hasExplicitOperators) return undefined

  const normalizedQuery = ` ${normalizeForMatch(query)} `
  const groups = intent?.conceptGroups?.filter(group => group.required) || []
  if (groups.length > 0) {
    const parts = groups.map(group => {
      const selected = group.terms.find(term =>
        normalizedQuery.includes(` ${normalizeForMatch(term)} `)
      ) || group.label
      const clean = normalizeQuery(selected).replaceAll('"', '')
      return clean.includes(' ') ? `"${clean}"` : clean
    }).filter(Boolean)
    return parts.length ? parts.join(' ') : undefined
  }

  const normalized = normalizeQuery(query).replaceAll('"', '')
  const wordCount = normalized.split(' ').filter(Boolean).length
  if (wordCount < 2 || wordCount > 8) return undefined
  return `"${normalized}"`
}

export function buildQueryVariants(
  query: string,
  lens: SearchLens,
  expanded: ExpandedQuery,
  operators: OperatorsResult,
  currentYear = new Date().getFullYear(),
  semanticIntent?: SemanticIntentPlan
): QueryVariant[] {
  const variants: QueryVariant[] = []
  const seen = new Set<string>()
  const explicitQuery = restoreExplicitOperators(query, operators)
  const budgets = semanticBudgets(semanticIntent)

  // For procurement lens, prioritize semantic intent variants over raw query
  // to prevent search engines from misinterpreting the query
  if (lens === 'procurement' && semanticIntent?.searchVariants && semanticIntent.searchVariants.length > 0) {
    for (const candidate of semanticIntent.searchVariants) {
      addVariant(variants, seen, candidate, 'ai-intent', 100, budgets.variants)
    }
  }

  // Every selected engine receives the user's complete sentence unchanged.
  addVariant(variants, seen, explicitQuery, 'broad', lens === 'procurement' ? 80 : 100, budgets.variants)
  // Protect the meaning-bearing groups rather than quoting an entire natural
  // language sentence. This preserves names, services, and geography without
  // asking an engine to match filler words such as “find me” verbatim.
  addVariant(
    variants,
    seen,
    protectedIntentQuery(query, operators, semanticIntent),
    'intent-core',
    96,
    budgets.variants
  )

  if (lens !== 'procurement') {
    for (const candidate of semanticIntent?.searchVariants || []) {
      addVariant(variants, seen, candidate, 'ai-intent', 92, budgets.variants)
    }
  }

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
  addVariant(variants, seen, semantic, 'semantic', 90, budgets.variants)

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
    addVariant(variants, seen, official, 'official', 85, budgets.variants)
  }
  if (['pdf', 'government', 'procurement', 'pricing', 'academic', 'financial'].includes(lens)) {
    addVariant(variants, seen, document, 'document', 80, budgets.variants)
  }
  if (lens === 'procurement' || lens === 'news') {
    addVariant(variants, seen, freshness, 'freshness', 75, budgets.variants)
  }
  if (lens === 'procurement') {
    addVariant(variants, seen, portal, 'portal', 70, budgets.variants)
  }

  for (const candidate of [...expanded.withOperators, ...expanded.expansions]) {
    addVariant(variants, seen, candidate, 'semantic', 50, budgets.variants)
  }

  return variants.sort((left, right) => right.priority - left.priority)
}

function orderedTargetedSources(selected: LiveSearchSource[]): LiveSearchSource[] {
  const selectedSet = new Set(selected)
  return TARGETED_SOURCE_ORDER.filter(source => selectedSet.has(source))
}

export function buildRetrievalTasks(
  variants: QueryVariant[],
  plan: SearchPlan,
  maxLiveTasks = DEFAULT_LIVE_TASKS
): RetrievalTask[] {
  if (variants.length === 0 || plan.liveSources.length === 0) return []

  const tasks: RetrievalTask[] = []
  const seen = new Set<string>()
  const addTask = (source: LiveSearchSource, variant: QueryVariant) => {
    if (tasks.length >= maxLiveTasks) return
    const key = `${source}:${variant.query.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    tasks.push({ source, query: variant.query, purpose: variant.purpose })
  }

  const broadVariants = variants
    .filter(variant => variant.purpose === 'broad' || variant.purpose === 'intent-core')
    .slice(0, 2)
  for (const variant of broadVariants) {
    for (const source of plan.liveSources) addTask(source, variant)
  }

  const targetedSources = orderedTargetedSources(plan.liveSources)
  const targetedVariants = variants.filter(
    variant => !broadVariants.includes(variant) && variant.purpose !== 'semantic'
  )
  for (const variant of targetedVariants) {
    const sources = variant.purpose === 'ai-intent'
      ? plan.liveSources
      : targetedSources.length > 1
        ? targetedSources.slice(0, 2)
        : targetedSources
    for (const source of sources) addTask(source, variant)
  }

  for (const variant of variants.filter(item => item.purpose === 'semantic' && !broadVariants.includes(item))) {
    const source = targetedSources[tasks.length % Math.max(1, targetedSources.length)]
    if (source) addTask(source, variant)
  }

  return tasks
}

export function buildSearchOrchestrationPlan(
  query: string,
  lens: SearchLens,
  expanded: ExpandedQuery,
  operators: OperatorsResult,
  plan: SearchPlan,
  currentYear = new Date().getFullYear(),
  semanticIntent?: SemanticIntentPlan
): SearchOrchestrationPlan {
  const budgets = semanticBudgets(semanticIntent)
  const variants = buildQueryVariants(query, lens, expanded, operators, currentYear, semanticIntent)
  return {
    variants,
    tasks: buildRetrievalTasks(variants, plan, budgets.tasks),
    variantBudget: budgets.variants,
    taskBudget: budgets.tasks,
  }
}
