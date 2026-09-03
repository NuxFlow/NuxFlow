import { useDb } from '../utils/db'
import { videoAssets } from '@nuxflow/db/schema'
import { and, count, eq, lt } from 'drizzle-orm'

// Cloudflare Stream processing normally finishes within minutes. A video_assets row
// stuck at status:'processing' past this TTL means the registration lookup succeeded
// at upload time but Stream itself never finished (or never will) — nothing else in
// the app ever revisits these rows, so without this sweep they'd sit stuck forever.
const STUCK_PROCESSING_TTL_HOURS = 2

export const reconcileStuckVideos = async () => {
  const db = useDb()

  // Cutoff as SQLite-compatible datetime string (space separator, no trailing Z),
  // matching the convention used by prune-old-data.ts.
  const cutoffDate = new Date(Date.now() - STUCK_PROCESSING_TTL_HOURS * 3_600_000)
    .toISOString().replace('T', ' ').slice(0, 19)

  const where = and(eq(videoAssets.status, 'processing'), lt(videoAssets.createdAt, cutoffDate))

  const [row] = await db
    .select({ value: count() })
    .from(videoAssets)
    .where(where)

  const reconciled = row?.value ?? 0
  if (reconciled > 0) {
    await db.update(videoAssets).set({ status: 'failed' }).where(where)
  }

  return { reconciled }
}
