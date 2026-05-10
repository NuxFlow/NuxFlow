import { createClient } from '@libsql/client'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const url = process.env.NUXT_TURSO_URL
const authToken = process.env.NUXT_TURSO_AUTH_TOKEN

if (!url) throw new Error('NUXT_TURSO_URL is required')

const client = createClient({ url, authToken: authToken || undefined })
const sql = readFileSync(resolve(__dirname, '../migrations/0001_fts5_search_index.sql'), 'utf8')

await client.executeMultiple(sql)

console.log('FTS5 migration applied.')
client.close()
