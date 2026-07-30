export interface ProcurementBrowserRescueTask {
  source: 'bing' | 'duckduckgo' | 'yahoo' | 'brave' | 'mojeek'
  query: string
}

const MAX_BROWSER_RESCUE_QUERIES = 4

export function buildProcurementBrowserRescueTasks(
  queries: string[]
): ProcurementBrowserRescueTask[] {
  const targeted = queries.slice(0, MAX_BROWSER_RESCUE_QUERIES)
  if (targeted.length === 0) return []

  return [
    ...targeted.map(query => ({ source: 'bing' as const, query })),
    { source: 'duckduckgo' as const, query: targeted[0] },
    { source: 'yahoo' as const, query: targeted[0] },
    { source: 'brave' as const, query: targeted[0] },
    { source: 'mojeek' as const, query: targeted[0] },
  ]
}
