import type { ExpandedQuery } from './intelligence'
import { buildProcurementRescueQueries } from './procurement-rescue-queries'
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
  const procurementQueries = lens === 'procurement'
    ? buildProcurementRescueQueries(query, semanticIntent)
    : []

  // Protect the literal request and its meaning-bearing core before any rescue
  // expansion. Previous procurement logic filled the entire variant budget with
  // operator-heavy site queries, making these two foundational strategies
  // unreachable.
  addVariant(variants, seen, explicitQuery, 'broad', 100, budgets.variants)
  addVariant(
    variants,
    seen,
    protectedIntentQuery(query, operators, semanticIntent),
    'intent-core',
    98,
    budgets.variants
  )

  if (lens === 'procurement') {
    // buildProcurementRescueQueries guarantees slot 1 is the buyer-language
    // capability-family expansion. Reserve a planner slot for it rather than
    // broadcasting every rescue query through every engine.
    addVariant(variants, seen, procurementQueries[1], 'ai-intent', 96, budgets.variants)
  } else {
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

  const official = findFirst(expanded.withOperators, /site:\.(?:gov|us)\b/i)
    || findFirst(expanded.expansions, /site:\.(?:gov|us)\b/i)
    || findFirst(procurementQueries, /site:\.gov\b/i)
  const document = findFirst(expanded.withOperators, /filetype:pdf/i)
    || findFirst(expanded.expansions, /filetype:pdf|\bpdf\b/i)
    || findFirst(procurementQueries, /filetype:pdf/i)
  const freshness = findFirst(
    expanded.expansions,
    new RegExp(`(?:${currentYear}.*(?:open|active|due|closing)|(?:open|active|due|closing).*${currentYear})`, 'i')
  ) || findFirst(expanded.expansions, /currently open|responses due|submission deadline|closing date/i)
    || findFirst(procurementQueries, new RegExp(`\\b${currentYear}\\b`, 'i'))
  const portal = findFirst(
    expanded.withOperators,
    /site:(?:sam\.gov|ionwave\.net|bonfirehub\.com|planetbids\.com|bidnetdirect\.com)/i
  ) || findFirst(
    expanded.expansions,
    /site:(?:sam\.gov|ionwave\.net|bonfirehub\.com|planetbids\.com|bidnetdirect\.com)/i
  ) || findFirst(
    procurementQueries,
    /site:(?:sam\.gov|ionwave\.net|bonfirehub\.com|planetbids\.com|bidnetdirect\.com)/i
  )

  if (lens === 'procurement') {
    // These four complementary strategies are more valuable than another
    // synonym-only variant, so reserve them before the seven-slot simple-query
    // budget can be exhausted.
    addVariant(variants, seen, official, 'official', 94, budgets.variants)
    addVariant(variants, seen, document, 'document', 92, budgets.variants)
    addVariant(variants, seen, freshness, 'freshness', 90, budgets.variants)
    addVariant(variants, seen, portal, 'portal', 88, budgets.variants)
  } else {
    addVariant(variants, seen, semantic, 'semantic', 90, budgets.variants)
    if (['government', 'legal', 'medical', 'academic'].includes(lens)) {
      addVariant(variants, seen, official, 'official', 85, budgets.variants)
    }
    if (['pdf', 'government', 'pricing', 'academic', 'financial'].includes(lens)) {
      addVariant(variants, seen, document, 'document', 80, budgets.variants)
    }
    if (lens === 'news') {
      addVariant(variants, seen, freshness, 'freshness', 75, budgets.variants)
    }
  }

  // Complex procurement intents receive additional natural/buyer-language
  // variants only after the critical retrieval strategies are protected.
  if (lens === 'procurement') {
    for (const candidate of procurementQueries.filter(value => !/\b(?:site:|filetype:)/i.test(value))) {
      addVariant(variants, seen, candidate, 'ai-intent', 70, budgets.variants)
    }
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

  // The literal and protected-intent queries are the anchor searches. Fan them
  // out across every selected source before spending budget on expansions.
  const coreVariants = variants.filter(variant =>
    variant.purpose === 'broad' || variant.purpose === 'intent-core'
  )
  for (const variant of coreVariants) {
    for (const source of plan.liveSources) {
      addTask(source, variant)
      if (tasks.length >= maxLiveTasks) return tasks
    }
  }

  // Spread remaining strategies across different engines instead of repeatedly
  // assigning the first two sources. Simple searches stay tightly bounded;
  // moderate/complex semantic plans can use their larger 20/28-task budgets to
  // confirm important variants across additional independent indexes.
  const targetedSources = orderedTargetedSources(plan.liveSources)
  const diversifiedSources = targetedSources.length > 0 ? targetedSources : plan.liveSources
  const remainingVariants = variants.filter(variant =>
    variant.purpose !== 'broad' && variant.purpose !== 'intent-core'
  )
  const expandedFanout = maxLiveTasks > DEFAULT_LIVE_TASKS
  let sourceCursor = 0

  for (const variant of remainingVariants) {
    if (tasks.length >= maxLiveTasks) break
    const copies = variant.purpose === 'ai-intent'
      ? Math.min(expandedFanout ? 3 : 2, diversifiedSources.length)
      : Math.min(expandedFanout ? 2 : 1, diversifiedSources.length)

    for (let offset = 0; offset < copies; offset += 1) {
      const source = diversifiedSources[(sourceCursor + offset) % diversifiedSources.length]
      addTask(source, variant)
      if (tasks.length >= maxLiveTasks) break
    }
    sourceCursor = (sourceCursor + Math.max(1, copies)) % diversifiedSources.length
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
  const tasks = buildRetrievalTasks(variants, plan, budgets.tasks)
  return {
    variants,
    tasks,
    variantBudget: budgets.variants,
    taskBudget: budgets.tasks,
  }
}
