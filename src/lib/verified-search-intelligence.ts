import type { ScrapedResult, SearchLens } from '../types/search'

function resultDomain(result: ScrapedResult): string {
  if (result.domain) return result.domain
  try {
    return new URL(result.url).hostname.replace(/^www\./, '')
  } catch {
    return 'unknown source'
  }
}

export function verifiedSearchSummary(
  query: string,
  lens: SearchLens,
  results: ScrapedResult[]
): string {
  if (results.length === 0) {
    return `No destination page passed the complete-query evidence review for “${query}.” Try a broader location, date range, or related procurement term.`
  }

  const top = results.slice(0, 3)
    .map(result => `“${result.title.replace(/\s+/g, ' ').trim().slice(0, 100)}” (${resultDomain(result)})`)
    .join('; ')

  return `Verified ${results.length} destination page${results.length === 1 ? '' : 's'} for “${query}” using the ${lens} lens. Strongest evidence: ${top}.`
}

export function verifiedSearchConfidence(results: ScrapedResult[]): number {
  if (results.length === 0) return 0

  const averageRelevance = results.reduce(
    (total, result) => total + Math.max(0, Math.min(1, result.validation?.relevance || 0)),
    0
  ) / results.length
  const sourceCount = new Set(
    results.flatMap(result => result.retrieval?.sources || [result.source])
  ).size
  const evidenceCount = results.reduce(
    (total, result) => total + (result.pageValidation?.evidence.length || 0),
    0
  )

  return Math.min(96, Math.round(
    averageRelevance * 72
    + Math.min(14, sourceCount * 4)
    + Math.min(10, evidenceCount * 2)
  ))
}
