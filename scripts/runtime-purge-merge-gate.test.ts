import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const removed = [
  'src/lib/automatic-browser-fallback.ts',
  'src/lib/brave-search-api.ts',
  'src/lib/feature-capabilities.ts',
  'src/lib/gemini-grounded-search.ts',
  'src/lib/managed-search.ts',
  'src/lib/occumed-supplemental-search.ts',
  'src/lib/procurement-api-sources.ts',
  'src/lib/procurement-browser-rescue-tasks.ts',
  'src/lib/procurement-rescue.ts',
  'src/lib/public-search-fallbacks.ts',
  'src/lib/resilient-search.ts',
  'src/lib/sam-gov-opportunities.ts',
  'src/lib/search-intent-routing.ts',
  'src/lib/search-orchestrator.ts',
  'src/lib/search-response-parsers.ts',
  'src/lib/tavily-search.ts',
]

test('proven runtime-dead legacy search modules are physically gone', () => {
  const survivors = removed.filter(file => existsSync(file))
  assert.deepEqual(survivors, [], `legacy runtime files survived purge: ${survivors.join(', ')}`)
})

test('runtime graph is clean after the physical purge', () => {
  const raw = execFileSync(process.execPath, ['scripts/runtime-import-audit.mjs', '--json'], { encoding: 'utf8' })
  const report = JSON.parse(raw) as {
    unreachable: string[]
    unresolvedLocalImports: unknown[]
  }
  assert.deepEqual(report.unreachable, [])
  assert.deepEqual(report.unresolvedLocalImports, [])
})
