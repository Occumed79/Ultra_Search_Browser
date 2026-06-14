import * as cheerio from 'cheerio'
import type { ScrapedResult } from '../types/search'

// ─── SPECIALIZED PROCUREMENT CRAWLERS ───
// SERVER-SIDE ONLY: This module must only be imported in server-side code (API routes, server components)
// Do not import this in client components or it will bundle heavy dependencies.

export type CrawlerStatus = 'success' | 'timeout' | 'blocked' | 'error' | 'empty' | 'failed' | 'unavailable'

export type SourceStatus = 'active' | 'experimental' | 'blocked' | 'empty' | 'failed' | 'unavailable'

export interface CrawlerDiagnostics {
  source: string
  sourceStatus: SourceStatus
  status: CrawlerStatus
  resultsCount: number
  urlAttempted?: string
  httpStatus?: number
  blockedDetection?: boolean
  error?: string
  latency?: number
}

function getSourceStatus(crawlerStatus: CrawlerStatus): SourceStatus {
  switch (crawlerStatus) {
    case 'success':
      return 'active'
    case 'blocked':
      return 'blocked'
    case 'empty':
      return 'empty'
    case 'failed':
    case 'unavailable':
      return 'failed'
    case 'timeout':
    case 'error':
    default:
      return 'experimental'
  }
}

function createDiagnostics(
  source: string,
  status: CrawlerStatus,
  resultsCount: number,
  urlAttempted?: string,
  httpStatus?: number,
  blockedDetection?: boolean,
  error?: string,
  latency?: number
): CrawlerDiagnostics {
  return {
    source,
    sourceStatus: getSourceStatus(status),
    status,
    resultsCount,
    urlAttempted,
    httpStatus,
    blockedDetection,
    error,
    latency,
  }
}

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

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
]

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

async function fetchWithTimeout(url: string, timeout = 10000, retryCount = 0): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      },
      signal: controller.signal,
    })
    clearTimeout(timer)
    return res
  } catch (err) {
    clearTimeout(timer)
    
    // Retry on timeout with exponential backoff
    if (retryCount < 2 && err instanceof Error && err.name === 'AbortError') {
      const delay = Math.pow(2, retryCount) * 1000
      await new Promise(resolve => setTimeout(resolve, delay))
      return fetchWithTimeout(url, timeout, retryCount + 1)
    }
    
    throw new Error(`Fetch timeout for ${url}`)
  }
}

/**
 * Crawl SAM.gov for federal procurement opportunities
 */
