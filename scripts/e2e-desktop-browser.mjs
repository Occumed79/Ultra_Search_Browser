import { chromium } from 'playwright'

const baseUrl = process.env.E2E_APP_URL || 'http://127.0.0.1:3000'
const longTitle = `City of Example — Occupational Health, Medical Surveillance, Audiometry, Respirator Clearance, Drug Testing, Deployment Readiness, and Employee Medical Examination Services ${'scope '.repeat(24)}`.trim()

function isoDateInDays(days) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function candidate(index, query) {
  const id = String(index + 1).padStart(3, '0')
  return {
    title: index === 0 ? longTitle : `Occupational Health Services Solicitation ${id} — ${query}`,
    url: `https://procurement.example.gov/solicitations/${id}?source=ultra-search&description=${encodeURIComponent('very-long-procurement-url-segment-'.repeat(4))}`,
    description: 'Request for proposals for occupational health services including employee medical examinations, audiometry, respirator clearance, medical surveillance, and related workforce health services.',
    source: index % 2 === 0 ? 'SearXNG · brave' : 'SearXNG · bing',
    score: 100 - index,
    rank: index + 1,
    query,
    purpose: 'official-procurement',
  }
}

function validated(result, index) {
  const approved = index !== 1
  const decision = approved ? 'SHOW' : 'REVIEW'
  const bucket = approved ? 'valid' : 'uncertain'
  const strongFit = index % 3 === 0
  const dueSoon = index % 5 === 0
  return {
    ...result,
    bucket,
    validation: {
      status: approved ? 'valid' : 'uncertain',
      relevance: approved ? 0.96 : 0.7,
      reason: approved ? 'Verified open Occu-Med-fit procurement opportunity.' : 'Procurement shell requires manual evidence review.',
      matchedConcepts: ['occupational health services'],
      mode: 'local-rules',
    },
    occuMedDecision: { decision, reason: approved ? 'Open and relevant.' : 'Manual evidence review required.' },
    pageValidation: {
      checkedAt: new Date().toISOString(),
      requestedUrl: result.url,
      finalUrl: result.url,
      httpStatus: 200,
      contentType: 'text/html',
      availability: approved ? 'reachable' : 'unsupported',
      reason: approved ? 'Substantive procurement package verified.' : 'Client-rendered procurement portal requires review.',
      evidence: approved ? ['Scope of work includes occupational health services and employee medical examinations.', 'The proposal deadline is confirmed and still open.'] : [],
      extractedText: approved ? 'Request for proposals occupational health services with an active future proposal deadline.' : '',
      extractedTextLength: approved ? 88 : 0,
      cached: false,
      lifecycle: {
        status: approved ? 'active' : 'unknown',
        reason: approved ? 'Future proposal deadline found.' : 'Could not confirm lifecycle.',
        confidence: approved ? 0.95 : 0.5,
        dates: [],
      },
    },
    rfpIntelligence: approved ? {
      opportunityKey: `example-${index}`,
      title: result.title,
      organization: 'City of Example',
      solicitationNumber: `RFP-2026-${String(index + 1).padStart(3, '0')}`,
      opportunityType: 'RFP',
      dueDate: dueSoon ? isoDateInDays(14) : isoDateInDays(75),
      placeOfPerformance: 'United States',
      serviceSummary: ['Occupational health services', 'Employee medical examinations', 'Audiometry'],
      fitScore: strongFit ? 94 : 76,
      fitBand: strongFit ? 'strong' : 'good',
      matchedCapabilities: ['occupational health', 'audiometry'],
      concerns: [],
      deliveryModel: 'provider-network',
      documentUrls: [result.url],
    } : undefined,
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function installRoutes(page) {
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }))
  await page.route('https://www.google.com/s2/favicons**', route => route.fulfill({ status: 204, body: '' }))

  await page.route('**/api/domain-preferences?**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ preferences: [] }),
  }))

  await page.route('**/api/search/plan', async route => {
    const requestBody = route.request().postDataJSON()
    const query = String(requestBody?.query || '')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query,
        lens: 'procurement',
        intent: { intent: 'find-procurement', requiredConcepts: [query], optionalConcepts: [], exclusions: [], geography: [], sourcePreferences: [], temporal: [] },
        searches: [
          { id: 'literal', query: `${query} RFP`, purpose: 'literal-procurement', priority: 100 },
          { id: 'official', query: `site:.gov ${query} solicitation`, purpose: 'official-procurement', priority: 95 },
        ],
        transport: 'searxng',
        apiKeysRequired: false,
        maxResultsPerSearch: 25,
        timestamp: new Date().toISOString(),
      }),
    })
  })

  await page.route('**/api/search', async route => {
    const requestBody = route.request().postDataJSON()
    const query = String(requestBody?.plan?.query || '')
    if (query.includes('slow first')) await new Promise(resolve => setTimeout(resolve, 900))
    const results = Array.from({ length: 50 }, (_, index) => candidate(index, query))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results,
        engines: ['SearXNG · brave', 'SearXNG · bing'],
        attemptedSearches: 2,
        successfulSearches: 2,
        transport: 'searxng',
        diagnostics: [
          { query: `${query} RFP`, engine: 'brave', resultCount: 25 },
          { query: `site:.gov ${query} solicitation`, engine: 'bing', resultCount: 25 },
        ],
      }),
    })
  })

  await page.route('**/api/search/ingest', async route => {
    const requestBody = route.request().postDataJSON()
    const query = String(requestBody?.query || '')
    const results = Array.isArray(requestBody?.results) ? requestBody.results : []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query,
        lens: 'procurement',
        requestedLens: 'procurement',
        summary: 'Candidate retrieval completed.',
        expandedQueries: [query, `${query} solicitation`],
        signals: [],
        results,
        sources: ['SearXNG · brave', 'SearXNG · bing'],
        timestamp: new Date().toISOString(),
        confidence: 0,
        intent: requestBody?.intent,
      }),
    })
  })

  await page.route('**/api/search/validate', async route => {
    const requestBody = route.request().postDataJSON()
    const raw = Array.isArray(requestBody?.results) ? requestBody.results : []
    const validatedResults = raw.map(validated)
    const valid = validatedResults.filter(result => result.bucket === 'valid')
    const uncertain = validatedResults.filter(result => result.bucket === 'uncertain')
    const progress = {
      phase: 'complete',
      total: Math.min(48, validatedResults.length),
      checked: Math.min(48, validatedResults.length),
      reachable: valid.length,
      valid: valid.length,
      uncertain: uncertain.length,
      expired: 0,
      dead: 0,
      rejected: 0,
      duplicates: 0,
    }
    const body = [
      `event: progress\ndata: ${JSON.stringify({ progress: { ...progress, phase: 'opening-pages', checked: 4 } })}\n\n`,
      `event: complete\ndata: ${JSON.stringify({ results: validatedResults, buckets: { valid, uncertain, expired: [], dead: [], rejected: [], duplicate: [] }, progress, summary: 'Verified Occu-Med opportunities.', confidence: 94, lens: 'procurement' })}\n\n`,
    ].join('')
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body })
  })
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }))
  assert(metrics.scrollWidth <= metrics.clientWidth + 2, `${label}: document horizontal overflow ${JSON.stringify(metrics)}`)
  assert(metrics.bodyScrollWidth <= metrics.clientWidth + 2, `${label}: body horizontal overflow ${JSON.stringify(metrics)}`)
}

