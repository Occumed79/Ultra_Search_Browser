import type { SearchLens } from '../types/search'

export type SemanticIntentComplexity = 'simple' | 'moderate' | 'complex'
export type SemanticIntentKind =
  | 'navigate'
  | 'explain'
  | 'compare'
  | 'find-provider'
  | 'find-procurement'
  | 'find-pricing'
  | 'find-document'
  | 'find-news'
  | 'technical'
  | 'research'

export type IntentConceptKind = 'subject' | 'service' | 'geography' | 'format' | 'time'

export interface IntentConceptGroup {
  id: string
  label: string
  terms: string[]
  kind: IntentConceptKind
  required: boolean
  weight: number
}

export interface SemanticIntentPlan {
  interpretation: string
  intentKind: SemanticIntentKind
  requiredConcepts: string[]
  conceptGroups: IntentConceptGroup[]
  optionalConcepts: string[]
  exclusions: string[]
  geography: string[]
  timeConstraints: string[]
  sourcePreferences: string[]
  searchVariants: string[]
  suggestedLens: SearchLens
  complexity: SemanticIntentComplexity
  usedExternal: boolean
  provider: 'gemini' | 'deterministic'
  model?: string
  runtimeMs: number
  error?: string
}

export interface SemanticIntentCapabilities {
  configured: boolean
  model: string
}

export interface SemanticIntentEnvironment {
  [key: string]: string | undefined
  GEMINI_API_KEY?: string
  GEMINI_INTENT_MODEL?: string
  GEMINI_MODEL?: string
}

interface GeminiIntentPayload {
  interpretation?: unknown
  intentKind?: unknown
  requiredConcepts?: unknown
  conceptGroups?: unknown
  optionalConcepts?: unknown
  exclusions?: unknown
  geography?: unknown
  timeConstraints?: unknown
  sourcePreferences?: unknown
  searchVariants?: unknown
  suggestedLens?: unknown
  complexity?: unknown
}

const GEMINI_TIMEOUT_MS = 2_500
const CURRENT_GEMINI_MODEL = 'gemini-3.5-flash-lite'
const RETIRED_GEMINI_MODELS = new Set([
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash-lite-preview-09-2025',
  'gemini-3.1-flash-lite-preview',
])
const VALID_LENSES = new Set<SearchLens>([
  'web', 'pdf', 'government', 'procurement', 'pricing', 'provider',
  'technical', 'news', 'legal', 'medical', 'academic', 'financial',
])
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'does', 'for', 'from',
  'how', 'i', 'in', 'is', 'it', 'me', 'of', 'on', 'or', 'that', 'the', 'this',
  'to', 'what', 'when', 'where', 'which', 'who', 'with', 'you',
])
const REQUEST_WORDS = new Set([
  'about', 'available', 'best', 'can', 'could', 'current', 'find', 'finding',
  'get', 'give', 'help', 'latest', 'list', 'locate', 'looking', 'need', 'near',
  'offer', 'offering', 'offers', 'please', 'provide', 'provides', 'providing',
  'search', 'show', 'tell', 'want',
])
const TARGET_WORDS = new Set([
  'clinic', 'clinics', 'company', 'companies', 'facility', 'facilities', 'hospital',
  'hospitals', 'office', 'offices', 'practice', 'practices', 'provider', 'providers',
  'service', 'services', 'website', 'websites',
])
const VALID_INTENT_KINDS = new Set<SemanticIntentKind>([
  'navigate', 'explain', 'compare', 'find-provider', 'find-procurement',
  'find-pricing', 'find-document', 'find-news', 'technical', 'research',
])

interface ConceptFamily {
  id: string
  label: string
  kind: IntentConceptKind
  terms: string[]
  weight: number
}

