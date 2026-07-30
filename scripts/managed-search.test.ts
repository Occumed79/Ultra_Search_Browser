import test from 'node:test'
import assert from 'node:assert/strict'
import {
  managedSearchCapabilities,
  searchManagedWeb,
  type ManagedSearchEnvironment,
} from '../src/lib/managed-search'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('managed search inventory reports key pools without exposing keys', () => {
  const environment: ManagedSearchEnvironment = {
    LANGSEARCH_API_KEY: 'first-key',
    LANGSEARCH_API_KEY_2: 'second-key',
    LANGSEARCH_API_KEYS: 'third-key,fourth-key',
    WEBSEARCH_API_KEY: 'unknown-provider-key',
  }
  const capabilities = managedSearchCapabilities(environment)
  const langsearch = capabilities.providers.find(provider => provider.provider === 'langsearch')

  assert.equal(langsearch?.configured, true)
  assert.equal(langsearch?.keyCount, 4)
  assert.deepEqual(capabilities.configuredProviders, ['langsearch'])
  assert.equal(capabilities.configuredButUnwired[0].environmentVariable, 'WEBSEARCH_API_KEY')
  assert.doesNotMatch(JSON.stringify(capabilities), /first-key|second-key|third-key|fourth-key/)
})

test('rate-limited trial keys rotate before the provider is failed', async () => {
  const environment: ManagedSearchEnvironment = {
    LANGSEARCH_API_KEY: 'trial-one',
    LANGSEARCH_API_KEY_2: 'trial-two',
  }
  const seenAuthorization: string[] = []
  const fetchFn = async (_input: string | URL | Request, init?: RequestInit) => {
    const authorization = new Headers(init?.headers).get('Authorization') || ''
    seenAuthorization.push(authorization)
    if (seenAuthorization.length === 1) {
      return jsonResponse({ error: 'monthly quota exhausted' }, 429)
    }
    return jsonResponse({
      data: {
        webPages: {
          value: [{
            name: 'RFP – Pre-Employment Physical Exams',
            url: 'https://county.example/rfp-pre-employment-physicals',
            snippet: 'Request for proposals for pre-employment physical examinations.',
          }],
        },
      },
    })
  }

  const search = await searchManagedWeb(
    'request for proposal employment evaluation',
    {
      safeSearch: true,
      preferredLanguage: 'en',
      region: 'us',
    },
    environment,
    fetchFn
  )

  assert.equal(search.results.length, 1)
  assert.equal(search.diagnostics.attemptedRequests, 2)
  assert.equal(search.diagnostics.failedRequests, 1)
  assert.equal(search.diagnostics.successfulRequests, 1)
  assert.equal(new Set(seenAuthorization).size, 2)
  assert.ok(seenAuthorization.every(value => /^Bearer trial-(?:one|two)$/.test(value)))
})

test('provider diagnostics redact keys even when an upstream error echoes one', async () => {
  const environment: ManagedSearchEnvironment = {
    SERPER_API_KEY: 'secret-serper-test-key',
  }
  const search = await searchManagedWeb(
    'employment evaluation RFP',
    {
      safeSearch: true,
      preferredLanguage: 'en',
      region: 'us',
    },
    environment,
    async () => jsonResponse({
      error: 'Authorization: secret-serper-test-key is invalid',
    }, 401)
  )

  assert.equal(search.diagnostics.failedRequests, 1)
  assert.match(search.diagnostics.attempts[0].error || '', /\[redacted\]/)
  assert.doesNotMatch(JSON.stringify(search.diagnostics), /secret-serper-test-key/)
})

test('managed metasearch merges independent API indexes and records real provider state', async () => {
  const environment: ManagedSearchEnvironment = {
    SERPER_API_KEY: 'serper-key',
    EXA_API_KEY: 'exa-key',
    LANGSEARCH_API_KEY: 'lang-key',
    FIRECRAWL_API_KEY: 'firecrawl-key',
    OLOSTEP_API_KEY: 'olostep-key',
  }
  const fetchFn = async (input: string | URL | Request) => {
    const endpoint = String(input)
    if (endpoint.includes('serper')) {
      return jsonResponse({
        organic: [{
          title: 'Pre-Employment Physical Exams RFP',
          link: 'https://one.example/rfp',
          snippet: 'Occupational health solicitation.',
        }],
      })
    }
    if (endpoint.includes('exa.ai')) {
      return jsonResponse({
        results: [{
          title: 'Medical Evaluation Services',
          url: 'https://two.example/medical-evaluation-rfp.pdf',
          highlights: ['Request for proposals for medical evaluations.'],
        }],
      })
    }
    if (endpoint.includes('langsearch')) {
      return jsonResponse({
        data: {
          webPages: {
            value: [{
              name: 'Employee Health Services Bid',
              url: 'https://three.example/bid',
              snippet: 'Pre-employment exams and occupational health services.',
            }],
          },
        },
      })
    }
    if (endpoint.includes('firecrawl')) {
      return jsonResponse({
        success: true,
        data: {
          web: [{
            title: 'Fire Department Medical Evaluation RFP',
            url: 'https://four.example/rfp',
            description: 'Medical evaluation services request for proposals.',
          }],
        },
      })
    }
    return jsonResponse({
      result: {
        links: [{
          title: 'Employment Medical Examinations Solicitation',
          url: 'https://five.example/solicitation',
          description: 'Solicitation for pre-employment medical examinations.',
        }],
      },
    })
  }

  const search = await searchManagedWeb(
    'request for proposal employment evaluation',
    {
      safeSearch: true,
      preferredLanguage: 'en',
      region: 'us',
      queryVariants: ['pre-employment physical RFP'],
    },
    environment,
    fetchFn
  )

  assert.equal(search.results.length, 5)
  assert.equal(search.diagnostics.successfulRequests, 5)
  assert.deepEqual(
    new Set(search.results.map(result => result.source)),
    new Set(['Serper', 'Exa', 'LangSearch', 'Firecrawl Search', 'Olostep Search'])
  )
})
