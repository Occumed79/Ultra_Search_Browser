import type { ScrapedResult } from '../types/search'

const ELIGIBLE_LIFECYCLE_STATUSES = new Set(['open', 'active', 'current', 'unknown'])

export function isVerifiedResult(result: ScrapedResult): boolean {
  const lifecycle = result.pageValidation?.lifecycle.status
  return Boolean(
    result.url
    && result.title
    && result.bucket === 'valid'
    && result.validation?.status === 'valid'
    && result.pageValidation?.availability === 'reachable'
    && lifecycle
    && ELIGIBLE_LIFECYCLE_STATUSES.has(lifecycle)
  )
}

export function verifiedResultsOnly(results: ScrapedResult[]): ScrapedResult[] {
  return results.filter(isVerifiedResult)
}
