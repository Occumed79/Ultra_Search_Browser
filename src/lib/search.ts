import * as cheerio from 'cheerio'
import {
  type IntelligenceObject,
  type ExpandedQuery,
  type SearchLens,
  expandQuery,
  scoreSignals,
  calculateConfidence,
  buildIntelligenceObject,
  LENS_CONFIGS,
} from './intelligence'
import { extractIntelligence } from './entity-extraction'
import { crawlAllProcurementSources, procurementToScrapedResult, type CrawlerDiagnostics } from './procurement-crawlers'
import { rerankResults } from './semantic-search'
import { fetchAndExtractFromURL, type ExtractionResult } from './document-extraction'
import { createVectorStoreAdapter, type VectorStoreAdapter, type SearchDocument } from './vector-store'
import { generateEmbedding, isEmbeddingsReady, initializeEmbeddings } from './embeddings'
import { searchCache, scrapeCache } from './cache'
import type { ScrapedResult } from '../types/search'

// Re-export intelligence types for consumers
export type { IntelligenceObject, ExpandedQuery, SearchLens }
export type { ScrapedResult }


export function extractWebsites(text: string, domainHint?: string): string[] {
  const urlRegex = /https?:\/\/(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[a-zA-Z0-9-._~:/?#[\]@!$&'()*+,;=]*)?/g
  const urls = [...text.matchAll(urlRegex)].map(m => m[0]).filter((v, i, a) => a.indexOf(v) === i)
  if (domainHint) {
    return urls.filter(u => u.toLowerCase().includes(domainHint.toLowerCase()))
  }
  return urls
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Score boost for procurement/PDF/government lenses
 * Boosts .gov, .us portals, PDFs, and procurement terms
 * Penalizes junk directories
 */
function scoreResultForLens(result: ScrapedResult, lens: SearchLens): number {
  let boost = 0
  const domain = result.domain.toLowerCase()
  const url = result.url.toLowerCase()
  const title = result.title.toLowerCase()
  const description = (result.description || '').toLowerCase()

  // Government/PDF/Procurement lens boosts
  if (['government', 'procurement', 'pdf'].includes(lens)) {
    // Strong boost for .gov domains
    if (domain.endsWith('.gov')) boost += 50
    // Boost for .us county/city/state portals
    if (domain.endsWith('.us') || domain.includes('.gov.') || domain.includes('county') || domain.includes('city') || domain.includes('state')) boost += 30
    // Boost for PDF files
    if (url.endsWith('.pdf')) boost += 40
    // Boost for procurement terms in title/description
    const procurementTerms = ['rfp', 'rfq', 'ifb', 'bid', 'solicitation', 'proposal', 'due date', 'addendum', 'tender', 'procurement']
    const hasProcurementTerm = procurementTerms.some(term => title.includes(term) || description.includes(term))
    if (hasProcurementTerm) boost += 25
  }

  // Occupational health specific boosts for procurement/pricing/provider lenses
  if (['procurement', 'pricing', 'provider'].includes(lens)) {
    const healthTerms = ['occupational health', 'occupational medicine', 'employee health', 'dot physical', 'pft', 'pulmonary function', 'drug screen', 'fit test', 'audiogram']
    const hasHealthTerm = healthTerms.some(term => title.includes(term) || description.includes(term))
    if (hasHealthTerm) boost += 20
  }

  // Penalize junk directories
  const junkPatterns = ['directory', 'listing', 'aggregator', 'portal', 'marketplace']
  const isJunk = junkPatterns.some(pattern => domain.includes(pattern) && !domain.includes('.gov'))
  if (isJunk) boost -= 20

  return boost
}

// --- Scraping-based search (no API keys) ---

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchWithTimeout(url: string, timeout = 8000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
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

export async function searchDuckDuckGo(query: string): Promise<{ text: string; results: ScrapedResult[] }> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetchWithTimeout(searchUrl)
  if (!res.ok) throw new Error(`DuckDuckGo error: ${res.status}`)

  const html = await res.text()
  const $ = cheerio.load(html)

  const results: ScrapedResult[] = []
  const snippets: string[] = []

  $('.result').each((_, el) => {
    const title = $(el).find('.result__a').first().text().trim()
    const href = $(el).find('.result__a').first().attr('href') || ''
    const desc = $(el).find('.result__snippet').first().text().trim()

    if (title && href) {
      const url = href.startsWith('http') ? href : `https:${href}`
      results.push({ title, url, description: desc, domain: extractDomain(url), source: 'DuckDuckGo', rank: results.length + 1, score: 0 })
      snippets.push(title, desc, url)
    }
  })

  return { text: snippets.join(' '), results }
}

export async function searchBingHTML(query: string): Promise<{ text: string; results: ScrapedResult[] }> {
  const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=20`
  const res = await fetchWithTimeout(searchUrl)
  if (!res.ok) throw new Error(`Bing error: ${res.status}`)

  const html = await res.text()
  const $ = cheerio.load(html)

  const results: ScrapedResult[] = []
  const snippets: string[] = []

  $('li.b_algo').each((_, el) => {
    const title = $(el).find('h2 a').first().text().trim()
    let href = $(el).find('h2 a').first().attr('href') || ''
    const desc = $(el).find('.b_caption p').first().text().trim()

    if (title && href) {
      if (!href.startsWith('http')) href = `https://www.bing.com${href}`
      results.push({ title, url: href, description: desc, domain: extractDomain(href), source: 'Bing', rank: results.length + 1, score: 0 })
      snippets.push(title, desc, href)
    }
  })

  return { text: snippets.join(' '), results }
}

