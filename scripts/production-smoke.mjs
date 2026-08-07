const APP_URL = (process.env.APP_URL || 'https://ultra-search-browser.onrender.com').replace(/\/$/, '')
const EXPECTED_COMMIT = (process.env.EXPECTED_COMMIT || '').trim()
const MAX_WAIT_MS = Number(process.env.MAX_WAIT_MS || 12 * 60 * 1000)
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15_000)
const EXPECTED_PIPELINE = 'rfp-finder-v5-browser-fed-zero-key'

const SELF_HOSTED_EVIDENCE_CANDIDATES = [
  {
    title: 'Ultra Search Browser Production Validation Evidence',
    url: `${APP_URL}/search-validation-evidence.txt`,
    description: 'Static Ultra Search Browser production evidence for page retrieval, extraction, semantic review, lifecycle classification, streaming progress, and verified-only output.',
    domain: new URL(APP_URL).hostname,
    source: 'production-smoke',
    rank: 1,
    score: 100,
  },
]

const BROWSER_SERP_FIXTURE = [
  {
    title: 'Occupational Health Services Request for Proposals',
    url: 'https://procurement.example.gov/bids/occupational-health-services?utm_source=google',
    description: 'Request for proposals from qualified vendors for employee occupational health services including pre-employment physical examinations, medical surveillance, audiograms, spirometry, drug testing, and related employer medical services. Responses due September 30, 2026.',
    source: 'Browser · Google',
    rank: 1,
    score: 100,
    query: 'Occupational Health Services RFP',
    purpose: 'broad',
  },
  {
    title: 'Occupational Health Definition and Careers',
    url: 'https://example.org/dictionary/occupational-health',
    description: 'Definition, jobs, careers and educational information about occupational health.',
    source: 'Browser · Bing',
    rank: 2,
    score: 96,
    query: 'Occupational Health Services RFP',
    purpose: 'broad',
  },
]

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

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

async function waitForDeployment() {
  const deadline = Date.now() + MAX_WAIT_MS
  let lastState = 'No response yet.'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${APP_URL}/api/health?ts=${Date.now()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(25_000),
      })
      const health = await readJson(response)
      lastState = `HTTP ${response.status}; commit=${health.commit || 'missing'}; pipeline=${health.searchPipeline || 'missing'}`
      console.log(`[deployment] ${lastState}`)
      if (
        response.ok
        && health.status === 'ok'
        && health.productMode === 'rfp-finder-browser-fed'
        && health.searchPipeline === EXPECTED_PIPELINE
        && (!EXPECTED_COMMIT || commitMatches(health.commit, EXPECTED_COMMIT))
      ) return health
    } catch (error) {
      lastState = error instanceof Error ? error.message : String(error)
      console.log(`[deployment] waiting: ${lastState}`)
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`Render did not serve the expected deployment before timeout. Last state: ${lastState}`)
}

async function runPlan() {
  const response = await fetch(`${APP_URL}/api/search/plan`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'Occupational Health Services RFP', maxSearches: 8 }),
    signal: AbortSignal.timeout(30_000),
  })
  const plan = await readJson(response)
  if (!response.ok) throw new Error(`search plan HTTP ${response.status}: ${JSON.stringify(plan).slice(0, 1_500)}`)
  if (plan.transport !== 'browser-extension') throw new Error(`Unexpected retrieval transport: ${plan.transport}`)
  if (plan.apiKeysRequired !== false) throw new Error('Core search plan incorrectly requires API keys.')
  if (plan.intent?.provider !== 'deterministic' || plan.intent?.usedExternal !== false) {
    throw new Error(`Search plan was not deterministic: ${JSON.stringify(plan.intent).slice(0, 1_500)}`)
  }
  if (!Array.isArray(plan.searches) || plan.searches.length < 4) {
    throw new Error(`Search plan did not produce enough targeted browser queries: ${JSON.stringify(plan.searches)}`)
  }
  if (/\b(?:site:|filetype:)/i.test(plan.searches[0].query)) {
    throw new Error(`Literal search was replaced by an operator-only query: ${plan.searches[0].query}`)
  }
  if (!plan.searches.some(search => /site:\.gov/i.test(search.query))) {
    throw new Error(`Search plan has no government-source strategy: ${JSON.stringify(plan.searches)}`)
  }
  if (!plan.searches.some(search => /filetype:pdf/i.test(search.query))) {
    throw new Error(`Search plan has no direct-document strategy: ${JSON.stringify(plan.searches)}`)
  }
  console.log(`[plan] ${plan.searches.length} browser queries; intent=${plan.intent.intentKind}; apiKeysRequired=${plan.apiKeysRequired}`)
  return plan
}

