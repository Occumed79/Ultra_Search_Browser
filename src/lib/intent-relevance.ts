import type { IntentConceptGroup, SemanticIntentPlan } from './semantic-intent'
import type { ScrapedResult, SearchLens } from '../types/search'

export interface IntentRelevance {
  matchedGroups: IntentConceptGroup[]
  missingGroups: IntentConceptGroup[]
  exclusionMatches: string[]
  coverage: number
  criticalCoverage: number
  taskEvidence: boolean
  taskEvidenceReason: string
  sourcePreferenceScore: number
  collisionReason?: string
  adjustment: number
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])\.(?=[a-z0-9])/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function singularForms(value: string): string[] {
  if (value.length <= 4) return [value]
  if (value.endsWith('ies') && value.length > 5) return [value, `${value.slice(0, -3)}y`]
  if (value.endsWith('es') && value.length > 5) return [value, value.slice(0, -2), value.slice(0, -1)]
  if (value.endsWith('s')) return [value, value.slice(0, -1)]
  return [value]
}

function textForResult(result: ScrapedResult): string {
  return [
    result.title,
    result.description,
    result.url,
    result.domain,
    result.content,
    result.pageValidation?.evidence?.join(' '),
    result.pageValidation?.lifecycle.reason,
  ].filter(Boolean).join(' ')
}

function termMatches(term: string, normalizedText: string, tokens: Set<string>): boolean {
  const normalizedTerm = normalize(term)
  if (!normalizedTerm) return false
  if (normalizedTerm.includes(' ')) return ` ${normalizedText} `.includes(` ${normalizedTerm} `)
  return singularForms(normalizedTerm).some(form =>
    tokens.has(form)
    || (form.length >= 5 && normalizedText.includes(form))
  )
}

function groupMatches(group: IntentConceptGroup, normalizedText: string, tokens: Set<string>): boolean {
  return group.terms.some(term => termMatches(term, normalizedText, tokens))
}

