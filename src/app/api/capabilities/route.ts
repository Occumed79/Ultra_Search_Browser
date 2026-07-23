export async function GET() {
  return Response.json({
    database: {
      configured: Boolean(process.env.DATABASE_URL),
      label: 'Persistent history, bookmarks, and search memory',
    },
    searxng: {
      configured: Boolean(process.env.SEARXNG_URL),
      label: 'Self-hosted SearXNG search source',
    },
    insightHub: {
      configured: Boolean(process.env.INSIGHT_HUB_API_URL),
      label: 'Insight Hub adapter-backed procurement opportunities',
    },
    localEmbeddings: {
      configured: process.env.ENABLE_LOCAL_EMBEDDINGS === 'true',
      label: 'Local sentence-transformer embeddings',
    },
    ocr: {
      configured: process.env.ENABLE_OCR === 'true',
      label: 'Image and scanned-document OCR',
    },
  })
}
