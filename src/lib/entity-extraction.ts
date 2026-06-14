import type { ProcurementIntelligence, ProviderIntelligence, PricingIntelligence, LegalIntelligence, MedicalIntelligence, AcademicIntelligence, FinancialIntelligence } from '../types/search'

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
 * Extract legal intelligence from text and URL
 */
export function extractLegalIntelligence(
  text: string,
  url: string,
  title: string
): LegalIntelligence | undefined {
  const lowerText = text.toLowerCase()
  const lowerTitle = title.toLowerCase()

  // Determine legal type
  let legalType: LegalIntelligence['legal_type'] = 'unknown'
  if (/court|ruling|judgment|decision|case law/i.test(lowerText) || /v\.|vs\.|plaintiff|defendant/i.test(lowerText)) {
    legalType = 'case law'
  } else if (/statute|act|bill|legislation|code/i.test(lowerText) || /\d+\s+U\.S\.C\.|§\s+\d+/i.test(text)) {
    legalType = 'statute'
  } else if (/regulation|rule|compliance|requirement|standard/i.test(lowerText)) {
    legalType = 'regulation'
  } else if (/compliance|adhere|requirement|mandate/i.test(lowerText)) {
    legalType = 'compliance'
  }

  // Extract case name
  const caseMatch = text.match(/([A-Z][a-zA-Z\s&]+(?:v\.|vs\.|versus)[A-Z][a-zA-Z\s&]+)/i) ||
                   title.match(/([A-Z][a-zA-Z\s&]+(?:v\.|vs\.|versus)[A-Z][a-zA-Z\s&]+)/i)
  const caseName = caseMatch ? caseMatch[1].trim() : undefined

  // Extract court
  const courtMatch = text.match(/(?:Court of|Supreme Court|District Court|Circuit Court|Appellate Court)\s+(?:the\s+)?([A-Z][a-zA-Z\s]+)/i)
  const court = courtMatch ? courtMatch[1].trim() : undefined

  // Extract jurisdiction
  const jurisdictionMatch = text.match(/(?:Jurisdiction|State|Federal|Circuit)\s*[:\s]+([A-Z][a-zA-Z\s]+)/i)
  const jurisdiction = jurisdictionMatch ? jurisdictionMatch[1].trim() : undefined

  // Extract citation
  const citationMatch = text.match(/\d+\s+F\.\d+|\d+\s+U\.S\.\s+\d+|\d+\s+S\.Ct\.\s+\d+/i)
  const citation = citationMatch ? citationMatch[0] : undefined

  // Extract decision date
  const dateMatch = text.match(/(?:Decided|Decision Date|Date)\s*[:\s]+([A-Z][a-z]+ \d{1,2},?\s+\d{4})/i) ||
                    text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/)
  const decisionDate = dateMatch ? dateMatch[1] : undefined

  // Extract statute name
  const statuteMatch = text.match(/(?:Act|Statute|Code)\s+(?:of\s+)?([A-Z][a-zA-Z\s]+)/i)
  const statuteName = statuteMatch ? statuteMatch[1].trim() : undefined

  // Extract regulation number
  const regMatch = text.match(/(?:Regulation|Rule|CFR)\s*[:\s]+(\d+\s+CFR\s+\d+\.?\d*)/i)
  const regulationNumber = regMatch ? regMatch[1] : undefined

  // Calculate source confidence
  const signals = [
    caseName ? 'case name' : '',
    citation ? 'citation' : '',
    court ? 'court' : '',
    legalType !== 'unknown' ? 'legal type' : '',
  ].filter(Boolean)

  const sourceConfidence = Math.min(95, 40 + signals.length * 10)

  return {
    case_name: caseName,
    court,
    jurisdiction,
    citation,
    decision_date: decisionDate,
    statute_name: statuteName,
    regulation_number: regulationNumber,
    source_confidence: sourceConfidence,
    document_url: url,
    matched_signals: signals,
    legal_type: legalType !== 'unknown' ? legalType : undefined,
  }
}

/**
 * Extract medical intelligence from text and URL
 */
