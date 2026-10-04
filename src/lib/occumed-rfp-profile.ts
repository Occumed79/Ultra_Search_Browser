import type { SemanticIntentPlan } from './semantic-intent'

/**
 * Compatibility shim only.
 * The hard-coded Occu-Med relevance vocabulary was intentionally removed.
 * Canonical relevance is owned by OCCU_MED_AWARE (Neon), not this repository.
 */
export const OCCUMED_PROFILE_VERSION = 'external-neon-authority'
export const OCCUMED_OFFICIAL_SOURCES = [] as const
export const OCCUMED_CLIENT_ANCHORS = [] as const
export const OCCUMED_CAPABILITY_GROUPS = [] as const
export const OCCUMED_BUYER_SEGMENTS = [] as const
export const OCCUMED_HARD_EXCLUSIONS = [] as const
export const OCCUMED_VERIFIED_WIN_EXAMPLES = [] as const
export const OCCUMED_POSITIVE_EXAMPLES = [] as const
export const OCCUMED_NEGATIVE_EXAMPLES = [] as const

export interface OccuMedRelevanceAssessment {
  status: 'relevant' | 'uncertain' | 'irrelevant'
  score: number
  matchedCapabilities: string[]
  matchedBuyerSegments: string[]
  exclusions: string[]
  reason: string
}

export function assessOccuMedRfpText(_text: string): OccuMedRelevanceAssessment {
  return {
    status: 'uncertain',
    score: 0.5,
    matchedCapabilities: [],
    matchedBuyerSegments: [],
    exclusions: [],
    reason: 'Local Occu-Med relevance vocabulary removed; canonical Neon relevance must decide fit.',
  }
}

export function augmentOccuMedSemanticIntent(
  intent?: SemanticIntentPlan
): SemanticIntentPlan | undefined {
  return intent
}

export const OCCUMED_AI_PROFILE = {
  version: OCCUMED_PROFILE_VERSION,
  officialSources: OCCUMED_OFFICIAL_SOURCES,
  operatingModel: 'Canonical relevance is externalized to OCCU_MED_AWARE (Neon).',
  capabilityGroups: OCCUMED_CAPABILITY_GROUPS,
  buyerSegments: OCCUMED_BUYER_SEGMENTS,
  clientSimilarityAnchors: OCCUMED_CLIENT_ANCHORS,
  verifiedWinExamples: OCCUMED_VERIFIED_WIN_EXAMPLES,
  hardExclusions: OCCUMED_HARD_EXCLUSIONS,
  positiveExamples: OCCUMED_POSITIVE_EXAMPLES,
  negativeExamples: OCCUMED_NEGATIVE_EXAMPLES,
} as const
