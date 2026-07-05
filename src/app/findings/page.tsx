import { Suspense } from 'react'
import { query } from '../../lib/db'

export default async function FindingsPage() {
  // Fetch recent pricing findings (fail-open)
  let rows: any[] = []
  try {
    const res = await query(`SELECT id, provider_name, service_name, price, price_text, currency, location, phone, email, evidence_text, source_url, confidence, created_at FROM pricing_findings ORDER BY created_at DESC LIMIT 200`)
    if (res && res.rows) rows = res.rows
  } catch (err) {
    console.warn('Failed to load pricing findings:', err)
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Pricing Findings</h1>
      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">No findings available — make a pricing search or configure DATABASE_URL to enable findings persistence.</div>
      ) : (
        <div className="grid gap-4">
          {rows.map(r => (
            <div key={r.id} className="p-4 rounded-lg bg-[#0f1724] border border-[#233242]">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-sm text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
                  <a href={r.source_url} target="_blank" rel="noreferrer" className="text-lg font-medium hover:underline">{r.provider_name || r.source_url}</a>
                </div>
                <div className="text-right">
                  <div className="text-sm">{r.service_name}</div>
                  <div className="text-xl mt-1">{r.price_text || (r.price ? `$${r.price}` : '—')}</div>
                </div>
              </div>
              <div className="mt-3 text-sm text-muted-foreground">{r.evidence_text?.slice(0, 300)}</div>
              <div className="mt-3 flex gap-2">
                <a className="text-xs text-blue-300 hover:underline" href={r.source_url} target="_blank" rel="noreferrer">Open source</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
