import type { ScrapedResult } from '../types/search'

// Helper function to check if an opportunity is still active
function isOpportunityActive(deadlineDate?: string, postedDate?: string): boolean {
  if (!deadlineDate && !postedDate) return true // No date info, assume active
  
  const now = new Date()
  
  // If we have a deadline, check if it's in the future
  if (deadlineDate) {
    const deadline = new Date(deadlineDate)
    if (deadline < now) return false
  }
  
  // If we only have a posted date, check if it's within the last 180 days
  if (postedDate && !deadlineDate) {
    const posted = new Date(postedDate)
    const daysSincePosted = (now.getTime() - posted.getTime()) / (1000 * 60 * 60 * 24)
    if (daysSincePosted > 180) return false
  }
  
  return true
}

// SAM.gov public API (free, no API key required for basic access)
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
    // SAM.gov requires an API key. Without it, we'll use site-specific search queries instead
    // This function now serves as a placeholder for when API key is available
    if (!process.env.SAM_GOV_API_KEY) {
      console.log('SAM.gov API key not configured, skipping direct API access')
      return []
    }

    const params = new URLSearchParams({
      q: query,
      limit: limit.toString(),
      mode: 'json',
      api_key: process.env.SAM_GOV_API_KEY,
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
      .filter((opp: SamGovOpportunity) => isOpportunityActive(opp.responseDeadline, opp.postedDate))
      .slice(0, limit)
      .map((opp: SamGovOpportunity) => ({
        title: opp.title,
        url: opp.url || `https://sam.gov/opportunity/${opp.opportunityId}`,
        description: opp.description || `${opp.organization} - ${opp.type}`,
        domain: 'sam.gov',
        source: 'SAM.gov',
        rank: 0,
        score: 1.0, // High score for official government source
        pageValidation: {
          checkedAt: new Date().toISOString(),
          requestedUrl: opp.url || `https://sam.gov/opportunity/${opp.opportunityId}`,
          finalUrl: opp.url || `https://sam.gov/opportunity/${opp.opportunityId}`,
          availability: 'reachable',
          reason: 'Active procurement opportunity from SAM.gov',
          evidence: [`Posted: ${opp.postedDate}`, opp.responseDeadline ? `Deadline: ${opp.responseDeadline}` : ''],
          extractedTextLength: opp.description?.length || 0,
          cached: false,
          lifecycle: {
            status: opp.responseDeadline && new Date(opp.responseDeadline) > new Date() ? 'open' : 'unknown',
            reason: 'Based on response deadline',
            confidence: 0.8,
            dates: [
              {
                kind: 'posted',
                value: opp.postedDate,
                iso: opp.postedDate,
                context: 'SAM.gov posting date',
              },
              ...(opp.responseDeadline ? [{
                kind: 'due',
                value: opp.responseDeadline,
                iso: opp.responseDeadline,
                context: 'SAM.gov response deadline',
              }] : []),
            ],
          },
        },
      }))
  } catch (error) {
    console.error('Error fetching from SAM.gov:', error)
    return []
  }
}

// USA.gov procurement RSS feed (free)
const USA_GOV_RSS = 'https://www.usa.gov/rss/procurement.xml'

