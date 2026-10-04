/** Evidence interpreter for the Neon profile. No embedded terms, score weights or domain exclusions. */
import { getRelevanceProfile, type ProfileSource, type RelevanceProfile } from './relevanceProfile'
import { evaluateRules, matchEvidence } from './profileRules'

export interface RelevanceInput {
  title?: string | null
  snippet?: string | null
  description?: string | null
}
export interface RelevanceResult {
  score: number
  rejected: boolean
  rejectReason: string | null
  confidence: 'verified_explicit' | 'strong_combination' | 'insufficient' | 'rejected'
  reasons: string[]
  matchedServiceCategories: string[]
  matchedExplicitPhrases: string[]
  matchedComponentTerms: string[]
  matchedProcurementSignals: string[]
  matchedWorkforceSignals: string[]
  matchedRegulatorySignals: string[]
  negativeSignals: string[]
  profileSource: ProfileSource
  profileVersion: string
}

/**
 * Uses Insight-Hub's profile categories and rule interpreter. Full evidence is represented by Neon's
 * accept floor, partial evidence by its review floor; there are no Ultra Search fit scores or cutoffs.
 * Lifecycle, source quality and retrieval ranking are deliberately outside this relevance decision.
 */
export function classifyResult(input: RelevanceInput, profile: RelevanceProfile = getRelevanceProfile()): RelevanceResult {
  const title = input.title || ''
  const text = [title, input.snippet, input.description].filter(Boolean).join(' ')
  const procurement = matchEvidence(text, profile.procurementSignals)
  const workforce = matchEvidence(text, profile.workforceSignals)
  const regulatory = matchEvidence(text, profile.regulatory)
  const explicit: string[] = matchEvidence(text, profile.generalExplicit)
  const components: string[] = []
  const categories: string[] = []
  let direct = explicit.length > 0
  for (const category of profile.categories) {
    const ex = matchEvidence(text, category.explicit)
    const comp = matchEvidence(text, category.component)
    const reg = matchEvidence(text, category.regulatory)
    if (ex.length || comp.length || reg.length) categories.push(category.label)
    if (!category.adjacentOnly) {
      direct ||= ex.length > 0
      components.push(...comp)
    }
    explicit.push(...ex)
    regulatory.push(...reg)
  }
  const rules = evaluateRules(profile, { title, haystack: text, hasProcurementSignal: procurement.length > 0 })
  const titleEvidence = matchEvidence(title, profile.titleMedical).length > 0
  const networkCategory = profile.categories.find(category => category.id === profile.networkCategoryId)
  const combination = new Set(components).size > 1 && (workforce.length > 0 || regulatory.length > 0) && titleEvidence
  const network = Boolean(networkCategory && categories.includes(networkCategory.label) && titleEvidence && rules.networkServiceEvidence)
  const full = procurement.length > 0 && (direct || combination || network || rules.programMatches.length > 0)
  const partial = explicit.length > 0 || components.length > 0 || regulatory.length > 0
  const penalties = rules.conditionalPenalty + rules.softPenalties.reduce((sum, penalty) => sum + penalty.penalty, 0)
  const score = rules.hardReject || !partial && !full || profile.source === 'unavailable'
    ? 0
    : Math.max(0, (full ? profile.thresholds.acceptMin : profile.thresholds.reviewMin) - penalties)
  const rejected = Boolean(rules.hardReject) || !full
  const reason = rules.hardReject?.reason || (full ? 'Canonical profile service evidence satisfied' : 'Canonical profile service evidence incomplete')
  return {
    score, rejected, rejectReason: rejected ? reason : null,
    confidence: rules.hardReject || !partial && !full ? 'rejected' : !full ? 'insufficient' : direct ? 'verified_explicit' : 'strong_combination',
    reasons: [reason], matchedServiceCategories: [...new Set(categories)],
    matchedExplicitPhrases: [...new Set(explicit)], matchedComponentTerms: [...new Set(components)],
    matchedProcurementSignals: procurement, matchedWorkforceSignals: workforce,
    matchedRegulatorySignals: [...new Set(regulatory)],
    negativeSignals: rules.hardReject ? [rules.hardReject.ruleKey] : rules.negativeSignals,
    profileSource: profile.source, profileVersion: profile.version,
  }
}
