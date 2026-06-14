#!/usr/bin/env tsx
// ─── SMOKE TEST SCRIPT FOR PROCUREMENT SEARCH ───
// Tests core procurement/PDF/government/pricing/provider search functionality

import { searchIntelligence } from '../src/lib/search'
import { crawlAllProcurementSources } from '../src/lib/procurement-crawlers'

interface TestResult {
  query: string
  lens: string
  responseTime: number
  resultCount: number
  topResults: Array<{ title: string; domain: string; url: string }>
  urlsAreReal: boolean
  pdfExtractionHappened: boolean
  intelligenceObjectsPopulated: boolean
  crawlerDiagnostics?: any
  cacheHitMiss?: string
  fallbackWebSearchUsed: boolean
  extractionDiagnostics: Array<{
    url: string
    extractionAttempted: boolean
    extractionSucceeded: boolean
    extractionType: string
    extractionError?: string
    extractedTextLength?: number
  }>
  errors: string[]
}

const TEST_QUERIES = [
  { query: 'Request for Proposal occupational health services', lens: 'procurement' },
  { query: 'occupational health services RFP county PDF', lens: 'pdf' },
  { query: 'DOT physical cash price', lens: 'pricing' },
  { query: 'pulmonary function test pricing', lens: 'pricing' },
  { query: 'site:.gov occupational medicine bid', lens: 'government' },
  { query: 'SAM.gov occupational health services', lens: 'procurement' },
]

