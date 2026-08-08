export interface RetrievalCoverageInput {
  uniqueCandidateCount: number
  successfulSearches: number
  attemptedSearches: number
  minimumUniqueCandidates?: number
  minimumSuccessfulSearches?: number
}

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'referrer', 'source',
])

export function canonicalRetrievalUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return undefined
    url.hash = ''
    for (const key of Array.from(url.searchParams.keys())) {
      const lower = key.toLowerCase()
      if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) url.searchParams.delete(key)
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
    return url.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

export function distinctRetrievalCoverage(results: Array<{ url: string }>): number {
  const urls = new Set<string>()
  for (const result of results) {
    const canonical = canonicalRetrievalUrl(result.url)
    if (canonical) urls.add(canonical)
  }
  return urls.size
}

export function shouldRunDirectRescue(input: RetrievalCoverageInput): boolean {
  const minimumUniqueCandidates = Math.max(4, input.minimumUniqueCandidates ?? 12)
  const targetSuccessfulSearches = Math.max(
    1,
    Math.min(
      input.attemptedSearches,
      input.minimumSuccessfulSearches ?? Math.min(3, input.attemptedSearches)
    )
  )

  return input.uniqueCandidateCount < minimumUniqueCandidates
    || input.successfulSearches < targetSuccessfulSearches
}