function cleanGoogleUrl(href: string): string {
  if (href.startsWith('/url?q=')) {
    const match = href.match(/\/url\?q=([^&]+)/)
    if (match) return decodeURIComponent(match[1])
  }
  if (href.startsWith('http')) return href
  return `https://www.google.com${href}`
}

export async function searchGoogleScrape(query: string): Promise<{ text: string; results: ScrapedResult[] }> {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en`
  const res = await fetchWithTimeout(searchUrl)
  if (!res.ok) throw new Error(`Google error: ${res.status}`)

  const html = await res.text()
  const $ = cheerio.load(html)

  const results: ScrapedResult[] = []
  const snippets: string[] = []
  const seenUrls = new Set<string>()

  const selectors = ['.g', 'div[data-sokoban-container]']

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const title = $(el).find('h3').first().text().trim() || $(el).find('a[href^="/url"]').first().text().trim()
      let href = $(el).find('a[href^="/url"]').first().attr('href') || ''
      const desc = $(el).find('.VwiC3b').first().text().trim() || $(el).find('span').eq(2).text().trim()

      if (title && href) {
        const url = cleanGoogleUrl(href)
        if (url && !seenUrls.has(url) && url.startsWith('http')) {
          seenUrls.add(url)
          results.push({ title, url, description: desc, domain: extractDomain(url), source: 'Google', rank: results.length + 1, score: 0 })
          snippets.push(title, desc, url)
        }
      }
    })
    if (results.length > 0) break
  }

  return { text: snippets.join(' '), results }
}

export async function scrapeWebsite(url: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(url, 5000)
    if (!res.ok) return ''
    const html = await res.text()
    const $ = cheerio.load(html)
    // Remove script/style for cleaner text
    $('script, style, nav, header, footer').remove()
    return $('body').text().replace(/\s+/g, ' ')
  } catch {
    return ''
  }
}

export async function searchAllEngines(
  queries: string[],
  lens: SearchLens = 'web'
): Promise<{ text: string; sources: string[]; rawTexts: string[]; results: ScrapedResult[] }> {
  const texts: string[] = []
  const sources: string[] = []
  const rawTexts: string[] = []
  const allResults: ScrapedResult[] = []
  const seenUrls = new Set<string>()

  const engines = [
    { name: 'DuckDuckGo', fn: searchDuckDuckGo },
    { name: 'Bing', fn: searchBingHTML },
    { name: 'Google', fn: searchGoogleScrape },
  ]

  for (const query of queries) {
    for (const engine of engines) {
      try {
        const data = await engine.fn(query)
        if (data.text.trim().length > 50) {
          texts.push(data.text)
          rawTexts.push(data.text)
          sources.push(`${engine.name} (${query.slice(0, 40)})`)
        }
        for (const r of data.results) {
          if (r.url && !seenUrls.has(r.url) && r.title) {
            seenUrls.add(r.url)
            allResults.push(r)
          }
        }
      } catch (err) {
        console.warn(`${engine.name} failed for "${query}":`, err)
      }
    }
  }

  // Also try scraping the top website found
  const allText = texts.join(' ')
  const foundUrls = extractWebsites(allText)
  if (foundUrls.length > 0) {
    try {
      const siteText = await scrapeWebsite(foundUrls[0])
      if (siteText.length > 100) {
        texts.push(siteText)
        rawTexts.push(siteText)
        sources.push(`Direct: ${new URL(foundUrls[0]).hostname}`)
      }
    } catch {
      // ignore
    }
  }

  // Rank results by source diversity and deduplicate
  allResults.forEach((r, i) => { r.rank = i + 1 })

  // Apply lens-specific scoring boosts
  allResults.forEach(r => {
    r.score += scoreResultForLens(r, lens)
  })

  // Re-sort by boosted scores
  allResults.sort((a, b) => b.score - a.score)
  allResults.forEach((r, i) => { r.rank = i + 1 })

  return { text: texts.join(' '), sources, rawTexts, results: allResults }
}


// ─── VECTOR STORE INTEGRATION ───

let vectorStore: VectorStoreAdapter | null = null

async function getVectorStore(): Promise<VectorStoreAdapter | null> {
  if (vectorStore !== null) {
    return vectorStore
  }
  
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    return null
  }
  
  try {
    const pgvectorAdapter = createVectorStoreAdapter('pgvector', databaseUrl)
    if ('initialize' in pgvectorAdapter) {
      await (pgvectorAdapter as any).initialize()
    }
    vectorStore = pgvectorAdapter
    console.log('pgvector adapter initialized')
    return vectorStore
  } catch (err) {
    console.warn('Failed to initialize pgvector adapter:', err)
    return null
  }
}

async function indexDocumentsInVectorStore(results: ScrapedResult[], lens: SearchLens): Promise<void> {
  const store = await getVectorStore()
  if (!store) return
  
  // Initialize embeddings if not already done
  if (!isEmbeddingsReady()) {
    try {
      await initializeEmbeddings()
    } catch (err) {
      console.warn('Failed to initialize embeddings, indexing without embeddings:', err)
    }
  }
  
  const documents: SearchDocument[] = []
  
  for (const result of results) {
    const text = result.title + ' ' + (result.description || '')
    let embedding: number[] | undefined = undefined
    
    // Generate embedding if embeddings are available
    if (isEmbeddingsReady()) {
      try {
        embedding = await generateEmbedding(text)
      } catch (err) {
        console.warn('Failed to generate embedding for document:', err)
      }
    }
    
    documents.push({
      id: result.url,
      text,
      embedding,
      metadata: {
        url: result.url,
        title: result.title,
        source: result.source,
        lens,
        rank: result.rank,
      },
    })
  }
  
  try {
    await store.addDocuments(documents)
    console.log(`Indexed ${documents.length} documents in vector store (${documents.filter(d => d.embedding).length} with embeddings)`)
  } catch (err) {
    console.warn('Failed to index documents in vector store:', err)
  }
}

// ─── INTELLIGENCE-POWERED SEARCH ───

export async function searchIntelligence(
  query: string,
  forcedLens?: SearchLens
): Promise<{ intelligence: IntelligenceObject; results: ScrapedResult[] }> {
  // Check cache first (cache key includes query + lens to prevent wrong lens results)
  const cacheKey = `${query}:${forcedLens || 'default'}`
  const cached = searchCache.get(cacheKey)
  if (cached) {
    console.log('Cache hit for search:', cacheKey)
    return cached
  }

  const expanded = expandQuery(query, forcedLens)
  const lens = expanded.lens

  // Use specialized procurement crawlers for procurement lens (with timeout)
  if (lens === 'procurement') {
    try {
      // Add timeout wrapper for procurement crawler phase
      const procurementPromise = (async () => {
        const { opportunities: procurementOpportunities, diagnostics: crawlerDiagnostics } = await crawlAllProcurementSources(query)
        const procurementResults = procurementOpportunities.map(procurementToScrapedResult)
        
        // Log crawler diagnostics
        crawlerDiagnostics.forEach(d => {
          console.log(`Crawler ${d.source}: ${d.status} (${d.resultsCount} results, ${d.latency}ms)${d.error ? ` - ${d.error}` : ''}`)
        })
        
        return { procurementResults, crawlerDiagnostics }
      })()

      // Timeout after 15 seconds for entire procurement phase
      const timeoutPromise = new Promise<{ procurementResults: ScrapedResult[]; crawlerDiagnostics: any }>((_, reject) =>
        setTimeout(() => reject(new Error('Procurement crawler phase timeout')), 15000)
      )

      const { procurementResults, crawlerDiagnostics } = await Promise.race([procurementPromise, timeoutPromise])
      
      // Also run normal search with procurement-focused expansions in parallel
      const procurementExpansions = [
        query,
        `${query} RFP`,
        `${query} RFQ`,
        `${query} bid`,
        `${query} solicitation`,
        `${query} site:.gov`,
        `${query} site:.us`,
        `${query} PDF`,
        'occupational health RFP',
        'occupational medicine bid',
        'occupational health services solicitation',
        'DOT physical pricing',
        'pulmonary function test pricing',
      ]
      
      const { text, sources, rawTexts, results: searchResults } = await searchAllEngines(procurementExpansions, lens)
      
      // Merge and dedupe crawler + search results
      const seenUrls = new Set<string>()
      const mergedResults: ScrapedResult[] = []
      
      for (const result of [...procurementResults, ...searchResults]) {
        if (!seenUrls.has(result.url)) {
          seenUrls.add(result.url)
          mergedResults.push(result)
        }
      }
      
      // Enrich with intelligence objects
      const enrichedResults = await Promise.all(
        mergedResults.slice(0, 30).map(async (result) => {
          let content = ''
          let extractionSource = 'scrape'
          
          // Try PDF extraction for PDF URLs
          if (result.url.toLowerCase().endsWith('.pdf')) {
            try {
              const extractionResult: ExtractionResult = await fetchAndExtractFromURL(result.url, 8000)
              if (extractionResult.success && extractionResult.document) {
                content = extractionResult.document.text
                extractionSource = 'pdf'
              }
            } catch {
              // Fall back to regular scraping
            }
          }
          
          // Regular scraping fallback
          if (!content) {
            try {
              content = await scrapeWebsite(result.url)
              extractionSource = 'scrape'
            } catch {
              // If scraping fails, return result without intelligence
            }
          }
          
          if (content.length > 100) {
            const intelligence = extractIntelligence(content, result.url, result.title, lens)
            if (intelligence) {
              return { ...result, intelligence, extractionSource }
            }
          }
          
          return result
        })
      )
      
      const mergedSources = [...new Set([...procurementResults.map(r => r.source), ...sources])]
      const mergedRawTexts = [...procurementResults.map(r => r.title + ' ' + (r.description || '')), ...rawTexts]
      const mergedText = mergedRawTexts.join(' ')
      
      const intelligence = buildIntelligenceObject(query, expanded, mergedSources, mergedRawTexts)
      return { intelligence, results: enrichedResults }
    } catch (err) {
      console.warn('Procurement crawlers failed or timed out, falling back to general search:', err)
      // Fall through to general search
    }
  }

  const allQueries = [
    query,
    ...expanded.expansions.slice(0, 6),
    ...expanded.withOperators.slice(0, 3),
  ]

  const { text, sources, rawTexts, results } = await searchAllEngines(allQueries, lens)

  // Semantic reranking for better relevance (with error handling)
  let semanticallyOrderedResults = results
  try {
    const reranked = rerankResults(
      query,
      results.map(r => ({ id: r.url, text: r.title + ' ' + r.description, url: r.url, title: r.title, source: r.source })),
      results.length
    )
    
    // Reorder results based on semantic scores
    semanticallyOrderedResults = reranked
      .map(r => results[r.originalIndex])
      .map((result, index) => ({ ...result, rank: index + 1 }))
  } catch (err) {
    console.warn('Semantic reranking failed, using original results order:', err)
    semanticallyOrderedResults = results.map((result, index) => ({ ...result, rank: index + 1 }))
  }

  // Enrich results with intelligence objects for relevant lenses
  const enrichedResults = await Promise.all(
    semanticallyOrderedResults.map(async (result) => {
      let content = ''
      let extractionSource = 'scrape'
      let extractionAttempted = false
      let extractionSucceeded = false
      let extractionType = 'none'
      let extractionError: string | undefined = undefined
      
      const isPdf = result.url.toLowerCase().endsWith('.pdf') || result.url.toLowerCase().includes('.pdf')
      const isDocx = result.url.toLowerCase().endsWith('.docx')
      const titleOrSnippet = (result.title + ' ' + (result.description || '')).toLowerCase()
      const suggestsPdf = /pdf|rfp|bid|solicitation|proposal|tender|procurement/i.test(titleOrSnippet)
      
      // Try PDF/DOCX extraction for PDF, government, and procurement lenses, or if URL/title suggests PDF
      if (
        ['pdf', 'government', 'procurement'].includes(lens) ||
        isPdf ||
        (suggestsPdf && ['pdf', 'government', 'procurement'].includes(lens))
      ) {
        extractionAttempted = true
        extractionType = isPdf ? 'pdf' : isDocx ? 'docx' : 'html'
        
        try {
          if (isPdf) {
            const extractionResult: ExtractionResult = await fetchAndExtractFromURL(result.url, 8000)
            if (extractionResult.success && extractionResult.document) {
              content = extractionResult.document.text
              extractionSource = 'pdf'
              extractionSucceeded = true
            } else {
              extractionError = extractionResult.error || 'PDF extraction failed'
            }
          } else if (isDocx) {
            const extractionResult: ExtractionResult = await fetchAndExtractFromURL(result.url, 10000)
            if (extractionResult.success && extractionResult.document) {
              content = extractionResult.document.text
              extractionSource = 'docx'
              extractionSucceeded = true
            } else {
              extractionError = extractionResult.error || 'DOCX extraction failed'
            }
          }
        } catch (err) {
          extractionError = err instanceof Error ? err.message : 'Extraction error'
          // Fall back to regular scraping
        }
      }
      
      // Regular scraping fallback or for other lenses
      if (!content && ['procurement', 'provider', 'pricing', 'legal', 'medical', 'academic', 'financial'].includes(lens)) {
        extractionAttempted = true
        extractionType = 'html'
        try {
          // Check scrape cache
          const scrapeCacheKey = result.url
          const cachedContent = scrapeCache.get(scrapeCacheKey)
          if (cachedContent) {
            content = cachedContent
            extractionSource = 'scrape-cached'
            extractionSucceeded = true
          } else {
            content = await scrapeWebsite(result.url)
            extractionSource = 'scrape'
            extractionSucceeded = true
            // Cache the scraped content
            scrapeCache.set(scrapeCacheKey, content)
          }
        } catch (err) {
          extractionError = err instanceof Error ? err.message : 'Scraping error'
          // If scraping fails, return result without intelligence
        }
      }
      
      if (content.length > 100) {
        const intelligence = extractIntelligence(content, result.url, result.title, lens)
        if (intelligence) {
          return { 
            ...result, 
            intelligence, 
            extractionSource,
            extractionDiagnostics: {
              extractionAttempted,
              extractionSucceeded,
              extractionType,
              extractionError,
              extractedTextLength: content.length,
            }
          }
        }
      }
      
      return {
        ...result,
        extractionDiagnostics: {
          extractionAttempted,
          extractionSucceeded,
          extractionType,
          extractionError,
          extractedTextLength: content.length || 0,
        }
      }
    })
  )

  if (text.trim().length < 100) {
    const intelligence = buildIntelligenceObject(query, expanded, sources, rawTexts, 'Limited results from search engines')
    const result = { intelligence, results: enrichedResults }
    // Cache the result
    searchCache.set(cacheKey, result)
    return result
  }

  const intelligence = buildIntelligenceObject(query, expanded, sources, rawTexts)
  const result = { intelligence, results: enrichedResults }
  // Cache the result
  searchCache.set(cacheKey, result)
  return result
}

