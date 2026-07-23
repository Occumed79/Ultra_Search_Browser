import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  evaluateSearchQuality,
  type SearchQualityBenchmarkCase,
  type SearchQualityJudgment,
  type SearchQualityResult,
} from '../src/lib/search-quality'

const APP_URL = (process.env.APP_URL || 'https://ultra-search-browser.onrender.com').replace(/\/$/, '')
const QUALITY_LIMIT = Math.max(1, Number(process.env.QUALITY_LIMIT || 24))
const QUALITY_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.QUALITY_CONCURRENCY || 2)))
const QUALITY_STRICT = process.env.QUALITY_STRICT === 'true'
const ARTIFACT_DIR = process.env.QUALITY_ARTIFACT_DIR || 'artifacts/search-quality'

interface BenchmarkFile {
  version: number
  description?: string
  cases: SearchQualityBenchmarkCase[]
}

interface JudgmentFile {
  version: number
  description?: string
  queries: Record<string, SearchQualityJudgment[]>
}

interface SearchApiResponse {
  query?: string
  lens?: string
  results?: SearchQualityResult[]
  diagnostics?: Record<string, unknown>
  error?: string
  detail?: string
}

interface CaseReport {
  id: string
  query: string
  lens: string
  status: 'success' | 'failed'
  runtimeMs: number
  error?: string
  diagnostics?: Record<string, unknown>
  evaluation?: ReturnType<typeof evaluateSearchQuality>
  results: SearchQualityResult[]
}

function average(values: number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}

async function readResponseJson(response: Response): Promise<SearchApiResponse> {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) as SearchApiResponse : {}
  } catch {
    throw new Error(`Expected JSON from ${response.url}; received ${text.slice(0, 500)}`)
  }
}

async function readHealth(): Promise<Record<string, unknown>> {
  const response = await fetch(`${APP_URL}/api/health?ts=${Date.now()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}`)
  return await response.json() as Record<string, unknown>
}

