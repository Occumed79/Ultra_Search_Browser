import type { ProcurementIntelligence, ProviderIntelligence, PricingIntelligence } from '../types/search'

// ─── ENTITY EXTRACTION ───

/**
 * Extract structured procurement intelligence from text and URL
 */
export function extractProcurementIntelligence(
  text: string,
  url: string,
  title: string
): ProcurementIntelligence | undefined {
  const lowerText = text.toLowerCase()
  const lowerTitle = title.toLowerCase()

  // Determine opportunity type
  let opportunityType: ProcurementIntelligence['opportunity_type'] = 'unknown'
  if (/rfp|request for proposal/i.test(lowerText) || /rfp|request for proposal/i.test(lowerTitle)) {
    opportunityType = 'RFP'
  } else if (/rfq|request for quotation/i.test(lowerText) || /rfq|request for quotation/i.test(lowerTitle)) {
    opportunityType = 'RFQ'
  } else if (/rft|request for tender/i.test(lowerText) || /rft|request for tender/i.test(lowerTitle)) {
    opportunityType = 'RFT'
  } else if (/solicitation/i.test(lowerText) || /solicitation/i.test(lowerTitle)) {
    opportunityType = 'solicitation'
  } else if (/bid|tender/i.test(lowerText) || /bid|tender/i.test(lowerTitle)) {
    opportunityType = 'bid'
  } else if (/procurement/i.test(lowerText) || /procurement/i.test(lowerTitle)) {
    opportunityType = 'procurement'
  }

  // Extract organization (usually county, city, or agency name)
  const orgMatch = text.match(/(?:County|City|State|Department|Agency|District)\s+of\s+([A-Z][a-zA-Z\s]+)/i) ||
                    title.match(/([A-Z][a-zA-Z\s]+(?:County|City|State|Department|Agency|District))/i)
  const organization = orgMatch ? orgMatch[1].trim() : title.split(/\s+/).slice(0, 3).join(' ')

  // Extract service (occupational health, etc.)
  const serviceMatch = text.match(/(?:for|providing|offering)\s+([a-zA-Z\s]+(?:services|health|medicine|clinic))/i) ||
                        title.match(/([a-zA-Z\s]+(?:Health|Medicine|Services))/i)
  const service = serviceMatch ? serviceMatch[1].trim() : 'occupational health services'

  // Extract due date
  const dueDateMatch = text.match(/(?:due date|deadline|closing|responses due|submission deadline)[:\s]+([A-Z][a-z]+ \d{1,2},?\s+\d{4})/i) ||
                       text.match(/(?:due|deadline)[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i)
  const dueDate = dueDateMatch ? dueDateMatch[1] : undefined

  // Extract procurement email
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  const procurementEmail = emailMatch ? emailMatch[0] : undefined

  // Extract procurement phone
  const phoneMatch = text.match(new RegExp('(?:phone|tel|call)[:\\s]*\\d[\\d\\s]*)?(\\+?1?\\d[\\d\\s]*)', 'i'))
  const procurementPhone = phoneMatch ? phoneMatch[1] : undefined

  // Extract monetary value
  const moneyMatch = text.match(/\$[\d,]+(?:\.\d{2})?|\$\d+\s*(?:million|k|K)/i)
  const monetaryValue = moneyMatch ? moneyMatch[0] : undefined

  // Extract posted date
  const postedMatch = text.match(/(?:posted|published|date)[:\s]+([A-Z][a-z]+ \d{1,2},?\s+\d{4})/i) ||
                      text.match(/(?:posted|published)[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i)
  const postedDate = postedMatch ? postedMatch[1] : undefined

  // Determine status
  let status: ProcurementIntelligence['status'] = 'unknown'
  if (/open|active|current|accepting proposals/i.test(lowerText)) {
    status = 'open'
  } else if (/closed|awarded|expired/i.test(lowerText)) {
    status = 'closed'
  }

  // Calculate source confidence based on signals
  const signals = [
    opportunityType !== 'unknown' ? 'procurement language' : '',
    /\.gov/i.test(url) ? '.gov domain' : '',
    /sam\.gov|bonfire|planetbids|ionwave|bidnet/i.test(url) ? 'procurement portal' : '',
    dueDate ? 'includes deadline' : '',
    monetaryValue ? 'monetary value' : '',
    status === 'open' ? 'active opportunity' : '',
  ].filter(Boolean)

  const sourceConfidence = Math.min(95, 40 + signals.length * 10)

  return {
    organization,
    opportunity_type: opportunityType,
    service,
    due_date: dueDate,
    procurement_email: procurementEmail,
    procurement_phone: procurementPhone,
    source_confidence: sourceConfidence,
    document_url: url,
    matched_signals: signals,
    monetary_value: monetaryValue,
    posted_date: postedDate,
    status,
  }
}

/**
 * Extract structured provider intelligence from text and URL
 */
export function extractProviderIntelligence(
  text: string,
  url: string,
  title: string
): ProviderIntelligence | undefined {
  const lowerText = text.toLowerCase()

  // Extract provider name
  const nameMatch = title.match(/([A-Z][a-zA-Z\s]+(?:Clinic|Center|Health|Medicine|Medical|Occupational))/i) ||
                    text.match(/(?:provider|clinic|facility)[:\s]+([A-Z][a-zA-Z\s]+)/i)
  const providerName = nameMatch ? nameMatch[1].trim() : title.split(/\s+/).slice(0, 2).join(' ')

  // Extract address
  const addressMatch = text.match(/(\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+,\s+[A-Z]{2}\s+\d{5})/i)
  const address = addressMatch ? addressMatch[1] : undefined

  // Extract city/state/zip from address
  let city, state, zip
  if (address) {
    const parts = address.split(', ')
    if (parts.length >= 2) {
      city = parts[0].split(/\d+/)[1]?.trim() || parts[0]
      const stateZip = parts[1].trim()
      const stateMatch = stateZip.match(/^([A-Z]{2})/)
      const zipMatch = stateZip.match(/(\d{5})/)
      state = stateMatch ? stateMatch[1] : undefined
      zip = zipMatch ? zipMatch[1] : undefined
    }
  }

  // Extract provider phone
  const phoneMatch = text.match(new RegExp('(?:phone|tel|call)[:\\s]*\\d[\\d\\s]*)?(\\+?1?\\d[\\d\\s]*)', 'i'))
  const providerPhone = phoneMatch ? phoneMatch[1] : undefined

  // Extract services offered
  const services: string[] = []
  if (/occupational health|occupational medicine/i.test(lowerText)) services.push('occupational health')
  if (/dot physical|cdl physical/i.test(lowerText)) services.push('DOT physical')
  if (/drug test|drug screening/i.test(lowerText)) services.push('drug testing')
  if (/pft|spirometry|pulmonary function/i.test(lowerText)) services.push('PFT')
  if (/audiometry|hearing test/i.test(lowerText)) services.push('audiometry')
  if (/respirator|fit test/i.test(lowerText)) services.push('respirator fit test')
  if (/physical exam|pre-employment/i.test(lowerText)) services.push('physical exams')

  // Extract credentials
  const credentials: string[] = []
  if (/board certified/i.test(lowerText)) credentials.push('Board Certified')
  if (/licensed/i.test(lowerText)) credentials.push('Licensed')
  if (/accredited/i.test(lowerText)) credentials.push('Accredited')

  // Determine payment acceptance
  const acceptsSelfPay = /self-pay|cash pay|out-of-pocket/i.test(lowerText)
  const acceptsEmployer = /employer|work comp|workers compensation/i.test(lowerText)

  // Calculate source confidence
  const signals = [
    address ? 'physical address' : '',
    providerPhone ? 'contact information' : '',
    services.length > 0 ? 'occupational services' : '',
    credentials.length > 0 ? 'credentials' : '',
  ].filter(Boolean)

  const sourceConfidence = Math.min(95, 40 + signals.length * 10)

  return {
    provider_name: providerName,
    address,
    city,
    state,
    zip,
    provider_phone: providerPhone,
    services_offered: services,
    source_confidence: sourceConfidence,
    website_url: url,
    matched_signals: signals,
    credentials: credentials.length > 0 ? credentials : undefined,
    accepts_self_pay: acceptsSelfPay || undefined,
    accepts_employer: acceptsEmployer || undefined,
  }
}

/**
 * Extract structured pricing intelligence from text and URL
 */
export function extractPricingIntelligence(
  text: string,
  url: string,
  title: string
): PricingIntelligence | undefined {
  const lowerText = text.toLowerCase()

  // Extract provider name
  const nameMatch = title.match(/([A-Z][a-zA-Z\s]+(?:Clinic|Center|Health|Medicine|Medical))/i) ||
                    text.match(/(?:provider|clinic|facility)[:\s]+([A-Z][a-zA-Z\s]+)/i)
  const providerName = nameMatch ? nameMatch[1].trim() : title.split(/\s+/).slice(0, 2).join(' ')

  // Determine service category
  let serviceCategory: PricingIntelligence['service_category'] = 'unknown'
  if (/pft|spirometry|pulmonary function/i.test(lowerText)) {
    serviceCategory = 'PFT'
  } else if (/dot physical|cdl physical/i.test(lowerText)) {
    serviceCategory = 'DOT'
  } else if (/physical exam|pre-employment/i.test(lowerText)) {
    serviceCategory = 'physical'
  } else if (/drug test|drug screening/i.test(lowerText)) {
    serviceCategory = 'drug test'
  } else if (/audiometry|hearing test/i.test(lowerText)) {
    serviceCategory = 'audiometry'
  } else if (/respirator|fit test/i.test(lowerText)) {
    serviceCategory = 'respirator'
  }

  const service = serviceCategory !== 'unknown' 
    ? `${serviceCategory} testing` 
    : 'occupational health services'

  // Extract cash price
  const cashMatch = text.match(/(?:self-pay|cash|out-of-pocket)[:\s]*\$?([\d,]+(?:\.\d{2})?)/i)
  const priceCash = cashMatch ? `$${cashMatch[1]}` : undefined

  // Extract employer price
  const employerMatch = text.match(/(?:employer|work comp|workers comp)[:\s]*\$?([\d,]+(?:\.\d{2})?)/i)
  const priceEmployer = employerMatch ? `$${employerMatch[1]}` : undefined

  // Extract price range
  const rangeMatch = text.match(/\$([\d,]+)\s*-\s*\$([\d,]+)/i)
  const priceRange = rangeMatch ? `$${rangeMatch[1]} - $${rangeMatch[2]}` : undefined

  // Determine payment types
  const paymentTypes: PricingIntelligence['payment_types'] = []
  if (/self-pay|cash|out-of-pocket/i.test(lowerText)) paymentTypes.push('self-pay', 'cash')
  if (/employer|work comp|workers compensation/i.test(lowerText)) paymentTypes.push('employer', 'work comp')
  if (/insurance/i.test(lowerText)) paymentTypes.push('insurance')

  // Calculate source confidence
  const signals = [
    priceCash ? 'self-pay mention' : '',
    priceEmployer ? 'employer payment' : '',
    serviceCategory !== 'unknown' ? 'service category' : '',
    /fee schedule|price list|rate card/i.test(lowerText) ? 'pricing document' : '',
  ].filter(Boolean)

  const sourceConfidence = Math.min(95, 40 + signals.length * 10)

  return {
    provider_name: providerName,
    service,
    price_cash: priceCash,
    price_employer: priceEmployer,
    price_range: priceRange,
    source_confidence: sourceConfidence,
    document_url: url,
    matched_signals: signals,
    payment_types: paymentTypes.length > 0 ? paymentTypes : undefined,
    service_category: serviceCategory !== 'unknown' ? serviceCategory : undefined,
  }
}

/**
 * Route to appropriate intelligence extraction based on lens
 */
export function extractIntelligence(
  text: string,
  url: string,
  title: string,
  lens: string
): ProcurementIntelligence | ProviderIntelligence | PricingIntelligence | undefined {
  switch (lens) {
    case 'procurement':
      return extractProcurementIntelligence(text, url, title)
    case 'provider':
      return extractProviderIntelligence(text, url, title)
    case 'pricing':
      return extractPricingIntelligence(text, url, title)
    default:
      return undefined
  }
}
