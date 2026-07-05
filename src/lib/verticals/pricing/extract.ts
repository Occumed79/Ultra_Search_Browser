// Simple rule-based pricing extraction for pricing vertical

export interface PricingFinding {
  provider_name?: string
  service_name?: string
  price?: number | null
  price_text?: string
  currency?: string
  location?: string
  phone?: string
  email?: string
  evidence_text?: string
  confidence?: number
}

// Common occupational health service terms
const SERVICE_TERMS = [
  'dot physical', 'physical exam', 'respirator physical', 'audiogram', 'hearing test', 'spirometry', 'pulmonary function test', 'pft', 'fit test', 'drug screen', 'urine drug screen', 'breath alcohol', 'tb test', 'x-ray', 'chest x-ray', 'ekg', 'immunization', 'vaccine', 'venipuncture', 'lab draw'
]

const moneyRegex = /\$\s?([0-9,]+(?:\.[0-9]{1,2})?)/g
const numericMoneyRegex = /([0-9]{2,6}(?:\.[0-9]{1,2})?)(?:\s?(USD|usd|dollars))?/g
const phoneRegex = /(\+?\d[\d\-() ]{7,}\d)/g
const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig

export function extractPricingFindings(text: string, sourceUrl: string, title?: string): PricingFinding[] {
  const findings: PricingFinding[] = []
  if (!text || text.length < 20) return findings

  // Search for dollar amounts first
  const prices: { price_text: string; index: number; price: number }[] = []
  let m: RegExpExecArray | null
  while ((m = moneyRegex.exec(text)) !== null) {
    const raw = m[0]
    const num = parseFloat(m[1].replace(/,/g, ''))
    prices.push({ price_text: raw, index: m.index, price: num })
  }

  // Also look for bare numeric prices with USD
  while ((m = numericMoneyRegex.exec(text)) !== null) {
    const raw = m[0]
    const num = parseFloat(m[1].replace(/,/g, ''))
    prices.push({ price_text: raw, index: m.index, price: num })
  }

  // If no prices found, try headline/title for patterns like "Cash price: $95"
  if (prices.length === 0 && title) {
    let mt: RegExpExecArray | null
    while ((mt = moneyRegex.exec(title)) !== null) {
      const raw = mt[0]
      const num = parseFloat(mt[1].replace(/,/g, ''))
      prices.push({ price_text: raw, index: mt.index, price: num })
    }
  }

  // For each found price, capture surrounding context and try to extract service/provider
  for (const p of prices.slice(0, 8)) {
    const start = Math.max(0, p.index - 200)
    const end = Math.min(text.length, p.index + 200)
    const evidence = text.slice(start, end)

    // Find nearest service term in evidence
    const lower = evidence.toLowerCase()
    let service: string | undefined
    for (const term of SERVICE_TERMS) {
      if (lower.includes(term)) {
        service = term
        break
      }
    }

    // Try to guess provider name from title or from lines above the price
    let provider: string | undefined = undefined
    if (title && title.length > 0) provider = title

    // Find phone and email in evidence
    const phoneMatch = evidence.match(phoneRegex)
    const emailMatch = evidence.match(emailRegex)

    findings.push({
      provider_name: provider,
      service_name: service || undefined,
      price: p.price,
      price_text: p.price_text,
      currency: 'USD',
      location: undefined,
      phone: phoneMatch ? phoneMatch[0] : undefined,
      email: emailMatch ? emailMatch[0] : undefined,
      evidence_text: evidence,
      confidence: service ? 0.9 : 0.5,
    })
  }

  return findings
}
