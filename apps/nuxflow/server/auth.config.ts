import { defineServerAuth } from '@onmax/nuxt-better-auth/config'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createClient } from '@libsql/client'
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql'
import { drizzle as drizzleD1 } from 'drizzle-orm/d1'
import * as schema from '@nuxflow/db/schema'
import { getD1 } from './utils/db'
import { hashPassword, verifyPassword } from './utils/crypto'

export default defineServerAuth((ctx) => {
  const config = ctx.runtimeConfig as {
    tursoUrl: string
    tursoAuthToken: string
    googleClientId?: string
    googleClientSecret?: string
    githubClientId?: string
    githubClientSecret?: string
  }

  // D1 is cached into getD1() by the 01.d1-cache middleware which runs for every
  // request before this callback is invoked. The result is cached per-siteUrl by
  // the nuxt-better-auth runtime so this runs once per CF Workers isolate.
  let db: ReturnType<typeof drizzleLibsql<typeof schema>> | ReturnType<typeof drizzleD1<typeof schema>>

  const d1 = getD1()
  if (d1) {
    db = drizzleD1(d1 as Parameters<typeof drizzleD1>[0], { schema })
  }

  if (!db!) {
    const client = createClient({
      url: config.tursoUrl,
      authToken: config.tursoAuthToken || undefined,
    })
    db = drizzleLibsql(client, { schema })
  }

  return {
    database: drizzleAdapter(db!, {
      provider: 'sqlite',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
      usePlural: false,
      // @ts-expect-error — DrizzleAdapterConfig doesn't type `experimental.joins` yet; valid at runtime
      experimental: { joins: true },
      // D1 does not support interactive transactions — disable so the adapter
      // uses individual statements instead of wrapping in BEGIN/COMMIT.
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      password: {
        // Use Web Crypto PBKDF2 — crypto.subtle runs as native workerd code outside
        // V8's CPU budget, avoiding "worker exceeded resource limits" on CF free plan.
        hash: hashPassword,
        verify: ({ hash, password }: { hash: string; password: string }) => verifyPassword(hash, password),
      },
    },
    rateLimit: { enabled: false },
    socialProviders: {
      google: {
        clientId: config.googleClientId ?? '',
        clientSecret: config.googleClientSecret ?? '',
        enabled: Boolean(config.googleClientId),
      },
      github: {
        clientId: config.githubClientId ?? '',
        clientSecret: config.githubClientSecret ?? '',
        enabled: Boolean(config.githubClientId),
      },
    },
  }
})