export function extractMedicalIntelligence(
  text: string,
  url: string,
  title: string
): MedicalIntelligence | undefined {
  const lowerText = text.toLowerCase()
  const lowerTitle = title.toLowerCase()

  // Determine medical type
  let medicalType: MedicalIntelligence['medical_type'] = 'unknown'
  if (/clinical trial|study|research|investigation/i.test(lowerText) || /nct\d+/i.test(text)) {
    medicalType = 'research'
  } else if (/clinical|treatment|therapy|intervention|procedure/i.test(lowerText)) {
    medicalType = 'clinical'
  } else if (/diagnosis|diagnostic|screening|test/i.test(lowerText)) {
    medicalType = 'diagnosis'
  } else if (/treatment|therapy|medication|drug/i.test(lowerText)) {
    medicalType = 'treatment'
  }

  // Extract condition
  const conditionMatch = text.match(/(?:condition|disease|disorder|syndrome)\s*[:\s]+([A-Z][a-zA-Z\s]+)/i) ||
                        title.match(/([A-Z][a-zA-Z\s]+(?:Disease|Disorder|Syndrome|Condition))/i)
  const condition = conditionMatch ? conditionMatch[1].trim() : undefined

  // Extract treatment
  const treatmentMatch = text.match(/(?:treatment|therapy)\s*(?:for|of)\s+([a-zA-Z\s]+)/i)
  const treatment = treatmentMatch ? treatmentMatch[1].trim() : undefined

  // Extract diagnosis
  const diagnosisMatch = text.match(/(?:diagnosis|diagnosed as)\s*[:\s]+([a-zA-Z\s]+)/i)
  const diagnosis = diagnosisMatch ? diagnosisMatch[1].trim() : undefined

  // Extract study type
  const studyTypeMatch = text.match(/(?:study type|design)\s*[:\s]+([a-zA-Z\s]+)/i)
  const studyType = studyTypeMatch ? studyTypeMatch[1].trim() : undefined

  // Extract clinical trial ID
  const trialMatch = text.match(/NCT\d+/i)
  const clinicalTrialId = trialMatch ? trialMatch[0] : undefined

  // Extract publication date
  const dateMatch = text.match(/(?:Published|Publication Date)\s*[:\s]+([A-Z][a-z]+ \d{1,2},?\s+\d{4})/i) ||
                    text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/)
  const publicationDate = dateMatch ? dateMatch[1] : undefined

  // Calculate source confidence
  const signals = [
    condition ? 'condition' : '',
    clinicalTrialId ? 'clinical trial ID' : '',
    medicalType !== 'unknown' ? 'medical type' : '',
    /\.edu\b/i.test(url) ? 'academic source' : '',
    /\.gov\b/i.test(url) ? 'government source' : '',
  ].filter(Boolean)

  const sourceConfidence = Math.min(95, 40 + signals.length * 10)

  return {
    condition,
    treatment,
    diagnosis,
    study_type: studyType,
    clinical_trial_id: clinicalTrialId,
    publication_date: publicationDate,
    source_confidence: sourceConfidence,
    document_url: url,
    matched_signals: signals,
    medical_type: medicalType !== 'unknown' ? medicalType : undefined,
  }
}

/**
 * Extract academic intelligence from text and URL
 */
export function extractAcademicIntelligence(
  text: string,
  url: string,
  title: string
): AcademicIntelligence | undefined {
  const lowerText = text.toLowerCase()
  const lowerTitle = title.toLowerCase()

  // Determine academic type
  let academicType: AcademicIntelligence['academic_type'] = 'unknown'
  if (/journal|article|paper/i.test(lowerText) || /doi\.org/i.test(url)) {
    academicType = 'journal'
  } else if (/conference|proceedings|symposium/i.test(lowerText)) {
    academicType = 'conference'
  } else if (/thesis|dissertation|doctoral/i.test(lowerText)) {
    academicType = 'thesis'
  } else if (/preprint|arxiv|bioRxiv|medRxiv/i.test(lowerText) || /arxiv\.org/i.test(url)) {
    academicType = 'preprint'
  }

  // Extract paper title (use title if available)
  const paperTitle = title

  // Extract authors
  const authorsMatch = text.match(/(?:Authors?|By)\s*[:\s]+([A-Z][a-zA-Z\s,]+)/i)
  const authors = authorsMatch ? authorsMatch[1].split(',').map(a => a.trim()) : undefined

  // Extract journal
  const journalMatch = text.match(/(?:Journal|Published in)\s*[:\s]+([A-Z][a-zA-Z\s]+)/i)
  const journal = journalMatch ? journalMatch[1].trim() : undefined

  // Extract publication date
  const dateMatch = text.match(/(?:Published|Publication Date)\s*[:\s]+([A-Z][a-z]+ \d{1,2},?\s+\d{4})/i) ||
                    text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/)
  const publicationDate = dateMatch ? dateMatch[1] : undefined

  // Extract DOI
  const doiMatch = text.match(/doi:\s*(10\.\d+\/[^\s]+)/i) || url.match(/doi\.org\/(10\.\d+\/[^\s]+)/i)
  const doi = doiMatch ? (doiMatch[1] || doiMatch[0].replace('doi:', '').replace('doi.org/', '')) : undefined

  // Extract citation count
  const citationMatch = text.match(/(?:citations?|cited by)\s*[:\s]+(\d+)/i)
  const citationCount = citationMatch ? parseInt(citationMatch[1]) : undefined

  // Extract abstract
  const abstractMatch = text.match(/(?:Abstract)\s*[:\s]+([^.]+\.)/i)
  const abstract = abstractMatch ? abstractMatch[1] : undefined

  // Calculate source confidence
  const signals = [
    doi ? 'DOI' : '',
    journal ? 'journal' : '',
    authors ? 'authors' : '',
    academicType !== 'unknown' ? 'academic type' : '',
    /\.edu\b/i.test(url) ? 'academic source' : '',
  ].filter(Boolean)

  const sourceConfidence = Math.min(95, 40 + signals.length * 10)

  return {
    paper_title: paperTitle,
    authors,
    journal,
    publication_date: publicationDate,
    doi,
    citation_count: citationCount,
    abstract,
    source_confidence: sourceConfidence,
    document_url: url,
    matched_signals: signals,
    academic_type: academicType !== 'unknown' ? academicType : undefined,
  }
}

