import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractEntities,
  extractFromHTML,
  scoreDocumentRelevance,
} from '../src/lib/document-extraction'

test('phone extraction is valid and does not throw', () => {
  const entities = extractEntities(
    'Phone: (559) 435-2800. Call +1 707-555-1212. Email info@example.com. Due July 25, 2026. Fee $125.00.'
  )

  assert.ok(entities.phones.some(phone => phone.includes('559')))
  assert.ok(entities.phones.some(phone => phone.includes('707')))
  assert.deepEqual(entities.emails, ['info@example.com'])
  assert.deepEqual(entities.dates, ['July 25, 2026'])
  assert.deepEqual(entities.monetaryValues, ['$125.00'])
})

test('HTML extraction safely returns text, structure, and entities', () => {
  const document = extractFromHTML(`
    <html>
      <head><title>Occupational Health Clinic</title></head>
      <body>
        <header>Navigation</header>
        <h1>Occupational Health Services</h1>
        <p>Our clinic provides employer physicals, audiograms, and respirator fit testing.</p>
        <p>Phone: (559) 435-2800 and email clinic@example.com for scheduling.</p>
        <table><tr><th>Service</th><th>Price</th></tr><tr><td>Audiogram</td><td>$85.00</td></tr></table>
      </body>
    </html>
  `)

  assert.equal(document.title, 'Occupational Health Clinic')
  assert.match(document.text, /respirator fit testing/)
  assert.equal(document.sections.headers[0], 'Occupational Health Services')
  assert.deepEqual(document.sections.tables[0], ['Service', 'Price', 'Audiogram', '$85.00'])
  assert.ok(document.entities.phones.some(phone => phone.includes('559')))
  assert.deepEqual(document.entities.emails, ['clinic@example.com'])
})

test('relevance scoring accepts query punctuation without constructing a regex', () => {
  const document = extractFromHTML(`
    <html><head><title>C++ API Reference</title></head>
    <body><p>This C++ API reference documents the search application.</p></body></html>
  `)

  assert.doesNotThrow(() => scoreDocumentRelevance(document, 'C++ (API)', 'technical'))
  assert.ok(scoreDocumentRelevance(document, 'C++ API', 'technical') > 0)
})
