import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProcurementBrowserRescueTasks } from '../src/lib/procurement-rescue'

test('procurement browser rescue fans targeted variants across resilient sources', () => {
  const queries = [
    'occupational health services RFP solicitation bid',
    'occupational medicine services RFP solicitation',
    'employee health services RFP solicitation',
    'site:.gov occupational health services RFP',
    'filetype:pdf occupational health services request for proposals',
  ]

  const tasks = buildProcurementBrowserRescueTasks(queries)
  assert.deepEqual(tasks, [
    { source: 'bing', query: queries[0] },
    { source: 'bing', query: queries[1] },
    { source: 'bing', query: queries[2] },
    { source: 'bing', query: queries[3] },
    { source: 'duckduckgo', query: queries[0] },
    { source: 'mojeek', query: queries[0] },
  ])
})

test('procurement browser rescue is empty without targeted queries', () => {
  assert.deepEqual(buildProcurementBrowserRescueTasks([]), [])
})
