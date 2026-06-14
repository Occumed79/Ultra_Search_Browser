import * as cheerio from 'cheerio'

// ─── DOCUMENT EXTRACTION LAYER ───

export interface ExtractedDocument {
  text: string
  title?: string
  metadata: {
    fileType?: string
    pageCount?: number
    author?: string
    createdDate?: string
    modifiedDate?: string
  }
  entities: {
    emails: string[]
    phones: string[]
    urls: string[]
    dates: string[]
    monetaryValues: string[]
  }
  sections: {
    headers: string[]
    paragraphs: string[]
    tables: string[][]
  }
}

/**
 * Extract text from HTML content
 */
export function extractFromHTML(html: string): ExtractedDocument {
  const $ = cheerio.load(html)
  
  // Remove script/style elements
  $('script, style, nav, header, footer, iframe').remove()
  
  const text = $('body').text().replace(/\s+/g, ' ').trim()
  const title = $('title').text().trim() || $('h1').first().text().trim()
  
  // Extract sections
  const headers: string[] = []
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const header = $(el).text().trim()
    if (header) headers.push(header)
  })
  
  const paragraphs: string[] = []
  $('p').each((_, el) => {
    const para = $(el).text().trim()
    if (para.length > 20) paragraphs.push(para)
  })
  
  const tables: string[][] = []
  $('table').each((_, el) => {
    const tableData: string[] = []
    $(el).find('td, th').each((_, cell) => {
      tableData.push($(cell).text().trim())
    })
    if (tableData.length > 0) tables.push(tableData)
  })
  
  // Extract entities
  const entities = extractEntities(text)
  
  return {
    text,
    title,
    metadata: { fileType: 'html' },
    entities,
    sections: { headers, paragraphs, tables },
  }
}

/**
 * Extract entities from text
 */
