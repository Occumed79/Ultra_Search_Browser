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
        && ['orchestrated-v2', 'orchestrated-v3-smart-filter'].includes(data.searchPipeline)
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

async function runSearch({ query, lens, expectExternalSmartFilter }) {
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
    signal: AbortSignal.timeout(55_000),
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

  console.log(`\n[${lens}] ${data.results.length} results in ${runtimeMs}ms`)
  console.log(`[${lens}] ${data.diagnostics.attemptedLiveTasks} live tasks; ${data.diagnostics.successfulLiveTasks} succeeded; ${data.diagnostics.failedLiveTasks} failed`)
  console.log(`[${lens}] smart filter: ${data.diagnostics.smartFilter.mode}; externalUsed=${data.diagnostics.smartFilter.externalUsed}`)
  console.log(`[${lens}] query variants: ${data.diagnostics.queryVariants.map(item => `${item.purpose}: ${item.query}`).join(' | ')}`)
  for (const result of data.results.slice(0, 3)) {
    console.log(`[${lens}] - ${result.title} — ${result.url}`)
  }

  return data
}

async function main() {
  console.log(`Testing production: ${APP_URL}`)
  if (EXPECTED_COMMIT) console.log(`Expected commit: ${EXPECTED_COMMIT}`)

  const health = await waitForDeployment()
  console.log(`Production deployment ready: ${health.commit}`)
  console.log(`Capabilities: ${JSON.stringify(health.capabilities)}`)

  const expectExternalSmartFilter = health.capabilities?.cerebrasSmartFilter === true
    || health.capabilities?.groqSmartFilter === true

  await runSearch({ query: 'occupational health services', lens: 'web', expectExternalSmartFilter })
  await runSearch({ query: 'request for proposal occupational health services', lens: 'procurement', expectExternalSmartFilter })

  console.log('\nProduction smoke test passed.')
}

main().catch(error => {
  console.error('\nProduction smoke test failed.')
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})
