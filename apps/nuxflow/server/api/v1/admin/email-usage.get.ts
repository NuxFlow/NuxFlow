import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { emailLog, sites } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { requireSuperAdmin } from '../../../utils/permissions'
import { getEmailBinding } from '../../../utils/cf-env'

/**
 * Outbound email across every site, from NuxFlow's own send log (email_log) — Cloudflare's
 * sending quota is per account, so one busy or misbehaving tenant eats everyone's. Counts
 * are what NuxFlow attempted, not Cloudflare's billing figures (those are in the
 * Cloudflare dashboard under Email Service → Analytics).
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  const db = useDb(event)

  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)
  const since1 = new Date(Date.now() - 86_400_000).toISOString().replace('T', ' ').slice(0, 19)

  const [perSite, recentFailures] = await Promise.all([
    db.select({
      siteId: emailLog.siteId,
      siteName: sites.name,
      domain: sites.domain,
      sent30d: sql<number>`sum(case when ${emailLog.status} = 'sent' then 1 else 0 end)`,
      failed30d: sql<number>`sum(case when ${emailLog.status} = 'failed' then 1 else 0 end)`,
      sent24h: sql<number>`sum(case when ${emailLog.status} = 'sent' and ${emailLog.createdAt} >= ${since1} then 1 else 0 end)`,
      cloudflare30d: sql<number>`sum(case when ${emailLog.provider} = 'cloudflare' and ${emailLog.status} = 'sent' then 1 else 0 end)`,
    })
      .from(emailLog)
      .leftJoin(sites, eq(sites.id, emailLog.siteId))
      .where(gte(emailLog.createdAt, since30))
      .groupBy(emailLog.siteId, sites.name, sites.domain)
      .orderBy(desc(sql`count(*)`)),
    db.select({
      id: emailLog.id,
      siteName: sites.name,
      toAddress: emailLog.toAddress,
      subject: emailLog.subject,
      category: emailLog.category,
      provider: emailLog.provider,
      error: emailLog.error,
      createdAt: emailLog.createdAt,
    })
      .from(emailLog)
      .leftJoin(sites, eq(sites.id, emailLog.siteId))
      .where(and(eq(emailLog.status, 'failed'), gte(emailLog.createdAt, since30)))
      .orderBy(desc(emailLog.createdAt))
      .limit(50),
  ])

  return {
    sites: perSite.map(r => ({ ...r, sent30d: Number(r.sent30d ?? 0), failed30d: Number(r.failed30d ?? 0), sent24h: Number(r.sent24h ?? 0), cloudflare30d: Number(r.cloudflare30d ?? 0) })),
    recentFailures,
    sendingBindingPresent: !!getEmailBinding(event),
    inboundEmailDomain: String(useRuntimeConfig().inboundEmailDomain ?? '') || null,
  }
})