export function extractEntities(text: string) {
  const emails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []
  
  const phones = text.match(new RegExp('(?:phone|tel|call)[:\\s]*\\d[\\d\\s]*)?(\\+?1?\\d[\\d\\s]*)', 'gi')) || []
  
  const urls = text.match(/https?:\/\/(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[a-zA-Z0-9-._~:/?#[\]@!$&'()*+,;=]*)?/g) || []
  
  const dates = text.match(
    /(?:\d{1,2}\/\d{1,2}\/\d{4})|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi
  ) || []
  
  const monetaryValues = text.match(/\$[\d,]+(?:\.\d{2})?|\$\d+\s*(?:million|k|K)/gi) || []
  
  return {
    emails: [...new Set(emails)],
    phones: [...new Set(phones)],
    urls: [...new Set(urls)],
    dates: [...new Set(dates)],
    monetaryValues: [...new Set(monetaryValues)],
  }
}

/**
 * Extract structured data from PDF text (simulated - would use pdf-parse in production)
 */
export function extractFromPDF(pdfText: string, metadata?: any): ExtractedDocument {
  const text = pdfText.replace(/\s+/g, ' ').trim()
  
  // Try to extract title from first few lines
  const lines = text.split('\n').filter(l => l.trim())
  const title = lines[0]?.trim() || undefined
  
  // Extract sections based on common patterns
  const headers: string[] = []
  const headerPatterns = [
    /^(?:Chapter|Section|Part)\s+\d+/i,
    /^[A-Z][A-Z\s]{10,}$/,
    /^\d+\.\s+[A-Z]/,
  ]
  
  lines.forEach(line => {
    for (const pattern of headerPatterns) {
      if (pattern.test(line)) {
        headers.push(line.trim())
        break
      }
    }
  })
  
  const paragraphs: string[] = []
  let currentPara = ''
  lines.forEach(line => {
    if (line.trim().length === 0) {
      if (currentPara.length > 50) {
        paragraphs.push(currentPara.trim())
        currentPara = ''
      }
    } else {
      currentPara += line + ' '
    }
  })
  if (currentPara.length > 50) paragraphs.push(currentPara.trim())
  
  const entities = extractEntities(text)
  
  return {
    text,
    title,
    metadata: {
      fileType: 'pdf',
      pageCount: metadata?.numPages || undefined,
      author: metadata?.info?.Author,
      createdDate: metadata?.info?.CreationDate,
      modifiedDate: metadata?.info?.ModDate,
    },
    entities,
    sections: { headers, paragraphs, tables: [] },
  }
}

/**
 * Extract from DOCX (simulated - would use mammoth in production)
 */
export function extractFromDOCX(docxContent: string): ExtractedDocument {
  const text = docxContent.replace(/\s+/g, ' ').trim()
  
  const lines = text.split('\n').filter(l => l.trim())
  const title = lines[0]?.trim() || undefined
  
  const headers: string[] = []
  lines.forEach(line => {
    if (/^[A-Z][A-Z\s]{8,}$/.test(line) || /^\d+\.\s+[A-Z]/.test(line)) {
      headers.push(line.trim())
    }
  })
  
  const paragraphs: string[] = []
  let currentPara = ''
  lines.forEach(line => {
    if (line.trim().length === 0) {
      if (currentPara.length > 30) {
        paragraphs.push(currentPara.trim())
        currentPara = ''
      }
    } else {
      currentPara += line + ' '
    }
  })
  if (currentPara.length > 30) paragraphs.push(currentPara.trim())
  
  const entities = extractEntities(text)
  
  return {
    text,
    title,
    metadata: { fileType: 'docx' },
    entities,
    sections: { headers, paragraphs, tables: [] },
  }
}

/**
 * Main extraction router
 */
export async function extractDocument(
  content: string,
  fileType: 'html' | 'pdf' | 'docx' | 'text',
  metadata?: any
): Promise<ExtractedDocument> {
  switch (fileType) {
    case 'html':
      return extractFromHTML(content)
    case 'pdf':
      return extractFromPDF(content, metadata)
    case 'docx':
      return extractFromDOCX(content)
    case 'text':
      return {
        text: content.replace(/\s+/g, ' ').trim(),
        metadata: { fileType: 'text' },
        entities: extractEntities(content),
        sections: { headers: [], paragraphs: [content], tables: [] },
      }
    default:
      return {
        text: content,
        metadata: { fileType: 'unknown' },
        entities: extractEntities(content),
        sections: { headers: [], paragraphs: [], tables: [] },
      }
  }
}

/**
 * Score document relevance based on query and extracted content
 */
export function scoreDocumentRelevance(
  document: ExtractedDocument,
  query: string,
  lens: string
): number {
  const queryTerms = query.toLowerCase().split(/\s+/)
  const text = document.text.toLowerCase()
  
  let score = 0
  
  // Term matching
  queryTerms.forEach(term => {
    const regex = new RegExp(term, 'gi')
    const matches = text.match(regex)
    if (matches) {
      score += matches.length * 5
    }
  })
  
  // Title bonus
  if (document.title) {
    const titleLower = document.title.toLowerCase()
    queryTerms.forEach(term => {
      if (titleLower.includes(term)) score += 20
    })
  }
  
  // Entity bonuses based on lens
  if (lens === 'procurement') {
    if (document.entities.dates.length > 0) score += 15
    if (document.entities.monetaryValues.length > 0) score += 15
    if (text.includes('rfp') || text.includes('solicitation')) score += 30
  }
  
  if (lens === 'pricing') {
    if (document.entities.monetaryValues.length > 0) score += 25
    if (text.includes('fee') || text.includes('price') || text.includes('rate')) score += 20
  }
  
  if (lens === 'provider') {
    if (document.entities.phones.length > 0) score += 15
    if (document.entities.emails.length > 0) score += 10
    if (text.includes('clinic') || text.includes('provider')) score += 20
  }
  
  // Section structure bonus
  if (document.sections.headers.length > 3) score += 10
  if (document.sections.tables.length > 0) score += 15
  
  return Math.min(100, score)
}
