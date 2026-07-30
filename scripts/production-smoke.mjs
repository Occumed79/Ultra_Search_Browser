const APP_URL = (process.env.APP_URL || 'https://ultra-search-browser.onrender.com').replace(/\/$/, '')
const EXPECTED_COMMIT = (process.env.EXPECTED_COMMIT || '').trim()
const MAX_WAIT_MS = Number(process.env.MAX_WAIT_MS || 12 * 60 * 1000)
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15_000)

const FORBIDDEN_HOSTS = new Set([
  'bing.com', 'www.bing.com',
  'google.com', 'www.google.com',
  'duckduckgo.com', 'html.duckduckgo.com', 'lite.duckduckgo.com',
  'login.live.com', 'signup.live.com', 'account.microsoft.com',
  'login.microsoftonline.com', 'accounts.google.com',
])
const GENERIC_PROCUREMENT_TITLES = /\b(?:definition|meaning|dictionary|encyclopedia|occupational outlook handbook|licensing|license lookup|career guide|jobs?|home|a[- ]?z index|topic index|therapy)\b/i
const PROCUREMENT_EVIDENCE = /\b(?:request for proposals?|rfp|request for quotations?|rfq|request for tenders?|rft|invitation to bid|ifb|solicitation|tender|bid(?:ding)?|procurement|contract opportunity|vendor opportunity|competitive sealed proposal|notice inviting bids)\b/i
const PROCUREMENT_PORTALS = /(?:sam\.gov|ionwave\.net|bonfirehub\.com|planetbids\.com|bidnetdirect\.com|publicpurchase\.com|opengov\.com|bidsandtenders\.com)/i

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
        && health.searchPipeline === 'orchestrated-v8-multi-api-failover'
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

function assertCandidateUrls(results, lens) {
  for (const result of results) {
    const host = new URL(result.url).hostname.toLowerCase()
    if (FORBIDDEN_HOSTS.has(host)) {
      throw new Error(`${lens} leaked search/auth navigation: ${result.title} — ${result.url}`)
    }
  }
}

function assertProcurementQuality(results) {
  for (const result of results) {
    const text = `${result.title} ${result.description} ${result.url}`
    if (GENERIC_PROCUREMENT_TITLES.test(result.title)) {
      throw new Error(`Procurement search leaked a generic page: ${result.title} — ${result.url}`)
    }
    if (!PROCUREMENT_EVIDENCE.test(text) && !PROCUREMENT_PORTALS.test(result.url)) {
      throw new Error(`Procurement candidate lacks opportunity evidence: ${result.title} — ${result.url}`)
    }
  }
}

