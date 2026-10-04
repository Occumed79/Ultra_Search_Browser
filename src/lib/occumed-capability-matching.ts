import type { SemanticIntentPlan } from './semantic-intent'

/**
 * Compatibility shim.
 * Built-in Occu-Med capability vocabulary and buyer-language expansion were removed.
 * These functions deliberately add no domain vocabulary.
 */
export interface OccuMedCapabilityMatch {
  label: string
  terms: string[]
  score: number
}

export function normalizeOccuMedLanguage(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isBroadOccuMedCapabilityQuery(_value: string): boolean {
  return false
}

export function matchOccuMedCapabilityGroups(
  _value: string,
  _limit = 3
): OccuMedCapabilityMatch[] {
  return []
}

export function buyerLanguageTermsForQuery(
  _query: string,
  _limit = 8
): string[] {
  return []
}

export function buyerLanguageRetrievalQueries(
  query: string,
  limit = 4
): string[] {
  return [query].slice(0, Math.max(1, limit))
}

export function buyerLanguageSemanticQuery(query: string): string {
  return query
}

export function alignOccuMedSemanticIntent(
  _query: string,
  intent?: SemanticIntentPlan
): SemanticIntentPlan | undefined {
  return intent
}
