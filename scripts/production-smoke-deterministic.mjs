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

const OFFICIAL_EVIDENCE_CANDIDATES = [
  {
    title: 'Occupational Health Professionals - Overview | OSHA',
    url: 'https://www.osha.gov/occupational-health-professionals',
    description: 'Official OSHA overview of occupational health professionals, programs, and services.',
    domain: 'osha.gov',
    source: 'production-smoke',
    rank: 1,
    score: 100,
  },
  {
    title: "OSHA's Clinicians Web Page",
    url: 'https://www.osha.gov/clinicians',
    description: 'Official OSHA occupational-health guidance for clinicians caring for workers.',
    domain: 'osha.gov',
    source: 'production-smoke',
    rank: 2,
    score: 95,
  },
  {
    title: 'Help for Employers | OSHA',
    url: 'https://www.osha.gov/employers',
    description: 'Official OSHA workplace safety, health, consultation, and compliance assistance resources.',
    domain: 'osha.gov',
    source: 'production-smoke',
    rank: 3,
    score: 90,
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
        && health.searchPipeline === 'orchestrated-v5-evidence-stream'
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

async function runSearch(query, lens, health) {
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
  if (health.capabilities?.geminiIntentPlanner && diagnostics.semanticIntent?.usedExternal !== true) {
    throw new Error(`${lens} did not use Gemini: ${JSON.stringify(diagnostics.semanticIntent)}`)
  }
  if (health.capabilities?.cloudflareReranker && diagnostics.cloudflareRerank?.used !== true) {
    throw new Error(`${lens} did not use Cloudflare: ${JSON.stringify(diagnostics.cloudflareRerank)}`)
  }
  if (
    (health.capabilities?.cerebrasSmartFilter || health.capabilities?.groqSmartFilter)
    && diagnostics.smartFilter?.externalUsed !== true
  ) {
    throw new Error(`${lens} did not use Cerebras/Groq: ${JSON.stringify(diagnostics.smartFilter)}`)
  }

  console.log(`[${lens}] candidates=${data.results.length}; live=${diagnostics.successfulLiveTasks}/${diagnostics.attemptedLiveTasks}; memory=${diagnostics.memoryKeywordMatches}/${diagnostics.memoryVectorMatches}`)
  for (const result of data.results.slice(0, 3)) console.log(`[${lens}] ${result.source} · ${result.title} — ${result.url}`)
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
      query: 'occupational health professionals and services',
      lens: 'government',
      results: OFFICIAL_EVIDENCE_CANDIDATES,
      maxTargets: OFFICIAL_EVIDENCE_CANDIDATES.length,
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
  if (Number(complete.progress?.reachable || 0) < 1) throw new Error(`No reachable evidence: ${JSON.stringify(complete.progress)}`)
  if (!Array.isArray(complete.results) || complete.results.length < 1) {
    throw new Error(`No verified evidence result: ${JSON.stringify(complete.buckets).slice(0, 2_000)}`)
  }
  if (!complete.results.every(result =>
    result.bucket === 'valid'
    && result.validation?.status === 'valid'
    && result.pageValidation?.availability === 'reachable'
  )) throw new Error(`Non-verified main result leaked: ${JSON.stringify(complete.results).slice(0, 2_000)}`)
  if (complete.diagnostics?.verifiedOnly !== true) throw new Error('Verified-only mode was not reported.')
  if (progressEvents < 1 || resultEvents < 1) throw new Error('Evidence stream emitted no live progress/results.')

  console.log(`[evidence] checked=${complete.progress.checked}; reachable=${complete.progress.reachable}; valid=${complete.progress.valid}`)
  for (const result of complete.results) console.log(`[evidence] VERIFIED · ${result.title} — ${result.url}`)
}

async function main() {
  console.log(`Testing production: ${APP_URL}`)
  if (EXPECTED_COMMIT) console.log(`Expected commit: ${EXPECTED_COMMIT}`)
  const health = await waitForDeployment()
  console.log(`Production deployment ready: ${health.commit}`)
  console.log(`Capabilities: ${JSON.stringify(health.capabilities)}`)

  await runSearch('occupational health services', 'web', health)
  await runSearch('request for proposal occupational health services', 'procurement', health)
  await runEvidenceValidation()

  console.log('Production smoke test passed.')
}

main().catch(error => {
  console.error('Production smoke test failed.')
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})
