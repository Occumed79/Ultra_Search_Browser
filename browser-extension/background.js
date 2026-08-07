const ENGINE_ORDER = ['google', 'bing', 'duckduckgo', 'brave']
const SEARCH_TIMEOUT_MS = 20_000
const SEARCH_CONCURRENCY = 2

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function searchUrl(engine, query, count) {
  const encoded = encodeURIComponent(query)
  if (engine === 'google') return `https://www.google.com/search?q=${encoded}&num=${Math.min(20, count || 20)}&filter=0`
  if (engine === 'bing') return `https://www.bing.com/search?q=${encoded}&count=${Math.min(20, count || 20)}`
  if (engine === 'duckduckgo') return `https://duckduckgo.com/?q=${encoded}`
  return `https://search.brave.com/search?q=${encoded}&source=web`
}

function waitForTabComplete(tabId, timeoutMs = SEARCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = callback => {
      if (settled) return
      settled = true
      chrome.tabs.onUpdated.removeListener(onUpdated)
      clearTimeout(timer)
      callback()
    }
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish(resolve)
    }
    const timer = setTimeout(() => finish(() => reject(new Error('Search tab timed out.'))), timeoutMs)
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs.get(tabId, tab => {
      if (chrome.runtime.lastError) return
      if (tab?.status === 'complete') finish(resolve)
    })
  })
}

async function extractSerp(tabId, variant, engine) {
  let lastError = 'SERP extractor was not ready.'
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await new Promise(resolve => {
      chrome.tabs.sendMessage(tabId, {
        type: 'ULTRA_EXTRACT_SERP',
        query: variant.query,
        purpose: variant.purpose,
        engine,
      }, result => {
        if (chrome.runtime.lastError) {
          lastError = chrome.runtime.lastError.message
          resolve(null)
          return
        }
        resolve(result || null)
      })
    })
    if (response?.ok) return response
    if (response?.error) lastError = response.error
    await sleep(450)
  }
  throw new Error(lastError)
}

async function searchOneEngine(variant, engine, maxResults) {
  const tab = await chrome.tabs.create({
    url: searchUrl(engine, variant.query, maxResults),
    active: false,
  })
  if (!tab.id) throw new Error('Browser did not create a search tab.')

  try {
    await waitForTabComplete(tab.id)
    await sleep(250)
    return await extractSerp(tab.id, variant, engine)
  } finally {
    try {
      await chrome.tabs.remove(tab.id)
    } catch {
      // The user may have closed the background tab first.
    }
  }
}

async function searchVariant(variant, index, maxResults) {
  const diagnostics = []
  const engines = []
  const primary = ENGINE_ORDER[index % ENGINE_ORDER.length]
  const fallback = ENGINE_ORDER[(index + 1) % ENGINE_ORDER.length]

  for (const engine of [primary, fallback]) {
    engines.push(engine)
    try {
      const response = await searchOneEngine(variant, engine, maxResults)
      const results = Array.isArray(response.results) ? response.results : []
      diagnostics.push({
        query: variant.query,
        engine,
        resultCount: results.length,
        pageTitle: response.pageTitle,
      })
      if (results.length > 0) {
        return { results, engines, diagnostics, successful: true }
      }
    } catch (error) {
      diagnostics.push({
        query: variant.query,
        engine,
        resultCount: 0,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  diagnostics.push({
    query: variant.query,
    resultCount: 0,
    error: 'No browser engine returned parseable result cards for this query.',
  })
  return { results: [], engines, diagnostics, successful: false }
}

async function executePlan(plan) {
  if (!plan || !Array.isArray(plan.searches) || plan.searches.length === 0) {
    throw new Error('Ultra Search sent an empty browser search plan.')
  }

  const variants = plan.searches.slice(0, 10)
  const diagnostics = []
  const allCandidates = []
  const enginesUsed = new Set()
  let successfulSearches = 0

  for (let start = 0; start < variants.length; start += SEARCH_CONCURRENCY) {
    const wave = variants.slice(start, start + SEARCH_CONCURRENCY)
    const waveResults = await Promise.all(wave.map((variant, offset) =>
      searchVariant(variant, start + offset, plan.maxResultsPerSearch || 20)
    ))

    for (const result of waveResults) {
      diagnostics.push(...result.diagnostics)
      result.engines.forEach(engine => enginesUsed.add(engine))
      if (result.successful) successfulSearches += 1
      // Preserve duplicate URLs across engines/queries. The server ingestion
      // pipeline owns canonical URL dedupe so it can score cross-source overlap.
      allCandidates.push(...result.results)
    }

    if (start + SEARCH_CONCURRENCY < variants.length) await sleep(200)
  }

  return {
    results: allCandidates,
    engines: Array.from(enginesUsed),
    attemptedSearches: variants.length,
    successfulSearches,
    diagnostics,
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'ULTRA_SEARCH_RUN') return false

  executePlan(message.plan)
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(error => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }))
  return true
})
