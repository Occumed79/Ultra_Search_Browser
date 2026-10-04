/** Server adapter. Every relevance term, rule, buyer signal and threshold is loaded from Neon. */
import { classifyResult, type RelevanceInput } from './canonical/search/relevance'
import { decideRelevanceWithCodes } from './canonical/search/relevanceDecision'
import { getRelevanceProfile, type RelevanceProfile } from './canonical/search/relevanceProfile'
import { matchEvidence } from './canonical/search/profileRules'
export { ensureRelevanceProfile } from './canonical/occumedAware/relevanceProfileLoader'
export { getRelevanceProfile } from './canonical/search/relevanceProfile'

export function assessCanonicalRelevance(input: RelevanceInput & { naics?: string | null }, profile: RelevanceProfile = getRelevanceProfile()) {
  const evidence = classifyResult(input, profile)
  const decision = decideRelevanceWithCodes(evidence, [{ system: 'NAICS 2022', code: input.naics }], profile)
  return {
    ...decision, profileVersion: profile.version, evidence,
    status: decision.verdict === 'accept' ? 'relevant' as const : decision.verdict === 'reject' ? 'irrelevant' as const : 'uncertain' as const,
    matchedCapabilities: evidence.matchedServiceCategories,
    matchedBuyerSegments: matchEvidence([input.title, input.snippet, input.description].filter(Boolean).join(' '), profile.buyerSectors.map(buyer => buyer.phrase)),
    exclusions: decision.basis === 'rules' ? evidence.negativeSignals : [],
  }
}
export type CanonicalRelevanceAssessment = ReturnType<typeof assessCanonicalRelevance>

function cleanProfileSearchTerm(value: string): string {
  return value.replace(/"/g, '').replace(/\s+/g, ' ').trim()
}

function queryTokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 3))
}

/** UI/query discovery suggestions, derived only from a loaded profile and the user's query. */
export function canonicalBuyerTerms(query: string, limit = 12): string[] {
  const profile = getRelevanceProfile()
  const categories = profile.categories.filter(category => matchEvidence(query, [...category.explicit, ...category.component, ...category.regulatory]).length > 0)
  return [...new Set(categories.flatMap(category => category.explicit))].filter(term => term.toLowerCase() !== query.toLowerCase()).slice(0, limit)
}

/**
 * Search phrases drawn only from the canonical Neon search bundles.
 * This is retrieval expansion, not another relevance score.
 */
export function canonicalSearchBundleTerms(query: string, limit = 12): string[] {
  const profile = getRelevanceProfile()
  if (profile.source === 'unavailable') return []
  const q = query.toLowerCase()
  const tokens = queryTokens(query)
  const ranked = profile.searchBundles
    .map(bundle => {
      const serviceTerms = bundle.serviceTerms.map(cleanProfileSearchTerm).filter(Boolean)
      const label = `${bundle.key} ${bundle.label}`.toLowerCase()
      let score = 0
      if (q.includes(bundle.key.toLowerCase()) || q.includes(bundle.label.toLowerCase())) score += 20
      for (const term of serviceTerms) {
        if (matchEvidence(query, [term]).length > 0) score += 12
        const overlap = [...queryTokens(term)].filter(token => tokens.has(token)).length
        score += Math.min(6, overlap * 2)
      }
      return { score, terms: serviceTerms }
    })
    .filter(bundle => bundle.score > 0)
    .sort((left, right) => right.score - left.score)

  const matched = ranked.flatMap(bundle => bundle.terms)
  const categoryTerms = canonicalBuyerTerms(query, limit)
  return [...new Set([...matched, ...categoryTerms])]
    .filter(term => term.toLowerCase() !== query.toLowerCase())
    .slice(0, limit)
}

/** Buyer-type targeting comes from Neon and affects only where/how we search. */
export function canonicalTargetBuyerTypes(limit = 6): string[] {
  const profile = getRelevanceProfile()
  return profile.source === 'unavailable'
    ? []
    : [...new Set(profile.targetBuyerTypes.map(cleanProfileSearchTerm).filter(Boolean))].slice(0, limit)
}

/** Preferred-agency targeting comes from Neon and never changes relevance. */
export function canonicalSearchPriorityAgencies(limit = 6): string[] {
  const profile = getRelevanceProfile()
  return profile.source === 'unavailable'
    ? []
    : [...new Set(profile.searchPriority.agencyTerms.map(cleanProfileSearchTerm).filter(Boolean))].slice(0, limit)
}

/** Group query terms with their Neon aliases; ordinary words/format/geography stay in the generic plan. */
export function alignCanonicalIntent(query: string, intent: import('./semantic-intent').SemanticIntentPlan): import('./semantic-intent').SemanticIntentPlan {
  const categories = getRelevanceProfile().categories.filter(category => matchEvidence(query, [...category.explicit, ...category.component, ...category.regulatory]).length > 0)
  if (categories.length === 0) return intent
  const vocabulary = categories.flatMap(category => [...category.explicit, ...category.component, ...category.regulatory])
  const coveredTokens = new Set(vocabulary.flatMap(term => term.toLowerCase().split(/[^a-z0-9]+/)))
  const genericGroups = intent.conceptGroups.filter(group => group.kind === 'format' || group.kind === 'geography' || group.kind === 'time' || !group.terms.some(term => coveredTokens.has(term.toLowerCase()) || matchEvidence(term, vocabulary).length > 0))
  const conceptGroups = [...categories.map(category => ({ id: category.id, label: category.label, terms: [...new Set([category.label, ...category.explicit, ...category.component, ...category.regulatory])], kind: 'service' as const, required: true, weight: 1 })), ...genericGroups]
  return { ...intent, conceptGroups, requiredConcepts: conceptGroups.filter(group => group.required).map(group => group.label) }
}
