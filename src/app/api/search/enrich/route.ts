import { NextRequest, NextResponse } from 'next/server'
import { applySpamPenalty, calculateCombinedSpamScore } from '../../../../lib/anti-spam'
import { query as databaseQuery } from '../../../../lib/db'
import { fetchAndExtractFromURL } from '../../../../lib/document-extraction'
import { applyDomainPreferences, getDomainPreferences, type DomainPreference } from '../../../../lib/domain-memory'
import { extractIntelligence } from '../../../../lib/entity-extraction'
import { indexResultsInPersistentMemory } from '../../../../lib/memory-indexing'
import { insertPricingFinding } from '../../../../lib/search-storage'
import { applySmartFilter } from '../../../../lib/smart-filter'
import { extractPricingFindings } from '../../../../lib/verticals/pricing/extract'
import type { ScrapedResult, SearchLens } from '../../../../types/search'

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

const EXTRACTION_LENSES = new Set<SearchLens>([
  'pdf',
  'government',
  'procurement',
  'pricing',
  'provider',
  'legal',
  'medical',
  'academic',
  'financial',
])

const MAX_INPUT_RESULTS = 60
const MAX_EXTRACTION_TARGETS = 6
const EXTRACTION_TIMEOUT_MS = 5_500
const MAX_EXTRACTED_TEXT_LENGTH = 100_000
const MAX_LOCAL_SEMANTIC_TARGETS = 12

interface EnrichmentRequest {
  query?: string
  lens?: SearchLens
  results?: ScrapedResult[]
}

function extractionType(url: string, fileType?: string): NonNullable<ScrapedResult['extractionDiagnostics']>['extractionType'] {
  const normalized = `${fileType ?? ''} ${url}`.toLowerCase()
  if (normalized.includes('pdf')) return 'pdf'
  if (normalized.includes('docx') || normalized.includes('wordprocessingml')) return 'docx'
  if (/\.(png|jpe?g|gif|bmp|tiff|webp)(?:$|\?)/.test(normalized)) return 'image'
  return 'html'
}

