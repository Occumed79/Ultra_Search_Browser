export const dynamic = 'force-dynamic'

function deployedCommit(): string {
  return (
    process.env.RENDER_GIT_COMMIT
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.GIT_COMMIT_SHA
    || 'unknown'
  )
}

function healthPayload() {
  return {
    status: 'ok',
    service: 'ultra-search-browser',
    searchPipeline: 'orchestrated-v3-adapter-blend',
    commit: deployedCommit(),
    capabilities: {
      database: Boolean(process.env.DATABASE_URL),
      searxng: Boolean(process.env.SEARXNG_URL),
      insightHub: Boolean(process.env.INSIGHT_HUB_API_URL),
      localEmbeddings: process.env.ENABLE_LOCAL_EMBEDDINGS === 'true',
      ocr: process.env.ENABLE_OCR === 'true',
      marginalia: process.env.ENABLE_MARGINALIA !== 'false',
    },
    checkedAt: new Date().toISOString(),
  }
}

export async function GET() {
  return Response.json(healthPayload(), {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}

export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
