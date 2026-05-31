import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.NUXT_TURSO_URL!,
    authToken: process.env.NUXT_TURSO_AUTH_TOKEN,
  },
})