async function runSmokeTest(): Promise<void> {
  console.log('=== SMOKE TEST START ===\n')

  const results: TestResult[] = []

  for (const test of TEST_QUERIES) {
    console.log(`Testing: "${test.query}" (lens: ${test.lens})`)
    const startTime = Date.now()
    const errors: string[] = []

    try {
      const { intelligence, results: searchResults } = await searchIntelligence(test.query, test.lens as any)
      const responseTime = Date.now() - startTime

      // Check if URLs are real
      const urlsAreReal = searchResults.every(r => {
        try {
          new URL(r.url)
          return true
        } catch {
          return false
        }
      })

      // Check if PDF extraction happened
      const pdfExtractionHappened = searchResults.some(r => 
        r.url.toLowerCase().endsWith('.pdf')
      )

      // Check if intelligence objects populated
      const intelligenceObjectsPopulated = searchResults.some(r => r.intelligence !== undefined)

      // Check if fallback web search was used
      const fallbackWebSearchUsed = searchResults.some(r => r.source === 'DuckDuckGo' || r.source === 'Bing' || r.source === 'Google')

      // Extraction diagnostics per result
      const extractionDiagnostics = searchResults.slice(0, 10).map(r => {
        const isPdf = r.url.toLowerCase().endsWith('.pdf')
        const isDocx = r.url.toLowerCase().endsWith('.docx')
        const extractionAttempted = ['pdf', 'government', 'procurement'].includes(test.lens) && isPdf
        const extractionSucceeded = r.intelligence !== undefined
        const extractionType = isPdf ? 'pdf' : isDocx ? 'docx' : 'html'
        const extractedTextLength = extractionSucceeded ? (r.description?.length || 0) : 0
        
        return {
          url: r.url,
          extractionAttempted,
          extractionSucceeded,
          extractionType,
          extractionError: !extractionSucceeded && extractionAttempted ? 'Extraction failed or no intelligence populated' : undefined,
          extractedTextLength,
        }
      })

      // Get crawler diagnostics if procurement lens
      let crawlerDiagnostics
      if (test.lens === 'procurement') {
        try {
          const { diagnostics } = await crawlAllProcurementSources(test.query)
          crawlerDiagnostics = diagnostics
        } catch (e) {
          errors.push(`Crawler error: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      // Get top 5 results
      const topResults = searchResults.slice(0, 5).map(r => ({
        title: r.title,
        domain: r.domain,
        url: r.url,
      }))

      // Validate pass/fail criteria
      if (searchResults.length === 0) {
        errors.push('Result count is 0 - test failed')
      }
      if (test.lens === 'pdf' && !pdfExtractionHappened && searchResults.length > 0) {
        errors.push('PDF lens returned results but no PDF URLs found')
      }
      if (test.lens === 'pricing' && !intelligenceObjectsPopulated && searchResults.length > 0) {
        errors.push('Pricing lens returned results but no pricing intelligence objects populated')
      }
      if (test.lens === 'procurement' && searchResults.length === 0 && crawlerDiagnostics && crawlerDiagnostics.some(d => d.status === 'success' || d.status === 'empty')) {
        errors.push('Procurement lens returned 0 results but crawlers reported success/empty')
      }

      results.push({
        query: test.query,
        lens: test.lens,
        responseTime,
        resultCount: searchResults.length,
        topResults,
        urlsAreReal,
        pdfExtractionHappened,
        intelligenceObjectsPopulated,
        crawlerDiagnostics,
        fallbackWebSearchUsed,
        extractionDiagnostics,
        errors,
      })

      console.log(`  ✓ Response time: ${responseTime}ms`)
      console.log(`  ✓ Result count: ${searchResults.length}`)
      console.log(`  ✓ URLs real: ${urlsAreReal}`)
      console.log(`  ✓ PDF extraction: ${pdfExtractionHappened}`)
      console.log(`  ✓ Intelligence objects: ${intelligenceObjectsPopulated}`)
      if (errors.length > 0) {
        console.log(`  ⚠ Errors: ${errors.join(', ')}`)
      }
    } catch (e) {
      const responseTime = Date.now() - startTime
      errors.push(e instanceof Error ? e.message : String(e))
      
      results.push({
        query: test.query,
        lens: test.lens,
        responseTime,
        resultCount: 0,
        topResults: [],
        urlsAreReal: false,
        pdfExtractionHappened: false,
        intelligenceObjectsPopulated: false,
        fallbackWebSearchUsed: false,
        extractionDiagnostics: [],
        errors,
      })

      console.log(`  ✗ Error: ${e instanceof Error ? e.message : String(e)}`)
    }

    console.log()
  }

  // Summary
  console.log('=== SMOKE TEST SUMMARY ===')
  console.log(`Total tests: ${results.length}`)
  console.log(`Passed: ${results.filter(r => r.errors.length === 0).length}`)
  console.log(`Failed: ${results.filter(r => r.errors.length > 0).length}`)
  console.log()

  results.forEach((r, i) => {
    console.log(`Test ${i + 1}: ${r.query}`)
    console.log(`  Lens: ${r.lens}`)
    console.log(`  Response time: ${r.responseTime}ms`)
    console.log(`  Results: ${r.resultCount}`)
    console.log(`  URLs real: ${r.urlsAreReal}`)
    console.log(`  Fallback web search: ${r.fallbackWebSearchUsed}`)
    console.log(`  PDF extraction: ${r.pdfExtractionHappened}`)
    console.log(`  Intelligence: ${r.intelligenceObjectsPopulated}`)
    
    if (r.topResults.length > 0) {
      console.log(`  Top 5 results:`)
      r.topResults.forEach((tr, idx) => {
        console.log(`    ${idx + 1}. ${tr.title}`)
        console.log(`       Domain: ${tr.domain}`)
        console.log(`       URL: ${tr.url}`)
      })
    }
    
    if (r.extractionDiagnostics.length > 0) {
      console.log(`  Extraction diagnostics:`)
      r.extractionDiagnostics.forEach((ed, idx) => {
        console.log(`    ${idx + 1}. ${ed.url}`)
        console.log(`       Attempted: ${ed.extractionAttempted}`)
        console.log(`       Succeeded: ${ed.extractionSucceeded}`)
        console.log(`       Type: ${ed.extractionType}`)
        if (ed.extractionError) {
          console.log(`       Error: ${ed.extractionError}`)
        }
        if (ed.extractedTextLength && ed.extractedTextLength > 0) {
          console.log(`       Text length: ${ed.extractedTextLength}`)
        }
      })
    }
    
    if (r.errors.length > 0) {
      console.log(`  Errors: ${r.errors.join(', ')}`)
    }
    console.log()
  })

  // Crawler diagnostics summary
  console.log('=== CRAWLER DIAGNOSTICS ===')
  const procurementTests = results.filter(r => r.lens === 'procurement')
  if (procurementTests.length > 0) {
    for (const test of procurementTests) {
      if (test.crawlerDiagnostics) {
        console.log(`Query: ${test.query}`)
        for (const diag of test.crawlerDiagnostics) {
          console.log(`  ${diag.source}:`)
          console.log(`    Status: ${diag.status}`)
          console.log(`    Results: ${diag.resultsCount}`)
          console.log(`    Latency: ${diag.latency}ms`)
          if (diag.error) {
            console.log(`    Error: ${diag.error}`)
          }
        }
        console.log()
      }
    }
  }

  console.log('=== SMOKE TEST END ===')

  // Exit with error code if any tests failed
  if (results.some(r => r.errors.length > 0)) {
    process.exit(1)
  }
}

runSmokeTest().catch(e => {
  console.error('Smoke test failed:', e)
  process.exit(1)
})
