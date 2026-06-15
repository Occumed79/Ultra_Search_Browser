export async function GET() {
  return Response.json({ ok: true, service: "ultra-search-browser", awake: true });
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}
