// ── Membership tiers restore ──────────────────────────────────────────────────
// Matched by name. Deliberately does not touch `subscriptions` — see the comment on
// BackupMembershipTier for why copying those rows would be actively misleading.
import { and, eq, inArray } from 'drizzle-orm'
import { membershipTiers } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import type { Db } from '../db'
import type { NuxFlowBackup, RestoreOptions, RestoreResult } from '../backup-types'

export async function restoreMembershipTiers(
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<void> {
  if (!opts.what.includes('membershipTiers') || !backup.membershipTiers) return

  // One prefetch instead of one findFirst() per tier.
  const tierNames = backup.membershipTiers.map(t => t.name)
  const existingTierRows = tierNames.length > 0
    ? await db.query.membershipTiers.findMany({
        where: and(eq(membershipTiers.siteId, siteId), inArray(membershipTiers.name, tierNames)),
        columns: { id: true, name: true },
      })
    : []
  const tierByName = new Map(existingTierRows.map(t => [t.name, t]))

  for (const backupTier of backup.membershipTiers) {
    const existing = tierByName.get(backupTier.name)
    if (existing) {
      if (opts.conflictMode === 'overwrite') {
        await db.update(membershipTiers).set({
          description: backupTier.description,
          price: backupTier.price,
          currency: backupTier.currency,
          interval: backupTier.interval,
          features: backupTier.features,
          stripeProductId: backupTier.stripeProductId,
          stripePriceId: backupTier.stripePriceId,
          lsProductId: backupTier.lsProductId,
          lsVariantId: backupTier.lsVariantId,
          paddleProductId: backupTier.paddleProductId,
          isActive: backupTier.isActive,
        }).where(eq(membershipTiers.id, existing.id))
        result.membershipTiers.updated++
      } else {
        result.membershipTiers.skipped++
      }
    } else {
      const id = ulid()
      await db.insert(membershipTiers).values({
        id,
        siteId,
        name: backupTier.name,
        description: backupTier.description,
        price: backupTier.price,
        currency: backupTier.currency,
        interval: backupTier.interval,
        features: backupTier.features,
        stripeProductId: backupTier.stripeProductId,
        stripePriceId: backupTier.stripePriceId,
        lsProductId: backupTier.lsProductId,
        lsVariantId: backupTier.lsVariantId,
        paddleProductId: backupTier.paddleProductId,
        isActive: backupTier.isActive,
      })
      result.membershipTiers.created++
      // Duplicate tier name within the same backup.json (hand-edited): treat the second
      // entry as already-existing instead of attempting a second insert for the same
      // (siteId, name).
      tierByName.set(backupTier.name, { id, name: backupTier.name })
    }
  }
}
