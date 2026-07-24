const APP_URL = (process.env.APP_URL || 'https://ultra-search-browser.onrender.com').replace(/\/$/, '')
const EXPECTED_COMMIT = (process.env.EXPECTED_COMMIT || '').trim()
const MAX_WAIT_MS = Number(process.env.MAX_WAIT_MS || 12 * 60 * 1000)
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15_000)

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function readJson(response) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Expected JSON from ${response.url}, received: ${text.slice(0, 500)}`)
  }
}

function commitMatches(actual, expected) {
  if (!actual || actual === 'unknown' || !expected) return false
  return actual.startsWith(expected) || expected.startsWith(actual)
}

async function waitForDeployment() {
  const deadline = Date.now() + MAX_WAIT_MS
  let lastState = 'No response received yet.'

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${APP_URL}/api/health?ts=${Date.now()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(25_000),
      })
      const data = await readJson(response)
      lastState = `HTTP ${response.status}; commit=${data.commit || 'missing'}; pipeline=${data.searchPipeline || 'missing'}`
      console.log(`[deployment] ${lastState}`)

      if (
        response.ok
        && data.status === 'ok'
        && [
          'orchestrated-v2',
          'orchestrated-v3-smart-filter',
          'orchestrated-v4-semantic-superfilter',
          'orchestrated-v5-evidence-stream',
        ].includes(data.searchPipeline)
        && (!EXPECTED_COMMIT || commitMatches(data.commit, EXPECTED_COMMIT))
      ) {
        return data
      }
    } catch (error) {
      lastState = error instanceof Error ? error.message : String(error)
      console.log(`[deployment] waiting: ${lastState}`)
    }

    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(`Render did not serve the expected deployment before timeout. Last state: ${lastState}`)
}

async function runSearch({
  query,
  lens,
  expectExternalSmartFilter,
  expectGemini,
  expectCloudflare,
}) {
  const startedAt = Date.now()
  const response = await fetch(`${APP_URL}/api/search`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
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
  const runtimeMs = Date.now() - startedAt

  if (!response.ok) {
    throw new Error(`${lens} search failed with HTTP ${response.status}: ${JSON.stringify(data).slice(0, 1_500)}`)
  }
  if (!Array.isArray(data.results) || data.results.length === 0) {
    throw new Error(`${lens} search returned no results: ${JSON.stringify(data.diagnostics || data).slice(0, 1_500)}`)
  }
  if (!data.diagnostics || Number(data.diagnostics.attemptedLiveTasks || 0) < 3) {
    throw new Error(`${lens} search did not expose a multi-task orchestration plan.`)
  }
  if (!Array.isArray(data.diagnostics.queryVariants) || data.diagnostics.queryVariants.length < 2) {
    throw new Error(`${lens} search did not generate multiple query variants.`)
  }
  if (!data.diagnostics.smartFilter) {
    throw new Error(`${lens} search did not expose smart-filter diagnostics.`)
  }
  if (expectExternalSmartFilter && data.diagnostics.smartFilter.externalUsed !== true) {
    throw new Error(`${lens} search did not successfully use Cerebras or Groq: ${JSON.stringify(data.diagnostics.smartFilter).slice(0, 1_500)}`)
  }
  if (expectExternalSmartFilter) {
    const attempts = data.diagnostics.smartFilter.providerAttempts
    const successfulRole = Array.isArray(attempts)
      && attempts.some(attempt => attempt.status === 'success' && ['primary', 'fallback', 'review'].includes(attempt.role))
    if (!successfulRole) {
      throw new Error(`${lens} search did not report a successful provider role: ${JSON.stringify(attempts).slice(0, 1_500)}`)
    }
  }

  const semanticIntent = data.diagnostics.semanticIntent
  if (!semanticIntent) throw new Error(`${lens} search did not expose semantic-intent diagnostics.`)
  if (expectGemini && semanticIntent.usedExternal !== true) {
    throw new Error(`${lens} search did not successfully use Gemini intent planning: ${JSON.stringify(semanticIntent).slice(0, 1_500)}`)
  }
  if (expectGemini && !data.diagnostics.queryVariants.some(variant => variant.purpose === 'ai-intent')) {
    throw new Error(`${lens} search used Gemini but emitted no AI-intent query variants.`)
  }

  const cloudflare = data.diagnostics.cloudflareRerank
  if (!cloudflare) throw new Error(`${lens} search did not expose Cloudflare reranker diagnostics.`)
  if (expectCloudflare && cloudflare.used !== true) {
    throw new Error(`${lens} search did not successfully use Cloudflare reranking: ${JSON.stringify(cloudflare).slice(0, 1_500)}`)
  }

  console.log(`\n[${lens}] ${data.results.length} results in ${runtimeMs}ms`)
  console.log(`[${lens}] ${data.diagnostics.attemptedLiveTasks}/${data.diagnostics.taskBudget} live tasks; ${data.diagnostics.successfulLiveTasks} succeeded; ${data.diagnostics.failedLiveTasks} failed`)
  console.log(`[${lens}] Gemini: used=${semanticIntent.usedExternal}; model=${semanticIntent.model || 'deterministic'}; complexity=${semanticIntent.complexity}`)
  console.log(`[${lens}] Cloudflare: used=${cloudflare.used}; model=${cloudflare.model}; scored=${cloudflare.scoredCount}`)
  console.log(`[${lens}] smart filter: ${data.diagnostics.smartFilter.mode}; externalUsed=${data.diagnostics.smartFilter.externalUsed}`)
  console.log(`[${lens}] provider attempts: ${JSON.stringify(data.diagnostics.smartFilter.providerAttempts || [])}`)
  console.log(`[${lens}] query variants: ${data.diagnostics.queryVariants.map(item => `${item.purpose}: ${item.query}`).join(' | ')}`)
  for (const result of data.results.slice(0, 3)) {
    console.log(`[${lens}] - ${result.title} — ${result.url}`)
  }

  return data
}

function parseSseBlock(block) {
  let event = 'message'
  const data = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (!data.length) return null
  return { event, data: JSON.parse(data.join('\n')) }
}

async function runEvidenceValidation({ query, lens, results }) {
  const response = await fetch(`${APP_URL}/api/search/validate`, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, lens, results: results.slice(0, 4), maxTargets: 3 }),
    signal: AbortSignal.timeout(95_000),
  })
  if (!response.ok || !response.body) {
    throw new Error(`Evidence validation returned HTTP ${response.status}: ${(await response.text()).slice(0, 800)}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let complete = null
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
      if (parsed.event === 'error') throw new Error(`Evidence stream error: ${JSON.stringify(parsed.data).slice(0, 1_500)}`)
      if (parsed.event === 'complete') complete = parsed.data
    }
  }

  if (!complete) throw new Error('Evidence-validation stream ended without a complete event.')
  if (complete.progress?.phase !== 'complete') throw new Error(`Evidence validation did not complete: ${JSON.stringify(complete.progress)}`)
  if (Number(complete.progress?.checked || 0) < 1) throw new Error('Evidence validation did not inspect any destination pages.')
  if (!complete.buckets || !Array.isArray(complete.results)) throw new Error('Evidence validation returned no result buckets.')
  if (progressEvents < 1 || resultEvents < 1) throw new Error(`Evidence stream did not emit live progress/results: progress=${progressEvents}; results=${resultEvents}`)

  console.log(`\n[evidence] checked=${complete.progress.checked}; reachable=${complete.progress.reachable}; valid=${complete.progress.valid}; uncertain=${complete.progress.uncertain}; expired=${complete.progress.expired}; dead=${complete.progress.dead}; rejected=${complete.progress.rejected}; duplicates=${complete.progress.duplicates}`)
  console.log(`[evidence] runtime=${complete.diagnostics?.runtimeMs}ms; cache=${JSON.stringify(complete.diagnostics?.pageCache || {})}`)
  return complete
}