async function runCase(
  benchmark: SearchQualityBenchmarkCase,
  judgments: SearchQualityJudgment[]
): Promise<CaseReport> {
  const startedAt = Date.now()
  try {
    const response = await fetch(`${APP_URL}/api/search`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: benchmark.query,
        lens: benchmark.lens,
        settings: {
          defaultSources: ['bing', 'duckduckgo', 'memory'],
          resultsPerPage: 20,
          safeSearch: true,
          autoSummarize: false,
          preferredLanguage: 'en',
          region: 'us',
        },
      }),
      signal: AbortSignal.timeout(50_000),
    })
    const payload = await readResponseJson(response)
    const runtimeMs = Date.now() - startedAt
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${payload.detail || payload.error || 'Search failed'}`)
    }
    const results = Array.isArray(payload.results) ? payload.results : []
    return {
      id: benchmark.id,
      query: benchmark.query,
      lens: benchmark.lens,
      status: 'success',
      runtimeMs,
      diagnostics: payload.diagnostics,
      evaluation: evaluateSearchQuality(benchmark, results, judgments),
      results: results.slice(0, 10),
    }
  } catch (error) {
    return {
      id: benchmark.id,
      query: benchmark.query,
      lens: benchmark.lens,
      status: 'failed',
      runtimeMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      results: [],
    }
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  async function runner() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runner()))
  return results
}

function buildSummary(reports: CaseReport[], selectedCases: SearchQualityBenchmarkCase[]) {
  const successful = reports.filter(report => report.status === 'success' && report.evaluation)
  const evaluations = successful.map(report => report.evaluation!)
  const caseById = new Map(selectedCases.map(item => [item.id, item]))
  const officialExpected = successful.filter(report => caseById.get(report.id)?.expectOfficial)
  const pdfExpected = successful.filter(report => caseById.get(report.id)?.expectPdf)
  const preferredExpected = successful.filter(report => Boolean(caseById.get(report.id)?.preferredDomains?.length))
  const judged = evaluations.filter(evaluation => evaluation.ndcgAt10 !== null)

  return {
    totalQueries: reports.length,
    successfulQueries: successful.length,
    failedQueries: reports.length - successful.length,
    zeroResultQueries: successful.filter(report => report.evaluation!.resultCount === 0).length,
    averageLatencyMs: Math.round(average(successful.map(report => report.runtimeMs))),
    averageResultCount: Number(average(evaluations.map(item => item.resultCount)).toFixed(2)),
    averageTopResultConceptCoverage: Number(average(evaluations.map(item => item.topResultConceptCoverage)).toFixed(4)),
    averageTopFiveConceptCoverage: Number(average(evaluations.map(item => item.topFiveConceptCoverage)).toFixed(4)),
    averageDuplicateRate: Number(average(evaluations.map(item => item.duplicateRate)).toFixed(4)),
    averageStaleResultRate: Number(average(evaluations.map(item => item.staleResultRate)).toFixed(4)),
    averageForbiddenResultRate: Number(average(evaluations.map(item => item.forbiddenResultRate)).toFixed(4)),
    averageUniqueDomains: Number(average(evaluations.map(item => item.uniqueDomains)).toFixed(2)),
    averageUniqueSources: Number(average(evaluations.map(item => item.uniqueSources)).toFixed(2)),
    officialHitRate: officialExpected.length
      ? officialExpected.filter(report => report.evaluation!.officialHitRank !== null && report.evaluation!.officialHitRank! <= 10).length / officialExpected.length
      : null,
    pdfHitRate: pdfExpected.length
      ? pdfExpected.filter(report => report.evaluation!.pdfHitRank !== null && report.evaluation!.pdfHitRank! <= 10).length / pdfExpected.length
      : null,
    preferredDomainHitRate: preferredExpected.length
      ? preferredExpected.filter(report => report.evaluation!.preferredDomainHitRank !== null && report.evaluation!.preferredDomainHitRank! <= 10).length / preferredExpected.length
      : null,
    judgedQueries: judged.length,
    averageNdcgAt10: judged.length ? Number(average(judged.map(item => item.ndcgAt10!)).toFixed(4)) : null,
    averageReciprocalRank: judged.length ? Number(average(judged.map(item => item.reciprocalRank || 0)).toFixed(4)) : null,
  }
}

type QualitySummary = ReturnType<typeof buildSummary>

function markdownReport(
  generatedAt: string,
  health: Record<string, unknown>,
  summary: QualitySummary,
  reports: CaseReport[]
): string {
  const lines = [
    '# Ultra Search Quality Report',
    '',
    `- **Generated:** ${generatedAt}`,
    `- **Target:** ${APP_URL}`,
    `- **Commit:** ${String(health.commit || 'unknown')}`,
    `- **Pipeline:** ${String(health.searchPipeline || 'unknown')}`,
    `- **Queries:** ${summary.successfulQueries}/${summary.totalQueries} completed`,
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Average latency | ${summary.averageLatencyMs} ms |`,
    `| Average result count | ${summary.averageResultCount} |`,
    `| Top-result concept coverage | ${percent(summary.averageTopResultConceptCoverage)} |`,
    `| Top-five concept coverage | ${percent(summary.averageTopFiveConceptCoverage)} |`,
    `| Duplicate rate | ${percent(summary.averageDuplicateRate)} |`,
    `| Stale-result rate | ${percent(summary.averageStaleResultRate)} |`,
    `| Forbidden/junk signal rate | ${percent(summary.averageForbiddenResultRate)} |`,
    `| Average unique domains | ${summary.averageUniqueDomains} |`,
    `| Average unique sources | ${summary.averageUniqueSources} |`,
    `| Official-source hit rate | ${summary.officialHitRate === null ? 'n/a' : percent(summary.officialHitRate)} |`,
    `| PDF hit rate | ${summary.pdfHitRate === null ? 'n/a' : percent(summary.pdfHitRate)} |`,
    `| Preferred-domain hit rate | ${summary.preferredDomainHitRate === null ? 'n/a' : percent(summary.preferredDomainHitRate)} |`,
    `| Judged nDCG@10 | ${summary.averageNdcgAt10 === null ? 'No manual judgments yet' : summary.averageNdcgAt10.toFixed(3)} |`,
    `| Judged MRR | ${summary.averageReciprocalRank === null ? 'No manual judgments yet' : summary.averageReciprocalRank.toFixed(3)} |`,
    '',
    '## Query Results',
    '',
  ]

  for (const report of reports) {
    lines.push(`### ${report.id}`, '')
    lines.push(`- **Lens:** ${report.lens}`)
    lines.push(`- **Query:** ${report.query}`)
    lines.push(`- **Status:** ${report.status}`)
    lines.push(`- **Runtime:** ${report.runtimeMs} ms`)
    if (report.error) lines.push(`- **Error:** ${report.error}`)
    if (report.evaluation) {
      lines.push(`- **Results:** ${report.evaluation.resultCount}`)
      lines.push(`- **Top-five concept coverage:** ${percent(report.evaluation.topFiveConceptCoverage)}`)
      lines.push(`- **Unique domains:** ${report.evaluation.uniqueDomains}`)
      lines.push(`- **Duplicate rate:** ${percent(report.evaluation.duplicateRate)}`)
      lines.push(`- **Stale rate:** ${percent(report.evaluation.staleResultRate)}`)
      lines.push(`- **Official hit:** ${report.evaluation.officialHitRank ? `#${report.evaluation.officialHitRank}` : 'none'}`)
      lines.push(`- **PDF hit:** ${report.evaluation.pdfHitRank ? `#${report.evaluation.pdfHitRank}` : 'none'}`)
      lines.push(`- **Preferred-domain hit:** ${report.evaluation.preferredDomainHitRank ? `#${report.evaluation.preferredDomainHitRank}` : 'none'}`)
    }
    lines.push('')
    if (report.results.length) {
      lines.push('| Rank | Result | Domain | Source |')
      lines.push('| ---: | --- | --- | --- |')
      report.results.forEach((result, index) => {
        const safeTitle = result.title.replace(/\|/g, '\\|')
        const domain = result.domain || (() => {
          try { return new URL(result.url).hostname } catch { return '' }
        })()
        lines.push(`| ${index + 1} | [${safeTitle}](${result.url}) | ${domain} | ${result.source || ''} |`)
      })
      lines.push('')
    }
  }

  return `${lines.join('\n')}\n`
}

async function main() {
  const benchmark = await readJson<BenchmarkFile>('quality/benchmark.json')
  const judgmentFile = await readJson<JudgmentFile>('quality/judgments.json')
  const requestedLenses = (process.env.QUALITY_LENSES || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  const selectedCases = benchmark.cases
    .filter(item => !requestedLenses.length || requestedLenses.includes(item.lens))
    .slice(0, QUALITY_LIMIT)

  console.log(`Running Search Quality Lab against ${APP_URL}`)
  console.log(`Cases: ${selectedCases.length}; concurrency: ${QUALITY_CONCURRENCY}`)

  const health = await readHealth()
  const reports = await runWithConcurrency(selectedCases, QUALITY_CONCURRENCY, async benchmarkCase => {
    const report = await runCase(benchmarkCase, judgmentFile.queries[benchmarkCase.id] || [])
    const label = report.status === 'success'
      ? `${report.evaluation?.resultCount || 0} results; top-5 coverage ${percent(report.evaluation?.topFiveConceptCoverage || 0)}`
      : report.error
    console.log(`[${report.status}] ${report.id}: ${label}`)
    return report
  })

  const generatedAt = new Date().toISOString()
  const summary = buildSummary(reports, selectedCases)
  const report = {
    generatedAt,
    target: APP_URL,
    health,
    benchmarkVersion: benchmark.version,
    summary,
    reports,
  }

  await mkdir(ARTIFACT_DIR, { recursive: true })
  await writeFile(path.join(ARTIFACT_DIR, 'search-quality-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(path.join(ARTIFACT_DIR, 'search-quality-report.md'), markdownReport(generatedAt, health, summary, reports))

  console.log('\nSearch Quality Lab summary')
  console.log(JSON.stringify(summary, null, 2))
  console.log(`Reports written to ${ARTIFACT_DIR}`)

  const severeFailure = summary.successfulQueries === 0
  const strictFailure = QUALITY_STRICT && (summary.failedQueries > 0 || summary.zeroResultQueries > 0)
  if (severeFailure || strictFailure) process.exitCode = 1
}

main().catch(async error => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(message)
  try {
    await mkdir(ARTIFACT_DIR, { recursive: true })
    await writeFile(path.join(ARTIFACT_DIR, 'search-quality-error.txt'), `${message}\n`)
  } catch {
    // Keep the original failure as the process outcome.
  }
  process.exit(1)
})