const CONCEPT_FAMILIES: ConceptFamily[] = [
  {
    id: 'occupational-health',
    label: 'occupational health',
    kind: 'subject',
    terms: [
      'occupational health', 'occupational medicine', 'employee health',
      'workplace health', 'worksite medicine', 'industrial medicine',
      'employer medical',
    ],
    weight: 1.5,
  },
  {
    id: 'procurement-opportunity',
    label: 'procurement opportunity',
    kind: 'format',
    terms: [
      'request for proposal', 'request for proposals', 'rfp', 'request for quotation',
      'request for quotations', 'rfq', 'request for tender', 'request for tenders',
      'rft', 'invitation to bid', 'ifb', 'solicitation', 'tender', 'bid opportunity',
      'procurement opportunity', 'contract opportunity',
    ],
    weight: 1.4,
  },
  {
    id: 'posted-pricing',
    label: 'posted pricing',
    kind: 'format',
    terms: [
      'posted price', 'posted prices', 'pricing', 'price list', 'fee schedule',
      'cash price', 'cash prices', 'self pay price', 'self pay prices',
      'self-pay price', 'self-pay prices', 'rate card', 'rates', 'cost',
    ],
    weight: 1.35,
  },
  {
    id: 'treadmill-stress-test',
    label: 'treadmill stress test',
    kind: 'service',
    terms: [
      'treadmill stress test', 'exercise stress test', 'exercise treadmill test',
      'treadmill ecg', 'stress ecg', 'cardiac stress test', 'exercise tolerance test',
    ],
    weight: 1.5,
  },
  {
    id: 'bruce-protocol',
    label: 'Bruce protocol',
    kind: 'subject',
    terms: ['bruce protocol', 'bruce treadmill protocol'],
    weight: 1.35,
  },
  {
    id: 'pulmonary-function-test',
    label: 'pulmonary function test',
    kind: 'service',
    terms: ['pulmonary function test', 'pulmonary function testing', 'pft', 'spirometry', 'lung function test'],
    weight: 1.5,
  },
  {
    id: 'pure-tone-audiogram',
    label: 'pure-tone audiogram',
    kind: 'service',
    terms: [
      'pure tone audiogram', 'pure-tone audiogram', 'pure tone audiograms',
      'pure-tone audiograms', 'pure tone audiometry', 'audiometry', 'audiometrie',
      'hearing test',
    ],
    weight: 1.45,
  },
  {
    id: 'respirator-fit-test',
    label: 'respirator fit testing',
    kind: 'service',
    terms: ['respirator fit test', 'respirator fit testing', 'mask fit test', 'quantitative fit test', 'qualitative fit test'],
    weight: 1.5,
  },
  {
    id: 'dot-physical',
    label: 'DOT physical',
    kind: 'service',
    terms: ['dot physical', 'dot exam', 'cdl physical', 'department of transportation physical'],
    weight: 1.45,
  },
  {
    id: 'employment-medical-evaluation',
    label: 'employment medical evaluation',
    kind: 'service',
    terms: [
      'employment evaluation', 'employment medical evaluation', 'employee medical evaluation',
      'pre-employment evaluation', 'pre employment evaluation',
      'pre-employment medical evaluation', 'pre employment medical evaluation',
      'pre-employment physical', 'pre employment physical',
      'pre-employment physical exam', 'pre employment physical exam',
      'pre-employment examination', 'pre employment examination',
      'occupational health evaluation', 'fitness for duty evaluation',
      'medical evaluation services',
    ],
    weight: 1.5,
  },
  {
    id: 'pdf-document',
    label: 'PDF document',
    kind: 'format',
    terms: ['pdf', 'pdf document', 'downloadable pdf'],
    weight: 1.1,
  },
  {
    id: 'api-documentation',
    label: 'API documentation',
    kind: 'subject',
    terms: ['api documentation', 'api reference', 'developer documentation', 'sdk documentation'],
    weight: 1.35,
  },
]

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeArray(value: unknown, limit: number, maxLength = 180): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const normalized = normalizeSpace(item).slice(0, maxLength)
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
    if (output.length >= limit) break
  }
  return output
}

export function normalizeGeminiModel(value: string | undefined): string {
  const requested = value?.trim() || CURRENT_GEMINI_MODEL
  return RETIRED_GEMINI_MODELS.has(requested.toLowerCase())
    ? CURRENT_GEMINI_MODEL
    : requested
}

function configuredModel(env: SemanticIntentEnvironment): string {
  return normalizeGeminiModel(
    env.GEMINI_INTENT_MODEL?.trim()
    || env.GEMINI_MODEL?.trim()
    || CURRENT_GEMINI_MODEL
  )
}

