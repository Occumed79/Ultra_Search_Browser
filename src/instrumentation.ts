export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (!process.env.DATABASE_URL) return

  const { ensureDatabaseSchema } = await import('./lib/database-schema-lifecycle')
  const state = await ensureDatabaseSchema()
  if (state.status !== 'ready') {
    console.warn('Optional database schema is not ready; core search remains available.', state)
  }
}