function filterSelect(page, labelText) {
  return page.locator('label').filter({ has: page.locator('select'), hasText: new RegExp(`^${labelText}`) }).locator('select')
}

async function runViewport(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true })
  const page = await context.newPage()
  await installRoutes(page)
  const errors = []
  const failedResponses = []
  const appOrigin = new URL(baseUrl).origin

  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource/i.test(message.text())) {
      errors.push(`console: ${message.text()}`)
    }
  })
  page.on('response', response => {
    if (response.status() < 400) return
    try {
      const url = new URL(response.url())
      if (url.origin === appOrigin && url.pathname !== '/favicon.ico') {
        failedResponses.push(`${response.status()} ${url.pathname}`)
      }
    } catch {
      // Ignore malformed external URLs; the browser itself will surface real script errors.
    }
  })

  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  const input = page.getByPlaceholder('Describe the RFPs you need, location, services, or buyer...')
  const findButton = page.getByRole('button', { name: 'Find RFPs' })
  await input.fill('slow first occupational health services')
  await findButton.click()
  await input.fill('employee medical examinations')
  await page.getByRole('button', { name: /Find RFPs|Searching/ }).click()

  await page.getByText(/approved opportunities/).waitFor({ timeout: 10_000 })
  await page.getByText('49 approved opportunities', { exact: false }).waitFor({ timeout: 10_000 })
  await page.getByText('1 opportunities withheld from the primary list', { exact: false }).waitFor({ timeout: 10_000 })
  assert((await input.inputValue()) === 'employee medical examinations', 'newer search did not remain authoritative')
  assert(page.url().includes('q=employee+medical+examinations') || page.url().includes('q=employee%20medical%20examinations'), `shareable URL did not track final search: ${page.url()}`)

  const visibleCards = page.locator('.result-card:visible')
  const unfilteredCount = await visibleCards.count()
  assert(unfilteredCount === 49, `expected 49 visible approved cards before filtering, saw ${unfilteredCount}`)

  await page.getByRole('button', { name: 'Filters' }).click()
  await filterSelect(page, 'Fit').selectOption('strong')
  const strongCount = await visibleCards.count()
  assert(strongCount > 0 && strongCount < unfilteredCount, `strong-fit filter did not reduce visible cards: ${unfilteredCount} -> ${strongCount}`)

  await filterSelect(page, 'Due').selectOption('30')
  const dueCount = await visibleCards.count()
  assert(dueCount > 0 && dueCount < strongCount, `30-day due filter did not further reduce visible cards: ${strongCount} -> ${dueCount}`)

  await filterSelect(page, 'Source').selectOption('SearXNG · brave')
  const sourceCount = await visibleCards.count()
  assert(sourceCount > 0 && sourceCount < dueCount, `source filter did not further reduce visible cards: ${dueCount} -> ${sourceCount}`)

  await page.getByRole('button', { name: 'Clear' }).click()
  const restoredCount = await visibleCards.count()
  assert(restoredCount === unfilteredCount, `Clear did not restore the full visible result set: ${restoredCount} vs ${unfilteredCount}`)

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  assert(await input.evaluate(element => element === document.activeElement), 'keyboard shortcut did not focus the search input')

  const settingsLink = page.getByRole('link', { name: 'Settings' })
  const historyLink = page.getByRole('link', { name: 'History' })
  const bookmarksLink = page.getByRole('link', { name: 'Bookmarks' })
  assert((await settingsLink.getAttribute('href')) === '/settings', 'Settings navigation contract changed')
  assert((await historyLink.getAttribute('href')) === '/history', 'History navigation contract changed')
  assert((await bookmarksLink.getAttribute('href')) === '/bookmarks', 'Bookmarks navigation contract changed')

  await assertNoHorizontalOverflow(page, `${width}x${height}`)
  await page.evaluate(() => { document.documentElement.style.zoom = '1.25' })
  await assertNoHorizontalOverflow(page, `${width}x${height}@125%`)

  assert(failedResponses.length === 0, `same-origin resource failures detected: ${failedResponses.join(' | ')}`)
  assert(errors.length === 0, `browser errors detected: ${errors.join(' | ')}`)
  await context.close()
}

const browser = await chromium.launch({ headless: true })
try {
  await runViewport(browser, 1280, 720)
  await runViewport(browser, 1440, 900)
  await runViewport(browser, 1920, 1080)
  console.log('[e2e] desktop Chromium orchestration, cancellation, 50-card rendering, filter effects/reset, navigation, focus, and overflow checks passed')
} finally {
  await browser.close()
}