function taskEvidence(
  plan: SemanticIntentPlan,
  lens: SearchLens,
  result: ScrapedResult,
  normalizedText: string
): { matched: boolean; reason: string } {
  const url = result.url.toLowerCase()
  const providerEvidence = /\b(?:clinic|medical center|health center|hospital|physician|doctor|practice|occupational health|occupational medicine|employee health|services offered|appointments?)\b/i.test(normalizedText)
  const procurementEvidence = /\b(?:rfp|rfq|rft|ifb|solicitation|tender|invitation to bid|request for proposals?|request for quotations?|procurement opportunity|contract opportunity|responses due|bid due)\b/i.test(normalizedText)
    || /(?:sam\.gov|ionwave\.net|bonfirehub\.com|planetbids\.com|bidnetdirect\.com|publicpurchase\.com|opengov\.com)/i.test(url)
  const pricingEvidence = /(?:\$|€|£|¥)\s?\d/i.test(textForResult(result))
    || /\b(?:price|pricing|cost|fee schedule|fees?|rates?|cash pay|self pay|self-pay|chargemaster|price list|rate card)\b/i.test(normalizedText)
  const documentEvidence = /\.pdf(?:$|[?#])/i.test(url)
    || /\b(?:pdf|download document|view document|manual|report|whitepaper)\b/i.test(normalizedText)
  const technicalEvidence = /\b(?:documentation|api reference|developer guide|source code|repository|package|sdk|framework|stack trace)\b/i.test(normalizedText)
    || /(?:github\.com|stackoverflow\.com|developer\.mozilla\.org|npmjs\.com)/i.test(url)
  const newsEvidence = /\b(?:news|press release|reported|breaking|coverage)\b/i.test(normalizedText)

  if (plan.intentKind === 'find-provider' || lens === 'provider') {
    return { matched: providerEvidence, reason: providerEvidence ? 'provider-page evidence' : 'no provider-page evidence' }
  }
  if (plan.intentKind === 'find-procurement' || lens === 'procurement') {
    return { matched: procurementEvidence, reason: procurementEvidence ? 'procurement evidence' : 'no procurement evidence' }
  }
  if (plan.intentKind === 'find-pricing' || lens === 'pricing') {
    return { matched: pricingEvidence, reason: pricingEvidence ? 'posted-pricing evidence' : 'no posted-pricing evidence' }
  }
  if (plan.intentKind === 'find-document' || lens === 'pdf') {
    return { matched: documentEvidence, reason: documentEvidence ? 'document evidence' : 'no document evidence' }
  }
  if (plan.intentKind === 'technical' || lens === 'technical') {
    return { matched: technicalEvidence, reason: technicalEvidence ? 'technical-source evidence' : 'no technical-source evidence' }
  }
  if (plan.intentKind === 'find-news' || lens === 'news') {
    return { matched: newsEvidence, reason: newsEvidence ? 'news-source evidence' : 'no news-source evidence' }
  }
  return { matched: true, reason: 'no special page type required' }
}

function collisionReason(
  plan: SemanticIntentPlan,
  normalizedText: string
): string | undefined {
  if (
    plan.intentKind !== 'explain'
    && /\b(?:definition|dictionary|meaning|encyclopedia)\b/i.test(normalizedText)
  ) return 'generic definition instead of the requested outcome'

  if (
    plan.intentKind === 'find-provider'
    && /\b(?:jobs?|careers?|salary|occupational therapy|therapist)\b/i.test(normalizedText)
    && !/\b(?:occupational health|occupational medicine|employee health)\b/i.test(normalizedText)
  ) return 'job or occupational-therapy collision'

  const rejectsDirectories = plan.exclusions.some(value => /\b(?:directory|directories|aggregator|aggregators)\b/i.test(value))
    || plan.sourcePreferences.some(value => /official provider pages/i.test(value))
  if (rejectsDirectories && /\b(?:directory|find a provider|yellow pages|top \d+|best \d+)\b/i.test(normalizedText)) {
    return 'directory or aggregator excluded by the request'
  }
  return undefined
}

function sourcePreferenceScore(plan: SemanticIntentPlan, result: ScrapedResult, normalizedText: string): number {
  let score = 0
  const domain = result.domain.toLowerCase()
  for (const preference of plan.sourcePreferences) {
    if (/government/i.test(preference) && /\.(?:gov|us)$/.test(domain)) score += 8
    if (/direct documents/i.test(preference) && /\.pdf(?:$|[?#])/i.test(result.url)) score += 8
    if (/posted prices/i.test(preference) && /(?:\$|€|£|¥)\s?\d/.test(textForResult(result))) score += 8
    if (/official/i.test(preference) && /\b(?:official|about us|our services|locations|appointments)\b/i.test(normalizedText)) score += 5
  }
  return Math.min(16, score)
}

export function evaluateIntentRelevance(
  plan: SemanticIntentPlan,
  lens: SearchLens,
  result: ScrapedResult
): IntentRelevance {
  const normalizedText = normalize(textForResult(result))
  const tokens = new Set(normalizedText.split(' ').filter(Boolean))
  const required = plan.conceptGroups.filter(group => group.required)
  const matchedGroups = required.filter(group => groupMatches(group, normalizedText, tokens))
  const missingGroups = required.filter(group => !matchedGroups.includes(group))
  const totalWeight = required.reduce((sum, group) => sum + group.weight, 0) || 1
  const matchedWeight = matchedGroups.reduce((sum, group) => sum + group.weight, 0)
  const critical = required.filter(group => group.kind !== 'geography' && group.kind !== 'time')
  const matchedCritical = critical.filter(group => matchedGroups.includes(group))
  const criticalWeight = critical.reduce((sum, group) => sum + group.weight, 0) || 1
  const matchedCriticalWeight = matchedCritical.reduce((sum, group) => sum + group.weight, 0)
  const exclusions = plan.exclusions.filter(value => termMatches(value, normalizedText, tokens))
  const evidence = taskEvidence(plan, lens, result, normalizedText)
  const preferenceScore = sourcePreferenceScore(plan, result, normalizedText)
  const collision = collisionReason(plan, normalizedText)
  const coverage = matchedWeight / totalWeight
  const criticalCoverage = matchedCriticalWeight / criticalWeight

  let adjustment = Math.round((coverage - 0.5) * 44)
  adjustment += evidence.matched ? 8 : -18
  adjustment += preferenceScore
  if (exclusions.length > 0) adjustment -= 45
  if (collision) adjustment -= 45
  if (critical.length > 0 && matchedCritical.length === critical.length) adjustment += 12

  return {
    matchedGroups,
    missingGroups,
    exclusionMatches: exclusions,
    coverage,
    criticalCoverage,
    taskEvidence: evidence.matched,
    taskEvidenceReason: evidence.reason,
    sourcePreferenceScore: preferenceScore,
    collisionReason: collision,
    adjustment,
  }
}

export function intentRerankQuery(plan: SemanticIntentPlan): string {
  const requirements = plan.conceptGroups
    .filter(group => group.required)
    .map(group => group.label)
    .join('; ')
  const exclusions = plan.exclusions.length ? ` Exclude: ${plan.exclusions.join('; ')}.` : ''
  const sources = plan.sourcePreferences.length ? ` Prefer: ${plan.sourcePreferences.join('; ')}.` : ''
  return `${plan.interpretation} Required: ${requirements}.${exclusions}${sources}`.trim()
}
