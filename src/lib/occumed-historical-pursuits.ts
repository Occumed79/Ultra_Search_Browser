/**
 * Historical awards and client-program seeds were removed as a local relevance authority.
 * Canonical relevance and targeting metadata belong in OCCU_MED_AWARE (Neon).
 */
export type OccuMedHistoricalEvidenceType =
  | 'verified-prime-award'
  | 'verified-subcontract-award'
  | 'verified-performance-record'
  | 'active-client-program'
  | 'documented-service-pattern'

export interface OccuMedHistoricalPursuitSeed {
  client: string
  aliases: string[]
  program: string
  evidenceType: OccuMedHistoricalEvidenceType
  servicePatterns: string[]
  notes: string
  awardId?: string
  buyer?: string
  awardDate?: string
  publicEvidenceUrl?: string
  confidence?: 'verified-high' | 'contextual'
}

export const OCCUMED_VERIFIED_AWARD_SEEDS: OccuMedHistoricalPursuitSeed[] = []
export const OCCUMED_HISTORICAL_PURSUIT_SEEDS: OccuMedHistoricalPursuitSeed[] = []

export interface OccuMedHistoricalMatch {
  client: string
  program: string
  evidenceType: OccuMedHistoricalEvidenceType
  matchedPatterns: string[]
  notes: string
  awardId?: string
  buyer?: string
  publicEvidenceUrl?: string
  confidence?: 'verified-high' | 'contextual'
}

export function matchOccuMedHistoricalPatterns(_text: string): OccuMedHistoricalMatch[] {
  return []
}