/**
 * Extract financial intelligence from text and URL
 */
export function extractFinancialIntelligence(
  text: string,
  url: string,
  title: string
): FinancialIntelligence | undefined {
  const lowerText = text.toLowerCase()
  const lowerTitle = title.toLowerCase()

  // Determine financial type
  let financialType: FinancialIntelligence['financial_type'] = 'unknown'
  if (/earnings|revenue|profit|income statement|q\d+|fiscal/i.test(lowerText)) {
    financialType = 'earnings'
  } else if (/financial report|annual report|10-k|10-q/i.test(lowerText)) {
    financialType = 'report'
  } else if (/market|stock|trading|equity|share/i.test(lowerText)) {
    financialType = 'market'
  } else if (/economic|gdp|inflation|unemployment|federal reserve/i.test(lowerText)) {
    financialType = 'economic'
  }

  // Extract company name
  const companyMatch = text.match(/(?:Company|Corporation|Inc\.|LLC)\s*[:\s]+([A-Z][a-zA-Z\s]+)/i) ||
                       title.match(/([A-Z][a-zA-Z\s]+(?:Inc\.|LLC|Corporation|Company))/i)
  const companyName = companyMatch ? companyMatch[1].trim() : undefined

  // Extract ticker
  const tickerMatch = text.match(/\(([A-Z]{1,5})\)|NYSE:\s*([A-Z]{1,5})|NASDAQ:\s*([A-Z]{1,5})/i)
  const ticker = tickerMatch ? (tickerMatch[1] || tickerMatch[2] || tickerMatch[3]) : undefined

  // Extract report type
  const reportTypeMatch = text.match(/(?:Report Type|Form)\s*[:\s]+([A-Z0-9-]+)/i)
  const reportType = reportTypeMatch ? reportTypeMatch[1] : undefined

  // Extract reporting period
  const periodMatch = text.match(/(?:Period|Quarter|Fiscal Year)\s*[:\s]+([A-Z0-9\s]+)/i)
  const reportingPeriod = periodMatch ? periodMatch[1] : undefined

  // Extract revenue
  const revenueMatch = text.match(/(?:Revenue|Total Revenue)\s*[:\s]?\$?([\d,]+(?:\.\d{2})?)/i)
  const revenue = revenueMatch ? `$${revenueMatch[1]}` : undefined

  // Extract profit
  const profitMatch = text.match(/(?:Profit|Net Income|Earnings)\s*[:\s]?\$?([\d,]+(?:\.\d{2})?)/i)
  const profit = profitMatch ? `$${profitMatch[1]}` : undefined

  // Extract EPS
  const epsMatch = text.match(/(?:EPS|Earnings Per Share)\s*[:\s]?\$?([\d.]+)/i)
  const eps = epsMatch ? `$${epsMatch[1]}` : undefined

  // Calculate source confidence
  const signals = [
    companyName ? 'company name' : '',
    ticker ? 'ticker' : '',
    revenue ? 'revenue' : '',
    financialType !== 'unknown' ? 'financial type' : '',
    /\.gov\b/i.test(url) ? 'government source' : '',
  ].filter(Boolean)

  const sourceConfidence = Math.min(95, 40 + signals.length * 10)

  return {
    company_name: companyName,
    ticker,
    report_type: reportType,
    reporting_period: reportingPeriod,
    revenue,
    profit,
    eps,
    source_confidence: sourceConfidence,
    document_url: url,
    matched_signals: signals,
    financial_type: financialType !== 'unknown' ? financialType : undefined,
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
): ProcurementIntelligence | ProviderIntelligence | PricingIntelligence | LegalIntelligence | MedicalIntelligence | AcademicIntelligence | FinancialIntelligence | undefined {
  switch (lens) {
    case 'procurement':
      return extractProcurementIntelligence(text, url, title)
    case 'provider':
      return extractProviderIntelligence(text, url, title)
    case 'pricing':
      return extractPricingIntelligence(text, url, title)
    case 'legal':
      return extractLegalIntelligence(text, url, title)
    case 'medical':
      return extractMedicalIntelligence(text, url, title)
    case 'academic':
      return extractAcademicIntelligence(text, url, title)
    case 'financial':
      return extractFinancialIntelligence(text, url, title)
    default:
      return undefined
  }
}
