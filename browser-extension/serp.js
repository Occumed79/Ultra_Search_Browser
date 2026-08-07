function textOf(root, selectors) {
  for (const selector of selectors) {
    const node = root.querySelector(selector)
    const value = node?.textContent?.replace(/\s+/g, ' ').trim()
    if (value) return value
  }
  return ''
}

function engineName(hostname) {
  if (hostname.includes('google.')) return 'Google'
  if (hostname.includes('bing.com')) return 'Bing'
  if (hostname.includes('duckduckgo.com')) return 'DuckDuckGo'
  if (hostname.includes('brave.com')) return 'Brave'
  return 'Browser'
}

function normalizeLink(href) {
  if (!href) return null
  try {
    const url = new URL(href, window.location.href)
    if (url.hostname.includes('google.') && url.pathname === '/url') {
      const target = url.searchParams.get('q') || url.searchParams.get('url')
      if (target) return normalizeLink(target)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function isExternalResult(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    const current = window.location.hostname.replace(/^www\./, '').toLowerCase()
    if (host === current) return false
    if (host.endsWith('google.com') || host.endsWith('bing.com')) return false
    if (host.endsWith('duckduckgo.com') || host.endsWith('brave.com')) return false
    return true
  } catch {
    return false
  }
}

function candidateFromBlock(block, titleSelectors, linkSelectors, snippetSelectors) {
  let title = ''
  let link = null

  for (const selector of titleSelectors) {
    const titleNode = block.querySelector(selector)
    const value = titleNode?.textContent?.replace(/\s+/g, ' ').trim()
    if (!value) continue
    title = value
    const nearestLink = titleNode.closest('a') || titleNode.querySelector('a')
    link = normalizeLink(nearestLink?.href)
    if (link) break
  }

  if (!link) {
    for (const selector of linkSelectors) {
      const linkNode = block.querySelector(selector)
      const href = normalizeLink(linkNode?.href)
      if (!href) continue
      link = href
      if (!title) title = linkNode.textContent?.replace(/\s+/g, ' ').trim() || ''
      break
    }
  }

  if (!title || !link || !isExternalResult(link)) return null
  return {
    title: title.slice(0, 500),
    url: link,
    description: textOf(block, snippetSelectors).slice(0, 2_000),
  }
}

function extractGoogle() {
  const blocks = Array.from(document.querySelectorAll('div.MjjYud, div.g, div[data-snhf]'))
  return blocks.map(block => candidateFromBlock(
    block,
    ['h3'],
    ['a[href]'],
    ['.VwiC3b', '.IsZvec', '[data-sncf]', '.yXK7lf']
  )).filter(Boolean)
}

function extractBing() {
  const blocks = Array.from(document.querySelectorAll('li.b_algo, .b_algo'))
  return blocks.map(block => candidateFromBlock(
    block,
    ['h2'],
    ['h2 a[href]', 'a[href]'],
    ['.b_caption p', '.b_snippet', 'p']
  )).filter(Boolean)
}

function extractDuckDuckGo() {
  const blocks = Array.from(document.querySelectorAll('article[data-testid="result"], .result, [data-testid="result"]'))
  return blocks.map(block => candidateFromBlock(
    block,
    ['h2', '.result__title'],
    ['a[data-testid="result-title-a"]', '.result__a', 'a[href]'],
    ['[data-result="snippet"]', '[data-testid="result-snippet"]', '.result__snippet']
  )).filter(Boolean)
}

function extractBrave() {
  const blocks = Array.from(document.querySelectorAll('#results .snippet, #results [data-type="web"], .snippet'))
  return blocks.map(block => candidateFromBlock(
    block,
    ['h2', 'h3', '.title'],
    ['a[href]'],
    ['.snippet-description', '.description', '.content', 'p']
  )).filter(Boolean)
}

function extractGeneric() {
  const blocks = Array.from(document.querySelectorAll('article, li, div')).filter(block => {
    const heading = block.querySelector('h2, h3')
    const anchor = heading?.closest('a') || heading?.querySelector('a') || block.querySelector('h2 a, h3 a')
    return Boolean(heading && anchor)
  }).slice(0, 80)

  return blocks.map(block => candidateFromBlock(
    block,
    ['h2', 'h3'],
    ['h2 a[href]', 'h3 a[href]', 'a[href]'],
    ['p', '[class*="snippet"]', '[class*="description"]']
  )).filter(Boolean)
}

function dedupe(results) {
  const seen = new Set()
  return results.filter(result => {
    const key = result.url.replace(/\/$/, '').toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 25)
}

function extractResults(message) {
  const host = window.location.hostname.toLowerCase()
  let raw = []
  if (host.includes('google.')) raw = extractGoogle()
  else if (host.includes('bing.com')) raw = extractBing()
  else if (host.includes('duckduckgo.com')) raw = extractDuckDuckGo()
  else if (host.includes('brave.com')) raw = extractBrave()
  if (raw.length === 0) raw = extractGeneric()

  const source = `Browser · ${engineName(host)}`
  return dedupe(raw).map((result, index) => ({
    ...result,
    source,
    rank: index + 1,
    score: Math.max(10, 100 - index * 3),
    query: message.query || '',
    purpose: message.purpose || '',
  }))
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'ULTRA_EXTRACT_SERP') return false
  try {
    const results = extractResults(message)
    sendResponse({
      ok: true,
      results,
      pageTitle: document.title,
      pageUrl: window.location.href,
    })
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      pageTitle: document.title,
      pageUrl: window.location.href,
    })
  }
  return true
})
