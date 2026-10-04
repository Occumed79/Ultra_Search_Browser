import { NextRequest } from 'next/server'
import { canonicalBuyerTerms, ensureRelevanceProfile, getRelevanceProfile } from '../../../../lib/canonical-relevance'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  await ensureRelevanceProfile()
  const query = request.nextUrl.searchParams.get('query')?.slice(0, 500) || ''
  return Response.json({ terms: canonicalBuyerTerms(query), source: getRelevanceProfile().source, version: getRelevanceProfile().version }, { headers: { 'Cache-Control': 'no-store' } })
}
