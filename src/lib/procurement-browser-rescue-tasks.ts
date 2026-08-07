export interface ProcurementBrowserRescueTask {
  source: 'bing' | 'duckduckgo' | 'mojeek' | 'yahoo' | 'brave'
  query: string
}

const MAX_BROWSER_RESCUE_QUERIES = 4

export function buildProcurementBrowserRescueTasks(
  queries: string[]
): ProcurementBrowserRescueTask[] {
  const targeted = queries.slice(0, MAX_BROWSER_RESCUE_QUERIES)
  if (targeted.length === 0) return []

  // buildProcurementRescueQueries intentionally places four complementary
  // strategies first: literal procurement, buyer-language family, official
  // government, and direct-document discovery. Keep Bing as the broad sampler,
  // then spread those strategies across independent indexes instead of making
  // every engine repeat the same literal query.
  const literalQuery = targeted[0]
  const expandedQuery = targeted[1] || literalQuery
  const officialQuery = targeted[2] || literalQuery
  const documentQuery = targeted[3] || expandedQuery

  return [
    ...targeted.map(query => ({ source: 'bing' as const, query })),
    { source: 'duckduckgo' as const, query: literalQuery },
    { source: 'mojeek' as const, query: expandedQuery },
    { source: 'yahoo' as const, query: officialQuery },
    { source: 'brave' as const, query: documentQuery },
  ]
}
