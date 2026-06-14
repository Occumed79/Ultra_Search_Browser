import { NextRequest, NextResponse } from "next/server";
import { searchIntelligence, generateMockResults, type Vertical } from "@/lib/search";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, vertical } = body as { query: string; vertical?: Vertical };

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    try {
      const result = await searchIntelligence(query, vertical);
      return NextResponse.json(result);
    } catch (err) {
      console.warn("Intelligence search failed, falling back to mock:", err);
      const mock = generateMockResults(query);
      return NextResponse.json({
        organization: mock.organization,
        vertical: vertical || "contact",
        confidence: Math.round(mock.contacts.reduce((a, c) => a + c.confidence, 0) / mock.contacts.length),
        contacts: mock.contacts,
        signals: [],
        sources: mock.sources,
        queryExpansions: [],
        timestamp: mock.timestamp,
        note: "Search engines unavailable. Showing generated data.",
      });
    }
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
