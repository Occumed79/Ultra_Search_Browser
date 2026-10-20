/**
 * Prevent website navigation labels from being mistaken for solicitation
 * titles or issuing agencies. Conservative: suppress doubtful buyer strings
 * rather than inventing an organization.
 */
const UI_ARTIFACT = /(?:PrintArrow|LeftArrow|RightArrow|Slideshow|RightSlideshow|LeftSlideshow)\b/g
const BUYER_NOISE = /\b(?:via direct deposit|direct deposit|bank account|payment information|email alerts|subscription|privacy policy|terms of use|change your|proposal requested|browse opportunities|more results|search results|sign in|log in)\b/i
const BUYER_NAV_PREFIX = /^(?:proposal requested|opportunity details|view procurement|search bids|bid postings)\b/i

export function cleanOpportunityTitle(title: string): string {
  return title.replace(UI_ARTIFACT, ' ').replace(/\s+/g,' ').replace(/[\s|•·:;,/-]+$/g, '').trim().slice(0,240)
}

/** Do not accept UI controls, ordinary payment instructions or a whole
 * paragraph as a contracting entity. Source-backed buyer values override it. */
export function trustworthyBuyerCandidate(raw: string): string | undefined {
  const buyer=raw.replace(/\s+/g,' ').trim().replace(/^the\s+/i,'')
  if (!buyer || buyer.length > 100 || buyer.split(/\s+/).length > 12) return undefined
  if (BUYER_NOISE.test(buyer) || BUYER_NAV_PREFIX.test(buyer)) return undefined
  if (/[<>]/.test(buyer)) return undefined
  return buyer
}
