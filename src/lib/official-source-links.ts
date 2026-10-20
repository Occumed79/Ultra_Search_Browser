/**
 * High-confidence references from an external research listing to an original
 * procurement record. Only accepted, fixed platform URLs can be candidates.
 * A link is NOT proof: the issuing portal must still verify the exact identity.
 */
export interface SourceLink {
  url: string
  text: string
}

const ORIGINAL_RECORD_LABEL =
  /\b(?:official (?:posting|notice|solicitation|opportunity|bid)|original (?:source|solicitation|opportunity|notice)|source (?:notice|posting|solicitation|link)|view (?:original|solicitation|bid|opportunity)|submit (?:a |your )?(?:proposal|bid)|procurement portal|apply (?:on|at) (?:the )?portal)\b/i

export function supportedOfficialRecordUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    const hostname = url.hostname.toLowerCase()
    if (hostname === 'procurement.opengov.com') {
      return /^\/portal\/[a-z0-9-]{1,64}\/projects\/\d+(?:\/|$)/i.test(url.pathname)
    }
    if (/^[a-z0-9-]{1,64}\.bonfirehub\.com$/i.test(hostname)) {
      return /^\/opportunities\/[a-z0-9-]+(?:\/|$)/i.test(url.pathname)
        && !/^\/opportunities\/rss(?:\/|$)/i.test(url.pathname)
    }
    if (hostname === 'sam.gov' || hostname === 'www.sam.gov') {
      return /^\/opp\/(?:[a-f0-9]{32}|[a-f0-9-]{36})(?:\/|$)/i.test(url.pathname)
    }
  } catch { /* invalid link */ }
  return false
}

export function officialSourceLinks(
  links: SourceLink[] | undefined,
  currentUrl: string,
  maxLinks = 2
): SourceLink[] {
  const current = (() => {
    try { return new URL(currentUrl).href.split('#')[0] } catch { return '' }
  })()
  const seen = new Set<string>()
  const candidates: SourceLink[] = []
  for (const link of links || []) {
    if (!ORIGINAL_RECORD_LABEL.test(link.text) || !supportedOfficialRecordUrl(link.url)) continue
    const url = new URL(link.url)
    url.hash = ''
    const reference = url.href
    if (reference === current || seen.has(reference)) continue
    seen.add(reference)
    candidates.push({url:reference,text:link.text.slice(0,180)})
    if (candidates.length >= maxLinks) break
  }
  return candidates
}
