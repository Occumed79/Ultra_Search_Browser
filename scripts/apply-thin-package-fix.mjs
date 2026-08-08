import fs from 'node:fs'

const path = 'src/lib/page-validation.ts'
const source = fs.readFileSync(path, 'utf8')

const oldBlock = `    const document = await extractResponse(response, type, finalUrl)
    const primaryText = clean(document.text).slice(0, MAX_EXTRACTED_TEXT)
    const signal = inspectPageSignals(primaryText, finalUrl, result.url, document.title || result.title)
    let packageAnalysis: SolicitationPackageAnalysis | undefined

    if (
      lens === 'procurement'
      && signal.availability === 'reachable'
      && options.inspectPackage !== false
    ) {
      try {
        packageAnalysis = await inspectSolicitationPackage(finalUrl, document, {
          maxAttachments: 4,
          attachmentTimeoutMs: 4_500,
          maxCombinedText: MAX_EXTRACTED_TEXT,
          fetchImpl,
        })
      } catch (error) {
        console.warn('Solicitation package inspection failed:', finalUrl, error)
      }
    }

    const extractedText = clean(packageAnalysis?.combinedText || primaryText).slice(0, MAX_EXTRACTED_TEXT)
    const lifecycle = signal.availability === 'reachable'
      ? (packageAnalysis?.lifecycle || classifyResultStatus(\`${'${document.title || \'\'} ${extractedText}'}\`, lens))
      : {
          status: signal.availability === 'dead' ? 'dead' as const : 'junk' as const,
          reason: signal.reason,
          confidence: 0.94,
          dates: [],
        }
    const rfpIntelligence = lens === 'procurement' && signal.availability === 'reachable'
      ? extractRfpOpportunityIntelligence({
          text: extractedText,
          title: document.title || result.title,
          url: finalUrl,
          lifecycle,
          documents: packageAnalysis?.documents,
        })
      : undefined
`

const newBlock = `    const document = await extractResponse(response, type, finalUrl)
    const primaryText = clean(document.text).slice(0, MAX_EXTRACTED_TEXT)
    const initialSignal = inspectPageSignals(primaryText, finalUrl, result.url, document.title || result.title)
    const hasSolicitationPackageLink = (document.links || []).some(link =>
      /\\b(?:rfp|rfq|rfi|ifb|solicitation|bid|tender|procurement|request for proposals?|request for quotations?|attachment|amendment|addendum|scope of work|statement of work|specifications?)\\b|\\.(?:pdf|docx?)(?:$|[?#])/i
        .test(\`${'${link.text} ${link.url}'}\`)
    )
    let packageAnalysis: SolicitationPackageAnalysis | undefined

    if (
      lens === 'procurement'
      && options.inspectPackage !== false
      && (
        initialSignal.availability === 'reachable'
        || (initialSignal.availability === 'thin' && hasSolicitationPackageLink)
      )
    ) {
      try {
        packageAnalysis = await inspectSolicitationPackage(finalUrl, document, {
          maxAttachments: 4,
          attachmentTimeoutMs: 4_500,
          maxCombinedText: MAX_EXTRACTED_TEXT,
          fetchImpl,
        })
      } catch (error) {
        console.warn('Solicitation package inspection failed:', finalUrl, error)
      }
    }

    const extractedText = clean(packageAnalysis?.combinedText || primaryText).slice(0, MAX_EXTRACTED_TEXT)
    const signal = packageAnalysis && packageAnalysis.inspectedCount > 0
      ? inspectPageSignals(extractedText, finalUrl, result.url, document.title || result.title)
      : initialSignal
    const lifecycle = signal.availability === 'reachable'
      ? (packageAnalysis?.lifecycle || classifyResultStatus(\`${'${document.title || \'\'} ${extractedText}'}\`, lens))
      : {
          status: signal.availability === 'dead' ? 'dead' as const : 'junk' as const,
          reason: signal.reason,
          confidence: 0.94,
          dates: [],
        }
    const rfpIntelligence = lens === 'procurement' && signal.availability === 'reachable'
      ? extractRfpOpportunityIntelligence({
          text: extractedText,
          title: document.title || result.title,
          url: finalUrl,
          lifecycle,
          documents: packageAnalysis?.documents,
        })
      : undefined
`

if (!source.includes(oldBlock)) {
  throw new Error('Expected page-validation block was not found; refusing to patch an unknown source shape.')
}

fs.writeFileSync(path, source.replace(oldBlock, newBlock))
console.log('Patched thin procurement package validation.')
