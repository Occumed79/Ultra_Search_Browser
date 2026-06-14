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

  // Determine opportunity type with more patterns
  let opportunityType: ProcurementIntelligence['opportunity_type'] = 'unknown'
  const typePatterns = [
    { pattern: /rfp|request for proposal|request for proposals/i, type: 'RFP' as const },
    { pattern: /rfq|request for quotation|request for quote/i, type: 'RFQ' as const },
    { pattern: /rft|request for tender|request for tenders/i, type: 'RFT' as const },
    { pattern: /solicitation|solicitations/i, type: 'solicitation' as const },
    { pattern: /bid|bidding|invitation to bid|itb/i, type: 'bid' as const },
    { pattern: /tender|tendering/i, type: 'tender' as const },
    { pattern: /procurement|contract/i, type: 'procurement' as const },
    { pattern: /quote|quotation/i, type: 'RFQ' as const },
    { pattern: /proposal|proposals/i, type: 'RFP' as const },
  ]
  
  for (const { pattern, type } of typePatterns) {
    if (pattern.test(lowerText) || pattern.test(lowerTitle)) {
      opportunityType = type
      break
    }
  }

  // Extract organization with more patterns
  const orgPatterns = [
    /(?:County|City|State|Department|Agency|District|Bureau|Office|Authority|Commission)\s+(?:of|for)\s+([A-Z][a-zA-Z\s]+)/i,
    /([A-Z][a-zA-Z\s]+(?:County|City|State|Department|Agency|District|Bureau|Office|Authority|Commission))/i,
    /(?:Department|Agency|Office)\s+of\s+([A-Z][a-zA-Z\s]+)/i,
  ]
  
  let organization = title.split(/\s+/).slice(0, 3).join(' ')
  for (const pattern of orgPatterns) {
    const match = text.match(pattern) || title.match(pattern)
    if (match) {
      organization = match[1].trim()
      break
    }
  }

  // Extract service with more patterns
  const servicePatterns = [
    /(?:for|providing|offering|services?|contract for)\s+([a-zA-Z\s]+(?:services?|health|medicine|clinic|care|support|management|consulting))/i,
    /([a-zA-Z\s]+(?:Health|Medicine|Services|Care|Support|Management|Consulting))/i,
  ]
  
  let service = 'professional services'
  for (const pattern of servicePatterns) {
    const match = text.match(pattern) || title.match(pattern)
    if (match) {
      service = match[1].trim()
      break
    }
  }

  // Extract due date with more patterns
  const dueDatePatterns = [
    /(?:due date|deadline|closing|responses due|submission deadline|response due)[:\s]+([A-Z][a-z]+ \d{1,2},?\s+\d{4})/i,
    /(?:due|deadline|closing)[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /(?:due|deadline)[:\s]+(\d{4}-\d{2}-\d{2})/i,
    /(?:due|deadline)[:\s]+(\d{1,2}\s+[A-Z][a-z]+,\s+\d{4})/i,
  ]
  
  let dueDate: string | undefined
  for (const pattern of dueDatePatterns) {
    const match = text.match(pattern)
    if (match) {
      dueDate = match[1]
      break
    }
  }

  // Extract procurement email
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  const procurementEmail = emailMatch ? emailMatch[0] : undefined

  // Extract procurement phone with more patterns
  const phonePatterns = [
    /(?:phone|tel|call|contact|telephone)[:\s]*(\+?1?[\d\s\-\(\)]{10,})/i,
    /(\+?1?[\d\s\-\(\)]{10,})/,
  ]
  
  let procurementPhone: string | undefined
  for (const pattern of phonePatterns) {
    const match = text.match(pattern)
    if (match) {
      procurementPhone = match[1].replace(/[\s\-\(\)]/g, '')
      break
    }
  }

  // Extract monetary value with more patterns
  const moneyPatterns = [
    /\$[\d,]+(?:\.\d{2})?/i,
    /\$\d+\s*(?:million|billion|k|K|M|B)/i,
    /(?:estimated|approx|about|up to)\s*\$[\d,]+/i,
  ]
  
  let monetaryValue: string | undefined
  for (const pattern of moneyPatterns) {
    const match = text.match(pattern)
    if (match) {
      monetaryValue = match[0]
      break
    }
  }

  // Extract posted date with more patterns
  const postedPatterns = [
    /(?:posted|published|date|created|issued)[:\s]+([A-Z][a-z]+ \d{1,2},?\s+\d{4})/i,
    /(?:posted|published|date)[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /(?:posted|published|date)[:\s]+(\d{4}-\d{2}-\d{2})/i,
  ]
  
  let postedDate: string | undefined
  for (const pattern of postedPatterns) {
    const match = text.match(pattern)
    if (match) {
      postedDate = match[1]
      break
    }
  }

  // Determine status with more patterns
  let status: ProcurementIntelligence['status'] = 'unknown'
  const statusPatterns = [
    { pattern: /open|active|current|accepting proposals|accepting bids/i, status: 'open' as const },
    { pattern: /closed|awarded|expired|complete|withdrawn/i, status: 'closed' as const },
    { pattern: /pending|under review|evaluation/i, status: 'active' as const },
  ]
  
  for (const { pattern, status: s } of statusPatterns) {
    if (pattern.test(lowerText)) {
      status = s
      break
    }
  }

  // Calculate source confidence based on signals
  const signals = [
    opportunityType !== 'unknown' ? 'procurement language' : '',
    /\.gov/i.test(url) ? '.gov domain' : '',
    /sam\.gov|bonfire|planetbids|ionwave|bidnet|governmentbids|rfpdb/i.test(url) ? 'procurement portal' : '',
    dueDate ? 'includes deadline' : '',
    monetaryValue ? 'monetary value' : '',
    status === 'open' ? 'active opportunity' : '',
    procurementEmail ? 'contact email' : '',
    procurementPhone ? 'contact phone' : '',
  ].filter(Boolean)

  const sourceConfidence = Math.min(95, 35 + signals.length * 8)

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

  // Extract provider name with more patterns
  const namePatterns = [
    /([A-Z][a-zA-Z\s]+(?:Clinic|Center|Health|Medicine|Medical|Occupational|Wellness|Care))/i,
    /(?:provider|clinic|facility|practice|hospital)[:\s]+([A-Z][a-zA-Z\s]+)/i,
    /([A-Z][a-zA-Z\s]+(?:Associates|Group|Partners))/i,
  ]
  
  let providerName = title.split(/\s+/).slice(0, 2).join(' ')
  for (const pattern of namePatterns) {
    const match = text.match(pattern) || title.match(pattern)
    if (match) {
      providerName = match[1].trim()
      break
    }
  }

  // Extract address with more patterns
  const addressPatterns = [
    /(\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+,\s+[A-Z]{2}\s+\d{5})/i,
    /(\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\s+[A-Z]{2}\s+\d{5})/i,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+,\s+[A-Z]{2}\s+\d{5})/i,
  ]
  
  let address: string | undefined
  for (const pattern of addressPatterns) {
    const match = text.match(pattern)
    if (match) {
      address = match[1]
      break
    }
  }

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

  // Extract provider phone with more patterns
  const phonePatterns = [
    /(?:phone|tel|call|contact|telephone)[:\s]*(\+?1?[\d\s\-\(\)]{10,})/i,
    /(\+?1?[\d\s\-\(\)]{10,})/,
  ]
  
  let providerPhone: string | undefined
  for (const pattern of phonePatterns) {
    const match = text.match(pattern)
    if (match) {
      providerPhone = match[1].replace(/[\s\-\(\)]/g, '')
      break
    }
  }

  // Extract services offered with more patterns
  const servicePatterns = [
    { pattern: /occupational health|occupational medicine|occ health/i, service: 'occupational health' },
    { pattern: /dot physical|cdl physical|department of transportation/i, service: 'DOT physical' },
    { pattern: /drug test|drug screening|drug screen|substance abuse/i, service: 'drug testing' },
    { pattern: /pft|spirometry|pulmonary function|lung function/i, service: 'PFT' },
    { pattern: /audiometry|hearing test|hearing screening/i, service: 'audiometry' },
    { pattern: /respirator|fit test|respiratory protection/i, service: 'respirator fit test' },
    { pattern: /physical exam|pre-employment|pre employment/i, service: 'physical exams' },
    { pattern: /vaccination|immunization|flu shot|tb test/i, service: 'vaccinations' },
    { pattern: /x-ray|radiology|imaging/i, service: 'x-ray services' },
    { pattern: /lab|laboratory|blood work/i, service: 'laboratory services' },
  ]
  
  const services: string[] = []
  for (const { pattern, service } of servicePatterns) {
    if (pattern.test(lowerText)) {
      services.push(service)
    }
  }

  // Extract credentials with more patterns
  const credentialPatterns = [
    { pattern: /board certified|board-certified/i, credential: 'Board Certified' },
    { pattern: /licensed|licensure/i, credential: 'Licensed' },
    { pattern: /accredited|accreditation/i, credential: 'Accredited' },
    { pattern: /certified|certification/i, credential: 'Certified' },
    { pattern: /fellow|fellowship/i, credential: 'Fellow' },
  ]
  
  const credentials: string[] = []
  for (const { pattern, credential } of credentialPatterns) {
    if (pattern.test(lowerText)) {
      credentials.push(credential)
    }
  }

  // Determine payment acceptance
  const acceptsSelfPay = /self-pay|cash pay|out-of-pocket|private pay/i.test(lowerText)
  const acceptsEmployer = /employer|work comp|workers compensation|workers' comp/i.test(lowerText)
  const acceptsInsurance = /insurance|in-network|blue cross|aetna|cigna|united/i.test(lowerText)

  // Calculate source confidence
  const signals = [
    address ? 'physical address' : '',
    providerPhone ? 'contact information' : '',
    services.length > 0 ? 'occupational services' : '',
    credentials.length > 0 ? 'credentials' : '',
    acceptsInsurance ? 'accepts insurance' : '',
  ].filter(Boolean)

  const sourceConfidence = Math.min(95, 35 + signals.length * 8)

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
    accepts_self_pay: acceptsSelfPay,
    accepts_employer: acceptsEmployer,
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

  // Extract provider name with more patterns
  const namePatterns = [
    /([A-Z][a-zA-Z\s]+(?:Clinic|Center|Health|Medicine|Medical))/i,
    /(?:provider|clinic|facility|practice)[:\s]+([A-Z][a-zA-Z\s]+)/i,
  ]
  
  let providerName = title.split(/\s+/).slice(0, 2).join(' ')
  for (const pattern of namePatterns) {
    const match = text.match(pattern) || title.match(pattern)
    if (match) {
      providerName = match[1].trim()
      break
    }
  }

  // Determine service category with more patterns
  const servicePatterns = [
    { pattern: /pft|spirometry|pulmonary function|lung function/i, category: 'PFT' as const },
    { pattern: /dot physical|cdl physical|department of transportation/i, category: 'DOT' as const },
    { pattern: /physical exam|pre-employment|pre employment/i, category: 'physical' as const },
    { pattern: /drug test|drug screening|drug screen|substance abuse/i, category: 'drug test' as const },
    { pattern: /audiometry|hearing test|hearing screening/i, category: 'audiometry' as const },
    { pattern: /respirator|fit test|respiratory protection/i, category: 'respirator' as const },
    { pattern: /vaccination|immunization|flu shot/i, category: 'vaccination' as const },
    { pattern: /x-ray|radiology|imaging/i, category: 'x-ray' as const },
    { pattern: /lab|laboratory|blood work/i, category: 'lab' as const },
  ]
  
  let serviceCategory: PricingIntelligence['service_category'] = 'unknown'
  for (const { pattern, category } of servicePatterns) {
    if (pattern.test(lowerText)) {
      serviceCategory = category
      break
    }
  }

  const service = serviceCategory !== 'unknown' 
    ? `${serviceCategory} testing` 
    : 'occupational health services'

  // Extract cash price with more patterns
  const cashPatterns = [
    /(?:self-pay|cash|out-of-pocket|private pay)[:\s]*\$?([\d,]+(?:\.\d{2})?)/i,
    /\$([\d,]+(?:\.\d{2})?)\s*(?:self-pay|cash|out-of-pocket)/i,
  ]
  
  let priceCash: string | undefined
  for (const pattern of cashPatterns) {
    const match = text.match(pattern)
    if (match) {
      priceCash = `$${match[1]}`
      break
    }
  }

  // Extract employer price with more patterns
  const employerPatterns = [
    /(?:employer|work comp|workers comp|workers' comp)[:\s]*\$?([\d,]+(?:\.\d{2})?)/i,
    /\$([\d,]+(?:\.\d{2})?)\s*(?:employer|work comp)/i,
  ]
  
  let priceEmployer: string | undefined
  for (const pattern of employerPatterns) {
    const match = text.match(pattern)
    if (match) {
      priceEmployer = `$${match[1]}`
      break
    }
  }

  // Extract price range with more patterns
  const rangePatterns = [
    /\$([\d,]+)\s*-\s*\$([\d,]+)/i,
    /(?:from|between)\s*\$([\d,]+)\s*(?:and|to)\s*\$([\d,]+)/i,
  ]
  
  let priceRange: string | undefined
  for (const pattern of rangePatterns) {
    const match = text.match(pattern)
    if (match) {
      priceRange = `$${match[1]} - $${match[2]}`
      break
    }
  }

  // Determine payment types with more patterns
  const paymentTypes: PricingIntelligence['payment_types'] = []
  if (/self-pay|cash|out-of-pocket|private pay/i.test(lowerText)) {
    paymentTypes.push('self-pay', 'cash')
  }
  if (/employer|work comp|workers compensation|workers' comp/i.test(lowerText)) {
    paymentTypes.push('employer', 'work comp')
  }
  if (/insurance|in-network|blue cross|aetna|cigna|united/i.test(lowerText)) {
    paymentTypes.push('insurance')
  }

  // Calculate source confidence
  const signals = [
    priceCash ? 'self-pay mention' : '',
    priceEmployer ? 'employer payment' : '',
    serviceCategory !== 'unknown' ? 'service category' : '',
    /fee schedule|price list|rate card|pricing/i.test(lowerText) ? 'pricing document' : '',
  ].filter(Boolean)

  const sourceConfidence = Math.min(95, 35 + signals.length * 8)

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
  const pubDateMatch = text.match(/(?:Published|Date|Publication)[:\s]+([A-Z][a-z]+ \d{1,2},?\s+\d{4})/i)
  const publicationDate = pubDateMatch ? pubDateMatch[1] : undefined

  // Extract DOI
  const doiMatch = text.match(/doi[:\s]+(10\.\d+\/[^\s]+)/i) || url.match(/doi\.org\/(10\.\d+\/[^\s]+)/)
  const doi = doiMatch ? doiMatch[1] : undefined

  // Extract citation count
  const citationMatch = text.match(/(?:citations|cited by)[:\s]+(\d+)/i)
  const citationCount = citationMatch ? parseInt(citationMatch[1]) : undefined

  // Extract abstract
  const abstractMatch = text.match(/(?:Abstract|Summary)[:\s]+([^.]+\.)/i)
  const abstract = abstractMatch ? abstractMatch[1] : undefined

  // Calculate source confidence
  const signals = [
    academicType !== 'unknown' ? 'academic type detected' : '',
    doi ? 'DOI present' : '',
    authors ? 'authors listed' : '',
    journal ? 'journal specified' : '',
    publicationDate ? 'publication date' : '',
  ].filter(Boolean)

  const sourceConfidence = Math.min(95, 35 + signals.length * 8)

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
