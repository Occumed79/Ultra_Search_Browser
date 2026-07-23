const APP_URL = (process.env.APP_URL || 'https://ultra-search-browser.onrender.com').replace(/\/$/, '')
const EXPECTED_COMMIT = (process.env.EXPECTED_COMMIT || '').trim()
const MAX_WAIT_MS = Number(process.env.MAX_WAIT_MS || 12 * 60 * 1000)
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15_000)

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function commitMatches(actual, expected) {
  if (!expected) return true
  if (!actual || actual === 'unknown') return false
  return actual.startsWith(expected) || expected.startsWith(actual)
}

async function readJson(response) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Expected JSON from ${response.url}; received ${text.slice(0, 500)}`)
  }
}

async function main() {
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
        && data.searchPipeline === 'orchestrated-v2'
        && commitMatches(String(data.commit || ''), EXPECTED_COMMIT)
      ) {
        console.log(`[deployment] Ready: ${data.commit}`)
        return
      }
    } catch (error) {
      lastState = error instanceof Error ? error.message : String(error)
      console.log(`[deployment] waiting: ${lastState}`)
    }

    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(`Render did not serve the expected deployment before timeout. Last state: ${lastState}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})
