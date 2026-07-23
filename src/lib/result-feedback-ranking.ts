import { hasDatabase, query } from './db'
import type { ScrapedResult } from '../types/search'

interface FeedbackRow {
  url: string
  good_count: number | string | null
  bad_count: number | string | null
}

function numericCount(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

/**
 * Convert repeated useful/not-useful feedback into a bounded score adjustment.
 * The confidence ramp prevents a single click from overpowering retrieval,
 * while repeated consistent feedback can move an exact URL meaningfully.
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

export async function applyResultFeedbackRanking(results: ScrapedResult[]): Promise<ScrapedResult[]> {
  if (!hasDatabase() || results.length === 0) return results

  const urls = Array.from(new Set(results.map(result => result.url).filter(Boolean)))
  if (urls.length === 0) return results

  try {
    const response = await query(
      `SELECT
         sr.url,
         COUNT(*) FILTER (WHERE rf.feedback_type = 'good_result') AS good_count,
         COUNT(*) FILTER (WHERE rf.feedback_type = 'bad_result') AS bad_count
       FROM result_feedback rf
       INNER JOIN search_results sr ON sr.id = rf.result_id
       WHERE sr.url = ANY($1::text[])
       GROUP BY sr.url`,
      [urls]
    )

    const adjustments = new Map<string, number>()
    for (const row of (response?.rows ?? []) as FeedbackRow[]) {
      adjustments.set(
        row.url,
        feedbackScoreAdjustment(numericCount(row.good_count), numericCount(row.bad_count))
      )
    }

    return results
      .map(result => ({
        ...result,
        score: result.score + (adjustments.get(result.url) ?? 0),
      }))
      .sort((left, right) => right.score - left.score)
      .map((result, index) => ({ ...result, rank: index + 1 }))
  } catch (error) {
    console.warn('Result feedback ranking failed:', error)
    return results
  }
}
