import { classifyLens } from './intelligence'
import type { SemanticIntentPlan } from './semantic-intent'
import type { SearchLens } from '../types/search'

export interface LensRoutingDecision {
  requestedLens: SearchLens
  effectiveLens: SearchLens
  autoRouted: boolean
  reason: string
}

const STRONG_INTENT_PATTERNS: Array<{ lens: SearchLens; pattern: RegExp; reason: string }> = [
  {
    lens: 'procurement',
    pattern: /\b(?:request for proposals?|rfp|request for quotations?|rfq|request for tenders?|rft|invitation to bid|ifb|solicitation|tender|bid opportunity|procurement opportunity|contract opportunity)\b/i,
    reason: 'The query explicitly asks for a procurement opportunity.',
  },
  {
    lens: 'pricing',
    pattern: /\b(?:fee schedule|price list|pricing|self[- ]?pay rates?|cash prices?|cost breakdown|rate card|chargemaster)\b/i,
    reason: 'The query explicitly asks for prices, fees, or rates.',
  },
  {
    lens: 'pdf',
    pattern: /(?:\bfiletype:pdf\b|\bpdf documents?\b|\bdownloadable pdf\b)/i,
    reason: 'The query explicitly asks for PDF documents.',
  },
  {
    lens: 'news',
    pattern: /\b(?:latest news|breaking news|news coverage|press coverage)\b/i,
    reason: 'The query explicitly asks for current news coverage.',
  },
  {
    lens: 'technical',
    pattern: /\b(?:api documentation|developer documentation|source code|github repository|sdk reference)\b/i,
    reason: 'The query explicitly asks for technical documentation or code.',
  },
]

function strongIntent(query: string): { lens: SearchLens; reason: string } | undefined {
  return STRONG_INTENT_PATTERNS.find(item => item.pattern.test(query))
}

export function routeSearchLens(
  requestedLens: SearchLens,
  forcedLens: string | undefined,
  query: string,
  semanticIntent?: SemanticIntentPlan
): LensRoutingDecision {
  if (forcedLens) {
    return {
      requestedLens,
      effectiveLens: forcedLens as SearchLens,
      autoRouted: forcedLens !== requestedLens,
      reason: `The explicit bang/operator forced the ${forcedLens} lens.`,
    }
  }

  if (requestedLens !== 'web') {
    return {
      requestedLens,
      effectiveLens: requestedLens,
      autoRouted: false,
      reason: `The user explicitly selected the ${requestedLens} lens.`,
    }
  }

  const strong = strongIntent(query)
  if (strong) {
    return {
      requestedLens,
      effectiveLens: strong.lens,
      autoRouted: true,
      reason: strong.reason,
    }
  }

  const deterministic = classifyLens(query)
  const semantic = semanticIntent?.suggestedLens
  if (semantic && semantic !== 'web') {
    return {
      requestedLens,
      effectiveLens: semantic,
      autoRouted: true,
      reason: semanticIntent?.usedExternal
        ? `Semantic intent analysis identified a ${semantic} search task.`
        : `The query asks for a ${semantic} result type, so retrieval was routed accordingly.`,
    }
  }

  if (!semantic && deterministic !== 'web') {
    return {
      requestedLens,
      effectiveLens: deterministic,
      autoRouted: true,
      reason: `The query structure identified the ${deterministic} search task.`,
    }
  }

  return {
    requestedLens,
    effectiveLens: 'web',
    autoRouted: false,
    reason: 'No strong vertical intent was detected, so broad web search was preserved.',
  }
}
