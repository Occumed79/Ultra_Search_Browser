import { writeFile } from 'node:fs/promises'

const APP_URL = process.env.APP_URL || 'https://ultra-search-browser.onrender.com'
const EXPECTED_COMMIT = process.env.EXPECTED_COMMIT || ''
const DEPLOYMENT_TIMEOUT_MS = 12 * 60_000
const POLL_INTERVAL_MS = 15_000
const PROCUREMENT_EVIDENCE = /\b(rfp|rfq|rfi|solicitation|request for proposals?|request for quotations?|invitation to bid|bid opportunity|procurement|tender|due date|submission deadline|responses? due|closing date|scope of work|statement of work)\b/i
const PROCUREMENT_PORTALS = /\b(sam\.gov|bidnetdirect|bonfirehub|ionwave|planetbids|opengov|publicpurchase|demandstar|vendorregistry|procurement|bids?|solicitations?|rfp|rfq)\b/i
const CLOSED_OPPORTUNITY = /\b(closed|expired|archived|awarded|cancelled|canceled|responses? were due|submission deadline was|bid opening was)\b/i
const PROVIDER_EVIDENCE = /\b(occupational health|occupational medicine|employee health|workplace health|pre[- ]employment|medical examinations?|drug testing|audiometry|spirometry|fit testing|clinic|provider|services?)\b/i

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function commitMatches(actual, expected) {
  if (!expected) return true
  if (!actual) return false
  return actual === expected || actual.startsWith(expected) || expected.startsWith(actual)
}

async function readJson(response) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Expected JSON from ${response.url}; received: ${text.slice(0, 500)}`)
  }
}

async function fetchHealth() {
  const response = await fetch(`${APP_URL}/api/health`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  return { response, health: await readJson(response) }
}

async function waitForDeployment() {
  const deadline = Date.now() + DEPLOYMENT_TIMEOUT_MS
  let lastHealth = null

  while (Date.now() < deadline) {
    try {
      const { response, health } = await fetchHealth()
      lastHealth = health
      console.log(`[deployment] HTTP ${response.status}; commit=${health.commit || 'unknown'}; pipeline=${health.searchPipeline || 'unknown'}`)
      if (
        response.ok
        && health.status === 'ok'
        && health.searchPipeline === 'orchestrated-v10-browser-search-fallback'
        && (!EXPECTED_COMMIT || commitMatches(health.commit, EXPECTED_COMMIT))
      ) return health
    } catch (error) {
      console.log(`[deployment] ${error instanceof Error ? error.message : String(error)}`)
    }
    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(`Timed out waiting for production deployment. Last health: ${JSON.stringify(lastHealth)}`)
}

function resultText(result) {
  return `${result.title || ''} ${result.description || ''} ${result.url || ''}`
}

function assertCandidateUrls(results, lens) {
  for (const result of results) {
    if (typeof result.url !== 'string' || !/^https?:\/\//i.test(result.url)) {
      throw new Error(`${lens} returned a malformed candidate URL: ${JSON.stringify(result)}`)
    }
  }
}

function assertProcurementResults(results) {
  for (const result of results.slice(0, 8)) {
    const text = resultText(result)
    if (CLOSED_OPPORTUNITY.test(text)) {
      throw new Error(`Procurement result appears closed or expired: ${result.title} — ${result.url}`)
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
        defaultSources: ['bing', 'duckduckgo', 'mojeek', 'memory'],
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
      throw new Error(`Production did not apply the complete-query intent gate: ${JSON.stringify(diagnostics.intentGate)}`)
    }
    if (!diagnostics.intentGate?.model || diagnostics.intentGate.model === 'disabled') {
      throw new Error(`Production intent gate did not report an external model: ${JSON.stringify(diagnostics.intentGate)}`)
    }
  }

  if (lens === 'provider' || data.lens === 'provider') {
    const topText = data.results.slice(0, 8).map(resultText).join(' ')
    if (!PROVIDER_EVIDENCE.test(topText)) {
      throw new Error(`Provider search lacks occupational-health evidence: ${topText.slice(0, 1_000)}`)
    }
  }
  if (lens === 'procurement' || data.lens === 'procurement') assertProcurementResults(data.results)

  const validationResponse = await fetch(`${APP_URL}/api/search/validate`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      lens: data.lens || lens,
      results: data.results.slice(0, 8),
      settings: {
        safeSearch: true,
        preferredLanguage: 'en',
        region: 'us',
      },
    }),
    signal: AbortSignal.timeout(75_000),
  })
  const validation = await readJson(validationResponse)
  if (!validationResponse.ok) {
    throw new Error(`${lens} validation HTTP ${validationResponse.status}: ${JSON.stringify(validation).slice(0, 1_500)}`)
  }
  if (!Array.isArray(validation.results) || validation.results.length === 0) {
    throw new Error(`${lens} validation returned no candidates: ${JSON.stringify(validation).slice(0, 1_500)}`)
  }

  const summary = {
    query,
    requestedLens: lens,
    returnedLens: data.lens,
    count: data.results.length,
    topResults: data.results.slice(0, 5).map(result => ({
      title: result.title,
      url: result.url,
      source: result.source,
      score: result.score,
    })),
    diagnostics: {
      attemptedLiveTasks: diagnostics.attemptedLiveTasks,
      successfulLiveTasks: diagnostics.successfulLiveTasks,
      failedLiveTasks: diagnostics.failedLiveTasks,
      sourceRuns: diagnostics.sourceRuns,
      managedSearch: diagnostics.managedSearch,
      geminiGroundedSearch: diagnostics.geminiGroundedSearch,
      automaticBrowserFallbackEnabled: diagnostics.automaticBrowserFallbackEnabled,
      intentGate: diagnostics.intentGate,
      lensRouting: diagnostics.lensRouting,
    },
    validation: {
      count: validation.results.length,
      buckets: validation.buckets,
    },
    capabilities: health.capabilities,
  }

  console.log(JSON.stringify(summary, null, 2))
  return summary
}

async function main() {
  const health = await waitForDeployment()
  console.log(`Production deployment ready: ${health.commit || 'unknown'}`)
  console.log(`Capabilities: ${JSON.stringify(health.capabilities || {})}`)

  const reports = []
  reports.push(await runSearch(
    'occupational health services',
    'provider',
    health,
    { expectedLens: 'provider', requireIntentGate: true }
  ))
  reports.push(await runSearch(
    'occupational health services RFP',
    'web',
    health,
    { expectedLens: 'procurement', autoRouted: true, requireIntentGate: true }
  ))

  await writeFile(
    'production-smoke-report.json',
    JSON.stringify({ generatedAt: new Date().toISOString(), appUrl: APP_URL, health, reports }, null, 2)
  )
}

main().catch(async error => {
  const message = error instanceof Error ? `${error.stack || error.message}` : String(error)
  console.error('Production smoke test failed.')
  console.error(message)
  await writeFile(
    'production-smoke-report.json',
    JSON.stringify({ generatedAt: new Date().toISOString(), appUrl: APP_URL, error: message }, null, 2)
  )
  process.exitCode = 1
})
