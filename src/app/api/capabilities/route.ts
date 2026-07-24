import { externalSmartFilterCapabilities } from '../../../lib/external-smart-filter'

export async function GET() {
  const providers = externalSmartFilterCapabilities()

  return Response.json({
    database: {
      configured: Boolean(process.env.DATABASE_URL),
      label: 'Persistent history, bookmarks, and search memory',
    },
    searxng: {
      configured: Boolean(process.env.SEARXNG_URL),
      label: 'Self-hosted SearXNG search source',
    },
    localEmbeddings: {
      configured: process.env.ENABLE_LOCAL_EMBEDDINGS === 'true',
      label: 'Local sentence-transformer embeddings',
    },
    cerebras: {
      configured: providers.cerebras.configured,
      label: providers.cerebras.configured
        ? `Primary smart filter · ${providers.cerebras.model}`
        : 'Primary smart-filter provider',
    },
    groq: {
      configured: providers.groq.configured,
      label: providers.groq.configured
        ? `Fallback and review filter · ${providers.groq.model}`
        : 'Fallback smart-filter provider',
    },
    ocr: {
      configured: process.env.ENABLE_OCR === 'true',
      label: 'Image and scanned-document OCR',
    },
  })
}
