import { createClient } from '@libsql/client'

const url = process.env.NUXT_TURSO_URL!
const authToken = process.env.NUXT_TURSO_AUTH_TOKEN || undefined

const client = createClient({ url, authToken })

const tables = await client.execute(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
console.log('\nAll tables:')
tables.rows.forEach((r: any) => console.log(' ', r.name))

try {
  const rows = await client.execute(`SELECT filename, applied_at FROM _nuxflow_migrations ORDER BY filename`)
  console.log('\n_nuxflow_migrations rows:')
  rows.rows.forEach((r: any) => console.log(' ', r.filename, '|', r.applied_at))
} catch (e: any) {
  console.log('\n_nuxflow_migrations: NOT FOUND —', e.message)
}

client.close()
