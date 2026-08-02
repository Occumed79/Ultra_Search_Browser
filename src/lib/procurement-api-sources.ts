import type { ScrapedResult } from '../types/search'

// SAM.gov API integration for federal procurement opportunities
const SAM_API_BASE = 'https://api.sam.gov/api/opportunities'

export interface SamGovOpportunity {
  opportunityId: string
  title: string
  solicitationNumber: string
  postedDate: string
  responseDeadline: string
  description: string
  organization: string
  location: string
  url: string
  type: string
  category: string
}

export async function searchSamGov(query: string, limit = 10): Promise<ScrapedResult[]> {
  try {
    const params = new URLSearchParams({
      api_key: process.env.SAM_GOV_API_KEY || '',
      q: query,
      limit: limit.toString(),
      mode: 'json',
    })

    const response = await fetch(`${SAM_API_BASE}?${params}`, {
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      console.error(`SAM.gov API error: ${response.status}`)
      return []
    }

    const data = await response.json()
    
    if (!data.opportunities || !Array.isArray(data.opportunities)) {
      return []
    }

    return data.opportunities
      .slice(0, limit)
      .map((opp: SamGovOpportunity) => ({
        title: opp.title,
        url: opp.url || `https://sam.gov/opportunity/${opp.opportunityId}`,
        description: opp.description || `${opp.organization} - ${opp.type}`,
        domain: 'sam.gov',
        source: 'SAM.gov',
        rank: 0,
        score: 1.0, // High score for official government source
        metadata: {
          solicitationNumber: opp.solicitationNumber,
          postedDate: opp.postedDate,
          responseDeadline: opp.responseDeadline,
          organization: opp.organization,
          location: opp.location,
        },
      }))
  } catch (error) {
    console.error('Error fetching from SAM.gov:', error)
    return []
  }
}

// BidNet Direct API integration
const BIDNET_API_BASE = 'https://api.bidnetdirect.com/v1'

export interface BidNetOpportunity {
  id: string
  title: string
  description: string
  agency: string
  dueDate: string
  postedDate: string
  url: string
  state: string
  category: string
}

export async function searchBidNet(query: string, limit = 10): Promise<ScrapedResult[]> {
  try {
    // Note: BidNet requires API key and authentication
    // This is a placeholder implementation
    if (!process.env.BIDNET_API_KEY) {
      console.warn('BidNet API key not configured')
      return []
    }

    const params = new URLSearchParams({
      q: query,
      limit: limit.toString(),
    })

    const response = await fetch(`${BIDNET_API_BASE}/opportunities?${params}`, {
      headers: {
        'Authorization': `Bearer ${process.env.BIDNET_API_KEY}`,
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      console.error(`BidNet API error: ${response.status}`)
      return []
    }

    const data = await response.json()
    
    if (!data.opportunities || !Array.isArray(data.opportunities)) {
      return []
    }

    return data.opportunities
      .slice(0, limit)
      .map((opp: BidNetOpportunity) => ({
        title: opp.title,
        url: opp.url || `https://www.bidnetdirect.com/opportunity/${opp.id}`,
        description: opp.description || `${opp.agency} - ${opp.state}`,
        domain: 'bidnetdirect.com',
        source: 'BidNet Direct',
        rank: 0,
        score: 0.9,
        metadata: {
          agency: opp.agency,
          dueDate: opp.dueDate,
          postedDate: opp.postedDate,
          state: opp.state,
          category: opp.category,
        },
      }))
  } catch (error) {
    console.error('Error fetching from BidNet:', error)
    return []
  }
}

// Combined procurement API search
export async function searchProcurementApis(query: string, limit = 20): Promise<ScrapedResult[]> {
  const results: ScrapedResult[] = []
  
  // Search SAM.gov
  try {
    const samResults = await searchSamGov(query, Math.floor(limit / 2))
    results.push(...samResults)
  } catch (error) {
    console.error('SAM.gov search failed:', error)
  }

  // Search BidNet
  try {
    const bidnetResults = await searchBidNet(query, Math.floor(limit / 2))
    results.push(...bidnetResults)
  } catch (error) {
    console.error('BidNet search failed:', error)
  }

  // Deduplicate by URL
  const seen = new Set<string>()
  const deduplicated: ScrapedResult[] = []
  
  for (const result of results) {
    if (!seen.has(result.url)) {
      seen.add(result.url)
      deduplicated.push(result)
    }
  }

  // Sort by score and return
  return deduplicated
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit)
}
