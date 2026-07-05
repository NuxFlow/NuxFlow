import { defineConfig } from 'drizzle-kit'

// D1 is the only supported production database — it's plain SQLite under the hood,
// so drizzle-kit's generic 'sqlite' dialect diffs the schema without needing a live
// connection. `generate` never touches dbCredentials. `studio` does, and needs a real
// file: set DB_LOCAL_PATH to the local D1 sqlite file `wrangler dev` creates under
// apps/nuxflow/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_LOCAL_PATH ?? 'file:./local.db',
  },
})
