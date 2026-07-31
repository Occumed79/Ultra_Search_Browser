import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectSolicitationPackage } from '../src/lib/solicitation-package'
import type { ExtractedDocument } from '../src/lib/document-extraction'

const primaryDocument: ExtractedDocument = {
  title: 'Employee Occupational Health Services RFP',
  text: 'RFP Number: 26-104. Proposals are due August 30, 2026. Occupational health medical examinations and medical surveillance are required.',
  metadata: { fileType: 'html' },
  entities: {
    emails: [],
    phones: [],
    urls: [],
    dates: ['August 30, 2026'],
    monetaryValues: [],
  },
  sections: {
    headers: ['Employee Occupational Health Services RFP'],
    paragraphs: [],
    tables: [],
  },
  links: [],
}

test('keeps combined solicitation text available internally but out of serialized payloads', async () => {
  const analysis = await inspectSolicitationPackage(
    'https://example.gov/rfp/26-104',
    primaryDocument,
    { maxAttachments: 0 }
  )

  assert.match(analysis.combinedText, /occupational health/i)
  assert.equal(analysis.lifecycle.status, 'open')
  assert.equal(Object.prototype.propertyIsEnumerable.call(analysis, 'combinedText'), false)
  assert.equal(JSON.stringify(analysis).includes('combinedText'), false)
})
