import { eq, desc } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import {
  users, userSiteRoles, sites, contentItems, contentRevisions, media, comments,
  formSubmissions, subscriptions, apiKeys, auditLogs,
} from '@nuxflow/db/schema'

// Article 15 (right of access) / Article 20 (portability) self-service export. `users`
// is a single global account shared across every site in this D1 instance (no siteId
// column — see the multi-site note in CLAUDE.md), so every query here is scoped to
// `userId` alone, across every site, matching hasSuperAdminRole()'s own "any site"
// model elsewhere in this codebase. A deployment that has split into multiple
// independent Worker+D1 "pools" (see the Database size monitoring note in CLAUDE.md)
// only ever has one pool's data in front of a given request — a person with roles on
// sites split across pools needs to run this once per pool, an inherent limit of that
// architecture, not something a single request can see past.
//
// Deliberately excludes: full content bodies (title/slug/dates only — the body is the
// site's content, not personal data about the author), raw media bytes (already
// browsable via the media library; only a summary list here), notifications,
// push_subscriptions, and ai_generation_jobs (operational/system records, not data the
// person volunteered), and API key secrets (only a one-way hash is ever stored, per
// CLAUDE.md — there is no secret to export).
//
// Every query is capped so a single very active account can't produce an unbounded
// response — see CLAUDE.md's D1 export section for how costly an unbounded per-row
// read can get against real D1, even at a much smaller scale than a full DB dump.
const EXPORT_ROW_LIMIT = 2000

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const userId = session.user.id
  const db = useDb(event)

  const [profile] = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    image: users.image,
    phone: users.phone,
    emailVerified: users.emailVerified,
    createdAt: users.createdAt,
  }).from(users).where(eq(users.id, userId))

  if (!profile) {
    throw notFound('Account not found')
  }

  const [
    siteRoles,
    authoredContent,
    authoredRevisions,
    uploadedMedia,
    authoredComments,
    submissions,
    subs,
    keys,
    logs,
  ] = await Promise.all([
    db.select({
      siteId: userSiteRoles.siteId,
      role: userSiteRoles.role,
      createdAt: userSiteRoles.createdAt,
      siteName: sites.name,
      siteDomain: sites.domain,
    }).from(userSiteRoles)
      .innerJoin(sites, eq(sites.id, userSiteRoles.siteId))
      .where(eq(userSiteRoles.userId, userId)),

    db.select({
      id: contentItems.id, siteId: contentItems.siteId, title: contentItems.title,
      slug: contentItems.slug, status: contentItems.status, createdAt: contentItems.createdAt,
    }).from(contentItems).where(eq(contentItems.authorId, userId)).limit(EXPORT_ROW_LIMIT),

    db.select({
      id: contentRevisions.id, itemId: contentRevisions.itemId, title: contentRevisions.title,
      createdAt: contentRevisions.createdAt,
    }).from(contentRevisions).where(eq(contentRevisions.authorId, userId)).limit(EXPORT_ROW_LIMIT),

    db.select({
      id: media.id, siteId: media.siteId, filename: media.originalName, url: media.url,
      createdAt: media.createdAt,
    }).from(media).where(eq(media.uploadedBy, userId)).limit(EXPORT_ROW_LIMIT),

    db.select({
      id: comments.id, siteId: comments.siteId, itemId: comments.itemId, body: comments.body,
      status: comments.status, createdAt: comments.createdAt,
    }).from(comments).where(eq(comments.authorId, userId)).limit(EXPORT_ROW_LIMIT),

    db.select({
      id: formSubmissions.id, siteId: formSubmissions.siteId, formId: formSubmissions.formId,
      data: formSubmissions.data, createdAt: formSubmissions.createdAt,
    }).from(formSubmissions).where(eq(formSubmissions.userId, userId)).limit(EXPORT_ROW_LIMIT),

    db.select({
      id: subscriptions.id, siteId: subscriptions.siteId, provider: subscriptions.provider,
      status: subscriptions.status, tierId: subscriptions.tierId,
      currentPeriodStart: subscriptions.currentPeriodStart, currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd, createdAt: subscriptions.createdAt,
    }).from(subscriptions).where(eq(subscriptions.userId, userId)),

    db.select({
      id: apiKeys.id, siteId: apiKeys.siteId, name: apiKeys.name, scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt, createdAt: apiKeys.createdAt,
    }).from(apiKeys).where(eq(apiKeys.userId, userId)),

    db.select({
      id: auditLogs.id, siteId: auditLogs.siteId, action: auditLogs.action,
      resource: auditLogs.resource, resourceId: auditLogs.resourceId, createdAt: auditLogs.createdAt,
    }).from(auditLogs).where(eq(auditLogs.userId, userId)).orderBy(desc(auditLogs.createdAt)).limit(EXPORT_ROW_LIMIT),
  ])

  setResponseHeader(event, 'content-disposition', `attachment; filename="nuxflow-data-export.json"`)

  return {
    exportedAt: new Date().toISOString(),
    profile,
    siteRoles,
    authoredContent,
    authoredRevisions,
    uploadedMedia,
    comments: authoredComments,
    formSubmissions: submissions,
    subscriptions: subs,
    apiKeys: keys,
    auditLog: logs,
  }
})
