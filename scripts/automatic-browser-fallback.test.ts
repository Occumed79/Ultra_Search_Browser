import test from 'node:test'
import assert from 'node:assert/strict'
import { selectAutomaticBrowserFallbackTasks } from '../src/lib/automatic-browser-fallback'
import type { RetrievalTask } from '../src/lib/search-planner'

const tasks: RetrievalTask[] = [
  { source: 'bing', query: 'occupational health services', purpose: 'broad' },
  { source: 'duckduckgo', query: 'occupational health services', purpose: 'broad' },
  { source: 'brave', query: 'occupational health services', purpose: 'broad' },
  { source: 'mojeek', query: 'occupational health services', purpose: 'broad' },
  { source: 'bing', query: '"occupational health services"', purpose: 'intent-core' },
]

test('automatic browser fallback uses only one exact-query task per resilient source', () => {
  assert.deepEqual(
    selectAutomaticBrowserFallbackTasks(tasks, true),
    [tasks[0], tasks[1], tasks[3]]
  )
})

test('automatic browser fallback remains off when managed APIs are available', () => {
  assert.deepEqual(selectAutomaticBrowserFallbackTasks(tasks, false), [])
})
