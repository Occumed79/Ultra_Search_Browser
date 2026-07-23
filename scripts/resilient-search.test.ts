import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBingRss, parseDuckDuckGoLite } from '../src/lib/search-response-parsers'

test('parses Bing RSS search items into ranked results', () => {
  const results = parseBingRss(`
    <?xml version="1.0"?>
    <rss><channel>
      <item>
        <title>County occupational health RFP</title>
        <link>https://county.gov/procurement/occupational-health</link>
        <description><![CDATA[Open request for occupational health services.]]></description>
      </item>
    </channel></rss>
  `)

  assert.equal(results.length, 1)
  assert.equal(results[0].source, 'Bing')
  assert.equal(results[0].domain, 'county.gov')
  assert.match(results[0].description, /occupational health services/i)
})

test('parses DuckDuckGo Lite results and unwraps redirect URLs', () => {
  const results = parseDuckDuckGoLite(`
    <html><body>
      <a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.gov%2Fbids%2F123">
        Occupational medicine solicitation
      </a>
      <div class="result-snippet">Government bid for medical services.</div>
    </body></html>
  `)

  assert.equal(results.length, 1)
  assert.equal(results[0].source, 'DuckDuckGo')
  assert.equal(results[0].url, 'https://example.gov/bids/123')
  assert.equal(results[0].domain, 'example.gov')
})
