import type { drizzle } from 'drizzle-orm/d1'
import type * as schema from '../schema'

/**
 * Mirrors `apps/nuxflow/server/utils/db.ts`'s `Db` type. Duplicated (not
 * imported) because that file lives in the app and constructs its instance
 * from a live D1 binding — this package only ever receives an already-built
 * `Db` as a parameter, per the "no client factory" rule in packages/db.
 */
export type Db = ReturnType<typeof drizzle<typeof schema>>
