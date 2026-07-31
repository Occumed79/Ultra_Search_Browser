import { hasDatabase, query } from './db'
import type { RfpOpportunityIntelligence } from './rfp-opportunity-intelligence'
import type { ScrapedResult } from '../types/search'

interface FeedbackRow {
  url: string
  good_count: number | string | null
  bad_count: number | string | null
}

interface LearningRow {
  url: string
  title: string | null
  snippet: string | null
  metadata: unknown
  feedback_type: string
  notes: string | null
}

type LearningResult = ScrapedResult & {
  rfpIntelligence?: RfpOpportunityIntelligence
}

const POSITIVE_FEEDBACK: Record<string, number> = {
  good_result: 1,
  pursue: 1.7,
  strong_match: 1.45,
  possible_match: 0.65,
  subcontract_only: 0.45,
  submitted: 1.8,
  awarded: 2.2,
}

const NEGATIVE_FEEDBACK: Record<string, number> = {
  bad_result: -1,
  wrong_service: -1.6,
  treatment_contract: -1.8,
  staffing_contract: -1.8,
  equipment_purchase: -1.8,
  wrong_geography: -1.1,
  mandatory_disqualifier: -1.7,
  too_little_time: -0.65,
  expired: -1.9,
  duplicate: -0.7,
  not_solicitation: -2,
  decline: -1.2,
  lost: -0.35,
}

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'among', 'because', 'before', 'being', 'between',
  'contract', 'current', 'document', 'from', 'have', 'into', 'opportunity', 'procurement', 'proposal',
  'request', 'result', 'services', 'shall', 'that', 'their', 'there', 'these', 'this', 'through', 'with',
  'would', 'your', 'rfp', 'rfq', 'rfi', 'solicitation', 'the', 'and', 'for', 'are', 'not', 'only',
])

function numericCount(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function normalizeText(value: string): string {
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
    normalizeText(value)
      .split(' ')
      .filter(token => token.length >= 4 && !STOP_WORDS.has(token))
  )).slice(0, 120)
}

function metadataText(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function resultLearningText(result: LearningResult): string {
  const intelligence = result.rfpIntelligence
  return [
    result.title,
    result.description,
    result.domain,
    intelligence?.organization,
    intelligence?.placeOfPerformance,
    intelligence?.serviceSummary.join(' '),
    intelligence?.matchedCapabilities.join(' '),
    intelligence?.matchedBuyerSegments.join(' '),
    intelligence?.deliveryModel,
    intelligence?.mandatoryCredentials.join(' '),
    intelligence?.concerns.join(' '),
  ].filter(Boolean).join(' ')
}

function feedbackWeight(type: string): number {
  return POSITIVE_FEEDBACK[type] ?? NEGATIVE_FEEDBACK[type] ?? 0
}

function semanticLearningAdjustments(rows: LearningRow[]): Map<string, number> {
  const tokenWeights = new Map<string, number>()
  for (const row of rows) {
    const weight = feedbackWeight(row.feedback_type)
    if (!weight) continue
    const text = [row.title, row.snippet, row.notes, metadataText(row.metadata)].filter(Boolean).join(' ')
    const rowTokens = tokens(text)
    const perToken = weight / Math.max(4, Math.sqrt(rowTokens.length || 1))
    for (const token of rowTokens) {
      tokenWeights.set(token, Math.max(-4, Math.min(4, (tokenWeights.get(token) || 0) + perToken)))
    }
  }
  return tokenWeights
}

/**
 * Convert repeated useful/not-useful feedback into a bounded exact-URL score
 * adjustment. A confidence ramp prevents one click from overpowering evidence.
 */
export function feedbackScoreAdjustment(goodCount: number, badCount: number): number {
  const good = Math.max(0, goodCount)
  const bad = Math.max(0, badCount)
  const total = good + bad
  if (total === 0) return 0

  const direction = (good - bad) / total
  const confidence = Math.min(1, total / 5)
  return Number((direction * confidence * 18).toFixed(2))
}

export function pursuitLearningAdjustment(result: ScrapedResult, tokenWeights: Map<string, number>): number {
  if (tokenWeights.size === 0) return 0
  const resultTokens = tokens(resultLearningText(result as LearningResult))
  if (resultTokens.length === 0) return 0
  const matched = resultTokens
    .map(token => tokenWeights.get(token) || 0)
    .filter(weight => weight !== 0)
  if (matched.length === 0) return 0

  const sum = matched.reduce((total, value) => total + value, 0)
  const evidenceConfidence = Math.min(1, matched.length / 8)
  return Number(Math.max(-14, Math.min(14, sum * evidenceConfidence * 2.2)).toFixed(2))
}

export async function applyResultFeedbackRanking(results: ScrapedResult[]): Promise<ScrapedResult[]> {
  if (!hasDatabase() || results.length === 0) return results

  const urls = Array.from(new Set(results.map(result => result.url).filter(Boolean)))
  if (urls.length === 0) return results

  const exactAdjustments = new Map<string, number>()
  let tokenWeights = new Map<string, number>()

  try {
    const response = await query(
      `SELECT
         sr.url,
         COUNT(*) FILTER (WHERE rf.feedback_type IN ('good_result', 'pursue', 'strong_match', 'submitted', 'awarded')) AS good_count,
         COUNT(*) FILTER (WHERE rf.feedback_type IN ('bad_result', 'wrong_service', 'treatment_contract', 'staffing_contract', 'equipment_purchase', 'wrong_geography', 'mandatory_disqualifier', 'expired', 'not_solicitation', 'decline')) AS bad_count
       FROM result_feedback rf
       INNER JOIN search_results sr ON sr.id = rf.result_id
       WHERE sr.url = ANY($1::text[])
       GROUP BY sr.url`,
      [urls]
    )

    for (const row of (response?.rows ?? []) as FeedbackRow[]) {
      exactAdjustments.set(
        row.url,
        feedbackScoreAdjustment(numericCount(row.good_count), numericCount(row.bad_count))
      )
    }
  } catch (error) {
    console.warn('Exact result feedback ranking failed:', error)
  }

  try {
    const response = await query(
      `SELECT sr.url, sr.title, sr.snippet, sr.metadata, rf.feedback_type, rf.notes
       FROM result_feedback rf
       INNER JOIN search_results sr ON sr.id = rf.result_id
       WHERE rf.feedback_type = ANY($1::text[])
       ORDER BY rf.created_at DESC
       LIMIT 500`,
      [[...Object.keys(POSITIVE_FEEDBACK), ...Object.keys(NEGATIVE_FEEDBACK)]]
    )
    tokenWeights = semanticLearningAdjustments((response?.rows ?? []) as LearningRow[])
  } catch (error) {
    console.warn('Pursuit-pattern learning failed:', error)
  }

  return results
    .map(result => ({
      ...result,
      score: result.score
        + (exactAdjustments.get(result.url) ?? 0)
        + pursuitLearningAdjustment(result, tokenWeights),
    }))
    .sort((left, right) => right.score - left.score)
    .map((result, index) => ({ ...result, rank: index + 1 }))
}
