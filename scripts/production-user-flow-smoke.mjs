const APP_URL = (process.env.APP_URL || 'https://ultra-search-browser.onrender.com').replace(/\/$/, '')
const EXPECTED_COMMIT = (process.env.EXPECTED_COMMIT || '').trim()
const CANARY_QUERIES = [
  'occupational health services',
  'medical surveillance services',
  'audiometry hearing conservation services',
  'respirator medical clearance services',
  'employee medical examinations',
  'drug and alcohol testing services',
  'deployment medical readiness examinations',
  'fitness for duty occupational medicine services',
  'OCONUS occupational health services',
]
const VALID_RETRIEVAL_TRANSPORTS = new Set([
  'searxng',
  'keenable',
  'multi-source',
  'zero-key-direct-rescue',
  'searxng+direct-rescue',
  'searxng+keenable',
  'keenable+direct-rescue',
  'searxng+keenable+direct-rescue',
  'multi-source+direct-rescue',
])
const EXPECTED_EMPTY_CODES = new Set(['SEARCH_SOURCES_EMPTY', 'SEARXNG_UNAVAILABLE'])
const PROCUREMENT_EVIDENCE = /\b(?:request for proposals?|rfp|request for quotations?|rfq|request for information|rfi|invitation to bid|ifb|solicitation|tender|bid(?:ding)?|procurement|contract opportunity|sources sought|notice inviting bids)\b/i
const PROCUREMENT_DESTINATION = /(?:ionwave\.net|bonfirehub\.com|planetbids\.com|bidnetdirect\.com|publicpurchase\.com|opengov\.com|bidsandtenders\.com|\/(?:procurement|purchasing|bids?|bid-opportunities|solicitations?|opportunities|contract-opportunities|vendor-opportunities|rfps?|rfqs?|ifbs?)(?:\/|$|[-_])|\.(?:pdf|docx?)(?:$|[?#]))/i

async function readJson(response) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Expected JSON from ${response.url}; received: ${text.slice(0, 500)}`)
  }
}

function commitMatches(actual, expected) {
  return Boolean(actual && expected && actual !== 'unknown'
    && (actual.startsWith(expected) || expected.startsWith(actual)))
}

async function assertDeployment() {
  const response = await fetch(`${APP_URL}/api/health?user-flow=${Date.now()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(25_000),
  })
  const health = await readJson(response)
  if (!response.ok || health.status !== 'ok') throw new Error(`Health check failed: HTTP ${response.status}`)
  if (EXPECTED_COMMIT && !commitMatches(health.commit, EXPECTED_COMMIT)) {
    throw new Error(`User-flow canary reached stale deployment ${health.commit}; expected ${EXPECTED_COMMIT}`)
  }
}

async function buildPlan(query) {
  const response = await fetch(`${APP_URL}/api/search/plan`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, maxSearches: 8 }),
    signal: AbortSignal.timeout(30_000),
  })
  const plan = await readJson(response)
  if (!response.ok) throw new Error(`Live plan failed for "${query}": HTTP ${response.status} ${JSON.stringify(plan).slice(0, 1_500)}`)
  if (plan.apiKeysRequired !== false) throw new Error(`Live plan unexpectedly requires search API keys for "${query}".`)
  if (!Array.isArray(plan.searches) || plan.searches.length < 4) throw new Error(`Live plan did not create enough procurement strategies for "${query}".`)
  return plan
}

async function retrieve(query, plan) {
  const response = await fetch(`${APP_URL}/api/search`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
    signal: AbortSignal.timeout(80_000),
  })
  const data = await readJson(response)
  if (response.ok) {
    if (!Array.isArray(data.results)) throw new Error(`Live retrieval returned no result array for "${query}".`)
    if (!VALID_RETRIEVAL_TRANSPORTS.has(data.transport)) throw new Error(`Unexpected live transport ${data.transport} for "${query}".`)
    if (data.apiKeysRequired !== false) throw new Error(`Live retrieval unexpectedly requires search API keys for "${query}".`)
    return data
  }

  const expectedEmpty = [502, 503].includes(response.status)
    && EXPECTED_EMPTY_CODES.has(data.code)
    && VALID_RETRIEVAL_TRANSPORTS.has(data.transport)
  if (!expectedEmpty) {
    throw new Error(`Live retrieval failed outside the source-exhaustion contract for "${query}": HTTP ${response.status} ${JSON.stringify(data).slice(0, 2_000)}`)
  }

  console.log(`[user-flow] query="${query}" upstream pool empty; code=${data.code}; transport=${data.transport}; ingest skipped`)
  return null
}

function assertProcurementShape(query, result) {
  const text = `${result.title || ''} ${result.description || ''} ${result.url || ''}`
  if (PROCUREMENT_EVIDENCE.test(text) || PROCUREMENT_DESTINATION.test(result.url || '')) return
  throw new Error(`Non-procurement page survived the live ingest gate for "${query}": ${JSON.stringify({ title: result.title, url: result.url, description: result.description }).slice(0, 1_500)}`)
}

async function ingest(query, plan, retrieval) {
  const response = await fetch(`${APP_URL}/api/search/ingest`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: plan.query,
      intent: plan.intent,
      searches: plan.searches,
      results: retrieval.results,
      transport: retrieval.transport,
      settings: { resultsPerPage: 20, safeSearch: true, preferredLanguage: 'en', region: 'us' },
    }),
    signal: AbortSignal.timeout(45_000),
  })
  const data = await readJson(response)
  if (!response.ok) throw new Error(`Live ingest failed for "${query}": HTTP ${response.status} ${JSON.stringify(data).slice(0, 2_500)}`)
  if (data.lens !== 'procurement') throw new Error(`Live ingest returned unexpected lens ${data.lens} for "${query}".`)
  if (data.diagnostics?.transport !== retrieval.transport) {
    throw new Error(`Live ingest dropped transport provenance for "${query}": retrieval=${retrieval.transport} ingest=${data.diagnostics?.transport}`)
  }
  if (Number(data.confidence || 0) !== 0) throw new Error(`Candidate-stage confidence must remain 0 for "${query}"; received ${data.confidence}`)
  if (!Array.isArray(data.results)) throw new Error(`Live ingest returned no result array for "${query}".`)

  for (const result of data.results) assertProcurementShape(query, result)

  console.log(`[user-flow] query="${query}" raw=${retrieval.results.length}; retained=${data.results.length}; transport=${retrieval.transport}; procurement-shape=clean`)
  return { query, raw: retrieval.results.length, retained: data.results.length, transport: retrieval.transport }
}

async function main() {
  await assertDeployment()
  const summaries = []
  for (const query of CANARY_QUERIES) {
    const plan = await buildPlan(query)
    const retrieval = await retrieve(query, plan)
    if (!retrieval) continue
    summaries.push(await ingest(query, plan, retrieval))
  }
  if (summaries.length === 0) {
    console.log('[user-flow] all live source pools were empty within the explicit source-exhaustion contract')
    return
  }
  console.log(`[user-flow] capability-canaries passed ${summaries.length}/${CANARY_QUERIES.length} live retrieval paths`)
}

main().catch(error => {
  console.error('Production user-flow smoke failed.')
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})