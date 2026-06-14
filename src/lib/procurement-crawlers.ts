import * as cheerio from 'cheerio'
import type { ScrapedResult } from '../types/search'

// ─── SPECIALIZED PROCUREMENT CRAWLERS ───

export interface ProcurementOpportunity {
  id: string
  title: string
  organization: string
  opportunityType: 'RFP' | 'RFQ' | 'RFT' | 'solicitation' | 'bid' | 'tender' | 'procurement'
  dueDate?: string
  postedDate?: string
  documentUrl: string
  sourceUrl: string
  source: string
  monetaryValue?: string
  status?: 'open' | 'active' | 'closed' | 'awarded'
  description?: string
  contactEmail?: string
  contactPhone?: string
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchWithTimeout(url: string, timeout = 10000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: controller.signal,
    })
    clearTimeout(timer)
    return res
  } catch {
    clearTimeout(timer)
    throw new Error(`Fetch timeout for ${url}`)
  }
}

/**
 * Crawl SAM.gov for federal procurement opportunities
 */
export async function crawlSAMGov(query: string): Promise<ProcurementOpportunity[]> {
  const opportunities: ProcurementOpportunity[] = []
  
  try {
    const searchUrl = `https://sam.gov/search/?keywords=${encodeURIComponent(query)}&index=opp&pageSize=10`
    const res = await fetchWithTimeout(searchUrl)
    if (!res.ok) return opportunities
    
    const html = await res.text()
    const $ = cheerio.load(html)
    
    $('.usa-card').each((_, el) => {
      const title = $(el).find('.usa-card__heading').first().text().trim()
      const link = $(el).find('a').first().attr('href')
      const organization = $(el).find('.org-name').first().text().trim()
      const dueDate = $(el).find('.due-date').first().text().trim()
      const postedDate = $(el).find('.posted-date').first().text().trim()
      
      if (title && link) {
        const fullUrl = link.startsWith('http') ? link : `https://sam.gov${link}`
        
        let opportunityType: ProcurementOpportunity['opportunityType'] = 'procurement'
        if (/rfp/i.test(title)) opportunityType = 'RFP'
        else if (/rfq/i.test(title)) opportunityType = 'RFQ'
        else if (/solicitation/i.test(title)) opportunityType = 'solicitation'
        
        opportunities.push({
          id: fullUrl,
          title,
          organization: organization || 'Federal Agency',
          opportunityType,
          dueDate: dueDate || undefined,
          postedDate: postedDate || undefined,
          documentUrl: fullUrl,
          sourceUrl: fullUrl,
          source: 'SAM.gov',
          status: 'open',
        })
      }
    })
  } catch (err) {
    console.warn('SAM.gov crawl failed:', err)
  }
  
  return opportunities
}

/**
 * Crawl BonfireHub for procurement opportunities
 */
export async function crawlBonfireHub(query: string): Promise<ProcurementOpportunity[]> {
  const opportunities: ProcurementOpportunity[] = []
  
  try {
    const searchUrl = `https://bonfirehub.com/public/?q=${encodeURIComponent(query)}`
    const res = await fetchWithTimeout(searchUrl)
    if (!res.ok) return opportunities
    
    const html = await res.text()
    const $ = cheerio.load(html)
    
    $('.opportunity-card').each((_, el) => {
      const title = $(el).find('.opportunity-title').first().text().trim()
      const link = $(el).find('a').first().attr('href')
      const organization = $(el).find('.organization').first().text().trim()
      const dueDate = $(el).find('.closing-date').first().text().trim()
      
      if (title && link) {
        const fullUrl = link.startsWith('http') ? link : `https://bonfirehub.com${link}`
        
        let opportunityType: ProcurementOpportunity['opportunityType'] = 'procurement'
        if (/rfp/i.test(title)) opportunityType = 'RFP'
        else if (/rfq/i.test(title)) opportunityType = 'RFQ'
        
        opportunities.push({
          id: fullUrl,
          title,
          organization: organization || 'Unknown',
          opportunityType,
          dueDate: dueDate || undefined,
          documentUrl: fullUrl,
          sourceUrl: fullUrl,
          source: 'BonfireHub',
          status: 'open',
        })
      }
    })
  } catch (err) {
    console.warn('BonfireHub crawl failed:', err)
  }
  
  return opportunities
}

