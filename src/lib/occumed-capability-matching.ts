import { OCCUMED_CAPABILITY_GROUPS } from './occumed-rfp-profile'
import type { SemanticIntentPlan } from './semantic-intent'

export interface OccuMedCapabilityMatch {
  label: string
  terms: string[]
  score: number
}

const GENERIC_QUERY_TOKENS = new Set([
  'active', 'bid', 'bids', 'contract', 'current', 'find', 'health', 'medical',
  'open', 'opportunities', 'opportunity', 'procurement', 'program', 'proposal',
  'proposals', 'request', 'rfp', 'rfq', 'services', 'solicitation', 'tender',
])

export function normalizeOccuMedLanguage(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(value: string): string[] {
  return Array.from(new Set(
    normalizeOccuMedLanguage(value)
      .split(' ')
      .filter(token => token.length >= 3 && !GENERIC_QUERY_TOKENS.has(token))
  ))
}

function sharedTokenCount(left: string[], right: string[]): number {
  const rightSet = new Set(right)
  return left.reduce((count, token) => count + (rightSet.has(token) ? 1 : 0), 0)
}

function scoreVariant(query: string, variant: string): number {
  const normalizedQuery = normalizeOccuMedLanguage(query)
  const normalizedVariant = normalizeOccuMedLanguage(variant)
  if (!normalizedQuery || !normalizedVariant) return 0
  if (normalizedQuery === normalizedVariant) return 240

  const queryTokens = tokens(query)
  const variantTokens = tokens(variant)
  const shared = sharedTokenCount(queryTokens, variantTokens)
  const containsPhrase = normalizedQuery.includes(normalizedVariant)
    || normalizedVariant.includes(normalizedQuery)

  if (containsPhrase && variantTokens.length > 0) {
    return 120 + shared * 12
  }
  if (shared >= 2) return 45 + shared * 12

  if (
    variantTokens.length === 1
    && queryTokens.includes(variantTokens[0])
    && !GENERIC_QUERY_TOKENS.has(variantTokens[0])
  ) {
    return 32
  }

  return 0
}

export function matchOccuMedCapabilityGroups(
  value: string,
  limit = 3
): OccuMedCapabilityMatch[] {
  return OCCUMED_CAPABILITY_GROUPS
    .map(group => ({
      label: group.label,
      terms: Array.from(group.terms),
      score: Math.max(
        scoreVariant(value, group.label),
        ...group.terms.map(term => scoreVariant(value, term))
      ),
    }))
    .filter(group => group.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit))
}

function candidateBreadthScore(query: string, candidate: string, isLabel: boolean): number {
  const queryTokens = tokens(query)
  const candidateTokens = tokens(candidate)
  const shared = sharedTokenCount(queryTokens, candidateTokens)
  const normalizedQuery = normalizeOccuMedLanguage(query)
  const normalizedCandidate = normalizeOccuMedLanguage(candidate)
  const oppositePhase = (normalizedQuery.includes('pre ') && normalizedCandidate.includes('post '))
    || (normalizedQuery.includes('post ') && normalizedCandidate.includes('pre '))

  return shared * 10
    + (isLabel ? 4 : 0)
    - (oppositePhase ? 35 : 0)
}

export function buyerLanguageTermsForQuery(
  query: string,
  limit = 8
): string[] {
  const normalizedQuery = normalizeOccuMedLanguage(query)
  const groups = matchOccuMedCapabilityGroups(query, 3)
  if (groups.length === 0) return []

  const rankedByGroup = groups.map(group => {
    const candidates = [
      { value: group.label, isLabel: true, order: -1 },
      ...group.terms.map((value, order) => ({ value, isLabel: false, order })),
    ]
      .filter(candidate => normalizeOccuMedLanguage(candidate.value) !== normalizedQuery)
      .sort((left, right) => {
        const scoreDelta = candidateBreadthScore(query, right.value, right.isLabel)
          - candidateBreadthScore(query, left.value, left.isLabel)
        if (scoreDelta !== 0) return scoreDelta
        return left.order - right.order
      })

    return candidates.map(candidate => candidate.value)
  })

  const output: string[] = []
  const seen = new Set<string>()
  let position = 0
  while (output.length < limit && rankedByGroup.some(group => position < group.length)) {
    for (const group of rankedByGroup) {
      const value = group[position]
      if (!value) continue
      const key = normalizeOccuMedLanguage(value)
      if (!key || seen.has(key)) continue
      seen.add(key)
      output.push(value)
      if (output.length >= limit) break
    }
    position += 1
  }

  return output
}

export function alignOccuMedSemanticIntent(
  query: string,
  intent?: SemanticIntentPlan
): SemanticIntentPlan | undefined {
  if (!intent) return undefined

  const matches = matchOccuMedCapabilityGroups(query, 3)
  if (matches.length === 0) return intent

  const matchedVocabulary = new Set(
    matches.flatMap(match => [match.label, ...match.terms])
      .flatMap(value => normalizeOccuMedLanguage(value).split(' '))
      .filter(Boolean)
  )
  const requestedCapability = {
    id: 'requested-occumed-capability',
    label: matches.map(match => match.label).join(' or '),
    terms: Array.from(new Set(matches.flatMap(match => [match.label, ...match.terms]))),
    kind: 'service' as const,
    required: true,
    weight: 1.6,
  }

  const preservedGroups = intent.conceptGroups.filter(group => {
    if (group.id === 'occumed-capable-service' || group.id === requestedCapability.id) return false
    if (group.kind === 'format' || group.kind === 'geography' || group.kind === 'time') return true

    const groupTokens = normalizeOccuMedLanguage(group.label)
      .split(' ')
      .filter(token => token.length >= 3)
    return groupTokens.some(token =>
      !matchedVocabulary.has(token) && !GENERIC_QUERY_TOKENS.has(token)
    )
  })
  const conceptGroups = [...preservedGroups, requestedCapability]

  return {
    ...intent,
    interpretation: `${intent.interpretation} Treat buyer-language terms within the requested Occu-Med capability family as equivalent service descriptions.`,
    requiredConcepts: conceptGroups.filter(group => group.required).map(group => group.label),
    conceptGroups,
  }
}
