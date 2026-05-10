import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const url = process.env.NUXT_TURSO_URL
const authToken = process.env.NUXT_TURSO_AUTH_TOKEN

if (!url) throw new Error('NUXT_TURSO_URL is required')

const client = createClient({ url, authToken })
const db = drizzle(client)

await migrate(db, { migrationsFolder: resolve(__dirname, '../migrations') })
console.log('Migrations applied.')
client.close()