function shouldExtract(result: ScrapedResult, lens: SearchLens): boolean {
  const url = result.url.toLowerCase()
  return EXTRACTION_LENSES.has(lens) || /\.(pdf|docx|png|jpe?g|gif|bmp|tiff|webp)(?:$|\?)/.test(url)
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(values.length)
  let cursor = 0

  async function runWorker() {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      output[index] = await worker(values[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => runWorker()))
  return output
}

async function persistEnrichment(
  result: ScrapedResult,
  extractedText: string,
  intelligence: ScrapedResult['intelligence'],
  lens: SearchLens
) {
  if (!process.env.DATABASE_URL || !result.id) return 0

  await databaseQuery(
    `UPDATE search_results
     SET extracted_text = $2,
         extraction_status = $3,
         metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
     WHERE id = $1`,
    [
      result.id,
      extractedText,
      'enriched',
      JSON.stringify({ lens, intelligence: intelligence ?? null }),
    ]
  )

  if (lens !== 'pricing') return 0

  const findings = extractPricingFindings(extractedText, result.url, result.title)
  await databaseQuery('DELETE FROM pricing_findings WHERE search_result_id = $1', [result.id])

  for (const finding of findings) {
    await insertPricingFinding({
      search_result_id: result.id,
      provider_name: finding.provider_name,
      service_name: finding.service_name,
      price: finding.price ?? undefined,
      price_text: finding.price_text,
      currency: finding.currency,
      location: finding.location,
      phone: finding.phone,
      email: finding.email,
      evidence_text: finding.evidence_text,
      source_url: result.url,
      confidence: finding.confidence,
    })
  }

  return findings.length
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()

  try {
    const body = (await request.json()) as EnrichmentRequest
    const query = body.query?.trim() ?? ''
    const lens = body.lens && VALID_LENSES.has(body.lens) ? body.lens : 'web'
    const inputResults = Array.isArray(body.results)
      ? body.results
          .filter(result => Boolean(result?.url && result?.title))
          .slice(0, MAX_INPUT_RESULTS)
      : []

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    if (inputResults.length === 0) {
      return NextResponse.json({
        results: [],
        diagnostics: {
          runtimeMs: Date.now() - startedAt,
          extractionAttempted: 0,
          extractionSucceeded: 0,
          pricingFindingsSaved: 0,
          blockedDomainsRemoved: 0,
          persistentMemory: { enabled: false, attempted: 0, indexed: 0 },
        },
      })
    }

    let preferences: DomainPreference[] = []
    if (process.env.DATABASE_URL) {
      preferences = await getDomainPreferences('default').catch(error => {
        console.warn('Domain preference enrichment failed:', error)
        return []
      })
    }

    const preferenceApplied = applyDomainPreferences([...inputResults], preferences)
    const preferenceAdjusted = (preferenceApplied.results as ScrapedResult[]).map(result => {
      const adjustment = preferenceApplied.adjustments.get(result.url)
      return adjustment ? { ...result, score: adjustment.adjustedScore } : result
    })
    const blockedDomainsRemoved = inputResults.length - preferenceAdjusted.length

    const targetUrls = new Set(
      preferenceAdjusted
        .filter(result => shouldExtract(result, lens))
        .slice(0, MAX_EXTRACTION_TARGETS)
        .map(result => result.url)
    )

    let extractionAttempted = 0
    let extractionSucceeded = 0
    let pricingFindingsSaved = 0

    const enriched = await mapWithConcurrency(preferenceAdjusted, 3, async result => {
      const target = targetUrls.has(result.url)
      let extractedText = ''
      let intelligence = result.intelligence
      let diagnostics: ScrapedResult['extractionDiagnostics'] = {
        extractionAttempted: target,
        extractionSucceeded: false,
        extractionType: target ? extractionType(result.url) : 'none',
        extractedTextLength: 0,
      }

      if (target) {
        extractionAttempted += 1
        const extraction = await fetchAndExtractFromURL(result.url, EXTRACTION_TIMEOUT_MS)

        if (extraction.success && extraction.document?.text) {
          extractedText = extraction.document.text.slice(0, MAX_EXTRACTED_TEXT_LENGTH)
          intelligence = extractIntelligence(extractedText, result.url, result.title, lens)
          extractionSucceeded += 1
          diagnostics = {
            extractionAttempted: true,
            extractionSucceeded: true,
            extractionType: extractionType(result.url, extraction.document.metadata.fileType),
            extractedTextLength: extractedText.length,
          }

          try {
            pricingFindingsSaved += await persistEnrichment(result, extractedText, intelligence, lens)
          } catch (error) {
            console.warn('Enrichment persistence failed:', result.url, error)
          }
        } else {
          diagnostics = {
            extractionAttempted: true,
            extractionSucceeded: false,
            extractionType: extractionType(result.url),
            extractedTextLength: 0,
            extractionError: extraction.error || 'Extraction failed',
          }
        }
      }

      const spam = calculateCombinedSpamScore(
        result.url,
        extractedText || `${result.title} ${result.description}`
      )

      return {
        ...result,
        intelligence,
        score: applySpamPenalty(result.score || 0, spam.score),
        spamScore: spam.score,
        spamReasons: spam.reasons,
        extractionDiagnostics: diagnostics,
      }
    })

    const refined = await applySmartFilter(
      query,
      lens,
      enriched,
      inputResults.length,
      {
        useLocalTransformer: true,
        semanticCandidateLimit: MAX_LOCAL_SEMANTIC_TARGETS,
      }
    )

    const persistentMemory = await indexResultsInPersistentMemory(refined.results, lens, 12, 4_000)

    return NextResponse.json({
      query,
      lens,
      results: refined.results,
      diagnostics: {
        runtimeMs: Date.now() - startedAt,
        extractionAttempted,
        extractionSucceeded,
        pricingFindingsSaved,
        blockedDomainsRemoved,
        smartFilter: refined.diagnostics,
        persistentMemory,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown enrichment failure'
    console.error('Search enrichment failed:', error)
    return NextResponse.json(
      { error: 'Search enrichment failed', detail: message },
      { status: 500 }
    )
  }
}
