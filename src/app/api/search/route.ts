import { NextRequest, NextResponse } from "next/server";
import { searchIntelligence, type SearchLens } from "../../../lib/search";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, lens } = body as { query: string; lens?: SearchLens };

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const { intelligence, results, pgvectorDiagnostics } = await searchIntelligence(query, lens);

    return NextResponse.json({
      query: intelligence.query,
      lens: intelligence.lens,
      summary: intelligence.summary,
      expandedQueries: intelligence.queryExpansions,
      signals: intelligence.signals,
      results,
      sources: intelligence.sources,
      timestamp: intelligence.timestamp,
      confidence: intelligence.confidence,
      pgvectorDiagnostics,
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
