import { searchInsightHubOpportunities } from './insight-hub-source'
import { orchestrateSearch, type OrchestratedSearch } from './search-orchestrator'
import type { SearchPlan } from './search-settings'
import type { ScrapedResult, SearchLens } from '../types/search'

export interface AdapterAwareDiagnostics {
  insightHubConfigured: boolean
  insightHubMatches: number
  insightHubTotal: number
  insightHubError?: string
}

export type AdapterAwareSearch = OrchestratedSearch & {
  diagnostics: OrchestratedSearch['diagnostics'] & AdapterAwareDiagnostics
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of Array.from(url.searchParams.keys())) {
      const lowered = key.toLowerCase()
      if (lowered.startsWith('utm_') || lowered === 'gclid' || lowered === 'fbclid') {
        url.searchParams.delete(key)
      }
    }
    return url.toString().replace(/\/$/, '').toLowerCase()
  } catch {
    return value.trim().toLowerCase()
  }
}

function queryOverlap(query: string, result: ScrapedResult): number {
  const terms = Array.from(new Set(
    query.toLowerCase().split(/[^a-z0-9]+/).filter(term => term.length > 2)
  ))
  if (!terms.length) return 0
  const text = `${result.title} ${result.description}`.toLowerCase()
  return terms.filter(term => text.includes(term)).length / terms.length
}

function liveAnchor(results: ScrapedResult[]): number {
  if (!results.length) return 88
  const sorted = results.map(result => result.score).filter(Number.isFinite).sort((a, b) => b - a)
  if (!sorted.length) return 88
  return sorted[Math.min(4, sorted.length - 1)]
}

function blendAdapterResults(
  currentResults: ScrapedResult[],
  adapterResults: ScrapedResult[],
  query: string,
  limit: number
): ScrapedResult[] {
  const anchor = liveAnchor(currentResults)
  const combined = new Map<string, ScrapedResult>()

  for (const result of currentResults) combined.set(normalizeUrl(result.url), result)

  for (const adapterResult of adapterResults) {
    const key = normalizeUrl(adapterResult.url)
    const existing = combined.get(key)
    const relevance = Math.max(0, Math.min(100, adapterResult.score || 0))
    const adapterScore = anchor + (relevance - 50) * 0.22 + queryOverlap(query, adapterResult) * 14

    if (existing) {
      const retrieval = existing.retrieval || { sources: [], queries: [], purposes: [], overlap: 0 }
      combined.set(key, {
        ...existing,
        score: existing.score + 16,
        intelligence: existing.intelligence || adapterResult.intelligence,
        retrieval: {
          sources: Array.from(new Set([...retrieval.sources, 'insight-hub-adapters'])),
          queries: Array.from(new Set([...retrieval.queries, query])),
          purposes: Array.from(new Set([...retrieval.purposes, 'portal'])),
          overlap: Math.max(retrieval.overlap, 2),
        },
      })
      continue
    }

    combined.set(key, {
      ...adapterResult,
      score: adapterScore,
      retrieval: {
        sources: ['insight-hub-adapters'],
        queries: [query],
        purposes: ['portal'],
        overlap: 1,
      },
    })
  }

  return Array.from(combined.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((result, index) => ({ ...result, rank: index + 1 }))
}

export async function orchestrateSearchWithAdapters(
  rawQuery: string,
  requestedLens: SearchLens,
  plan: SearchPlan
): Promise<AdapterAwareSearch> {
  const orchestration = await orchestrateSearch(rawQuery, requestedLens, plan)
  const baseDiagnostics: AdapterAwareDiagnostics = {
    insightHubConfigured: Boolean(process.env.INSIGHT_HUB_API_URL?.trim()),
    insightHubMatches: 0,
    insightHubTotal: 0,
  }

  if (orchestration.lens !== 'procurement' || !baseDiagnostics.insightHubConfigured) {
    return {
      ...orchestration,
      diagnostics: { ...orchestration.diagnostics, ...baseDiagnostics },
    }
  }

  try {
    const insightHub = await searchInsightHubOpportunities(orchestration.normalizedQuery, 50)
    const results = blendAdapterResults(
      orchestration.results,
      insightHub.results,
      orchestration.normalizedQuery,
      plan.resultsPerPage
    )

    return {
      ...orchestration,
      results,
      rawTexts: insightHub.text ? [...orchestration.rawTexts, insightHub.text] : orchestration.rawTexts,
      sources: insightHub.results.length
        ? Array.from(new Set([...orchestration.sources, 'Insight Hub adapters']))
        : orchestration.sources,
      diagnostics: {
        ...orchestration.diagnostics,
        insightHubConfigured: insightHub.configured,
        insightHubMatches: insightHub.results.length,
        insightHubTotal: insightHub.total,
        sourceRuns: [
          ...orchestration.diagnostics.sourceRuns,
          {
            source: 'insight-hub-adapters',
            query: orchestration.normalizedQuery,
            purpose: 'portal',
            status: insightHub.results.length ? 'success' : 'empty',
            resultCount: insightHub.results.length,
            runtimeMs: 0,
          },
        ],
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ...orchestration,
      failures: [...orchestration.failures, `Insight Hub adapters: ${message}`],
      diagnostics: {
        ...orchestration.diagnostics,
        ...baseDiagnostics,
        insightHubError: message,
        sourceRuns: [
          ...orchestration.diagnostics.sourceRuns,
          {
            source: 'insight-hub-adapters',
            query: orchestration.normalizedQuery,
            purpose: 'portal',
            status: 'failed',
            resultCount: 0,
            runtimeMs: 0,
            error: message,
          },
        ],
      },
    }
  }
}
