const APP_URL = (process.env.APP_URL || 'https://ultra-search-browser.onrender.com').replace(/\/$/, '')
const EXPECTED_COMMIT = (process.env.EXPECTED_COMMIT || '').trim()
const QUERY = 'occupational health services'
const VALID_RETRIEVAL_TRANSPORTS = new Set(['searxng', 'zero-key-direct-rescue', 'searxng+direct-rescue'])
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

async function buildPlan() {
  const response = await fetch(`${APP_URL}/api/search/plan`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, maxSearches: 8 }),
    signal: AbortSignal.timeout(30_000),
  })
  const plan = await readJson(response)
  if (!response.ok) throw new Error(`Live plan failed: HTTP ${response.status} ${JSON.stringify(plan).slice(0, 1_500)}`)
  if (plan.apiKeysRequired !== false) throw new Error('Live plan unexpectedly requires search API keys.')
  if (!Array.isArray(plan.searches) || plan.searches.length < 4) throw new Error('Live plan did not create enough procurement strategies.')
  return plan
}

async function retrieve(plan) {
  const response = await fetch(`${APP_URL}/api/search`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
    signal: AbortSignal.timeout(80_000),
  })
  const data = await readJson(response)
  if (response.ok) {
    if (!Array.isArray(data.results)) throw new Error('Live retrieval returned no result array.')
    if (!VALID_RETRIEVAL_TRANSPORTS.has(data.transport)) throw new Error(`Unexpected live transport ${data.transport}`)
    if (data.apiKeysRequired !== false) throw new Error('Live retrieval unexpectedly requires search API keys.')
    return data
  }

  const expectedEmpty = [502, 503].includes(response.status)
    && EXPECTED_EMPTY_CODES.has(data.code)
    && VALID_RETRIEVAL_TRANSPORTS.has(data.transport)
  if (!expectedEmpty) {
    throw new Error(`Live retrieval failed outside the zero-key exhaustion contract: HTTP ${response.status} ${JSON.stringify(data).slice(0, 2_000)}`)
  }

  console.log(`[user-flow] upstream search pool empty; code=${data.code}; transport=${data.transport}; ingest canary skipped`)
  return null
}

function assertProcurementShape(result) {
  const text = `${result.title || ''} ${result.description || ''} ${result.url || ''}`
  if (PROCUREMENT_EVIDENCE.test(text) || PROCUREMENT_DESTINATION.test(result.url || '')) return
  throw new Error(`Non-procurement page survived the live ingest gate: ${JSON.stringify({ title: result.title, url: result.url, description: result.description }).slice(0, 1_500)}`)
}

async function ingest(plan, retrieval) {
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
  if (!response.ok) throw new Error(`Live ingest failed: HTTP ${response.status} ${JSON.stringify(data).slice(0, 2_500)}`)
  if (data.lens !== 'procurement') throw new Error(`Live ingest returned unexpected lens ${data.lens}`)
  if (data.diagnostics?.transport !== retrieval.transport) {
    throw new Error(`Live ingest dropped transport provenance: retrieval=${retrieval.transport} ingest=${data.diagnostics?.transport}`)
  }
  if (Number(data.confidence || 0) !== 0) throw new Error(`Candidate-stage confidence must remain 0; received ${data.confidence}`)
  if (!Array.isArray(data.results)) throw new Error('Live ingest returned no result array.')

  for (const result of data.results) assertProcurementShape(result)

  console.log(`[user-flow] query="${QUERY}" raw=${retrieval.results.length}; retained=${data.results.length}; transport=${retrieval.transport}; procurement-shape=clean`)
}

async function main() {
  await assertDeployment()
  const plan = await buildPlan()
  const retrieval = await retrieve(plan)
  if (!retrieval) return
  await ingest(plan, retrieval)
}

main().catch(error => {
  console.error('Production user-flow smoke failed.')
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})
