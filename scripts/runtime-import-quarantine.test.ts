import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

test('runtime import graph permits only the frozen proven-dead legacy quarantine', () => {
  const raw = execFileSync(process.execPath, ['scripts/runtime-import-audit.mjs', '--json'], { encoding: 'utf8' })
  const report = JSON.parse(raw) as {
    quarantinedLegacy: string[]
    unexpectedUnreachable: string[]
    staleQuarantineEntries: string[]
    unresolvedLocalImports: unknown[]
  }
  assert.equal(report.quarantinedLegacy.length, 16)
  assert.deepEqual(report.unexpectedUnreachable, [])
  assert.deepEqual(report.staleQuarantineEntries, [])
  assert.deepEqual(report.unresolvedLocalImports, [])
})