function normalizeIntentText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])\.(?=[a-z0-9])/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter(value => {
    const key = normalizeIntentText(value)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function deterministicConcepts(query: string): string[] {
  const tokens = normalizeIntentText(query)
    .split(' ')
    .filter(token =>
      token.length >= 2
      && !STOP_WORDS.has(token)
      && !REQUEST_WORDS.has(token)
    )
  return Array.from(new Set(tokens)).slice(0, 12)
}

function deterministicComplexity(query: string): SemanticIntentComplexity {
  const words = normalizeSpace(query).split(' ').filter(Boolean).length
  const constraints = (query.match(/[",:()\-]|\b(?:before|after|within|near|excluding|without|open|current|latest|price|cost|rfp|provider)\b/gi) || []).length
  if (words >= 10 || constraints >= 3) return 'complex'
  if (words >= 5 || constraints >= 1) return 'moderate'
  return 'simple'
}

function phraseIsPresent(query: string, phrase: string): boolean {
  const normalizedQuery = ` ${normalizeIntentText(query)} `
  const normalizedPhrase = normalizeIntentText(phrase)
  return Boolean(normalizedPhrase && normalizedQuery.includes(` ${normalizedPhrase} `))
}

function matchingFamily(value: string): ConceptFamily | undefined {
  return CONCEPT_FAMILIES.find(family =>
    family.terms.some(term => phraseIsPresent(value, term))
    || phraseIsPresent(value, family.label)
  )
}

function conceptTerms(value: string): string[] {
  const family = matchingFamily(value)
  return family ? unique([value, family.label, ...family.terms]) : [value]
}

function conceptId(value: string, index: number): string {
  const normalized = normalizeIntentText(value).replace(/\s+/g, '-').slice(0, 60)
  return normalized || `concept-${index + 1}`
}

function normalizeConceptGroups(
  value: unknown,
  fallbackConcepts: string[]
): IntentConceptGroup[] {
  const groups: IntentConceptGroup[] = []
  const rawGroups = Array.isArray(value) ? value : []

  for (const [index, item] of rawGroups.entries()) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const label = typeof record.label === 'string'
      ? normalizeSpace(record.label).slice(0, 120)
      : ''
    if (!label) continue
    const terms = unique([
      label,
      ...normalizeArray(record.terms, 12, 140),
      ...conceptTerms(label),
    ]).slice(0, 12)
    const kind: IntentConceptKind = record.kind === 'service'
      || record.kind === 'geography'
      || record.kind === 'format'
      || record.kind === 'time'
      ? record.kind
      : 'subject'
    const weightValue = Number(record.weight)
    groups.push({
      id: typeof record.id === 'string' && record.id.trim()
        ? normalizeIntentText(record.id).replace(/\s+/g, '-').slice(0, 60)
        : conceptId(label, index),
      label,
      terms,
      kind,
      required: record.required !== false,
      weight: Number.isFinite(weightValue)
        ? Math.max(0.5, Math.min(2, weightValue))
        : kind === 'service' ? 1.5 : kind === 'geography' ? 1.25 : 1,
    })
    if (groups.length >= 12) break
  }

  if (groups.length > 0) return groups
  return fallbackConcepts.slice(0, 12).map((concept, index) => {
    const family = matchingFamily(concept)
    return {
      id: family?.id || conceptId(concept, index),
      label: family?.label || concept,
      terms: conceptTerms(concept),
      kind: family?.kind || 'subject',
      required: true,
      weight: family?.weight || 1,
    }
  })
}

function mergeConceptGroups(
  primary: IntentConceptGroup[],
  fallback: IntentConceptGroup[]
): IntentConceptGroup[] {
  const merged = [...primary]
  for (const candidate of fallback) {
    const candidateTerms = new Set(candidate.terms.map(normalizeIntentText))
    const overlaps = merged.some(group =>
      group.id === candidate.id
      || group.terms.some(term => candidateTerms.has(normalizeIntentText(term)))
    )
    if (!overlaps) merged.push(candidate)
    if (merged.length >= 12) break
  }
  return merged
}

function extractExclusions(query: string): string[] {
  const exclusions = Array.from(query.matchAll(
    /\b(?:without|excluding|exclude|avoid|except|no)\s+([^,;?]+?)(?=\s+\b(?:but|while|that|which|who|near|within|around|located)\b|[,;?]|$)/giu
  )).map(match => normalizeSpace(match[1]))
  const minusTerms = Array.from(query.matchAll(/(?:^|\s)-(?:"([^"]+)"|([a-z0-9][\w.-]*))/gi))
    .map(match => normalizeSpace(match[1] || match[2] || ''))
  return unique([...exclusions, ...minusTerms]).slice(0, 10)
}

function extractGeography(query: string): string[] {
  const values: string[] = []
  const radius = query.match(/\bwithin\s+\d+\s*(?:miles?|mi|kilometers?|km)\s+of\s+([^,;?]+)/iu)
  if (radius?.[1]) values.push(radius[1])

  const located = query.match(/\b(?:near|around|outside|located in|based in|in)\s+([^,;?]+)/iu)
  if (located?.[1]) values.push(located[1])

  return unique(values.map(value => normalizeSpace(
    value.split(/\s+\b(?:that|which|who|offering|offers|provide|provides|providing|perform|performs|with|without|excluding|for)\b/iu)[0]
  )).filter(value => {
    const normalized = normalizeIntentText(value)
    return normalized.length >= 2
      && !/^\d{4}$/.test(normalized)
      && !['advance', 'general', 'particular'].includes(normalized)
  })).slice(0, 4)
}

function extractTimeConstraints(query: string): string[] {
  const values = [
    ...(query.match(/\b(?:19|20)\d{2}\b/g) || []),
    ...(query.match(/\b(?:currently open|still open|open now|latest|current|recent|today|this week|this month|before [^,;?]+|after [^,;?]+|due [^,;?]+)\b/gi) || []),
  ]
  return unique(values.map(normalizeSpace)).slice(0, 8)
}

function extractSourcePreferences(query: string): string[] {
  const preferences: string[] = []
  if (/\bofficial\b/i.test(query)) preferences.push('official sources')
  if (/\b(?:official clinic|clinic website|provider website)s?\s+only\b/i.test(query)) preferences.push('official provider pages')
  if (/\b(?:government|\.gov)\s+(?:sources?|sites?|pages?)\s+only\b/i.test(query) || /site:\.gov\b/i.test(query)) preferences.push('government sources')
  if (/\b(?:pdf|documents?)\s+only\b/i.test(query) || /filetype:pdf\b/i.test(query)) preferences.push('direct documents')
  if (/\bposted\s+(?:cash\s+|self[- ]?pay\s+)?prices?\s+only\b/i.test(query)) preferences.push('pages with posted prices')
  return unique(preferences).slice(0, 8)
}

function inferIntentKind(query: string): SemanticIntentKind {
  if (/\b(?:compare|versus|vs\.?|difference between)\b/i.test(query)) return 'compare'
  if (CONCEPT_FAMILIES[1].terms.some(term => phraseIsPresent(query, term))) return 'find-procurement'
  if (CONCEPT_FAMILIES[2].terms.some(term => phraseIsPresent(query, term))) return 'find-pricing'
  if (/\b(?:pdf|document|manual|report|whitepaper|download)\b/i.test(query)) return 'find-document'
  if (/\b(?:news|press release|breaking|news coverage|press coverage)\b/i.test(query)) return 'find-news'
  if (/\b(?:api|sdk|source code|github|developer|programming|stack trace|error message|route handler|abortsignal|timeout|exception|next\.?js)\b/i.test(query)) return 'technical'
  if (/\b(?:what is|what are|how does|how do|why does|definition|meaning|explained?)\b/i.test(query)) return 'explain'
  const providerLanguage = /\b(?:clinic|clinics|provider|providers|doctor|physician|hospital|facility|near|offering|offers|perform|performs|services?)\b/i.test(query)
  const healthcareSubject = matchingFamily(query)?.kind === 'service'
    || phraseIsPresent(query, 'occupational health')
    || phraseIsPresent(query, 'occupational medicine')
    || /\b(?:cardiology|dental|dentist|healthcare|medical|medicine|radiology|laboratory|urgent care)\b/i.test(query)
  const explicitMedicalProvider = /\b(?:clinic|clinics|doctor|doctors|physician|physicians|hospital|hospitals|urgent care|medical center|health center)\b/i.test(query)
  if ((providerLanguage && healthcareSubject) || explicitMedicalProvider) return 'find-provider'
  return 'research'
}

function suggestedLensForIntent(kind: SemanticIntentKind, requestedLens: SearchLens): SearchLens {
  if (requestedLens !== 'web') return requestedLens
  if (kind === 'find-provider') return 'provider'
  if (kind === 'find-procurement') return 'procurement'
  if (kind === 'find-pricing') return 'pricing'
  if (kind === 'find-document') return 'pdf'
  if (kind === 'find-news') return 'news'
  if (kind === 'technical') return 'technical'
  return 'web'
}

function deterministicConceptGroups(
  query: string,
  geography: string[],
  exclusions: string[]
): IntentConceptGroup[] {
  const groups: IntentConceptGroup[] = []
  const consumed = new Set<string>()

  for (const family of CONCEPT_FAMILIES) {
    const matchedTerm = family.terms.find(term => phraseIsPresent(query, term))
    if (!matchedTerm) continue
    groups.push({
      id: family.id,
      label: family.label,
      terms: unique([matchedTerm, family.label, ...family.terms]),
      kind: family.kind,
      required: true,
      weight: family.weight,
    })
    for (const token of normalizeIntentText([family.label, ...family.terms].join(' ')).split(' ')) {
      consumed.add(token)
    }
  }

  for (const [index, location] of geography.entries()) {
    groups.push({
      id: `geography-${index + 1}`,
      label: location,
      terms: [location],
      kind: 'geography',
      required: true,
      weight: 1.25,
    })
    for (const token of normalizeIntentText(location).split(' ')) consumed.add(token)
  }

  const quoted = Array.from(query.matchAll(/["“”]([^"“”]{2,})["“”]/g))
    .map(match => normalizeSpace(match[1]))
  for (const phrase of quoted) {
    if (groups.some(group => group.terms.some(term => phraseIsPresent(phrase, term)))) continue
    groups.push({
      id: conceptId(phrase, groups.length),
      label: phrase,
      terms: [phrase],
      kind: 'subject',
      required: true,
      weight: 1.4,
    })
    for (const token of normalizeIntentText(phrase).split(' ')) consumed.add(token)
  }

  const excludedTokens = new Set(exclusions.flatMap(value => normalizeIntentText(value).split(' ')))
  const remaining = deterministicConcepts(query).filter(token =>
    !consumed.has(token)
    && !excludedTokens.has(token)
    && !TARGET_WORDS.has(token)
    && !['around', 'excluding', 'miles', 'offering', 'offers', 'perform', 'performs', 'within', 'without'].includes(token)
  )

  for (const token of remaining) {
    groups.push({
      id: conceptId(token, groups.length),
      label: token,
      terms: [token],
      kind: 'subject',
      required: true,
      weight: 1,
    })
    if (groups.length >= 12) break
  }

  return groups
}

function deterministicVariants(
  query: string,
  kind: SemanticIntentKind,
  groups: IntentConceptGroup[],
  exclusions: string[],
  sourcePreferences: string[]
): string[] {
  const core = groups
    .filter(group => group.required)
    .map(group => group.terms.find(term => phraseIsPresent(query, term)) || group.label)
    .join(' ')
    .trim()
  if (!core) return []

  const variants: string[] = [core]
  for (const group of groups.filter(item => item.terms.length > 1).slice(0, 4)) {
    const alternate = group.terms.find(term => normalizeIntentText(term) !== normalizeIntentText(group.terms[0]))
    if (!alternate) continue
    variants.push(groups.map(item => item.id === group.id ? alternate : item.terms[0]).join(' '))
  }

  if (kind === 'find-provider') variants.push(`${core} clinic services offered`)
  if (kind === 'find-procurement') variants.push(`${core} open solicitation`)
  if (kind === 'find-pricing') variants.push(`${core} price list fee schedule`)
  if (kind === 'find-document') variants.push(`filetype:pdf ${core}`)
  if (kind === 'find-news') variants.push(`${core} latest news`)
  if (sourcePreferences.some(value => /official/i.test(value))) variants.push(`${core} official`)
  if (exclusions.length > 0) {
    variants.push(`${core} ${exclusions.map(value => value.includes(' ') ? `-"${value}"` : `-${value}`).join(' ')}`)
  }

  return unique(variants)
    .filter(variant => normalizeIntentText(variant) !== normalizeIntentText(query))
    .slice(0, 8)
}

function deterministicInterpretation(
  query: string,
  kind: SemanticIntentKind,
  groups: IntentConceptGroup[],
  geography: string[]
): string {
  const subjects = groups
    .filter(group => group.kind !== 'geography')
    .map(group => group.label)
    .join(', ')
  const location = geography.length ? ` in or near ${geography.join(', ')}` : ''
  if (kind === 'find-provider') return `Find providers that offer ${subjects}${location}.`
  if (kind === 'find-procurement') return `Find procurement opportunities for ${subjects}${location}.`
  if (kind === 'find-pricing') return `Find pages with posted pricing for ${subjects}${location}.`
  if (kind === 'find-document') return `Find substantive documents about ${subjects}${location}.`
  return normalizeSpace(query)
}

export function buildDeterministicSemanticIntent(
  query: string,
  requestedLens: SearchLens = 'web',
  runtimeMs = 0,
  error?: string
): SemanticIntentPlan {
  const exclusions = extractExclusions(query)
  const geography = extractGeography(query)
  const timeConstraints = extractTimeConstraints(query)
  const sourcePreferences = extractSourcePreferences(query)
  const intentKind = inferIntentKind(query)
  const conceptGroups = deterministicConceptGroups(query, geography, exclusions)
  const requiredConcepts = conceptGroups.filter(group => group.required).map(group => group.label)
  return {
    interpretation: deterministicInterpretation(query, intentKind, conceptGroups, geography),
    intentKind,
    requiredConcepts,
    conceptGroups,
    optionalConcepts: [],
    exclusions,
    geography,
    timeConstraints,
    sourcePreferences,
    searchVariants: deterministicVariants(query, intentKind, conceptGroups, exclusions, sourcePreferences),
    suggestedLens: suggestedLensForIntent(intentKind, requestedLens),
    complexity: deterministicComplexity(query),
    usedExternal: false,
    provider: 'deterministic',
    runtimeMs,
    error,
  }
}

function fallbackPlan(query: string, lens: SearchLens, startedAt: number, error?: string): SemanticIntentPlan {
  return buildDeterministicSemanticIntent(query, lens, Date.now() - startedAt, error)
}

export function coerceSemanticIntentPlan(
  value: unknown,
  query: string,
  requestedLens: SearchLens
): SemanticIntentPlan {
  if (!value || typeof value !== 'object') return buildDeterministicSemanticIntent(query, requestedLens)
  const candidate = value as Partial<SemanticIntentPlan>
  const requiredConcepts = normalizeArray(candidate.requiredConcepts, 12)
  const deterministic = buildDeterministicSemanticIntent(query, requestedLens)
  const conceptGroups = mergeConceptGroups(
    normalizeConceptGroups(candidate.conceptGroups, requiredConcepts),
    deterministic.conceptGroups
  )
  if (conceptGroups.length === 0) return deterministic

  return {
    interpretation: typeof candidate.interpretation === 'string' && candidate.interpretation.trim()
      ? normalizeSpace(candidate.interpretation).slice(0, 500)
      : deterministic.interpretation,
    intentKind: candidate.intentKind && VALID_INTENT_KINDS.has(candidate.intentKind)
      ? candidate.intentKind
      : deterministic.intentKind,
    requiredConcepts: conceptGroups.filter(group => group.required).map(group => group.label),
    conceptGroups,
    optionalConcepts: normalizeArray(candidate.optionalConcepts, 10),
    exclusions: unique([
      ...normalizeArray(candidate.exclusions, 10),
      ...deterministic.exclusions,
    ]).slice(0, 10),
    geography: unique([
      ...normalizeArray(candidate.geography, 8),
      ...deterministic.geography,
    ]).slice(0, 8),
    timeConstraints: unique([
      ...normalizeArray(candidate.timeConstraints, 8),
      ...deterministic.timeConstraints,
    ]).slice(0, 8),
    sourcePreferences: unique([
      ...normalizeArray(candidate.sourcePreferences, 8),
      ...deterministic.sourcePreferences,
    ]).slice(0, 8),
    searchVariants: unique([
      ...normalizeArray(candidate.searchVariants, 8, 260),
      ...deterministic.searchVariants,
    ]).slice(0, 8),
    suggestedLens: candidate.suggestedLens && VALID_LENSES.has(candidate.suggestedLens)
      ? candidate.suggestedLens
      : deterministic.suggestedLens,
    complexity: candidate.complexity === 'simple'
      || candidate.complexity === 'moderate'
      || candidate.complexity === 'complex'
      ? candidate.complexity
      : deterministic.complexity,
    usedExternal: candidate.usedExternal === true,
    provider: candidate.provider === 'gemini' ? 'gemini' : 'deterministic',
    model: typeof candidate.model === 'string' ? candidate.model.slice(0, 100) : undefined,
    runtimeMs: Number.isFinite(candidate.runtimeMs) ? Number(candidate.runtimeMs) : 0,
    error: typeof candidate.error === 'string' ? candidate.error.slice(0, 500) : undefined,
  }
}

export function semanticIntentCapabilities(
  env: SemanticIntentEnvironment = process.env
): SemanticIntentCapabilities {
  return {
    configured: Boolean(env.GEMINI_API_KEY?.trim()),
    model: configuredModel(env),
  }
}

export function parseGeminiIntentPayload(
  value: string,
  query: string,
  requestedLens: SearchLens,
  model: string,
  runtimeMs: number
): SemanticIntentPlan {
  const payload = JSON.parse(value) as GeminiIntentPayload
  const rawSuggestedLens = typeof payload.suggestedLens === 'string'
    && VALID_LENSES.has(payload.suggestedLens as SearchLens)
    ? payload.suggestedLens as SearchLens
    : requestedLens
  const complexity: SemanticIntentComplexity = payload.complexity === 'simple'
    || payload.complexity === 'moderate'
    || payload.complexity === 'complex'
    ? payload.complexity
    : deterministicComplexity(query)
  const requiredConcepts = normalizeArray(payload.requiredConcepts, 12)
  const deterministic = buildDeterministicSemanticIntent(query, requestedLens)
  const parsedConceptGroups = normalizeConceptGroups(payload.conceptGroups, requiredConcepts)
  const conceptGroups = mergeConceptGroups(parsedConceptGroups, deterministic.conceptGroups)
  const intentKind = typeof payload.intentKind === 'string'
    && VALID_INTENT_KINDS.has(payload.intentKind as SemanticIntentKind)
    ? payload.intentKind as SemanticIntentKind
    : deterministic.intentKind
  const suggestedLens = rawSuggestedLens === 'web'
    && deterministic.suggestedLens !== 'web'
    && intentKind === deterministic.intentKind
    ? deterministic.suggestedLens
    : rawSuggestedLens
  const searchVariants = normalizeArray(payload.searchVariants, 8, 260)
    .filter(variant => variant.toLowerCase() !== normalizeSpace(query).toLowerCase())

  return {
    interpretation: typeof payload.interpretation === 'string' && payload.interpretation.trim()
      ? normalizeSpace(payload.interpretation).slice(0, 500)
      : normalizeSpace(query),
    intentKind,
    requiredConcepts: conceptGroups.length
      ? conceptGroups.filter(group => group.required).map(group => group.label)
      : deterministic.requiredConcepts,
    conceptGroups: conceptGroups.length ? conceptGroups : deterministic.conceptGroups,
    optionalConcepts: normalizeArray(payload.optionalConcepts, 10),
    exclusions: unique([
      ...normalizeArray(payload.exclusions, 10),
      ...deterministic.exclusions,
    ]).slice(0, 10),
    geography: unique([
      ...normalizeArray(payload.geography, 8),
      ...deterministic.geography,
    ]).slice(0, 8),
    timeConstraints: unique([
      ...normalizeArray(payload.timeConstraints, 8),
      ...deterministic.timeConstraints,
    ]).slice(0, 8),
    sourcePreferences: unique([
      ...normalizeArray(payload.sourcePreferences, 8),
      ...deterministic.sourcePreferences,
    ]).slice(0, 8),
    searchVariants: unique([...searchVariants, ...deterministic.searchVariants]).slice(0, 8),
    suggestedLens,
    complexity,
    usedExternal: true,
    provider: 'gemini',
    model,
    runtimeMs,
  }
}

export function geminiResponseSchema() {
  return {
    type: 'object',
    properties: {
      interpretation: { type: 'string' },
      intentKind: {
        type: 'string',
        enum: Array.from(VALID_INTENT_KINDS),
      },
      requiredConcepts: { type: 'array', items: { type: 'string' } },
      conceptGroups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            terms: { type: 'array', items: { type: 'string' } },
            kind: {
              type: 'string',
              enum: ['subject', 'service', 'geography', 'format', 'time'],
            },
            required: { type: 'boolean' },
            weight: { type: 'number' },
          },
          required: ['id', 'label', 'terms', 'kind', 'required', 'weight'],
        },
      },
      optionalConcepts: { type: 'array', items: { type: 'string' } },
      exclusions: { type: 'array', items: { type: 'string' } },
      geography: { type: 'array', items: { type: 'string' } },
      timeConstraints: { type: 'array', items: { type: 'string' } },
      sourcePreferences: { type: 'array', items: { type: 'string' } },
      searchVariants: { type: 'array', items: { type: 'string' } },
      suggestedLens: {
        type: 'string',
        enum: Array.from(VALID_LENSES),
      },
      complexity: {
        type: 'string',
        enum: ['simple', 'moderate', 'complex'],
      },
    },
    required: [
      'interpretation', 'intentKind', 'requiredConcepts', 'conceptGroups',
      'optionalConcepts', 'exclusions',
      'geography', 'timeConstraints', 'sourcePreferences', 'searchVariants',
      'suggestedLens', 'complexity',
    ],
  }
}

function plannerPrompt(query: string, lens: SearchLens): string {
  return [
    'You are the semantic intent planner for a public-web metasearch engine.',
    'Infer the task the person is trying to accomplish, not just the nouns they typed.',
    'Separate required meaning into concept groups. A concept group represents one requirement and contains exact equivalents that may satisfy it; for example occupational health and occupational medicine belong in one group, while a requested test and a city belong in separate groups.',
    'Do not treat conversational request words such as find, show, need, services, near, or please as standalone required concepts.',
    'Preserve organization names, model numbers, quoted phrases, requested services, geography, dates, exclusions, and source-quality constraints.',
    'Choose the intent kind and the best lens for the task.',
    'Generate up to eight concise search variants. Every variant must preserve all required concept groups, although a true synonym or locally appropriate translation may replace a group term.',
    'Include useful local-language variants when the location strongly implies another language.',
    'Prefer official or primary sources when the request asks for providers, prices, government material, procurement, technical documentation, or research.',
    'Do not add facts, organizations, dates, or locations that the user did not request.',
    'Do not answer the query. Return only the structured plan.',
    `Requested lens: ${lens}`,
    `User query: ${query}`,
  ].join('\n')
}

export async function planSemanticIntent(
  query: string,
  lens: SearchLens,
  env: SemanticIntentEnvironment = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<SemanticIntentPlan> {
  const startedAt = Date.now()
  const apiKey = env.GEMINI_API_KEY?.trim()
  const model = configuredModel(env)
  if (!apiKey) return fallbackPlan(query, lens, startedAt)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)
  try {
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: plannerPrompt(query, lens) }] }],
          generationConfig: {
            maxOutputTokens: 1_600,
            responseMimeType: 'application/json',
            responseSchema: geminiResponseSchema(),
          },
        }),
        signal: controller.signal,
        cache: 'no-store',
      }
    )
    const responseText = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 500)}`)

    const envelope = JSON.parse(responseText) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = envelope.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('')
      .trim() || ''
    if (!text) throw new Error('Gemini returned no semantic plan')

    return parseGeminiIntentPayload(text, query, lens, model, Date.now() - startedAt)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('Gemini semantic intent planning failed; using deterministic planning:', message)
    return fallbackPlan(query, lens, startedAt, message.slice(0, 500))
  } finally {
    clearTimeout(timer)
  }
}