export async function searchUsaGovRss(query: string, limit = 10): Promise<ScrapedResult[]> {
  try {
    const response = await fetch(USA_GOV_RSS)
    if (!response.ok) return []
    
    const text = await response.text()
    
    // Parse RSS feed
    const items = text.match(/<item>[\s\S]*?<\/item>/g) || []
    
    const queryLower = query.toLowerCase()
    
    const results: ScrapedResult[] = []
    
    for (const item of items.slice(0, limit * 2)) {
      const titleMatch = item.match(/<title>(.*?)<\/title>/)
      const linkMatch = item.match(/<link>(.*?)<\/link>/)
      const descMatch = item.match(/<description>(.*?)<\/description>/)
      const dateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/)
      
      if (!titleMatch || !linkMatch) continue
      
      const title = titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/, '$1')
      const link = linkMatch[1]
      const description = descMatch ? descMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/, '$1') : ''
      const pubDate = dateMatch ? dateMatch[1] : undefined
      
      // Check if item matches query
      const itemText = `${title} ${description}`.toLowerCase()
      if (!itemText.includes(queryLower)) continue
      
      // Check if opportunity is still active
      if (!isOpportunityActive(undefined, pubDate)) continue
      
      results.push({
        title,
        url: link,
        description,
        domain: 'usa.gov',
        source: 'USA.gov RSS',
        rank: 0,
        score: 0.9,
        pageValidation: {
          checkedAt: new Date().toISOString(),
          requestedUrl: link,
          finalUrl: link,
          availability: 'reachable',
          reason: 'Procurement opportunity from USA.gov RSS feed',
          evidence: pubDate ? [`Posted: ${pubDate}`] : [],
          extractedTextLength: description.length,
          cached: false,
          lifecycle: {
            status: 'open',
            reason: 'From RSS feed',
            confidence: 0.7,
            dates: pubDate ? [{
              kind: 'posted',
              value: pubDate,
              iso: pubDate,
              context: 'USA.gov RSS publication date',
            }] : [],
          },
        },
      })
      
      if (results.length >= limit) break
    }
    
    return results
  } catch (error) {
    console.error('Error fetching from USA.gov RSS:', error)
    return []
  }
}

// Government procurement portals (free web scraping)
const GOVERNMENT_PORTALS = [
  'https://www.maricopa.gov/2190/Solicitations',
  'https://solicitations.phoenix.gov',
  'https://procurement.cityofnewyork.us',
  'https://www.lacity.org/la-bids',
  'https://www.houstontx.gov/finance/purchasing/bids.html',
]

export async function searchGovernmentPortals(query: string, limit = 10): Promise<ScrapedResult[]> {
  const results: ScrapedResult[] = []
  
  for (const portal of GOVERNMENT_PORTALS.slice(0, 3)) { // Limit to 3 portals to avoid timeout
    try {
      const response = await fetch(portal, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      })
      
      if (!response.ok) continue
      
      const html = await response.text()
      const queryLower = query.toLowerCase()
      
      // Simple text-based search (in production, use proper HTML parsing)
      if (html.toLowerCase().includes(queryLower)) {
        const domain = new URL(portal).hostname.replace('www.', '')
        results.push({
          title: `${domain} - Procurement Opportunities`,
          url: portal,
          description: `Government procurement portal for ${domain}. Search for "${query}" to find relevant opportunities.`,
          domain,
          source: 'Government Portal',
          rank: 0,
          score: 0.8,
          pageValidation: {
            checkedAt: new Date().toISOString(),
            requestedUrl: portal,
            finalUrl: portal,
            availability: 'reachable',
            reason: 'Government procurement portal',
            evidence: [`Portal contains "${query}"`],
            extractedTextLength: html.length,
            cached: false,
            lifecycle: {
              status: 'open',
              reason: 'Active government portal',
              confidence: 0.6,
              dates: [],
            },
          },
        })
      }
    } catch (error) {
      console.error(`Error fetching ${portal}:`, error)
    }
  }
  
  return results.slice(0, limit)
}

// State government procurement sites (free)
const STATE_PROCUREMENT_SITES = [
  'https://www.capitol.texas.gov/Procurement/Search.aspx',
  'https://www.osc.state.ny.us/procurement/index.htm',
  'https://www.dgs.virginia.gov/procurement-opportunities/',
  'https://www.ebids.illinois.gov',
]

export async function searchStateProcurement(query: string, limit = 10): Promise<ScrapedResult[]> {
  const results: ScrapedResult[] = []
  
  for (const site of STATE_PROCUREMENT_SITES.slice(0, 2)) { // Limit to 2 sites
    try {
      const response = await fetch(site, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      })
      
      if (!response.ok) continue
      
      const html = await response.text()
      const queryLower = query.toLowerCase()
      
      if (html.toLowerCase().includes(queryLower)) {
        const domain = new URL(site).hostname.replace('www.', '')
        results.push({
          title: `${domain} - State Procurement`,
          url: site,
          description: `State procurement opportunities at ${domain}. Search for "${query}" to find relevant opportunities.`,
          domain,
          source: 'State Procurement',
          rank: 0,
          score: 0.75,
          pageValidation: {
            checkedAt: new Date().toISOString(),
            requestedUrl: site,
            finalUrl: site,
            availability: 'reachable',
            reason: 'State procurement portal',
            evidence: [`Site contains "${query}"`],
            extractedTextLength: html.length,
            cached: false,
            lifecycle: {
              status: 'open',
              reason: 'Active state procurement site',
              confidence: 0.6,
              dates: [],
            },
          },
        })
      }
    } catch (error) {
      console.error(`Error fetching ${site}:`, error)
    }
  }
  
  return results.slice(0, limit)
}

