import test from 'node:test'
import assert from 'node:assert/strict'
import { CURRENT_DATABASE_SCHEMA_VERSION, databaseSchemaState } from '../src/lib/database-schema-lifecycle'
import { searchFlightRecorderStats } from '../src/lib/search-flight-recorder'

test('soak/schema hardening remains bounded and fail-open at merge gate', () => {
  const schema = databaseSchemaState()
  assert.equal(CURRENT_DATABASE_SCHEMA_VERSION, 1)
  assert.ok(['disabled', 'unchecked', 'ready', 'behind', 'ahead', 'error'].includes(schema.status))
  assert.equal(schema.expectedVersion, 1)

  const flight = searchFlightRecorderStats()
  assert.ok(flight.retainedTraces <= flight.maxTraces)
  assert.ok(flight.ttlMs <= 60 * 60_000)
})
