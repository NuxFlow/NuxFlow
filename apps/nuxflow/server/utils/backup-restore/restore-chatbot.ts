// ── Chatbot knowledge restore ─────────────────────────────────────────────────
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { chatKnowledge } from '@nuxflow/db/schema'
import type { Db } from '../db'
import type { NuxFlowBackup, RestoreOptions, RestoreResult } from '../backup-types'
import { MAX_KNOWLEDGE_ENTRIES } from '../chatbot-admin'

/**
 * The chatbot's FAQ and free-text entries, restored with the settings (the chatbot's own
 * settings are a setting). Matched by kind + title: 'overwrite' replaces the answer, 'skip'
 * and 'archive' keep the site's own. Conversations never travel — they're people's data.
 * The index task learns the restored entries by itself.
 */
export async function restoreChatKnowledge(db: Db, siteId: string, backup: NuxFlowBackup, opts: RestoreOptions, result: RestoreResult): Promise<void> {
  if (!opts.what.includes('settings') || !backup.chatKnowledge?.length) return
  const counts = { created: 0, updated: 0, skipped: 0 }
  const existing = await db.query.chatKnowledge.findMany({ where: eq(chatKnowledge.siteId, siteId), columns: { id: true, kind: true, title: true } })
  const byKey = new Map(existing.map(e => [`${e.kind}:${e.title}`, e.id]))
  let total = existing.length
  for (const entry of backup.chatKnowledge) {
    const id = byKey.get(`${entry.kind}:${entry.title}`)
    if (id) {
      if (opts.conflictMode === 'overwrite') {
        await db.update(chatKnowledge).set({ body: entry.body, enabled: entry.enabled, updatedAt: new Date().toISOString() })
          .where(and(eq(chatKnowledge.id, id), eq(chatKnowledge.siteId, siteId)))
        counts.updated++
      }
      else counts.skipped++
      continue
    }
    if (total >= MAX_KNOWLEDGE_ENTRIES) {
      counts.skipped++
      continue
    }
    const newId = ulid()
    await db.insert(chatKnowledge).values({ id: newId, siteId, kind: entry.kind, title: entry.title, body: entry.body, enabled: entry.enabled })
    byKey.set(`${entry.kind}:${entry.title}`, newId)
    total++
    counts.created++
  }
  result.chatKnowledge = counts
}
