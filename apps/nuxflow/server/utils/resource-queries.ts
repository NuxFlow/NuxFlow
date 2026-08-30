import { media, comments, menus, taxonomies, taxonomyTerms, themes, dynamicPlugins, videoAssets, membershipTiers, forms } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import type { Db } from './db'

export async function getMediaByIdOrThrow(db: Db, siteId: string, id: string, message = 'Not found', columns?: Record<string, boolean>) {
  const item = await db.query.media.findFirst({
    where: and(eq(media.id, id), eq(media.siteId, siteId)),
    columns,
  })
  if (!item) notFound(message)
  return item
}

export async function getCommentByIdOrThrow(db: Db, siteId: string, id: string, message = 'Comment not found') {
  const item = await db.query.comments.findFirst({
    where: and(eq(comments.id, id), eq(comments.siteId, siteId)),
  })
  if (!item) notFound(message)
  return item
}

export async function getMenuByIdOrThrow(db: Db, siteId: string, id: string, message = 'Menu not found') {
  const item = await db.query.menus.findFirst({
    where: and(eq(menus.id, id), eq(menus.siteId, siteId)),
  })
  if (!item) notFound(message)
  return item
}

export async function getTaxonomyByIdOrThrow(db: Db, siteId: string, id: string, message = 'Taxonomy not found') {
  const item = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.id, id), eq(taxonomies.siteId, siteId)),
  })
  if (!item) notFound(message)
  return item
}

export async function getTaxonomyTermByIdOrThrow(db: Db, taxonomyId: string, termId: string, message = 'Term not found') {
  const item = await db.query.taxonomyTerms.findFirst({
    where: and(eq(taxonomyTerms.id, termId), eq(taxonomyTerms.taxonomyId, taxonomyId)),
  })
  if (!item) notFound(message)
  return item
}

export async function getThemeByIdOrThrow(db: Db, siteId: string, id: string, message = 'Theme not found', columns?: Record<string, boolean>) {
  const item = await db.query.themes.findFirst({
    where: and(eq(themes.id, id), eq(themes.siteId, siteId)),
    columns,
  })
  if (!item) notFound(message)
  return item
}

export async function getDynamicPluginByIdOrThrow(db: Db, siteId: string, id: string, message = 'Dynamic plugin not found') {
  const item = await db.query.dynamicPlugins.findFirst({
    where: and(eq(dynamicPlugins.id, id), eq(dynamicPlugins.siteId, siteId)),
  })
  if (!item) notFound(message)
  return item
}

export async function getVideoAssetByIdOrThrow(db: Db, siteId: string, id: string, message = 'Video asset not found') {
  const item = await db.query.videoAssets.findFirst({
    where: and(eq(videoAssets.id, id), eq(videoAssets.siteId, siteId)),
  })
  if (!item) notFound(message)
  return item
}

export async function getMembershipTierByIdOrThrow(db: Db, siteId: string, id: string, message = 'Membership tier not found', columns?: Record<string, boolean>) {
  const item = await db.query.membershipTiers.findFirst({
    where: and(eq(membershipTiers.id, id), eq(membershipTiers.siteId, siteId)),
    columns,
  })
  if (!item) notFound(message)
  return item
}

export async function getFormByIdOrThrow(db: Db, siteId: string, id: string, message = 'Form not found', columns?: Record<string, boolean>) {
  const item = await db.query.forms.findFirst({
    where: and(eq(forms.id, id), eq(forms.siteId, siteId)),
    columns,
  })
  if (!item) notFound(message)
  return item
}

export async function getFormBySlugOrThrow(db: Db, siteId: string, slug: string, message = 'Form not found') {
  const item = await db.query.forms.findFirst({
    where: and(eq(forms.siteId, siteId), eq(forms.slug, slug)),
  })
  if (!item) notFound(message)
  return item
}