async function runBrowserIngest(plan) {
  const response = await fetch(`${APP_URL}/api/search/ingest`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: plan.query,
      intent: plan.intent,
      searches: plan.searches,
      results: BROWSER_SERP_FIXTURE,
      settings: { resultsPerPage: 20, safeSearch: true, preferredLanguage: 'en', region: 'us' },
    }),
    signal: AbortSignal.timeout(45_000),
  })
  const data = await readJson(response)
  if (!response.ok) throw new Error(`browser ingest HTTP ${response.status}: ${JSON.stringify(data).slice(0, 2_500)}`)
  if (data.lens !== 'procurement') throw new Error(`Browser ingest returned lens ${data.lens}.`)
  if (data.diagnostics?.retrievalMode !== 'browser-fed') throw new Error(`Browser ingest did not report browser-fed mode: ${JSON.stringify(data.diagnostics)}`)
  if (data.diagnostics?.apiKeysRequired !== false) throw new Error('Browser ingest incorrectly requires API keys.')
  if (data.diagnostics?.intentGate?.applied !== true) throw new Error(`Intent gate was not applied: ${JSON.stringify(data.diagnostics?.intentGate)}`)
  if (!Array.isArray(data.results) || data.results.length < 1) throw new Error(`Relevant browser fixture was discarded: ${JSON.stringify(data).slice(0, 3_500)}`)
  if (!data.results.some(result => /request for proposals/i.test(`${result.title} ${result.description}`))) {
    throw new Error(`Procurement candidate did not survive filtering: ${JSON.stringify(data.results).slice(0, 2_500)}`)
  }
  if (data.results.some(result => /definition|careers/i.test(result.title))) {
    throw new Error(`Junk browser result survived Occu-Med filtering: ${JSON.stringify(data.results).slice(0, 2_500)}`)
  }
  if (Number(data.confidence || 0) !== 0) throw new Error(`Candidate-stage confidence must remain 0; received ${data.confidence}.`)
  console.log(`[ingest] raw=${BROWSER_SERP_FIXTURE.length}; retained=${data.results.length}; sources=${data.sources?.join(', ')}`)
}

async function assertLegacyServerSearchRetired() {
  const response = await fetch(`${APP_URL}/api/search`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'Occupational Health Services RFP' }),
    signal: AbortSignal.timeout(30_000),
  })
  const data = await readJson(response)
  if (response.status !== 428 || data.code !== 'BROWSER_RESULTS_REQUIRED') {
    throw new Error(`Legacy server retrieval is still active: HTTP ${response.status} ${JSON.stringify(data).slice(0, 1_500)}`)
  }
  if (data.apiKeysRequired !== false || data.transport !== 'browser-extension') {
    throw new Error(`Legacy route did not redirect to zero-key browser transport: ${JSON.stringify(data).slice(0, 1_500)}`)
  }
  console.log('[legacy] server-side search retrieval correctly retired')
}

function parseSseBlock(block) {
  let event = 'message'
  const data = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  return data.length ? { event, data: JSON.parse(data.join('\n')) } : null
}

async function runEvidenceValidation() {
  const response = await fetch(`${APP_URL}/api/search/validate`, {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'Ultra Search Browser production validation evidence',
      lens: 'web',
      results: SELF_HOSTED_EVIDENCE_CANDIDATES,
      maxTargets: SELF_HOSTED_EVIDENCE_CANDIDATES.length,
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok || !response.body) throw new Error(`Evidence validation HTTP ${response.status}: ${(await response.text()).slice(0, 800)}`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let complete
  let progressEvents = 0
  let resultEvents = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n')
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() || ''
    for (const block of blocks) {
      const parsed = parseSseBlock(block)
      if (!parsed) continue
      if (parsed.event === 'progress') progressEvents += 1
      if (parsed.event === 'result') resultEvents += 1
      if (parsed.event === 'error') throw new Error(`Evidence stream error: ${JSON.stringify(parsed.data)}`)
      if (parsed.event === 'complete') complete = parsed.data
    }
  }

  if (!complete) throw new Error('Evidence stream ended without completion.')
  if (complete.progress?.phase !== 'complete') throw new Error(`Evidence phase was ${complete.progress?.phase}`)
  if (Number(complete.progress?.reachable || 0) < 1) throw new Error(`No reachable evidence: ${JSON.stringify(complete.progress)}`)
  if (!Array.isArray(complete.results) || complete.results.length < 1) throw new Error('No verified evidence result.')
  if (progressEvents < 1 || resultEvents < 1) throw new Error('Evidence stream emitted no live progress/results.')
  console.log(`[evidence] checked=${complete.progress.checked}; reachable=${complete.progress.reachable}; valid=${complete.progress.valid}`)
}

async function main() {
  console.log(`Testing production: ${APP_URL}`)
  if (EXPECTED_COMMIT) console.log(`Expected commit: ${EXPECTED_COMMIT}`)
  const health = await waitForDeployment()
  console.log(`Production deployment ready: ${health.commit}`)
  if (health.capabilities?.coreSearchApiKeysRequired !== false) throw new Error('Health contract says core search requires API keys.')
  if (health.capabilities?.serverSideSearchRetrieval !== false) throw new Error('Health contract says server-side search retrieval is still active.')
  if (health.capabilities?.browserFedSearch !== true) throw new Error('Health contract does not expose browser-fed search.')

  const plan = await runPlan()
  await runBrowserIngest(plan)
  await assertLegacyServerSearchRetired()
  await runEvidenceValidation()
  console.log('Production smoke test passed.')
}

main().catch(error => {
  console.error('Production smoke test failed.')
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})