export async function crawlSAMGov(query: string): Promise<{ opportunities: ProcurementOpportunity[]; diagnostics: CrawlerDiagnostics }> {
  const opportunities: ProcurementOpportunity[] = []
  const startTime = Date.now()
  const searchUrl = `https://sam.gov/search/?keywords=${encodeURIComponent(query)}&index=opp&pageSize=10`
  
  try {
    const res = await fetchWithTimeout(searchUrl)
    
    if (!res.ok) {
      return {
        opportunities,
        diagnostics: createDiagnostics(
          'SAM.gov',
          res.status === 403 || res.status === 429 ? 'blocked' : 'error',
          0,
          searchUrl,
          res.status,
          false,
          `HTTP ${res.status}: ${res.statusText}`,
          Date.now() - startTime
        ),
      }
    }
    
    const html = await res.text()
    const $ = cheerio.load(html)
    
    // Check for blocked/limited content
    if (html.includes('Access Denied') || html.includes('captcha') || html.includes('bot detection')) {
      return {
        opportunities,
        diagnostics: createDiagnostics(
          'SAM.gov',
          'blocked',
          0,
          searchUrl,
          res.status,
          true,
          'Blocked by bot detection or access control',
          Date.now() - startTime
        ),
      }
    }
    
    $('.usa-card, .solicitation-card, .card, .listing, .opportunity, .result').each((_, el) => {
      const title = $(el).find('.usa-card__heading, .title, h3, h4, h2, .heading, .solicitation-title').first().text().trim()
      const link = $(el).find('a[href]').first().attr('href')
      const organization = $(el).find('.org-name, .agency, .organization, .entity, .department, .office').first().text().trim()
      const dueDate = $(el).find('.due-date, .deadline, .closing-date, .close-date, .response-date').first().text().trim()
      const postedDate = $(el).find('.posted-date, .post-date, .publish-date, .created-date').first().text().trim()
      
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
    
    return {
      opportunities,
      diagnostics: createDiagnostics(
        'SAM.gov',
        opportunities.length > 0 ? 'success' : 'empty',
        opportunities.length,
        searchUrl,
        res.status,
        false,
        undefined,
        Date.now() - startTime
      ),
    }
  } catch (err) {
    return {
      opportunities,
      diagnostics: createDiagnostics(
        'SAM.gov',
        'error',
        0,
        searchUrl,
        undefined,
        false,
        err instanceof Error ? err.message : 'Unknown error',
        Date.now() - startTime
      ),
    }
  }
}

/**
 * Crawl BonfireHub for procurement opportunities
 */
export async function crawlBonfireHub(query: string): Promise<{ opportunities: ProcurementOpportunity[]; diagnostics: CrawlerDiagnostics }> {
  const opportunities: ProcurementOpportunity[] = []
  const startTime = Date.now()
  const searchUrl = `https://bonfirehub.com/public/?q=${encodeURIComponent(query)}`
  
  try {
    const res = await fetchWithTimeout(searchUrl)
    
    if (!res.ok) {
      return {
        opportunities,
        diagnostics: createDiagnostics(
          'BonfireHub',
          res.status === 403 || res.status === 429 ? 'blocked' : 'error',
          0,
          searchUrl,
          res.status,
          false,
          `HTTP ${res.status}: ${res.statusText}`,
          Date.now() - startTime
        ),
      }
    }
    
    const html = await res.text()
    const $ = cheerio.load(html)
    
    if (html.includes('Access Denied') || html.includes('captcha') || html.includes('bot detection')) {
      return {
        opportunities,
        diagnostics: createDiagnostics(
          'BonfireHub',
          'blocked',
          0,
          searchUrl,
          res.status,
          true,
          'Blocked by bot detection or access control',
          Date.now() - startTime
        ),
      }
    }
    
    $('.opportunity-card, .card, .listing, .result, .item').each((_, el) => {
      const title = $(el).find('.opportunity-title, .title, h3, h4, h2, .heading').first().text().trim()
      const link = $(el).find('a[href]').first().attr('href')
      const organization = $(el).find('.organization, .agency, .entity, .department').first().text().trim()
      const dueDate = $(el).find('.closing-date, .deadline, .close-date, .response-date').first().text().trim()
      
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
    
    return {
      opportunities,
      diagnostics: createDiagnostics(
        'BonfireHub',
        opportunities.length > 0 ? 'success' : 'empty',
        opportunities.length,
        searchUrl,
        res.status,
        false,
        undefined,
        Date.now() - startTime
      ),
    }
  } catch (err) {
    return {
      opportunities,
      diagnostics: createDiagnostics(
        'BonfireHub',
        'error',
        0,
        searchUrl,
        undefined,
        false,
        err instanceof Error ? err.message : 'Unknown error',
        Date.now() - startTime
      ),
    }
  }
}

/**
 * Crawl PlanetBids for procurement opportunities
 */
export async function crawlPlanetBids(query: string): Promise<{ opportunities: ProcurementOpportunity[]; diagnostics: CrawlerDiagnostics }> {
  const opportunities: ProcurementOpportunity[] = []
  const startTime = Date.now()
  const searchUrl = `https://planetbids.com/search?q=${encodeURIComponent(query)}`
  
  try {
    const res = await fetchWithTimeout(searchUrl)
    
    if (!res.ok) {
      return {
        opportunities,
        diagnostics: createDiagnostics(
          'PlanetBids',
          res.status === 403 || res.status === 429 ? 'blocked' : 'error',
          0,
          searchUrl,
          res.status,
          false,
          `HTTP ${res.status}: ${res.statusText}`,
          Date.now() - startTime
        ),
      }
    }
    
    const html = await res.text()
    const $ = cheerio.load(html)
    
    if (html.includes('Access Denied') || html.includes('captcha') || html.includes('bot detection')) {
      return {
        opportunities,
        diagnostics: createDiagnostics(
          'PlanetBids',
          'blocked',
          0,
          searchUrl,
          res.status,
          true,
          'Blocked by bot detection or access control',
          Date.now() - startTime
        ),
      }
    }
    
    $('.bid-item, .card, .listing, .result, .item, .opportunity').each((_, el) => {
      const title = $(el).find('.bid-title, .title, h3, h4, h2, .heading').first().text().trim()
      const link = $(el).find('a[href]').first().attr('href')
      const organization = $(el).find('.agency, .organization, .entity, .department').first().text().trim()
      const dueDate = $(el).find('.due-date, .deadline, .close-date, .response-date').first().text().trim()
      
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
    
    return {
      opportunities,
      diagnostics: createDiagnostics(
        'PlanetBids',
        opportunities.length > 0 ? 'success' : 'empty',
        opportunities.length,
        searchUrl,
        res.status,
        false,
        undefined,
        Date.now() - startTime
      ),
    }
  } catch (err) {
    return {
      opportunities,
      diagnostics: createDiagnostics(
        'PlanetBids',
        'error',
        0,
        searchUrl,
        undefined,
        false,
        err instanceof Error ? err.message : 'Unknown error',
        Date.now() - startTime
      ),
    }
  }
}

/**
 * Crawl IonWave for procurement opportunities
 */
export async function crawlIonWave(query: string): Promise<{ opportunities: ProcurementOpportunity[]; diagnostics: CrawlerDiagnostics }> {
  const opportunities: ProcurementOpportunity[] = []
  const startTime = Date.now()
  const searchUrl = `https://ionwave.net/search?q=${encodeURIComponent(query)}`
  
  try {
    const res = await fetchWithTimeout(searchUrl)
    
    if (!res.ok) {
      return {
        opportunities,
        diagnostics: createDiagnostics(
          'IonWave',
          res.status === 403 || res.status === 429 ? 'blocked' : 'error',
          0,
          searchUrl,
          res.status,
          false,
          `HTTP ${res.status}: ${res.statusText}`,
          Date.now() - startTime
        ),
      }
    }
    
    const html = await res.text()
    const $ = cheerio.load(html)
    
    if (html.includes('Access Denied') || html.includes('captcha') || html.includes('bot detection')) {
      return {
        opportunities,
        diagnostics: createDiagnostics(
          'IonWave',
          'blocked',
          0,
          searchUrl,
          res.status,
          true,
          'Blocked by bot detection or access control',
          Date.now() - startTime
        ),
      }
    }
    
    $('.solicitation-item, .card, .listing, .result, .item, .opportunity').each((_, el) => {
      const title = $(el).find('.solicitation-title, .title, h3, h4, h2, .heading').first().text().trim()
      const link = $(el).find('a[href]').first().attr('href')
      const organization = $(el).find('.entity, .agency, .organization, .department').first().text().trim()
      const dueDate = $(el).find('.close-date, .deadline, .due-date, .response-date').first().text().trim()
      
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
    
    return {
      opportunities,
      diagnostics: createDiagnostics(
        'IonWave',
        opportunities.length > 0 ? 'success' : 'empty',
        opportunities.length,
        searchUrl,
        res.status,
        false,
        undefined,
        Date.now() - startTime
      ),
    }
  } catch (err) {
    return {
      opportunities,
      diagnostics: createDiagnostics(
        'IonWave',
        'error',
        0,
        searchUrl,
        undefined,
        false,
        err instanceof Error ? err.message : 'Unknown error',
        Date.now() - startTime
      ),
    }
  }
}

/**
 * Crawl BidNetDirect for procurement opportunities
 */
export async function crawlBidNetDirect(query: string): Promise<{ opportunities: ProcurementOpportunity[]; diagnostics: CrawlerDiagnostics }> {
  const opportunities: ProcurementOpportunity[] = []
  const startTime = Date.now()
  const searchUrl = `https://bidnetdirect.com/search?q=${encodeURIComponent(query)}`
  
  try {
    const res = await fetchWithTimeout(searchUrl)
    
    if (!res.ok) {
      return {
        opportunities,
        diagnostics: createDiagnostics(
          'BidNetDirect',
          res.status === 403 || res.status === 429 ? 'blocked' : 'error',
          0,
          searchUrl,
          res.status,
          false,
          `HTTP ${res.status}: ${res.statusText}`,
          Date.now() - startTime
        ),
      }
    }
    
    const html = await res.text()
    const $ = cheerio.load(html)
    
    if (html.includes('Access Denied') || html.includes('captcha') || html.includes('bot detection')) {
      return {
        opportunities,
        diagnostics: createDiagnostics(
          'BidNetDirect',
          'blocked',
          0,
          searchUrl,
          res.status,
          true,
          'Blocked by bot detection or access control',
          Date.now() - startTime
        ),
      }
    }
    
    $('.opportunity, .card, .listing, .result, .item, .bid-item').each((_, el) => {
      const title = $(el).find('.opp-title, .title, h3, h4, h2, .heading').first().text().trim()
      const link = $(el).find('a[href]').first().attr('href')
      const organization = $(el).find('.agency, .organization, .entity, .department').first().text().trim()
      const dueDate = $(el).find('.deadline, .due-date, .close-date, .response-date').first().text().trim()
      
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
    
    return {
      opportunities,
      diagnostics: createDiagnostics(
        'BidNetDirect',
        opportunities.length > 0 ? 'success' : 'empty',
        opportunities.length,
        searchUrl,
        res.status,
        false,
        undefined,
        Date.now() - startTime
      ),
    }
  } catch (err) {
    return {
      opportunities,
      diagnostics: createDiagnostics(
        'BidNetDirect',
        'error',
        0,
        searchUrl,
        undefined,
        false,
        err instanceof Error ? err.message : 'Unknown error',
        Date.now() - startTime
      ),
    }
  }
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
    
    // Check for blocked content
    if (html.includes('Access Denied') || html.includes('captcha') || html.includes('bot detection')) {
      return opportunities
    }
    
    $('.procurement-item, .bid-item, .rfp-item, .opportunity, .listing, .card, .result').each((_, el) => {
      const title = $(el).find('.title, h3, h4, h2, .heading, .opp-title, .solicitation-title').first().text().trim()
      const link = $(el).find('a[href]').first().attr('href')
      const dueDate = $(el).find('.due-date, .deadline, .closing, .close-date, .response-date').first().text().trim()
      
      if (title && link) {
        const fullUrl = link.startsWith('http') ? link : `https://www.${county.toLowerCase().replace(/\s+/g, '')}.gov${link}`
        
        let opportunityType: ProcurementOpportunity['opportunityType'] = 'procurement'
        if (/rfp/i.test(title)) opportunityType = 'RFP'
        else if (/rfq/i.test(title)) opportunityType = 'RFQ'
        else if (/solicitation/i.test(title)) opportunityType = 'solicitation'
        
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
 * Crawl GovernmentBids for procurement opportunities
 */
export async function crawlGovernmentBids(query: string): Promise<{ opportunities: ProcurementOpportunity[]; diagnostics: CrawlerDiagnostics }> {
  const opportunities: ProcurementOpportunity[] = []
  const startTime = Date.now()
  const searchUrl = `https://governmentbids.com/search?q=${encodeURIComponent(query)}`
  
  try {
    const res = await fetchWithTimeout(searchUrl)
    
    if (!res.ok) {
      return {
        opportunities,
        diagnostics: createDiagnostics(
          'GovernmentBids',
          res.status === 403 || res.status === 429 ? 'blocked' : 'error',
          0,
          searchUrl,
          res.status,
          false,
          `HTTP ${res.status}: ${res.statusText}`,
          Date.now() - startTime
        ),
      }
    }
    
    const html = await res.text()
    const $ = cheerio.load(html)
    
    if (html.includes('Access Denied') || html.includes('captcha') || html.includes('bot detection')) {
      return {
        opportunities,
        diagnostics: createDiagnostics(
          'GovernmentBids',
          'blocked',
          0,
          searchUrl,
          res.status,
          true,
          'Blocked by bot detection or access control',
          Date.now() - startTime
        ),
      }
    }
    
    $('.bid-item, .opportunity, .card, .listing, .result, .item').each((_, el) => {
      const title = $(el).find('.bid-title, .title, h3, h4, h2, .heading, .opp-title').first().text().trim()
      const link = $(el).find('a[href]').first().attr('href')
      const organization = $(el).find('.agency, .organization, .entity, .department, .gov').first().text().trim()
      const dueDate = $(el).find('.due-date, .deadline, .close-date, .response-date, .closing').first().text().trim()
      
      if (title && link) {
        const fullUrl = link.startsWith('http') ? link : `https://governmentbids.com${link}`
        
        let opportunityType: ProcurementOpportunity['opportunityType'] = 'procurement'
        if (/rfp/i.test(title)) opportunityType = 'RFP'
        else if (/rfq/i.test(title)) opportunityType = 'RFQ'
        else if (/solicitation/i.test(title)) opportunityType = 'solicitation'
        
        opportunities.push({
          id: fullUrl,
          title,
          organization: organization || 'Government Agency',
          opportunityType,
          dueDate: dueDate || undefined,
          documentUrl: fullUrl,
          sourceUrl: fullUrl,
          source: 'GovernmentBids',
          status: 'open',
        })
      }
    })
    
    return {
      opportunities,
      diagnostics: createDiagnostics(
        'GovernmentBids',
        opportunities.length > 0 ? 'success' : 'empty',
        opportunities.length,
        searchUrl,
        res.status,
        false,
        undefined,
        Date.now() - startTime
      ),
    }
  } catch (err) {
    return {
      opportunities,
      diagnostics: createDiagnostics(
        'GovernmentBids',
        'error',
        0,
        searchUrl,
        undefined,
        false,
        err instanceof Error ? err.message : 'Unknown error',
        Date.now() - startTime
      ),
    }
  }
}

/**
 * Crawl RFPDB for procurement opportunities
 */
export async function crawlRFPDB(query: string): Promise<{ opportunities: ProcurementOpportunity[]; diagnostics: CrawlerDiagnostics }> {
  const opportunities: ProcurementOpportunity[] = []
  const startTime = Date.now()
  const searchUrl = `https://rfpdb.com/search?q=${encodeURIComponent(query)}`
  
  try {
    const res = await fetchWithTimeout(searchUrl)
    
    if (!res.ok) {
      return {
        opportunities,
        diagnostics: createDiagnostics(
          'RFPDB',
          res.status === 403 || res.status === 429 ? 'blocked' : 'error',
          0,
          searchUrl,
          res.status,
          false,
          `HTTP ${res.status}: ${res.statusText}`,
          Date.now() - startTime
        ),
      }
    }
    
    const html = await res.text()
    const $ = cheerio.load(html)
    
    if (html.includes('Access Denied') || html.includes('captcha') || html.includes('bot detection')) {
      return {
        opportunities,
        diagnostics: createDiagnostics(
          'RFPDB',
          'blocked',
          0,
          searchUrl,
          res.status,
          true,
          'Blocked by bot detection or access control',
          Date.now() - startTime
        ),
      }
    }
    
    $('.rfp-item, .opportunity, .card, .listing, .result, .item').each((_, el) => {
      const title = $(el).find('.rfp-title, .title, h3, h4, h2, .heading, .opp-title').first().text().trim()
      const link = $(el).find('a[href]').first().attr('href')
      const organization = $(el).find('.agency, .organization, .entity, .department, .company').first().text().trim()
      const dueDate = $(el).find('.due-date, .deadline, .close-date, .response-date, .closing').first().text().trim()
      
      if (title && link) {
        const fullUrl = link.startsWith('http') ? link : `https://rfpdb.com${link}`
        
        let opportunityType: ProcurementOpportunity['opportunityType'] = 'procurement'
        if (/rfp/i.test(title)) opportunityType = 'RFP'
        else if (/rfq/i.test(title)) opportunityType = 'RFQ'
        else if (/solicitation/i.test(title)) opportunityType = 'solicitation'
        
        opportunities.push({
          id: fullUrl,
          title,
          organization: organization || 'Unknown',
          opportunityType,
          dueDate: dueDate || undefined,
          documentUrl: fullUrl,
          sourceUrl: fullUrl,
          source: 'RFPDB',
          status: 'open',
        })
      }
    })
    
    return {
      opportunities,
      diagnostics: createDiagnostics(
        'RFPDB',
        opportunities.length > 0 ? 'success' : 'empty',
        opportunities.length,
        searchUrl,
        res.status,
        false,
        undefined,
        Date.now() - startTime
      ),
    }
  } catch (err) {
    return {
      opportunities,
      diagnostics: createDiagnostics(
        'RFPDB',
        'error',
        0,
        searchUrl,
        undefined,
        false,
        err instanceof Error ? err.message : 'Unknown error',
        Date.now() - startTime
      ),
    }
  }
}

/**
 * Run all procurement crawlers in parallel
 */
export async function crawlAllProcurementSources(
  query: string,
  counties?: string[]
): Promise<{ opportunities: ProcurementOpportunity[]; diagnostics: CrawlerDiagnostics[] }> {
  const allOpportunities: ProcurementOpportunity[] = []
  const allDiagnostics: CrawlerDiagnostics[] = []
  
  // Run major procurement portals in parallel
  const [samGov, bonfire, planetBids, ionWave, bidNet, govBids, rfpdb] = await Promise.all([
    crawlSAMGov(query),
    crawlBonfireHub(query),
    crawlPlanetBids(query),
    crawlIonWave(query),
    crawlBidNetDirect(query),
    crawlGovernmentBids(query),
    crawlRFPDB(query),
  ])
  
  allOpportunities.push(
    ...samGov.opportunities,
    ...bonfire.opportunities,
    ...planetBids.opportunities,
    ...ionWave.opportunities,
    ...bidNet.opportunities,
    ...govBids.opportunities,
    ...rfpdb.opportunities
  )
  allDiagnostics.push(
    samGov.diagnostics,
    bonfire.diagnostics,
    planetBids.diagnostics,
    ionWave.diagnostics,
    bidNet.diagnostics,
    govBids.diagnostics,
    rfpdb.diagnostics
  )
  
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
  
  return { opportunities: deduplicated, diagnostics: allDiagnostics }
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