/**
 * Crawl PlanetBids for procurement opportunities
 */
export async function crawlPlanetBids(query: string): Promise<ProcurementOpportunity[]> {
  const opportunities: ProcurementOpportunity[] = []
  
  try {
    const searchUrl = `https://planetbids.com/search?q=${encodeURIComponent(query)}`
    const res = await fetchWithTimeout(searchUrl)
    if (!res.ok) return opportunities
    
    const html = await res.text()
    const $ = cheerio.load(html)
    
    $('.bid-item').each((_, el) => {
      const title = $(el).find('.bid-title').first().text().trim()
      const link = $(el).find('a').first().attr('href')
      const organization = $(el).find('.agency').first().text().trim()
      const dueDate = $(el).find('.due-date').first().text().trim()
      
      if (title && link) {
        const fullUrl = link.startsWith('http') ? link : `https://planetbids.com${link}`
        
        let opportunityType: ProcurementOpportunity['opportunityType'] = 'procurement'
        if (/rfp/i.test(title)) opportunityType = 'RFP'
        else if (/rfq/i.test(title)) opportunityType = 'RFQ'
        
        opportunities.push({
          id: fullUrl,
          title,
          organization: organization || 'Unknown',
          opportunityType,
          dueDate: dueDate || undefined,
          documentUrl: fullUrl,
          sourceUrl: fullUrl,
          source: 'PlanetBids',
          status: 'open',
        })
      }
    })
  } catch (err) {
    console.warn('PlanetBids crawl failed:', err)
  }
  
  return opportunities
}

/**
 * Crawl IonWave for procurement opportunities
 */
export async function crawlIonWave(query: string): Promise<ProcurementOpportunity[]> {
  const opportunities: ProcurementOpportunity[] = []
  
  try {
    const searchUrl = `https://ionwave.net/search?q=${encodeURIComponent(query)}`
    const res = await fetchWithTimeout(searchUrl)
    if (!res.ok) return opportunities
    
    const html = await res.text()
    const $ = cheerio.load(html)
    
    $('.solicitation-item').each((_, el) => {
      const title = $(el).find('.solicitation-title').first().text().trim()
      const link = $(el).find('a').first().attr('href')
      const organization = $(el).find('.entity').first().text().trim()
      const dueDate = $(el).find('.close-date').first().text().trim()
      
      if (title && link) {
        const fullUrl = link.startsWith('http') ? link : `https://ionwave.net${link}`
        
        let opportunityType: ProcurementOpportunity['opportunityType'] = 'procurement'
        if (/rfp/i.test(title)) opportunityType = 'RFP'
        else if (/rfq/i.test(title)) opportunityType = 'RFQ'
        
        opportunities.push({
          id: fullUrl,
          title,
          organization: organization || 'Unknown',
          opportunityType,
          dueDate: dueDate || undefined,
          documentUrl: fullUrl,
          sourceUrl: fullUrl,
          source: 'IonWave',
          status: 'open',
        })
      }
    })
  } catch (err) {
    console.warn('IonWave crawl failed:', err)
  }
  
  return opportunities
}

/**
 * Crawl BidNetDirect for procurement opportunities
 */
export async function crawlBidNetDirect(query: string): Promise<ProcurementOpportunity[]> {
  const opportunities: ProcurementOpportunity[] = []
  
  try {
    const searchUrl = `https://bidnetdirect.com/search?q=${encodeURIComponent(query)}`
    const res = await fetchWithTimeout(searchUrl)
    if (!res.ok) return opportunities
    
    const html = await res.text()
    const $ = cheerio.load(html)
    
    $('.opportunity').each((_, el) => {
      const title = $(el).find('.opp-title').first().text().trim()
      const link = $(el).find('a').first().attr('href')
      const organization = $(el).find('.agency').first().text().trim()
      const dueDate = $(el).find('.deadline').first().text().trim()
      
      if (title && link) {
        const fullUrl = link.startsWith('http') ? link : `https://bidnetdirect.com${link}`
        
        let opportunityType: ProcurementOpportunity['opportunityType'] = 'procurement'
        if (/rfp/i.test(title)) opportunityType = 'RFP'
        else if (/rfq/i.test(title)) opportunityType = 'RFQ'
        
        opportunities.push({
          id: fullUrl,
          title,
          organization: organization || 'Unknown',
          opportunityType,
          dueDate: dueDate || undefined,
          documentUrl: fullUrl,
          sourceUrl: fullUrl,
          source: 'BidNetDirect',
          status: 'open',
        })
      }
    })
  } catch (err) {
    console.warn('BidNetDirect crawl failed:', err)
  }
  
  return opportunities
}

