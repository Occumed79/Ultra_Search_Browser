import { searchBingResilient } from './resilient-search'
import { applyIntentCandidateGate } from './search-intent-gate'
import { buildProcurementRescueQueries } from './procurement-rescue-queries'
import { searchGoogleScrape, type SearchEngineOptions } from './search'
import type { ScrapedResult } from '../types/search'

export interface ProcurementRescueDiagnostics {
  attemptedQueries: number
  attemptedTasks: number
  successfulTasks: number
  rawCandidates: number
  retainedCandidates: number
  failures: string[]
  queries: string[]
}

function normalizedUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined
    parsed.hash = ''
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (key.toLowerCase().startsWith('utm_') || ['fbclid', 'gclid'].includes(key.toLowerCase())) {
        parsed.searchParams.delete(key)
      }
    }
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

function mergeCandidates(
  entries: Array<{ engine: string; query: string; results: ScrapedResult[] }>
): ScrapedResult[] {
  const merged = new Map<string, ScrapedResult>()
  for (const entry of entries) {
    for (const raw of entry.results) {
      const url = normalizedUrl(raw.url)
      if (!url) continue
      const key = url.toLowerCase()
      const existing = merged.get(key)
      const next: ScrapedResult = {
        ...raw,
        url,
        domain: raw.domain || new URL(url).hostname.replace(/^www\./, ''),
        source: raw.source || entry.engine,
        retrieval: {
          sources: Array.from(new Set([...(raw.retrieval?.sources || []), entry.engine])),
          queries: Array.from(new Set([...(raw.retrieval?.queries || []), entry.query])),
          purposes: Array.from(new Set([...(raw.retrieval?.purposes || []), 'procurement-rescue'])),
          overlap: Math.max(1, raw.retrieval?.overlap || 1),
        },
      }
      if (!existing || next.score > existing.score) merged.set(key, next)
    }
  }
  return Array.from(merged.values())
}

export async function rescueProcurementCandidates(
  query: string,
  options: SearchEngineOptions
): Promise<{ results: ScrapedResult[]; diagnostics: ProcurementRescueDiagnostics }> {
  const queries = buildProcurementRescueQueries(query)
  const tasks = queries.flatMap(rescueQuery => [
    {
      engine: 'Google',
      query: rescueQuery,
      run: () => searchGoogleScrape(rescueQuery, options),
    },
    {
      engine: 'Bing',
      query: rescueQuery,
      run: () => searchBingResilient(rescueQuery, options),
    },
  ])

  const settled = await Promise.allSettled(tasks.map(async task => ({
    engine: task.engine,
    query: task.query,
    data: await task.run(),
  })))
  const successes: Array<{ engine: string; query: string; results: ScrapedResult[] }> = []
  const failures: string[] = []

  settled.forEach((item, index) => {
    const task = tasks[index]
    if (item.status === 'fulfilled') {
      successes.push({
        engine: item.value.engine,
        query: item.value.query,
        results: item.value.data.results,
      })
    } else {
      const message = item.reason instanceof Error ? item.reason.message : String(item.reason)
      failures.push(`${task.engine}: ${message}`)
    }
  })

  const rawCandidates = mergeCandidates(successes)
  const gated = applyIntentCandidateGate(query, 'procurement', rawCandidates)
  return {
    results: gated.results,
    diagnostics: {
      attemptedQueries: queries.length,
      attemptedTasks: tasks.length,
      successfulTasks: successes.length,
      rawCandidates: rawCandidates.length,
      retainedCandidates: gated.results.length,
      failures,
      queries,
    },
  }
}