async function runSearch(query, lens, health, expectations = {}) {
  const response = await fetch(`${APP_URL}/api/search`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      lens,
      settings: {
        defaultSources: ['bing', 'duckduckgo', 'memory'],
        resultsPerPage: 20,
        safeSearch: true,
        autoSummarize: true,
        preferredLanguage: 'en',
        region: 'us',
      },
    }),
    signal: AbortSignal.timeout(75_000),
  })
  const data = await readJson(response)
  if (!response.ok) throw new Error(`${lens} search HTTP ${response.status}: ${JSON.stringify(data).slice(0, 1_500)}`)
  if (!Array.isArray(data.results) || data.results.length === 0) {
    throw new Error(`${lens} search returned no candidates: ${JSON.stringify(data.diagnostics || data).slice(0, 1_500)}`)
  }
  assertCandidateUrls(data.results, lens)

  const diagnostics = data.diagnostics || {}
  if (Number(diagnostics.attemptedLiveTasks || 0) < 3) throw new Error(`${lens} did not fan out across live tasks.`)
  if (
    !data.intent
    || !Array.isArray(data.intent.conceptGroups)
    || data.intent.conceptGroups.length === 0
  ) {
    throw new Error(`${lens} did not return a structured intent plan: ${JSON.stringify(data.intent)}`)
  }

  if (expectations.expectedLens && data.lens !== expectations.expectedLens) {
    throw new Error(`Expected ${expectations.expectedLens} lens but production returned ${data.lens}.`)
  }
  if (expectations.autoRouted) {
    if (diagnostics.lensRouting?.autoRouted !== true) {
      throw new Error(`Production did not report automatic lens routing: ${JSON.stringify(diagnostics.lensRouting)}`)
    }
  }
  if (expectations.requireIntentGate) {
    if (diagnostics.intentGate?.applied !== true) {
      throw new Error(`Production did not apply the procurement intent gate: ${JSON.stringify(diagnostics.intentGate)}`)
    }
  }
  if (expectations.procurementQuality) assertProcurementQuality(data.results)
  if (Number(data.confidence || 0) !== 0) {
    throw new Error(`Candidate-stage confidence must be 0, received ${data.confidence}.`)
  }
  if (data.summary) {
    throw new Error(`Candidate-stage search returned a premature summary: ${data.summary}`)
  }

  console.log(`[${lens}->${data.lens}] candidates=${data.results.length}; live=${diagnostics.successfulLiveTasks}/${diagnostics.attemptedLiveTasks}; memory=${diagnostics.memoryKeywordMatches}/${diagnostics.memoryVectorMatches}`)
  for (const result of data.results.slice(0, 3)) console.log(`[${data.lens}] ${result.source} · ${result.title} — ${result.url}`)
  return data
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
  if (!response.ok || !response.body) {
    throw new Error(`Evidence validation HTTP ${response.status}: ${(await response.text()).slice(0, 800)}`)
  }

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
  if (Number(complete.progress?.reachable || 0) < 1) {
    throw new Error(`No reachable evidence: ${JSON.stringify({ progress: complete.progress, buckets: complete.buckets }).slice(0, 2_500)}`)
  }
  if (!Array.isArray(complete.results) || complete.results.length < 1) {
    throw new Error(`No verified evidence result: ${JSON.stringify(complete.buckets).slice(0, 2_000)}`)
  }
  const verified = complete.results.filter(result =>
    result.bucket === 'valid'
    && result.validation?.status === 'valid'
    && result.pageValidation?.availability === 'reachable'
  )
  if (verified.length < 1) throw new Error(`No verified main result: ${JSON.stringify(complete.results).slice(0, 2_000)}`)
  if (Number(complete.diagnostics?.verifiedCount || 0) < 1) throw new Error('Verified result count was not reported.')
  if (progressEvents < 1 || resultEvents < 1) throw new Error('Evidence stream emitted no live progress/results.')
  if (Number(complete.confidence || 0) <= 0) throw new Error('Verified evidence returned no confidence score.')
  if (!complete.summary) throw new Error('Verified evidence returned no grounded summary.')

  console.log(`[evidence] checked=${complete.progress.checked}; reachable=${complete.progress.reachable}; valid=${complete.progress.valid}; confidence=${complete.confidence}`)
  for (const result of complete.results) console.log(`[evidence] VERIFIED · ${result.title} — ${result.url}`)
}

async function main() {
  console.log(`Testing production: ${APP_URL}`)
  if (EXPECTED_COMMIT) console.log(`Expected commit: ${EXPECTED_COMMIT}`)
  const health = await waitForDeployment()
  console.log(`Production deployment ready: ${health.commit}`)
  console.log(`Capabilities: ${JSON.stringify(health.capabilities)}`)

  await runSearch('occupational health services', 'web', health, {
    expectedLens: 'provider',
    autoRouted: true,
  })
  await runSearch('Occupational Health Services RFP', 'web', health, {
    expectedLens: 'procurement',
    autoRouted: true,
    requireIntentGate: true,
    procurementQuality: true,
  })
  await runEvidenceValidation()

  console.log('Production smoke test passed.')
}

main().catch(error => {
  console.error('Production smoke test failed.')
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})