/**
 * Crawl county procurement portals (generic pattern)
 */
export async function crawlCountyPortals(query: string, county: string): Promise<ProcurementOpportunity[]> {
  const opportunities: ProcurementOpportunity[] = []
  
  try {
    const searchUrl = `https://www.${county.toLowerCase().replace(/\s+/g, '')}.gov/procurement?q=${encodeURIComponent(query)}`
    const res = await fetchWithTimeout(searchUrl)
    if (!res.ok) return opportunities
    
    const html = await res.text()
    const $ = cheerio.load(html)
    
    $('.procurement-item, .bid-item, .rfp-item').each((_, el) => {
      const title = $(el).find('.title, h3, h4').first().text().trim()
      const link = $(el).find('a').first().attr('href')
      const dueDate = $(el).find('.due-date, .deadline, .closing').first().text().trim()
      
      if (title && link) {
        const fullUrl = link.startsWith('http') ? link : `https://www.${county.toLowerCase().replace(/\s+/g, '')}.gov${link}`
        
        let opportunityType: ProcurementOpportunity['opportunityType'] = 'procurement'
        if (/rfp/i.test(title)) opportunityType = 'RFP'
        else if (/rfq/i.test(title)) opportunityType = 'RFQ'
        
        opportunities.push({
          id: fullUrl,
          title,
          organization: county,
          opportunityType,
          dueDate: dueDate || undefined,
          documentUrl: fullUrl,
          sourceUrl: fullUrl,
          source: `County: ${county}`,
          status: 'open',
        })
      }
    })
  } catch (err) {
    console.warn(`County portal crawl failed for ${county}:`, err)
  }
  
  return opportunities
}

/**
 * Run all procurement crawlers in parallel
 */
export async function crawlAllProcurementSources(
  query: string,
  counties?: string[]
): Promise<ProcurementOpportunity[]> {
  const allOpportunities: ProcurementOpportunity[] = []
  
  // Run major procurement portals in parallel
  const [samGov, bonfire, planetBids, ionWave, bidNet] = await Promise.all([
    crawlSAMGov(query),
    crawlBonfireHub(query),
    crawlPlanetBids(query),
    crawlIonWave(query),
    crawlBidNetDirect(query),
  ])
  
  allOpportunities.push(...samGov, ...bonfire, ...planetBids, ...ionWave, ...bidNet)
  
  // Crawl county portals if specified
  if (counties && counties.length > 0) {
    const countyResults = await Promise.all(
      counties.map(county => crawlCountyPortals(query, county))
    )
    countyResults.forEach(results => allOpportunities.push(...results))
  }
  
  // Deduplicate by URL
  const seen = new Set<string>()
  const deduplicated = allOpportunities.filter(opp => {
    if (seen.has(opp.id)) return false
    seen.add(opp.id)
    return true
  })
  
  return deduplicated
}

/**
 * Convert procurement opportunities to ScrapedResult format
 */
export function procurementToScrapedResult(opp: ProcurementOpportunity): ScrapedResult {
  return {
    title: opp.title,
    url: opp.documentUrl,
    description: `${opp.organization} - ${opp.opportunityType}${opp.dueDate ? ` - Due: ${opp.dueDate}` : ''}`,
    domain: new URL(opp.documentUrl).hostname.replace(/^www\./, ''),
    source: opp.source,
    rank: 0,
    score: 0,
    resultType: 'procurement',
  }
}
