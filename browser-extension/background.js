const ENGINE_ORDER = ['google', 'bing', 'duckduckgo', 'brave']
const SEARCH_TIMEOUT_MS = 20_000

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

function mergeCandidates(candidates) {
  const merged = new Map()
  for (const candidate of candidates) {
    if (!candidate?.url || !candidate?.title) continue
    let key
    try {
      const url = new URL(candidate.url)
      url.hash = ''
      key = url.toString().replace(/\/$/, '').toLowerCase()
    } catch {
      continue
    }
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, candidate)
      continue
    }
    const sources = new Set([existing.source, candidate.source].filter(Boolean))
    const queries = new Set([existing.query, candidate.query].filter(Boolean))
    merged.set(key, {
      ...(Number(existing.score || 0) >= Number(candidate.score || 0) ? existing : candidate),
      description: String(existing.description || '').length >= String(candidate.description || '').length
        ? existing.description
        : candidate.description,
      source: Array.from(sources).join(' + '),
      query: Array.from(queries).join(' | '),
    })
  }
  return Array.from(merged.values()).map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
  }))
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

  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index]
    const primary = ENGINE_ORDER[index % ENGINE_ORDER.length]
    const fallback = ENGINE_ORDER[(index + 1) % ENGINE_ORDER.length]
    let succeeded = false

    for (const engine of [primary, fallback]) {
      enginesUsed.add(engine)
      try {
        const response = await searchOneEngine(variant, engine, plan.maxResultsPerSearch || 20)
        const results = Array.isArray(response.results) ? response.results : []
        diagnostics.push({
          query: variant.query,
          engine,
          resultCount: results.length,
          pageTitle: response.pageTitle,
        })
        if (results.length > 0) {
          allCandidates.push(...results)
          successfulSearches += 1
          succeeded = true
          break
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

    if (!succeeded) {
      diagnostics.push({
        query: variant.query,
        resultCount: 0,
        error: 'No browser engine returned parseable result cards for this query.',
      })
    }
    await sleep(200)
  }

  return {
    results: mergeCandidates(allCandidates),
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
