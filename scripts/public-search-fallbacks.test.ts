import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseBraveSearchHtml,
  parseMojeekSearchHtml,
  parseYahooSearchHtml,
} from '../src/lib/public-search-fallbacks'

test('Yahoo parser unwraps result redirects and ignores Yahoo navigation', () => {
  const encoded = encodeURIComponent('https://example.gov/procurement/occupational-health-rfp.pdf')
  const results = parseYahooSearchHtml(`
    <div id="web"><ol class="searchCenterMiddle">
      <li><div class="algo">
        <h3><a href="https://r.search.yahoo.com/_ylt=test/RU=${encoded}/RK=2/RS=test">Occupational Health Services RFP</a></h3>
        <div class="compText"><p>Request for proposals. Responses due August 30, 2026.</p></div>
      </div></li>
      <li><div class="algo"><h3><a href="https://search.yahoo.com/preferences">Yahoo preferences</a></h3></div></li>
    </ol></div>
  `)

  assert.equal(results.length, 1)
  assert.equal(results[0].source, 'Yahoo')
  assert.equal(results[0].url, 'https://example.gov/procurement/occupational-health-rfp.pdf')
})

test('Brave parser extracts direct web result cards', () => {
  const results = parseBraveSearchHtml(`
    <div class="snippet" data-type="web">
      <a class="result-header" href="https://sam.gov/opp/example/view">NASA Occupational Health Services Solicitation</a>
      <div class="snippet-description">Combined solicitation with a future response deadline.</div>
    </div>
  `)

  assert.equal(results.length, 1)
  assert.equal(results[0].source, 'Brave')
  assert.equal(results[0].domain, 'sam.gov')
})

test('Mojeek parser extracts substantive result cards', () => {
  const results = parseMojeekSearchHtml(`
    <div class="results-standard">
      <div class="result">
        <h2><a href="https://oregonbuys.gov/bso/external/bidDetail.sdo?docId=123">RFQ Occupational Health Services</a></h2>
        <p class="s">Open solicitation for employee occupational health services.</p>
      </div>
    </div>
  `)

  assert.equal(results.length, 1)
  assert.equal(results[0].source, 'Mojeek')
  assert.equal(results[0].domain, 'oregonbuys.gov')
})
