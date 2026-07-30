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

  const exactQuery = targeted[0]
  return [
    ...targeted.map(query => ({ source: 'bing' as const, query })),
    { source: 'duckduckgo' as const, query: exactQuery },
    { source: 'mojeek' as const, query: exactQuery },
    { source: 'yahoo' as const, query: exactQuery },
    { source: 'brave' as const, query: exactQuery },
  ]
}
