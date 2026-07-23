import { scoreLexicalRelevance } from './semantic-search'
import type { ScrapedResult, SearchLens } from '../types/search'

export interface RankingPrecisionSignals {
  queryRelevance: number
  queryAdjustment: number
  lensAdjustment: number
  totalAdjustment: number
}

/**
 * Weak matches need an explicit penalty; otherwise an early upstream rank can
 * outweigh a result that covers substantially more of the user's query.
 */
export function queryRelevanceAdjustment(relevance: number): number {
  const normalized = Math.max(0, Math.min(1, relevance))
  if (normalized < 0.08) return -26
  if (normalized < 0.18) return -18
  if (normalized < 0.3) return -10
  if (normalized < 0.45) return -4
  return 0
}

function resultText(result: Pick<ScrapedResult, 'title' | 'description' | 'url' | 'domain'>): string {
  return `${result.title} ${result.description} ${result.url} ${result.domain}`.toLowerCase()
}

export function lensCompatibilityAdjustment(
  lens: SearchLens,
  result: Pick<ScrapedResult, 'title' | 'description' | 'url' | 'domain'>
): number {
  const text = resultText(result)
  const url = result.url.toLowerCase()

  if (lens === 'pdf') {
    const directPdf = /\.pdf(?:$|[?#])/i.test(url)
    const documentEvidence = /\b(pdf|download document|view document|document file)\b/i.test(text)
    return directPdf ? 10 : documentEvidence ? 2 : -18
  }

  if (lens === 'procurement') {
    const opportunityEvidence = /\b(rfp|rfq|ifb|rft|bid|solicitation|tender|request for proposals?|request for qualifications|proposal due|procurement opportunity|contract opportunity|vendor opportunity)\b/i.test(text)
    const careerEvidence = /\b(job opening|careers?|apply now|employment opportunity|vacanc(?:y|ies))\b/i.test(text)
    if (careerEvidence && !opportunityEvidence) return -28
    return opportunityEvidence ? 8 : -20
  }

  if (lens === 'pricing') {
    const pricingEvidence = /(?:\$|€|£|¥)\s?\d|\b(price|pricing|cost|fee schedule|fees?|rates?|cash pay|self-pay|chargemaster|price list|estimate)\b/i.test(text)
    return pricingEvidence ? 7 : -16
  }

  if (lens === 'government') {
    const officialDomain = /\.(?:gov|us)(?:$|:)/i.test(result.domain)
    const officialEvidence = /\b(official|department|agency|regulation|statute|government)\b/i.test(text)
    return officialDomain ? 7 : officialEvidence ? 2 : 0
  }

  if (lens === 'technical') {
    const technicalEvidence = /\b(documentation|api reference|developer guide|source code|repository|package|sdk|framework)\b/i.test(text)
      || /(?:github\.com|stackoverflow\.com|developer\.mozilla\.org|npmjs\.com)/i.test(text)
    const retailEvidence = /\b(shop now|clothing|homeware|add to bag|fashion)\b/i.test(text)
    if (retailEvidence && !technicalEvidence) return -20
    return technicalEvidence ? 5 : 0
  }

  return 0
}

export function calculateRankingPrecisionSignals(
  query: string,
  lens: SearchLens,
  result: Pick<ScrapedResult, 'title' | 'description' | 'url' | 'domain'>
): RankingPrecisionSignals {
  const queryRelevance = scoreLexicalRelevance(query, {
    title: result.title,
    text: `${result.title} ${result.description}`,
    url: result.url,
  })
  const queryAdjustment = queryRelevanceAdjustment(queryRelevance)
  const lensAdjustment = lensCompatibilityAdjustment(lens, result)

  return {
    queryRelevance,
    queryAdjustment,
    lensAdjustment,
    totalAdjustment: queryAdjustment + lensAdjustment,
  }
}
