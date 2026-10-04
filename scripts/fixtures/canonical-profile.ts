/** Arbitrary test data returned by a fake DB transport, never a production relevance seed. */
import type { ProfileRows } from '../../src/lib/canonical/search/relevanceProfile'
export function profileRows(service = 'quasar inspection'): ProfileRows {
  return {
    terms: [
      { phrase: service, term_type: 'procurement_phrase', match_strength: 'direct', target_keys: ['category:synthetic'], metadata: null },
      { phrase: 'rfp', term_type: 'procurement_stage_signal', match_strength: 'direct', target_keys: null, metadata: null },
      { phrase: 'quasar', term_type: 'title_signal', match_strength: 'direct', target_keys: null, metadata: null },
      { phrase: 'relay network', term_type: 'delivery_network_term', match_strength: 'direct', target_keys: ['category:relay'], metadata: null },
      { phrase: 'sample buyer', term_type: 'buyer_sector_signal', match_strength: 'review', target_keys: null, metadata: null },
    ],
    facts: [
      { fact_key: 'test.category', category: 'relevance_category', predicate: 'synthetic', value_text: 'Synthetic service', value_json: {}, value_numeric: null },
      { fact_key: 'test.network', category: 'relevance_category', predicate: 'relay', value_text: 'Synthetic relay', value_json: {}, value_numeric: null },
      { fact_key: 'test.accept', category: 'relevance_threshold', predicate: 'relevance.accept_min', value_text: null, value_json: null, value_numeric: 75 },
      { fact_key: 'test.review', category: 'relevance_threshold', predicate: 'relevance.review_min', value_text: null, value_json: null, value_numeric: 40 },
      { fact_key: 'test.code', category: 'rfp_discovery_code', predicate: 'synthetic.code', value_text: null, value_json: { system: 'NAICS 2022', code: '123456', tier: 'capability', effect: 'include', title: 'Synthetic discovery' }, value_numeric: null },
    ],
    rules: [
      { rule_key: 'test.reject', category: 'synthetic', title: 'Synthetic rejection', rule_text: '', machine_action: 'reject_as_out_of_scope', hard_rule: true, priority: 100, scope: { match: 'any_trigger' }, search_triggers: ['forbidden-widget'] },
      { rule_key: 'test.program', category: 'synthetic', title: 'Synthetic combination', rule_text: '', machine_action: 'accept_program_combination', hard_rule: false, priority: 10, scope: { all_of: [['test-program-a'], ['test-program-b']] }, search_triggers: [] },
      { rule_key: 'test.network', category: 'synthetic', title: 'Synthetic service evidence', rule_text: '', machine_action: 'network_requires_service_evidence', hard_rule: false, priority: 10, scope: { requires_one_of: [service] }, search_triggers: [] },
    ],
    policies: [],
  }
}
