import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8')

test('empty verified-result verdict is hidden while complete-package validation is still running', () => {
  assert.match(
    source,
    /!isLoading\s*&&\s*!isEnriching\s*&&\s*!error\s*&&\s*visibleResults\.length === 0/
  )
})

test('active validation remains visibly described as opening pages and solicitation documents', () => {
  assert.match(source, /Opening pages, attachments, and amendments/)
  assert.match(source, /validationProgress\.checked/)
  assert.match(source, /validationProgress\.total/)
})
