import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyResultStatus } from '../src/lib/result-status'
import { evaluateRules } from '../src/lib/canonical/search/profileRules'
import { buildProfile } from '../src/lib/canonical/search/relevanceProfile'
import { profileRows } from './fixtures/canonical-profile'
import { extractRfpOpportunityIntelligence } from '../src/lib/rfp-opportunity-intelligence'
import { extractFromHTML, extractFromPDFText } from '../src/lib/document-extraction'

const now = new Date('2026-10-06T12:00:00Z')

test('an award date cannot reopen a solicitation whose response deadline passed', () => {
  const status = classifyResultStatus('Timeline: Issue Date August 26, 2026 9:30 am Deadline for written questions September 4, 2026 5:00 pm Proposal question responses emailed September 11, 2026 5:00 pm Request for Proposals Due October 2, 2026 5:00 pm Target Award Date October 30, 2026 5:00 pm', 'procurement', now)
  assert.equal(status.status, 'expired')
  assert.equal(status.dates.find(d => d.value === 'October 30, 2026')?.kind, 'award')
  assert.equal(status.dates.find(d => d.value === 'August 26, 2026')?.kind, 'posted')
})

test('PDF spacing inside a month does not hide a submission deadline', () => {
  const status = classifyResultStatus('Submittal Due: Octo ber 30, 2026. Request for Proposals Due October 2, 2026. Target Award Date November 30, 2026.', 'procurement', now)
  assert.equal(status.status, 'open')
  assert.match(status.reason, /2026-10-30/)
})

test('future award instructions are not an awarded lifecycle status', () => {
  const future = classifyResultStatus('RFP. Responses due October 30, 2026. A notice of award will be issued after evaluation.', 'procurement', now)
  assert.equal(future.status, 'open')
  assert.equal(classifyResultStatus('Notice of award. The contract was awarded to Example LLC.', 'procurement', now).status, 'awarded')
})

test('Neon post-award triggers distinguish future award terms from completed awards', () => {
  const rows = profileRows()
  rows.rules.push({ rule_key: 'test.award', category: 'notice', title: 'Awarded notices', rule_text: '', machine_action: 'reject_post_award_notice', hard_rule: true, priority: 100, scope: { match: 'any_trigger' }, search_triggers: ['awarded to'] })
  const profile = buildProfile(rows, 'neon')
  for (const text of ['The proposal will be awarded to the responsive firm.', 'The contract has not been awarded to any provider.']) {
    assert.equal(evaluateRules(profile, { title: 'Quasar inspection RFP', haystack: text, hasProcurementSignal: true }).hardReject, null)
  }
  assert.equal(evaluateRules(profile, { title: 'Quasar inspection', haystack: 'The contract was awarded to Example LLC.', hasProcurementSignal: true }).hardReject?.ruleKey, 'test.award')
})

test('the issuing buyer takes precedence over a county named in legal terms', () => {
  const intelligence = extractRfpOpportunityIntelligence({ url: 'https://example.gov/exams.pdf', title: 'Pre-employment and annual exams', text: 'The Arvada Fire Protection District (Arvada Fire/district) is soliciting proposals from qualified medical providers. Legal disputes shall be heard in Jefferson County.', lifecycle: { status: 'open', reason: 'Future deadline', confidence: .9, dates: [] } })
  assert.equal(intelligence.organization, 'Arvada Fire Protection District')
  const labeled = extractRfpOpportunityIntelligence({ url: 'https://example.gov/bid', title: 'Employee medical exams RFP', text: 'Agency: City of Sierra Vista Type of Government: State & Local Category: Q - Medical Services', lifecycle: { status: 'open', reason: 'Future deadline', confidence: .9, dates: [] } })
  assert.equal(labeled.organization, 'City of Sierra Vista')
  const document = extractFromPDFText('REQUEST FOR PROPOSAL\nARVADA FIRE PROTECTION DISTRICT\nPre-Employment and Annual Physical Examinations\nPeople and Culture Section')
  assert.equal(document.title, 'ARVADA FIRE PROTECTION DISTRICT — Pre-Employment and Annual Physical Examinations')
})

test('GovernmentContracts related opportunities cannot reopen the expired primary notice', () => {
  const document = extractFromHTML('<body><div class="container contents"><h1>Pre-employment physicals RFP</h1><div class="detail-contents">Agency: City of Sierra Vista Due: July 10, 2026</div><div class="section-desc">Scope: employee physical examinations. Submission Deadline: July 10, 2026.</div><div class="section-basic"><h2>See also</h2><a href="/government-contracts/opportunity-details/other.htm">Shipping boxes solicitation</a><p>Bid Due: November 20, 2026</p></div></div></body>', 'https://www.governmentcontracts.us/government-contracts/opportunity-details/60107436648215665.htm')
  assert.equal(classifyResultStatus(document.text, 'procurement', now).status, 'expired')
  assert.doesNotMatch(document.text, /Shipping|November/)
  assert.equal(document.links?.length, 0)
})