async function main() {
  console.log(`Testing production: ${APP_URL}`)
  if (EXPECTED_COMMIT) console.log(`Expected commit: ${EXPECTED_COMMIT}`)

  const health = await waitForDeployment()
  console.log(`Production deployment ready: ${health.commit}`)
  console.log(`Capabilities: ${JSON.stringify(health.capabilities)}`)

  if (health.capabilities?.groqSmartFilter === true) {
    if (!health.capabilities.groqSmartModel || !health.capabilities.groqReviewModel) {
      throw new Error('Groq is configured but separate smart and review model metadata is missing.')
    }
    console.log(`Groq fallback model: ${health.capabilities.groqSmartModel}`)
    console.log(`Groq review model: ${health.capabilities.groqReviewModel}`)
  }
  if (health.capabilities?.geminiIntentPlanner === true && !health.capabilities.geminiIntentModel) {
    throw new Error('Gemini is configured but intent model metadata is missing.')
  }
  if (health.capabilities?.cloudflareReranker === true && !health.capabilities.cloudflareRerankModel) {
    throw new Error('Cloudflare is configured but reranker model metadata is missing.')
  }
  if (health.searchPipeline === 'orchestrated-v5-evidence-stream') {
    if (health.capabilities?.deepPageValidation !== true || health.capabilities?.streamingValidation !== true) {
      throw new Error('Evidence-first deployment is missing deep page or streaming capabilities.')
    }
  }

  const expectExternalSmartFilter = health.capabilities?.cerebrasSmartFilter === true
    || health.capabilities?.groqSmartFilter === true
  const expectGemini = health.capabilities?.geminiIntentPlanner === true
  const expectCloudflare = health.capabilities?.cloudflareReranker === true

  const web = await runSearch({
    query: 'occupational health services',
    lens: 'web',
    expectExternalSmartFilter,
    expectGemini,
    expectCloudflare,
  })
  await runSearch({
    query: 'request for proposal occupational health services',
    lens: 'procurement',
    expectExternalSmartFilter,
    expectGemini,
    expectCloudflare,
  })

  if (health.searchPipeline === 'orchestrated-v5-evidence-stream') {
    await runEvidenceValidation({
      query: web.query || 'occupational health services',
      lens: web.lens || 'web',
      results: web.results,
    })
  }

  console.log('\nProduction smoke test passed.')
}

main().catch(error => {
  console.error('\nProduction smoke test failed.')
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})