// Additional free procurement RSS feeds
const PROCUREMENT_RSS_FEEDS = [
  'https://www.grants.gov/rss/opportunities.xml',
  'https://www.fbo.gov/rss',
  'https://www.fbo.gov/rss2',
]

export async function searchProcurementRssFeeds(query: string, limit = 10): Promise<ScrapedResult[]> {
  const results: ScrapedResult[] = []
  const queryLower = query.toLowerCase()
  
  for (const feedUrl of PROCUREMENT_RSS_FEEDS.slice(0, 2)) {
    try {
      const response = await fetch(feedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      })
      
      if (!response.ok) continue
      
      const text = await response.text()
      const items = text.match(/<item>[\s\S]*?<\/item>/g) || []
      
      for (const item of items.slice(0, limit)) {
        const titleMatch = item.match(/<title>(.*?)<\/title>/)
        const linkMatch = item.match(/<link>(.*?)<\/link>/)
        const descMatch = item.match(/<description>(.*?)<\/description>/)
        const dateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/)
        
        if (!titleMatch || !linkMatch) continue
        
        const title = titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/, '$1')
        const link = linkMatch[1]
        const description = descMatch ? descMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/, '$1') : ''
        const pubDate = dateMatch ? dateMatch[1] : undefined
        
        const itemText = `${title} ${description}`.toLowerCase()
        if (!itemText.includes(queryLower)) continue
        
        if (!isOpportunityActive(undefined, pubDate)) continue
        
        const domain = new URL(link).hostname.replace('www.', '')
        results.push({
          title,
          url: link,
          description,
          domain,
          source: 'Procurement RSS',
          rank: 0,
          score: 0.85,
          pageValidation: {
            checkedAt: new Date().toISOString(),
            requestedUrl: link,
            finalUrl: link,
            availability: 'reachable',
            reason: 'Procurement opportunity from RSS feed',
            evidence: pubDate ? [`Posted: ${pubDate}`] : [],
            extractedTextLength: description.length,
            cached: false,
            lifecycle: {
              status: 'open',
              reason: 'From RSS feed',
              confidence: 0.7,
              dates: pubDate ? [{
                kind: 'posted',
                value: pubDate,
                iso: pubDate,
                context: 'RSS publication date',
              }] : [],
            },
          },
        })
        
        if (results.length >= limit) break
      }
      
      if (results.length >= limit) break
    } catch (error) {
      console.error(`Error fetching ${feedUrl}:`, error)
    }
  }
  
  return results
}

// Combined free procurement search
export async function searchProcurementApis(query: string, limit = 20): Promise<ScrapedResult[]> {
  const results: ScrapedResult[] = []
  
  // Search SAM.gov (free API - requires API key)
  try {
    const samResults = await searchSamGov(query, Math.floor(limit / 4))
    results.push(...samResults)
  } catch (error) {
    console.error('SAM.gov search failed:', error)
  }

  // Search USA.gov RSS (free)
  try {
    const rssResults = await searchUsaGovRss(query, Math.floor(limit / 4))
    results.push(...rssResults)
  } catch (error) {
    console.error('USA.gov RSS search failed:', error)
  }

  // Search procurement RSS feeds (free)
  try {
    const procurementRssResults = await searchProcurementRssFeeds(query, Math.floor(limit / 4))
    results.push(...procurementRssResults)
  } catch (error) {
    console.error('Procurement RSS search failed:', error)
  }

  // Search government portals (free web scraping)
  try {
    const portalResults = await searchGovernmentPortals(query, Math.floor(limit / 8))
    results.push(...portalResults)
  } catch (error) {
    console.error('Government portals search failed:', error)
  }

  // Search state procurement sites (free)
  try {
    const stateResults = await searchStateProcurement(query, Math.floor(limit / 8))
    results.push(...stateResults)
  } catch (error) {
    console.error('State procurement search failed:', error)
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
