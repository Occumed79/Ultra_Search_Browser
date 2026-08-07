const APP_SOURCE = 'ultra-search-app'
const EXTENSION_SOURCE = 'ultra-search-extension'

function postToApp(payload) {
  window.postMessage({ source: EXTENSION_SOURCE, ...payload }, window.location.origin)
}

window.addEventListener('message', event => {
  if (event.source !== window || !event.data || event.data.source !== APP_SOURCE) return

  if (event.data.type === 'ULTRA_SEARCH_PING') {
    postToApp({ type: 'ULTRA_SEARCH_PONG', requestId: event.data.requestId })
    return
  }

  if (event.data.type !== 'ULTRA_SEARCH_RUN') return

  const requestId = event.data.requestId
  chrome.runtime.sendMessage({
    type: 'ULTRA_SEARCH_RUN',
    requestId,
    plan: event.data.plan,
  }, response => {
    if (chrome.runtime.lastError) {
      postToApp({
        type: 'ULTRA_SEARCH_ERROR',
        requestId,
        error: chrome.runtime.lastError.message,
      })
      return
    }

    if (!response || response.ok !== true) {
      postToApp({
        type: 'ULTRA_SEARCH_ERROR',
        requestId,
        error: response?.error || 'Browser search failed.',
      })
      return
    }

    postToApp({
      type: 'ULTRA_SEARCH_RESULTS',
      requestId,
      results: response.results || [],
      engines: response.engines || [],
      attemptedSearches: response.attemptedSearches || 0,
      successfulSearches: response.successfulSearches || 0,
      diagnostics: response.diagnostics || [],
    })
  })
})
