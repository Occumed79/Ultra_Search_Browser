# Ultra Search Browser

A Kagi-style broad search browser with multi-engine aggregation, query intelligence, signal scoring, and structured results — all without API keys.

## Features

- **Multi-Engine Aggregation**: Simultaneously scrapes DuckDuckGo, Bing, and Google for maximum coverage
- **Query Expansion Engine**: Auto-expands queries with synonyms, operators, and lens-specific terms
- **Search Lenses**: Web, PDF, Government, Procurement, Pricing, Provider, Technical, News, Legal, Medical, Academic, and Financial lenses
- **Signal Scoring**: Domain authority, document type, and content signals for relevance ranking
- **Intelligence Objects**: Structured results with organization, opportunity type, due dates, and confidence scores
- **Document Extraction**: HTML, PDF, DOCX, and image text extraction with entity recognition
- **OCR Support**: Text extraction from images using Tesseract.js
- **Vector Storage**: Local in-memory and PostgreSQL pgvector adapters for semantic search
- **Zero API Keys**: Uses cheerio + web scraping — no paid services required

## Advanced Features Roadmap

### Currently Active
- **Local BM25 Reranking**: In-memory BM25-style term frequency scoring for result relevance
- **Document Text Extraction**: HTML, PDF, DOCX, and image text extraction with entity recognition (emails, phones, URLs, dates, monetary values)
- **PDF Binary Parsing**: Direct binary PDF file parsing using pdf-parse library
- **DOCX Binary Parsing**: Direct binary DOCX file parsing using mammoth library
- **OCR (Optical Character Recognition)**: Text extraction from images using Tesseract.js with confidence scoring
- **pgvector Retrieval**: PostgreSQL pgvector integration with pg library (requires DATABASE_URL and pgvector extension)
- **Intelligence Object Extraction**: Automatic extraction of structured data for procurement, provider, and pricing lenses
- **Vector Storage**: Local in-memory adapter and PostgreSQL pgvector adapter for semantic search

### Experimental
- **Local Pseudo-Vector Reranking**: Hash-based TF-IDF vector approximation for semantic similarity (in-memory, not production-grade embeddings)
- **Procurement Crawlers**: HTTP fetch adapters for SAM.gov, BonfireHub, IonWave, PlanetBids, BidNetDirect with improved CSS selectors and diagnostics

*See Settings → Advanced Features for current capability status and runtime notes.*

## Tech Stack

- Next.js 16 (App Router)
- React 19 + TypeScript
- Tailwind CSS + Framer Motion
- Cheerio (server-side scraping)
- pdf-parse (PDF binary parsing)
- mammoth (DOCX binary parsing)
- Tesseract.js (OCR)
- pg (PostgreSQL client)
- Radix UI Primitives
- Geist Font

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**No API keys required.** The app uses web scraping and local algorithms.

## Deployment

### 1. Push to GitHub

```bash
git add .
git commit -m "Ready for deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ultimate-search-browser.git
git push -u origin main
```

### 2. Deploy to Render

1. Go to [render.com](https://render.com) → **New Web Service**
2. Connect your GitHub repo
3. Settings:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free
4. Click **Create Web Service**

Render will auto-deploy on every push to `main`.

### 3. Neon Database (Optional, for pgvector)

For persistent vector storage and semantic search using pgvector:

1. Go to [neon.tech](https://neon.tech) → Create Project
2. Copy the connection string
3. Add to Render as `DATABASE_URL` env var
4. The app will automatically initialize the pgvector extension and schema on first use

**Why Neon?** With Neon + pgvector, you get persistent embeddings and true semantic/hybrid retrieval. The app includes a full PgVectorStoreAdapter implementation with cosine similarity search.

## License

MIT
