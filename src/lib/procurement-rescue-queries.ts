const PROCUREMENT_WORDS = /\b(?:request for proposals?|rfp|request for quotations?|rfq|request for tenders?|rft|invitation to bid|ifb|solicitation|tender|bid(?:ding)?|procurement|contract opportunity|vendor opportunity)\b/gi

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function procurementSubject(query: string): string {
  return normalizeSpace(
    query
      .replace(PROCUREMENT_WORDS, ' ')
      .replace(/\b(?:open|current|active|opportunity|opportunities)\b/gi, ' ')
  ) || normalizeSpace(query)
}

export function buildProcurementRescueQueries(query: string): string[] {
  const subject = procurementSubject(query)
  return Array.from(new Set([
    `"${subject}" (RFP OR solicitation OR bid)`,
    `site:.gov "${subject}" (RFP OR solicitation OR bid)`,
    `site:sam.gov "${subject}" solicitation`,
    `(site:ionwave.net OR site:bonfirehub.com OR site:planetbids.com OR site:bidnetdirect.com) "${subject}"`,
  ]))
}
