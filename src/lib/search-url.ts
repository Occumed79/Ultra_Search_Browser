import type { SearchLens } from '../types/search'

const VALID_LENSES = new Set<SearchLens>([
  'web',
  'pdf',
  'government',
  'procurement',
  'pricing',
  'provider',
  'technical',
  'news',
  'legal',
  'medical',
  'academic',
  'financial',
])

export interface SearchUrlState {
  query: string
  lens: SearchLens
}

export function parseSearchUrl(search: string): SearchUrlState | null {
  const params = new URLSearchParams(search)
  const query = params.get('q')?.trim() ?? ''
  if (!query) return null

  const requestedLens = params.get('lens') as SearchLens | null
  return {
    query,
    lens: requestedLens && VALID_LENSES.has(requestedLens) ? requestedLens : 'web',
  }
}

export function buildSearchPath(
  pathname: string,
  currentSearch: string,
  query: string,
  lens: SearchLens,
  hash = ''
): string {
  const params = new URLSearchParams(currentSearch)
  const normalizedQuery = query.trim()

  if (normalizedQuery) {
    params.set('q', normalizedQuery)
    params.set('lens', lens)
  } else {
    params.delete('q')
    params.delete('lens')
  }

  const search = params.toString()
  return `${pathname || '/'}${search ? `?${search}` : ''}${hash}`
}
